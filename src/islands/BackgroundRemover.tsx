import { useEffect, useRef, useState } from 'preact/hooks';
import {
  validateImageFile,
  OUTPUT_FORMATS,
  OUTPUT_FORMAT_LABELS,
  OUTPUT_FORMAT_EXTENSIONS,
  LOSSY_FORMATS,
  DEFAULT_QUALITY,
  qualityToColorCount,
  type OutputFormat,
  type PngMode,
} from '../lib/tools/imageCompress';
import { rotatePoint, defaultPlacement, computeLinearGradientLine, type RgbaImageData, type Placement } from '../lib/tools/backgroundRemove';
import { applyBoxBlur, applyPixelate, DEFAULT_BLUR_RADIUS, DEFAULT_PIXEL_BLOCK_SIZE } from '../lib/tools/imageRedact';
import { FileDropzone } from './shared/FileDropzone';
import { CompareSlider } from './shared/CompareSlider';
import { ErrorMessage } from './shared/ErrorMessage';
import { formatBytes } from './shared/formatBytes';
import { SavingsBadge } from './shared/SavingsBadge';
import { downloadUrl } from './shared/downloadUrl';
import { useWorkerTask } from './shared/useWorkerTask';
import BackgroundRemoveWorker from '../workers/backgroundRemove.worker?worker';
import type { BackgroundRemoveWorkerRequest, BackgroundRemoveWorkerResult } from '../workers/backgroundRemove.worker';
import ImageCompressWorker from '../workers/imageCompress.worker?worker';
import type { ImageCompressWorkerRequest, ImageCompressWorkerResult } from '../workers/imageCompress.worker';

// Deliberately no ShareLinkButton — the input is a binary image file from the visitor's own
// disk, which can't (and shouldn't) be encoded into a URL. Same reasoning as every other
// image tool on this site.

type BackgroundMode = 'transparent' | 'color' | 'gradient' | 'image' | 'blur' | 'template';
type BlurStyle = 'blur' | 'pixelate';
/** Direction presets for the gradient fill, in the same 0°=right/90°=down clockwise
 *  convention `computeLinearGradientLine` uses, ordered like a compass starting at "up".
 *  Deliberately a fixed set of eight rather than a full angle dial — the common cases, not a
 *  full gradient editor. */
const GRADIENT_DIRECTIONS: { label: string; angle: number; title: string }[] = [
  { label: '↑', angle: 270, title: 'Bottom to top' },
  { label: '↗', angle: 315, title: 'Bottom-left to top-right' },
  { label: '→', angle: 0, title: 'Left to right' },
  { label: '↘', angle: 45, title: 'Top-left to bottom-right' },
  { label: '↓', angle: 90, title: 'Top to bottom' },
  { label: '↙', angle: 135, title: 'Top-right to bottom-left' },
  { label: '←', angle: 180, title: 'Right to left' },
  { label: '↖', angle: 225, title: 'Bottom-right to top-left' },
];
type PlaceDragMode = 'move' | 'scale' | 'rotate';

/** A background "template" is one of two kinds:
 *  - `'art'`: a small, deterministic canvas-drawing routine — zero added asset weight, no
 *    license question. The exact same `draw` function paints both the full-size export and
 *    its own gallery thumbnail, so a thumbnail can never drift from what actually exports.
 *  - `'photo'`: a real bundled photo (`public/samples/bg-*.jpg`), drawn with a cover-fit
 *    crop. Every one is either US-federal-government work (public domain) or a genuinely
 *    freely-licensed Wikimedia Commons upload verified individually before being added here
 *    — see this tool's content page for the full photographer credit/license list. `credit`
 *    is `null` only for public-domain photos, which carry no attribution requirement. */
type BackgroundTemplate =
  | { id: string; label: string; title: string; category: 'art'; kind: 'art'; draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void }
  | { id: string; label: string; title: string; category: 'photo'; kind: 'photo'; url: string; credit: string | null };

const TEMPLATE_CATEGORIES: { id: 'art' | 'photo'; label: string }[] = [
  { id: 'art', label: 'Art & patterns' },
  { id: 'photo', label: 'Nature photos' },
];

/** Draws `bitmap` cover-fit into a `width`×`height` rect — scaled up to fully cover it,
 *  centered, with whatever overflows on the long axis cropped off — the same behavior as
 *  CSS `background-size: cover`, used for every real-photo template. */
function drawImageCover(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, width: number, height: number): void {
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  ctx.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

/** Caches each photo template's decoded bitmap by URL — selecting the same template twice
 *  (or drawing its thumbnail and then its full export) never re-fetches or re-decodes it.
 *  Module-scope, like Background Remover's own `sessionPromise`/`ortModulePromise` caches,
 *  since the bitmap is immutable and safe to share across every instance of this island. */
const templatePhotoCache = new Map<string, Promise<ImageBitmap>>();
function loadTemplatePhoto(url: string): Promise<ImageBitmap> {
  let cached = templatePhotoCache.get(url);
  if (!cached) {
    cached = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('Could not load the template background image.');
        return response.blob();
      })
      .then((blob) => createImageBitmap(blob));
    templatePhotoCache.set(url, cached);
  }
  return cached;
}

/** Fixed (not `Math.random()`-generated) positions/colors for the templates below that use
 *  scattered shapes — a template must paint identically every time it's selected, and must
 *  match its own thumbnail pixel-for-pixel, which a fresh random draw on every render
 *  couldn't guarantee. */
const BOKEH_DOTS: { x: number; y: number; r: number; color: string }[] = [
  { x: 0.15, y: 0.22, r: 0.16, color: '#38bdf8' },
  { x: 0.42, y: 0.62, r: 0.22, color: '#f472b6' },
  { x: 0.72, y: 0.28, r: 0.13, color: '#facc15' },
  { x: 0.85, y: 0.78, r: 0.18, color: '#34d399' },
  { x: 0.22, y: 0.85, r: 0.11, color: '#a78bfa' },
  { x: 0.6, y: 0.1, r: 0.09, color: '#fb7185' },
];

const CONFETTI_DOTS: { x: number; y: number; r: number; color: string }[] = [
  { x: 0.08, y: 0.15, r: 0.018, color: '#ef4444' },
  { x: 0.2, y: 0.4, r: 0.012, color: '#3b82f6' },
  { x: 0.33, y: 0.12, r: 0.014, color: '#f59e0b' },
  { x: 0.46, y: 0.55, r: 0.02, color: '#10b981' },
  { x: 0.58, y: 0.22, r: 0.011, color: '#a855f7' },
  { x: 0.68, y: 0.68, r: 0.016, color: '#ef4444' },
  { x: 0.78, y: 0.3, r: 0.013, color: '#3b82f6' },
  { x: 0.88, y: 0.6, r: 0.019, color: '#f59e0b' },
  { x: 0.12, y: 0.72, r: 0.015, color: '#10b981' },
  { x: 0.3, y: 0.85, r: 0.012, color: '#a855f7' },
  { x: 0.5, y: 0.9, r: 0.017, color: '#ef4444' },
  { x: 0.7, y: 0.92, r: 0.011, color: '#3b82f6' },
  { x: 0.92, y: 0.85, r: 0.014, color: '#f59e0b' },
  { x: 0.95, y: 0.15, r: 0.013, color: '#10b981' },
  { x: 0.4, y: 0.3, r: 0.01, color: '#a855f7' },
];

const WATERCOLOR_BLOBS: { x: number; y: number; r: number; color: string }[] = [
  { x: 0.25, y: 0.3, r: 0.28, color: '#fbcfe8' },
  { x: 0.6, y: 0.25, r: 0.22, color: '#bfdbfe' },
  { x: 0.75, y: 0.65, r: 0.3, color: '#fde68a' },
  { x: 0.3, y: 0.75, r: 0.25, color: '#bbf7d0' },
];

const MARBLE_SWIRLS: { x: number; y: number; r: number; color: string }[] = [
  { x: 0.3, y: 0.3, r: 0.5, color: '#c7b9ad' },
  { x: 0.7, y: 0.6, r: 0.45, color: '#a89685' },
  { x: 0.5, y: 0.85, r: 0.4, color: '#8d7a68' },
];

/** Ridge outlines for the Mountain Sunset template's two silhouette layers, in the same
 *  relative (0-1) coordinate convention as the dot/blob arrays above — a mountain skyline
 *  reads as a fixed shape, not scattered points, so this is a path outline instead. */
const MOUNTAIN_BACK_RIDGE: { x: number; y: number }[] = [
  { x: 0, y: 0.62 },
  { x: 0.15, y: 0.5 },
  { x: 0.32, y: 0.6 },
  { x: 0.5, y: 0.42 },
  { x: 0.68, y: 0.58 },
  { x: 0.85, y: 0.48 },
  { x: 1, y: 0.6 },
];
const MOUNTAIN_FRONT_RIDGE: { x: number; y: number }[] = [
  { x: 0, y: 0.82 },
  { x: 0.2, y: 0.68 },
  { x: 0.4, y: 0.78 },
  { x: 0.6, y: 0.62 },
  { x: 0.8, y: 0.76 },
  { x: 1, y: 0.66 },
];

/** Fills the polygon formed by `ridge`'s points down to the bottom of the canvas — one
 *  mountain silhouette layer. Shared by the Mountain Sunset template's back and front
 *  layers, which differ only in their ridge outline and fill color. */
function drawMountainLayer(ctx: CanvasRenderingContext2D, w: number, h: number, ridge: { x: number; y: number }[], color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (const point of ridge) ctx.lineTo(point.x * w, point.y * h);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

const BACKGROUND_TEMPLATES: BackgroundTemplate[] = [
  {
    id: 'studio-gray',
    label: 'Studio',
    title: 'A soft gray studio-backdrop vignette — the classic portrait/product-photo look.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      const radius = Math.max(w, h) * 0.75;
      const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, radius);
      gradient.addColorStop(0, '#e5e7eb');
      gradient.addColorStop(1, '#6b7280');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'sunset-mesh',
    label: 'Sunset',
    title: 'A warm diagonal gradient mesh, from orange through pink to purple.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#ff9a76');
      gradient.addColorStop(0.5, '#ff6f91');
      gradient.addColorStop(1, '#6a3093');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      const highlight = ctx.createRadialGradient(w * 0.3, h * 0.25, 0, w * 0.3, h * 0.25, Math.max(w, h) * 0.5);
      highlight.addColorStop(0, 'rgba(255,255,255,0.35)');
      highlight.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = highlight;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'bokeh-lights',
    label: 'Bokeh',
    title: 'Soft, colorful blurred lights on a dark background.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
      const size = Math.max(w, h);
      for (const dot of BOKEH_DOTS) {
        const cx = dot.x * w;
        const cy = dot.y * h;
        const radius = dot.r * size;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `${dot.color}cc`);
        gradient.addColorStop(1, `${dot.color}00`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'diagonal-stripes',
    label: 'Stripes',
    title: 'Dark two-tone diagonal stripes.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1f2937';
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 6);
      ctx.translate(-w / 2, -h / 2);
      const diag = Math.sqrt(w * w + h * h);
      const stripeWidth = Math.max(w, h) * 0.07;
      for (let x = -diag; x < diag; x += stripeWidth * 2) {
        ctx.fillRect(x, -diag, stripeWidth, diag * 3);
      }
      ctx.restore();
    },
  },
  {
    id: 'grid-paper',
    label: 'Grid',
    title: 'A light graph-paper grid on an off-white background.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#fafaf9';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d6d3d1';
      ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.002);
      const step = Math.max(w, h) * 0.05;
      for (let x = 0; x <= w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    },
  },
  {
    id: 'confetti-dots',
    label: 'Confetti',
    title: 'Scattered colorful dots on a white background.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      const size = Math.min(w, h);
      for (const dot of CONFETTI_DOTS) {
        ctx.fillStyle = dot.color;
        ctx.beginPath();
        ctx.arc(dot.x * w, dot.y * h, dot.r * size, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'aurora-waves',
    label: 'Aurora',
    title: 'Flowing aurora-style color bands on a night sky.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#050b1a';
      ctx.fillRect(0, 0, w, h);
      const bands: { color: string; y: number; amp: number }[] = [
        { color: '#22d3ee', y: 0.35, amp: 0.08 },
        { color: '#34d399', y: 0.5, amp: 0.1 },
        { color: '#a78bfa', y: 0.65, amp: 0.07 },
      ];
      for (const band of bands) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = band.color;
        ctx.beginPath();
        ctx.moveTo(0, h * (band.y - band.amp));
        ctx.bezierCurveTo(w * 0.3, h * (band.y + band.amp), w * 0.6, h * (band.y - band.amp * 1.5), w, h * band.y);
        ctx.lineTo(w, h * (band.y + band.amp * 2));
        ctx.bezierCurveTo(w * 0.6, h * (band.y + band.amp * 3), w * 0.3, h * (band.y + band.amp * 0.5), 0, h * (band.y + band.amp * 2.5));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    },
  },
  {
    id: 'ocean-horizon',
    label: 'Ocean',
    title: 'A sky-and-sea gradient with a sunlit horizon glow.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      const horizon = h * 0.55;
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#7dd3fc');
      sky.addColorStop(1, '#e0f2fe');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, horizon);
      const sea = ctx.createLinearGradient(0, horizon, 0, h);
      sea.addColorStop(0, '#0284c7');
      sea.addColorStop(1, '#0c4a6e');
      ctx.fillStyle = sea;
      ctx.fillRect(0, horizon, w, h - horizon);
      const glow = ctx.createRadialGradient(w * 0.5, horizon, 0, w * 0.5, horizon, w * 0.25);
      glow.addColorStop(0, 'rgba(255,255,255,0.6)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'mountain-sunset',
    label: 'Mountains',
    title: 'Layered mountain silhouettes against a sunset sky.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#fbbf7a');
      sky.addColorStop(0.5, '#f97362');
      sky.addColorStop(1, '#3b2352');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,244,214,0.85)';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.42, Math.min(w, h) * 0.11, 0, Math.PI * 2);
      ctx.fill();
      drawMountainLayer(ctx, w, h, MOUNTAIN_BACK_RIDGE, 'rgba(59,41,74,0.55)');
      drawMountainLayer(ctx, w, h, MOUNTAIN_FRONT_RIDGE, '#241b36');
    },
  },
  {
    id: 'marble-swirl',
    label: 'Marble',
    title: 'Soft swirling marble-like bands on a pale background.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#f5f3f0';
      ctx.fillRect(0, 0, w, h);
      const size = Math.max(w, h);
      ctx.globalAlpha = 0.28;
      for (const swirl of MARBLE_SWIRLS) {
        const gradient = ctx.createRadialGradient(swirl.x * w, swirl.y * h, 0, swirl.x * w, swirl.y * h, swirl.r * size);
        gradient.addColorStop(0, swirl.color);
        gradient.addColorStop(1, 'rgba(245,243,240,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'retrowave-grid',
    label: 'Retrowave',
    title: 'A synthwave-style sunset with a perspective grid horizon.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      const horizon = h * 0.6;
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#1a0b2e');
      sky.addColorStop(1, '#7b2d8e');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, horizon);
      const sunY = h * 0.45;
      const sunRadius = Math.min(w, h) * 0.22;
      const sunGradient = ctx.createLinearGradient(0, sunY - sunRadius, 0, sunY + sunRadius);
      sunGradient.addColorStop(0, '#ffd447');
      sunGradient.addColorStop(1, '#ff5e7e');
      ctx.fillStyle = sunGradient;
      ctx.beginPath();
      ctx.arc(w * 0.5, sunY, sunRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0d0221';
      ctx.fillRect(0, horizon, w, h - horizon);
      ctx.strokeStyle = 'rgba(255,100,200,0.5)';
      ctx.lineWidth = Math.max(1, w * 0.003);
      for (let i = -5; i <= 5; i++) {
        ctx.beginPath();
        ctx.moveTo(w * 0.5 + i * w * 0.15, h);
        ctx.lineTo(w * 0.5, horizon);
        ctx.stroke();
      }
      for (let j = 1; j <= 4; j++) {
        const y = horizon + (h - horizon) * (j / 4) ** 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    },
  },
  {
    id: 'watercolor-wash',
    label: 'Watercolor',
    title: 'Soft overlapping pastel watercolor blobs on white.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      const size = Math.max(w, h);
      ctx.globalAlpha = 0.55;
      for (const blob of WATERCOLOR_BLOBS) {
        const radius = blob.r * size;
        const gradient = ctx.createRadialGradient(blob.x * w, blob.y * h, 0, blob.x * w, blob.y * h, radius);
        gradient.addColorStop(0, blob.color);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(blob.x * w, blob.y * h, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'color-blocks',
    label: 'Color blocks',
    title: 'A bold abstract composition of flat color blocks.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, 0, w * 0.55, h * 0.6);
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(w * 0.55, 0, w * 0.45, h * 0.35);
      ctx.fillStyle = '#111827';
      ctx.fillRect(w * 0.55, h * 0.35, w * 0.45, h * 0.25);
      ctx.fillRect(w * 0.3, h * 0.6, w * 0.7, h * 0.4);
    },
  },
  {
    id: 'halftone-dots',
    label: 'Halftone',
    title: 'A comic-print halftone dot pattern.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#fef2f2';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#dc2626';
      const step = Math.max(w, h) * 0.045;
      let row = 0;
      for (let y = step / 2; y < h; y += step) {
        row++;
        const offset = row % 2 === 0 ? step / 2 : 0;
        for (let x = step / 2 + offset; x < w; x += step) {
          const distanceFromCenter = Math.hypot(x - w * 0.5, y - h * 0.5) / (Math.max(w, h) * 0.6);
          const radius = Math.max(0.5, (1 - distanceFromCenter) * step * 0.45);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  {
    id: 'kraft-paper',
    label: 'Kraft paper',
    title: 'A warm, subtly textured kraft-paper background.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#c8a877';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(120,90,50,0.08)';
      const step = Math.max(w, h) * 0.03;
      let row = 0;
      for (let y = 0; y < h; y += step) {
        row++;
        const offset = (row % 2) * (step / 2);
        for (let x = offset; x < w; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, step * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  {
    id: 'chevron-pattern',
    label: 'Chevron',
    title: 'A repeating two-tone chevron/zigzag pattern.',
    category: 'art',
    kind: 'art',
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#0f766e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#5eead4';
      ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.03);
      const size = Math.max(w, h) * 0.09;
      for (let y = -size; y < h + size; y += size) {
        ctx.beginPath();
        let x = -size;
        let up = true;
        ctx.moveTo(x, y + (up ? 0 : size));
        while (x < w + size) {
          x += size;
          up = !up;
          ctx.lineTo(x, y + (up ? 0 : size));
        }
        ctx.stroke();
      }
    },
  },
  // Real photos — every one is US-federal-government work (public domain, `credit: null`)
  // or a Wikimedia Commons upload under a real free license, verified individually via its
  // own Commons file page before being added here. See this tool's content page for the
  // full photographer credit and license-link list.
  { id: 'photo-beach', label: 'Beach', title: 'Ofu Beach, American Samoa.', category: 'photo', kind: 'photo', url: '/samples/bg-beach.jpg', credit: null },
  {
    id: 'photo-mountain',
    label: 'Snowy peaks',
    title: 'Snow-covered mountains, Joshua Tree National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-mountain.jpg',
    credit: null,
  },
  {
    id: 'photo-meadow',
    label: 'Wildflowers',
    title: 'Coreopsis wildflowers, Wichita Mountains Wildlife Refuge.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-meadow.jpg',
    credit: null,
  },
  {
    id: 'photo-waterfall',
    label: 'Waterfall',
    title: 'A waterfall in Shenandoah National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-waterfall.jpg',
    credit: null,
  },
  {
    id: 'photo-canyon',
    label: 'Canyon',
    title: 'Kolob Canyon, Zion National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-canyon.jpg',
    credit: 'InSapphoWeTrust, CC BY-SA 2.0',
  },
  {
    id: 'photo-dunes',
    label: 'Dunes',
    title: 'The gypsum dunefield at White Sands National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-dunes.jpg',
    credit: 'dconvertini, CC BY-SA 2.0',
  },
  {
    id: 'photo-glacier',
    label: 'Glacier',
    title: 'Glacier Bay National Park and Preserve, Alaska.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-glacier.jpg',
    credit: null,
  },
  {
    id: 'photo-lake',
    label: 'Crater lake',
    title: 'Crater Lake National Park, Oregon.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-lake.jpg',
    credit: 'w_lemay, CC BY-SA 2.0',
  },
  {
    id: 'photo-grand-canyon',
    label: 'Grand Canyon',
    title: 'The Grand Canyon at sunset.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-grand-canyon.jpg',
    credit: 'Eric Kilby, CC BY-SA 2.0',
  },
  {
    id: 'photo-coastal-cliffs',
    label: 'Coastal cliffs',
    title: 'Coastal cliffs at Acadia National Park, Maine.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-coastal-cliffs.jpg',
    credit: null,
  },
  {
    id: 'photo-prairie',
    label: 'Prairie',
    title: 'The tallgrass prairie of the Flint Hills, Kansas.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-prairie.jpg',
    credit: null,
  },
  {
    id: 'photo-wetland',
    label: 'Wetland',
    title: 'Sunset over the Everglades.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-wetland.jpg',
    credit: null,
  },
  {
    id: 'photo-aurora',
    label: 'Aurora',
    title: 'The aurora borealis over Denali National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-aurora.jpg',
    credit: null,
  },
  {
    id: 'photo-badlands',
    label: 'Badlands',
    title: 'Badlands National Park, South Dakota.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-badlands.jpg',
    credit: null,
  },
  {
    id: 'photo-desert-badlands',
    label: 'Desert badlands',
    title: 'Zabriskie Point, Death Valley National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-desert-badlands.jpg',
    credit: 'Christian David, CC BY-SA 4.0',
  },
  {
    id: 'photo-cherry-blossom',
    label: 'Cherry blossoms',
    title: 'Cherry blossoms at the Tidal Basin, Washington, D.C.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-cherry-blossom.jpg',
    credit: null,
  },
  {
    id: 'photo-rainforest',
    label: 'Rainforest',
    title: 'Rainforest canopy, El Yunque National Forest, Puerto Rico.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-rainforest.jpg',
    credit: 'EgorovaSvetlana, CC BY-SA 4.0',
  },
  {
    id: 'photo-starry-sky',
    label: 'Night sky',
    title: 'A dark sky full of stars over Death Valley National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-starry-sky.jpg',
    credit: null,
  },
  {
    id: 'photo-autumn',
    label: 'Autumn forest',
    title: 'Autumn foliage in the Great Smoky Mountains.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-autumn.jpg',
    credit: 'Jason Hollinger, CC BY 2.0',
  },
  {
    id: 'photo-milky-way',
    label: 'Milky Way',
    title: 'The Milky Way over a Joshua tree, Joshua Tree National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-milky-way.jpg',
    credit: null,
  },
  {
    id: 'photo-star-trails',
    label: 'Star trails',
    title: 'Star trails and Comet NEOWISE over Joshua Tree National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-star-trails.jpg',
    credit: null,
  },
  {
    id: 'photo-building',
    label: 'Capitol building',
    title: 'The U.S. Capitol Building in spring.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-building.jpg',
    credit: null,
  },
  {
    id: 'photo-alaska-range',
    label: 'Alaska Range',
    title: 'The Alaska Range, Denali National Park and Preserve.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-alaska-range.jpg',
    credit: null,
  },
  {
    id: 'photo-galaxy',
    label: 'Galaxy',
    title: 'NGC 4414, a spiral galaxy imaged by the Hubble Space Telescope.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-galaxy.jpg',
    credit: null,
  },
  {
    id: 'photo-nebula',
    label: 'Nebula',
    title: 'The Orion Nebula, imaged by the Hubble Space Telescope.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-nebula.jpg',
    credit: null,
  },
  {
    id: 'photo-ocean-waves',
    label: 'Ocean waves',
    title: 'Big surf at Waimea Bay, Hawaii.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-ocean-waves.jpg',
    credit: null,
  },
  {
    id: 'photo-rainbow',
    label: 'Rainbow',
    title: 'A rainbow over Kīlauea Iki, Hawaiʻi Volcanoes National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-rainbow.jpg',
    credit: null,
  },
  {
    id: 'photo-volcano',
    label: 'Volcano',
    title: 'The Kīlauea summit eruption, Hawaiʻi Volcanoes National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-volcano.jpg',
    credit: null,
  },
  {
    id: 'photo-snow-satellite',
    label: 'Snow from space',
    title: 'A snow-covered United States, seen from satellite.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-snow-satellite.jpg',
    credit: 'NASA Goddard Space Flight Center, CC BY 2.0',
  },
  {
    id: 'photo-fog-forest',
    label: 'Foggy forest',
    title: 'Morning fog on the Firehole River, Yellowstone National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-fog-forest.jpg',
    credit: null,
  },
  {
    id: 'photo-hurricane',
    label: 'Hurricane',
    title: 'A hurricane seen from a GOES weather satellite, NOAA.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-hurricane.jpg',
    credit: null,
  },
  {
    id: 'photo-meteor-shower',
    label: 'Meteor shower',
    title: 'The Perseid meteor shower, NASA.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-meteor-shower.jpg',
    credit: null,
  },
  {
    id: 'photo-solar-eclipse',
    label: 'Solar eclipse',
    title: 'A total solar eclipse, NASA.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-solar-eclipse.jpg',
    credit: null,
  },
  {
    id: 'photo-tide-pools',
    label: 'Tide pools',
    title: 'Tide pools with reflected light, Crescent City, California.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-tide-pools.jpg',
    credit: null,
  },
  {
    id: 'photo-wildfire',
    label: 'Wildfire',
    title: 'Dried desert vegetation carrying wildfire, Joshua Tree National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-wildfire.jpg',
    credit: null,
  },
  {
    id: 'photo-lighthouse',
    label: 'Lighthouse',
    title: 'The Munising Range Light, Michigan.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-lighthouse.jpg',
    credit: null,
  },
  {
    id: 'photo-river',
    label: 'River',
    title: 'Oxbow Bend on the Snake River, Grand Teton National Park.',
    category: 'photo',
    kind: 'photo',
    url: '/samples/bg-river.jpg',
    credit: 'Michael Gäbler, CC BY 3.0',
  },
];

const DEFAULT_TEMPLATE_ID = BACKGROUND_TEMPLATES[0]!.id;

const MIN_BLUR_RADIUS = 4;
const MAX_BLUR_RADIUS = 40;
const MIN_PIXEL_BLOCK_SIZE = 4;
const MAX_PIXEL_BLOCK_SIZE = 40;
/** Cap on an art template's live preview canvas, in pixels on its longer edge — see the
 *  `templateArtPreviewUrl` effect's comment for why this matters on a large source photo. */
const TEMPLATE_PREVIEW_MAX_DIMENSION = 640;

/** Paints a template's own `draw` routine onto a small `<canvas>` for the gallery button —
 *  the exact same function that paints the full-size export, so a thumbnail can never drift
 *  out of sync with what actually gets exported. */
function TemplateThumb({ template, width, height }: { template: BackgroundTemplate; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (template.kind !== 'art') return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    template.draw(ctx, width, height);
  }, [template, width, height]);
  if (template.kind === 'photo') {
    // `loading="lazy"` — a photo template's bytes are fetched only once its thumbnail is
    // actually near the viewport, not for every template up front just because the gallery
    // rendered; this is on top of the whole gallery only rendering once "Template" mode is
    // chosen in the first place.
    return <img src={template.url} width={width} height={height} loading="lazy" decoding="async" alt="" class="bg-template-thumb__canvas bg-template-thumb__img" />;
  }
  return <canvas ref={canvasRef} width={width} height={height} class="bg-template-thumb__canvas" aria-hidden="true" />;
}

interface ExportResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

interface PlaceDragState {
  mode: PlaceDragMode;
  /** The pointer's own canvas-space position when the drag began — `move` uses this to turn
   *  further pointer movement into a delta; `scale`/`rotate` instead measure from the
   *  placement's own center (below), not from this point. */
  startPointer: { x: number; y: number };
  startPlacement: Placement;
}

const baseName = (name: string): string => name.replace(/\.[^./]+$/, '') || 'image';

const DEFAULT_BACKGROUND_COLOR = '#ffffff';
const DEFAULT_GRADIENT_COLOR_A = '#3cbcd4';
const DEFAULT_GRADIENT_COLOR_B = '#0d1117';
const DEFAULT_GRADIENT_ANGLE = 90;
const MIN_PLACEMENT_SCALE = 0.05;
/** How far beyond the cutout's own top edge the rotate handle sits, as a fraction of its
 *  half-height in the cutout's local (unscaled, unrotated) frame — scales and rotates along
 *  with the cutout itself so it always reads as "attached" to it. */
const ROTATE_HANDLE_MARGIN = 1.2;
/** Height cap for the placement stage's "fit" size — kept as one constant so the inline width
 *  formula and the scroll wrapper's own max-height can never drift apart (same technique as
 *  the Image Cropper's own `MAX_STAGE_HEIGHT_REM`). */
const MAX_PLACE_STAGE_HEIGHT_REM = 22;

/** A real bundled photo rather than synthetic canvas art (the pattern every other tool's
 *  "Load example" uses) — the segmentation model is trained on real photographs, and a
 *  generated shape doesn't demonstrate a cutout nearly as well as an actual subject against
 *  an actual background does. Public domain (no attribution required): "Stray cat on
 *  wall.jpg" by Neal Ziring, via Wikimedia Commons — see this tool's own content page for
 *  the credit and license link. */
const SAMPLE_IMAGE_URL = '/samples/cat.jpg';

async function loadSampleImageFile(): Promise<File> {
  const response = await fetch(SAMPLE_IMAGE_URL);
  if (!response.ok) throw new Error('Could not load the sample image.');
  const blob = await response.blob();
  return new File([blob], 'cat.jpg', { type: 'image/jpeg' });
}

/**
 * Decodes the file, runs it through the background-removal Worker, then composites the
 * result against whichever background the visitor picked (transparent, a solid color, or a
 * replacement image — freely positioned, scaled and rotated on top of it) and encodes the
 * final export — inherently DOM-bound (`createImageBitmap`, `<canvas>`), so like the other
 * image tools this stays in the island rather than the pure logic layer in `lib/tools`.
 */
export default function BackgroundRemover() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [cutoutPixels, setCutoutPixels] = useState<RgbaImageData | null>(null);
  const [cutoutPreviewUrl, setCutoutPreviewUrl] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [removingBackground, setRemovingBackground] = useState(false);
  const [compositing, setCompositing] = useState(false);

  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('transparent');
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BACKGROUND_COLOR);
  const [gradientColorA, setGradientColorA] = useState(DEFAULT_GRADIENT_COLOR_A);
  const [gradientColorB, setGradientColorB] = useState(DEFAULT_GRADIENT_COLOR_B);
  const [gradientAngle, setGradientAngle] = useState(DEFAULT_GRADIENT_ANGLE);
  const [backgroundImageFile, setBackgroundImageFile] = useState<File | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState('');
  const [backgroundImageSize, setBackgroundImageSize] = useState<{ width: number; height: number } | null>(null);
  const [backgroundImageError, setBackgroundImageError] = useState<string | null>(null);
  const [blurStyle, setBlurStyle] = useState<BlurStyle>('blur');
  const [blurStrength, setBlurStrength] = useState(DEFAULT_BLUR_RADIUS);
  const [debouncedBlurStrength, setDebouncedBlurStrength] = useState(DEFAULT_BLUR_RADIUS);
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);

  // How the cutout sits on top of the replacement background image: center position, scale,
  // rotation. Only meaningful (and only ever set) once both a cutout and a background image
  // exist — Transparent/Color modes have no separate "canvas" to place the cutout within, so
  // it always just fills the frame there, the same as before this feature existed.
  const [placement, setPlacement] = useState<Placement | null>(null);
  // The placement actually baked into the export — updated 200ms after dragging settles, the
  // same debounce the quality slider already uses, so dragging itself stays smooth (a plain
  // CSS transform) instead of re-running the full canvas-encode-optimize pipeline on every
  // pointer-move tick.
  const [debouncedPlacement, setDebouncedPlacement] = useState<Placement | null>(null);
  const placeDragRef = useRef<PlaceDragState | null>(null);
  const placeStageRef = useRef<HTMLDivElement>(null);

  // Only PNG can carry the transparent areas "Transparent" mode relies on — JPEG/WebP only
  // make sense once a solid or image background has made the result fully opaque.
  const [format, setFormat] = useState<OutputFormat>('image/png');
  const [pngMode, setPngMode] = useState<PngMode>('lossless');
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [debouncedQuality, setDebouncedQuality] = useState(DEFAULT_QUALITY);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  const removeSeqRef = useRef(0);
  const exportSeqRef = useRef(0);
  const removeWorker = useWorkerTask<BackgroundRemoveWorkerRequest, BackgroundRemoveWorkerResult>(() => new BackgroundRemoveWorker());
  const pngWorker = useWorkerTask<ImageCompressWorkerRequest, ImageCompressWorkerResult>(() => new ImageCompressWorker());

  // Same worker as the Image Compressor / Image Cropper's PNG passes — see ImageCompressor's
  // `PngWorkerClient` comment for why the graceful-degradation fallback is preserved across
  // the worker boundary here too.
  const optimizePng = (buffer: ArrayBuffer): Promise<ArrayBuffer> =>
    pngWorker.run({ kind: 'optimizePng', buffer }).then(
      (result) => (result.kind === 'optimizePng' ? result.buffer : buffer),
      (error: unknown) => {
        console.warn('PNG lossless optimization pass failed, keeping the canvas-encoded PNG as-is.', error);
        return buffer;
      }
    );
  const quantizePng = (image: ImageData, q: number): Promise<ImageData> =>
    pngWorker.run({ kind: 'quantizePng', image, quality: q }).then(
      (result) => (result.kind === 'quantizePng' ? new ImageData(result.image.data, result.image.width, result.image.height) : image),
      (error: unknown) => {
        console.warn('PNG lossy quantization failed, keeping the un-quantized pixels.', error);
        return image;
      }
    );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuality(quality), 200);
    return () => window.clearTimeout(timer);
  }, [quality]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedPlacement(placement), 200);
    return () => window.clearTimeout(timer);
  }, [placement]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedBlurStrength(blurStrength), 200);
    return () => window.clearTimeout(timer);
  }, [blurStrength]);

  useEffect(() => {
    if (!file) {
      setFileUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!backgroundImageFile) {
      setBackgroundImageUrl('');
      setBackgroundImageSize(null);
      return;
    }
    const url = URL.createObjectURL(backgroundImageFile);
    setBackgroundImageUrl(url);

    // Decoded only to read its natural dimensions (the placement canvas's own size) and then
    // immediately discarded — the actual pixels are decoded again, separately, by the
    // compositing effect below when it's time to draw. A `<img onLoad>` would work too, but
    // would only fire once the placement stage itself is already rendered, which is gated on
    // this very size being known — decoding here sidesteps that ordering problem entirely.
    let cancelled = false;
    void createImageBitmap(backgroundImageFile).then(
      (bitmap) => {
        const { width, height } = bitmap;
        bitmap.close();
        if (!cancelled) setBackgroundImageSize({ width, height });
      },
      () => {
        if (!cancelled) {
          setBackgroundImageError("Couldn't read that as an image — the file may be corrupted or in an unsupported format.");
          setBackgroundImageSize(null);
        }
      }
    );

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [backgroundImageFile]);

  // A brand-new (subject, background) pair starts centered, scaled to comfortably fit — the
  // same free placement (drag to move, corner handle to resize, top handle to rotate) is
  // available in both Image mode (placed on the replacement photo's own dimensions) and
  // Template mode (placed on a canvas sized to the cutout's own dimensions, since a template
  // has no independent "background size" of its own). Deliberately keyed on `backgroundMode`
  // too, unlike a single (cutout, target-size) pair would need — the trade-off is that
  // placement resets on every mode switch (even Image -> Color -> Image) rather than only
  // when the cutout or replacement image actually changes, but that's what makes one shared
  // `placement` state safe to reuse across two differently-sized placement targets instead of
  // needing a second, near-duplicate copy of every drag/resize/rotate handler below.
  const templatePlacementWidth = backgroundMode === 'template' ? (cutoutPixels?.width ?? null) : null;
  const templatePlacementHeight = backgroundMode === 'template' ? (cutoutPixels?.height ?? null) : null;
  useEffect(() => {
    const target =
      backgroundMode === 'image'
        ? backgroundImageSize
        : backgroundMode === 'template' && templatePlacementWidth != null && templatePlacementHeight != null
          ? { width: templatePlacementWidth, height: templatePlacementHeight }
          : null;
    if (!cutoutPixels || !target) {
      setPlacement(null);
      setDebouncedPlacement(null);
      return;
    }
    // Template mode's canvas *is* the cutout's own natural size (there's no independently
    // sized replacement image to fit into, unlike Image mode) — starting it at
    // `defaultPlacement`'s 90%-contain-fit scale would shrink the subject the instant a
    // template is picked, with no other setting having changed. Native size (scale 1),
    // centered, keeps a freshly-picked template visually identical to Color/Gradient/Blur
    // until the visitor actually drags to resize.
    const fresh =
      backgroundMode === 'template'
        ? { x: target.width / 2, y: target.height / 2, scale: 1, rotation: 0 }
        : defaultPlacement(cutoutPixels.width, cutoutPixels.height, target.width, target.height);
    setPlacement(fresh);
    setDebouncedPlacement(fresh);
  }, [cutoutPixels, backgroundImageSize, backgroundMode, templatePlacementWidth, templatePlacementHeight]);

  // A live preview of the currently-selected template, purely so the placement stage below
  // has an `<img>` URL for its background layer — the export itself always redraws the
  // template fresh onto the real full-resolution export canvas (see the compositing effect),
  // this is display-only. A photo template already has a static URL (`template.url`, reused
  // directly, `object-fit: cover` reproducing the same crop `drawImageCover` applies at
  // export time); an art template has no such URL since it's painted live, so one is
  // generated here via an offscreen canvas + `toDataURL`.
  //
  // Deliberately capped at `TEMPLATE_PREVIEW_MAX_DIMENSION`, not drawn at the cutout's own
  // (potentially much larger, e.g. 4000x3000) pixel dimensions — every template's `draw`
  // already scales its pattern proportionally to whatever `width`/`height` it's given, so a
  // smaller preview looks pixel-identical once the stage's CSS scales it back up to display
  // size, at a fraction of the drawing + PNG-encoding cost. Without this cap, switching
  // between art templates on a large photo visibly lagged — the same drawing work the export
  // does, just to fill a few-hundred-pixel-wide preview box.
  const [templateArtPreviewUrl, setTemplateArtPreviewUrl] = useState('');
  useEffect(() => {
    if (backgroundMode !== 'template' || !cutoutPixels) {
      setTemplateArtPreviewUrl('');
      return;
    }
    const template = BACKGROUND_TEMPLATES.find((t) => t.id === templateId) ?? BACKGROUND_TEMPLATES[0]!;
    if (template.kind !== 'art') {
      setTemplateArtPreviewUrl('');
      return;
    }
    const scale = Math.min(1, TEMPLATE_PREVIEW_MAX_DIMENSION / Math.max(cutoutPixels.width, cutoutPixels.height));
    const previewWidth = Math.max(1, Math.round(cutoutPixels.width * scale));
    const previewHeight = Math.max(1, Math.round(cutoutPixels.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setTemplateArtPreviewUrl('');
      return;
    }
    template.draw(context, previewWidth, previewHeight);
    setTemplateArtPreviewUrl(canvas.toDataURL('image/png'));
  }, [backgroundMode, templateId, cutoutPixels]);

  useEffect(() => {
    return () => {
      if (exportResult) URL.revokeObjectURL(exportResult.url);
    };
  }, [exportResult]);

  // A displayable PNG of the raw cutout, independent of the final export — used only for the
  // placement stage's live `<img>` overlay, which needs a URL to display, not raw pixels.
  // Built once per AI result, not on every placement change.
  useEffect(() => {
    if (!cutoutPixels) {
      setCutoutPreviewUrl('');
      return;
    }
    let cancelled = false;
    let createdUrl = '';
    void (async () => {
      const canvas = document.createElement('canvas');
      canvas.width = cutoutPixels.width;
      canvas.height = cutoutPixels.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.putImageData(new ImageData(cutoutPixels.data, cutoutPixels.width, cutoutPixels.height), 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (cancelled || !blob) return;
      createdUrl = URL.createObjectURL(blob);
      setCutoutPreviewUrl(createdUrl);
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [cutoutPixels]);

  // Step 1: decode the file and run it through the AI model — produces `cutoutPixels`, the
  // raw alpha-masked RGBA buffer. Runs once per file; background/format/quality/placement
  // changes below never re-run the (multi-second) AI step, only the (near-instant)
  // compositing step.
  useEffect(() => {
    if (!file) {
      setNaturalSize(null);
      setCutoutPixels(null);
      setLoadError(null);
      setProcessError(null);
      setRemovingBackground(false);
      return;
    }

    const validation = validateImageFile(file);
    if (!validation.ok) {
      setLoadError(validation.error);
      setNaturalSize(null);
      setCutoutPixels(null);
      return;
    }
    setLoadError(null);
    setProcessError(null);
    setCutoutPixels(null);

    const seq = (removeSeqRef.current += 1);
    const isStale = () => removeSeqRef.current !== seq;
    setRemovingBackground(true);

    let cancelled = false;
    void (async () => {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        if (!cancelled && !isStale()) {
          setRemovingBackground(false);
          setLoadError("Couldn't read that as an image — the file may be corrupted or in an unsupported format.");
        }
        return;
      }
      if (cancelled || isStale()) {
        bitmap.close();
        return;
      }

      const { width, height } = bitmap;
      setNaturalSize({ width, height });

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        bitmap.close();
        setRemovingBackground(false);
        setProcessError('This browser does not support canvas image export.');
        return;
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const imageData = context.getImageData(0, 0, width, height);

      try {
        const cutout = await removeWorker.run({ image: { data: imageData.data, width, height } }, { transfer: [imageData.data.buffer] });
        if (cancelled || isStale()) return;
        setCutoutPixels(cutout);
        setRemovingBackground(false);
      } catch (thrown) {
        if (cancelled || isStale()) return;
        setRemovingBackground(false);
        setProcessError(thrown instanceof Error ? thrown.message : 'Background removal failed on this image — try a different file.');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Step 2: composite the cutout against the chosen background — freely placed, scaled and
  // rotated when there's a replacement background image — and encode the final export.
  // Re-runs on every background/placement/format/quality change, but never touches the AI
  // model again.
  useEffect(() => {
    if (!cutoutPixels) {
      setExportResult(null);
      return;
    }

    // Bundles the two pieces free placement needs together, rather than checking each
    // separately at every use below — also gives TypeScript a real narrowed, non-null type
    // for both instead of requiring a `!` assertion at each read. Template mode reuses the
    // same free placement as Image mode, just against a canvas sized to the cutout's own
    // dimensions rather than an independently-sized replacement photo.
    const placementTarget =
      backgroundMode === 'image' && backgroundImageFile && backgroundImageSize && debouncedPlacement
        ? { size: backgroundImageSize, placement: debouncedPlacement }
        : backgroundMode === 'template' && debouncedPlacement
          ? { size: { width: cutoutPixels.width, height: cutoutPixels.height }, placement: debouncedPlacement }
          : null;

    const seq = (exportSeqRef.current += 1);
    const isStale = () => exportSeqRef.current !== seq;
    setCompositing(true);
    setProcessError(null);

    let cancelled = false;
    void (async () => {
      // The cutout's own pixels, alpha channel intact, drawn onto its own small canvas —
      // `drawImage`-ing *this* onto the export canvas alpha-blends over whatever background
      // was drawn first. `putImageData` alone can't do that: it overwrites pixels outright
      // rather than blending them, which would erase the background instead of showing
      // through the cutout's transparent areas.
      const cutoutCanvas = document.createElement('canvas');
      cutoutCanvas.width = cutoutPixels.width;
      cutoutCanvas.height = cutoutPixels.height;
      const cutoutContext = cutoutCanvas.getContext('2d');
      if (!cutoutContext) {
        setCompositing(false);
        setProcessError('This browser does not support canvas image export.');
        return;
      }
      cutoutContext.putImageData(new ImageData(cutoutPixels.data, cutoutPixels.width, cutoutPixels.height), 0, 0);

      const canvasWidth = placementTarget ? placementTarget.size.width : cutoutPixels.width;
      const canvasHeight = placementTarget ? placementTarget.size.height : cutoutPixels.height;

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        setCompositing(false);
        setProcessError('This browser does not support canvas image export.');
        return;
      }

      try {
        if (backgroundMode === 'color') {
          context.fillStyle = backgroundColor;
          context.fillRect(0, 0, canvasWidth, canvasHeight);
        } else if (backgroundMode === 'gradient') {
          const line = computeLinearGradientLine(canvasWidth, canvasHeight, gradientAngle);
          const gradient = context.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
          gradient.addColorStop(0, gradientColorA);
          gradient.addColorStop(1, gradientColorB);
          context.fillStyle = gradient;
          context.fillRect(0, 0, canvasWidth, canvasHeight);
        } else if (backgroundMode === 'image' && backgroundImageFile) {
          const bgBitmap = await createImageBitmap(backgroundImageFile);
          if (cancelled || isStale()) {
            bgBitmap.close();
            return;
          }
          // The canvas is already sized to this image's own natural dimensions when a
          // placement is active, so this draws it 1:1 with no cropping — free placement only
          // makes sense against the whole background image, not a "cover"-cropped slice of it.
          context.drawImage(bgBitmap, 0, 0, canvasWidth, canvasHeight);
          bgBitmap.close();
        } else if (backgroundMode === 'blur' && file) {
          // Re-decodes the original file rather than reusing `cutoutPixels` — the AI step
          // transfers its RGBA buffer into the Worker (see Step 1's `transfer` option), which
          // detaches it on the main thread, so the only remaining source for the *original*
          // (un-cut-out) pixels this mode needs to blur is the file itself.
          const sourceBitmap = await createImageBitmap(file);
          if (cancelled || isStale()) {
            sourceBitmap.close();
            return;
          }
          const sourceCanvas = document.createElement('canvas');
          sourceCanvas.width = canvasWidth;
          sourceCanvas.height = canvasHeight;
          const sourceContext = sourceCanvas.getContext('2d');
          if (!sourceContext) {
            sourceBitmap.close();
            throw new Error('This browser does not support canvas image export.');
          }
          sourceContext.drawImage(sourceBitmap, 0, 0, canvasWidth, canvasHeight);
          sourceBitmap.close();
          const sourceImageData = sourceContext.getImageData(0, 0, canvasWidth, canvasHeight);
          const wholeImageRect = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
          const blurred =
            blurStyle === 'pixelate'
              ? applyPixelate({ data: sourceImageData.data, width: canvasWidth, height: canvasHeight }, wholeImageRect, debouncedBlurStrength)
              : applyBoxBlur({ data: sourceImageData.data, width: canvasWidth, height: canvasHeight }, wholeImageRect, debouncedBlurStrength);
          context.putImageData(new ImageData(blurred.data, canvasWidth, canvasHeight), 0, 0);
        } else if (backgroundMode === 'template') {
          const template = BACKGROUND_TEMPLATES.find((t) => t.id === templateId) ?? BACKGROUND_TEMPLATES[0]!;
          if (template.kind === 'art') {
            template.draw(context, canvasWidth, canvasHeight);
          } else {
            const photoBitmap = await loadTemplatePhoto(template.url);
            if (cancelled || isStale()) return;
            drawImageCover(context, photoBitmap, canvasWidth, canvasHeight);
          }
        }

        if (placementTarget) {
          const { x, y, scale, rotation } = placementTarget.placement;
          context.save();
          context.translate(x, y);
          context.rotate((rotation * Math.PI) / 180);
          context.scale(scale, scale);
          context.drawImage(cutoutCanvas, -cutoutPixels.width / 2, -cutoutPixels.height / 2);
          context.restore();
        } else {
          context.drawImage(cutoutCanvas, 0, 0);
        }

        if (format === 'image/png' && pngMode === 'lossy') {
          // Quantization changes pixel values before the encoder ever sees them — it must
          // happen here, on the canvas, since the browser's canvas PNG encoder itself has no
          // lossy mode.
          const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);
          context.putImageData(await quantizePng(imageData, debouncedQuality), 0, 0);
        }

        let blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, format, LOSSY_FORMATS.has(format) ? debouncedQuality : undefined)
        );
        if (!blob) throw new Error('Could not export the result as an image.');

        if (format === 'image/png') {
          // A generic deflate pass only — Oxipng (WASM) finds real extra savings on top with
          // no pixel changes, so it's always worth trying, and only kept if it actually helped.
          const optimized = await optimizePng(await blob.arrayBuffer());
          const optimizedBlob = new Blob([optimized], { type: 'image/png' });
          if (optimizedBlob.size < blob.size) blob = optimizedBlob;
        }

        if (cancelled || isStale()) return;
        setExportResult({ blob, url: URL.createObjectURL(blob), width: canvasWidth, height: canvasHeight });
        setCompositing(false);
      } catch (thrown) {
        if (cancelled || isStale()) return;
        setCompositing(false);
        setProcessError(thrown instanceof Error ? thrown.message : 'Could not export the result as an image.');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cutoutPixels,
    backgroundMode,
    backgroundColor,
    gradientColorA,
    gradientColorB,
    gradientAngle,
    backgroundImageFile,
    backgroundImageSize,
    debouncedPlacement,
    blurStyle,
    debouncedBlurStrength,
    templateId,
    format,
    debouncedQuality,
    pngMode,
  ]);

  const loadExample = () => {
    void loadSampleImageFile()
      .then((sample) => setFile(sample))
      .catch(() => setLoadError('Could not load the sample image — check your connection and try again.'));
  };

  const removeFile = () => {
    setFile(null);
    setBackgroundMode('transparent');
    setBackgroundColor(DEFAULT_BACKGROUND_COLOR);
    setGradientColorA(DEFAULT_GRADIENT_COLOR_A);
    setGradientColorB(DEFAULT_GRADIENT_COLOR_B);
    setGradientAngle(DEFAULT_GRADIENT_ANGLE);
    setBackgroundImageFile(null);
    setBackgroundImageError(null);
    setBlurStyle('blur');
    setBlurStrength(DEFAULT_BLUR_RADIUS);
    setDebouncedBlurStrength(DEFAULT_BLUR_RADIUS);
    setTemplateId(DEFAULT_TEMPLATE_ID);
    setFormat('image/png');
    setPngMode('lossless');
    setQuality(DEFAULT_QUALITY);
    setDebouncedQuality(DEFAULT_QUALITY);
  };

  // Batches the mode switch with its format consequence into one state update (same pattern as
  // `updateBlurStyle` below) rather than reacting to the mode change in a separate effect —
  // setting format from an effect would land in a second render pass, recompositing once with
  // the old format and again once the effect's setFormat commits, wastefully drawing every
  // background twice on every mode switch. Transparency only survives in PNG, so entering
  // Transparent mode always forces it back — a hard requirement. Leaving Transparent has no such
  // requirement (JPEG/WebP/PNG are all valid once the result is opaque), so that direction only
  // nudges the default to JPEG once, right on the transition — a later manual pick (e.g. PNG for
  // exact color reproduction) survives further switches between two non-transparent modes since
  // this only fires when the mode actually changes to/from 'transparent'.
  const selectBackgroundMode = (mode: BackgroundMode) => {
    if (mode === 'transparent') {
      if (format !== 'image/png') setFormat('image/png');
    } else if (backgroundMode === 'transparent') {
      setFormat('image/jpeg');
    }
    setBackgroundMode(mode);
  };

  // A style switch resets intensity to that style's own default — blur radius and pixelate
  // block size are unrelated units, so there's no meaningful "previous value" to carry over
  // between them (same reasoning as Face/Plate Blur's `updateRegionStyle`).
  const updateBlurStyle = (style: BlurStyle) => {
    setBlurStyle(style);
    const next = style === 'pixelate' ? DEFAULT_PIXEL_BLOCK_SIZE : DEFAULT_BLUR_RADIUS;
    setBlurStrength(next);
    setDebouncedBlurStrength(next);
  };

  const chooseBackgroundImage = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    const validation = validateImageFile(chosen);
    if (!validation.ok) {
      setBackgroundImageError(validation.error);
      return;
    }
    setBackgroundImageError(null);
    setBackgroundImageFile(chosen);
  };

  /** Converts a pointer event's client coordinates into the background canvas's own pixel
   *  space, using the stage's rendered (CSS-scaled) size to recover the ratio — the same
   *  `scaleFactor()` technique the Image Cropper uses for its crop box. */
  const pointerToCanvasPoint = (event: PointerEvent): { x: number; y: number } | null => {
    const rect = placeStageRef.current?.getBoundingClientRect();
    // The placement canvas's own pixel width — the replacement image's natural width in
    // Image mode, or the cutout's own natural width in Template mode (a template has no
    // independently-sized "background" of its own; see the placement-reset effect above).
    const targetWidth = backgroundMode === 'image' ? backgroundImageSize?.width : backgroundMode === 'template' ? cutoutPixels?.width : undefined;
    if (!rect || rect.width === 0 || targetWidth == null) return null;
    const scale = targetWidth / rect.width;
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale };
  };

  const beginPlaceDrag = (mode: PlaceDragMode) => (event: PointerEvent) => {
    if (!placement) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const point = pointerToCanvasPoint(event);
    if (!point) return;
    placeDragRef.current = { mode, startPointer: point, startPlacement: placement };
  };

  const onPlaceDragMove = (event: PointerEvent) => {
    const drag = placeDragRef.current;
    if (!drag || !cutoutPixels) return;
    const point = pointerToCanvasPoint(event);
    if (!point) return;

    if (drag.mode === 'move') {
      const dx = point.x - drag.startPointer.x;
      const dy = point.y - drag.startPointer.y;
      setPlacement({ ...drag.startPlacement, x: drag.startPlacement.x + dx, y: drag.startPlacement.y + dy });
      return;
    }

    // `scale` and `rotate` both measure from the placement's own center as it was when the
    // drag began, not from the pointer's own start position — the handle being dragged is
    // near the cutout's corner/top, not its center, so this is the vector that actually
    // matters for "how big" / "which way" the cutout should now be.
    const { x: cx, y: cy } = drag.startPlacement;

    if (drag.mode === 'scale') {
      // Distance from center to the cutout's own corner at scale 1 — rotation doesn't change
      // a point's distance from the center it's rotating around, so this needs no
      // rotation-aware math despite the handle itself being drawn at a rotated position.
      const baseDistance = Math.sqrt((cutoutPixels.width / 2) ** 2 + (cutoutPixels.height / 2) ** 2);
      const distance = Math.sqrt((point.x - cx) ** 2 + (point.y - cy) ** 2);
      const nextScale = baseDistance > 0 ? Math.max(MIN_PLACEMENT_SCALE, distance / baseDistance) : drag.startPlacement.scale;
      setPlacement({ ...drag.startPlacement, scale: nextScale });
      return;
    }

    // rotate: the angle from center to the pointer, offset by 90° since the handle starts
    // directly *above* center (angle -90° in standard atan2) and should read as "0 rotation"
    // from there.
    const angle = (Math.atan2(point.y - cy, point.x - cx) * 180) / Math.PI + 90;
    setPlacement({ ...drag.startPlacement, rotation: angle });
  };

  const endPlaceDrag = () => {
    placeDragRef.current = null;
  };

  const download = () => {
    if (!exportResult || !file) return;
    const suffix =
      backgroundMode === 'transparent' ? 'no-bg' : backgroundMode === 'blur' ? 'blurred-bg' : backgroundMode === 'template' ? 'template-bg' : 'new-bg';
    downloadUrl(exportResult.url, `${baseName(file.name)}-${suffix}.${OUTPUT_FORMAT_EXTENSIONS[format]}`);
  };

  const busy = removingBackground || compositing;

  // The placement stage only renders once every piece it needs actually exists — computed
  // once per render rather than re-checked at each JSX use site below.
  const selectedTemplate = BACKGROUND_TEMPLATES.find((t) => t.id === templateId) ?? BACKGROUND_TEMPLATES[0]!;
  const templateBackgroundUrl = selectedTemplate.kind === 'photo' ? selectedTemplate.url : templateArtPreviewUrl;

  const placementReady =
    backgroundMode === 'image' && backgroundImageFile && backgroundImageUrl && backgroundImageSize && placement && cutoutPixels && cutoutPreviewUrl
      ? { url: backgroundImageUrl, size: backgroundImageSize, placement, cutout: cutoutPixels, cutoutUrl: cutoutPreviewUrl, cover: false }
      : backgroundMode === 'template' && templateBackgroundUrl && placement && cutoutPixels && cutoutPreviewUrl
        ? {
            url: templateBackgroundUrl,
            size: { width: cutoutPixels.width, height: cutoutPixels.height },
            placement,
            cutout: cutoutPixels,
            cutoutUrl: cutoutPreviewUrl,
            // A photo template is cover-fit cropped at export time (`drawImageCover`) since
            // its own aspect ratio rarely matches the cutout's — the stage's background
            // `<img>` needs the same crop to preview accurately. An art template's preview is
            // rendered pixel-for-pixel at the canvas's own size already, so a plain stretch
            // (the `<img>` default) reproduces it exactly with nothing to crop.
            cover: selectedTemplate.kind === 'photo',
          }
        : null;

  let cutoutStyle = '';
  let rotateHandleStyle = '';
  let scaleHandleStyle = '';
  if (placementReady) {
    const { size, placement: p, cutout } = placementReady;
    const widthPct = (cutout.width / size.width) * 100;
    cutoutStyle = `left:${(p.x / size.width) * 100}%; top:${(p.y / size.height) * 100}%; width:${widthPct}%; transform: translate(-50%, -50%) rotate(${p.rotation}deg) scale(${p.scale})`;

    const rotateLocal = rotatePoint(p.x, p.y - (cutout.height / 2) * ROTATE_HANDLE_MARGIN * p.scale, p.x, p.y, p.rotation);
    rotateHandleStyle = `left:${(rotateLocal.x / size.width) * 100}%; top:${(rotateLocal.y / size.height) * 100}%`;

    const scaleLocal = rotatePoint(p.x + (cutout.width / 2) * p.scale, p.y + (cutout.height / 2) * p.scale, p.x, p.y, p.rotation);
    scaleHandleStyle = `left:${(scaleLocal.x / size.width) * 100}%; top:${(scaleLocal.y / size.height) * 100}%`;
  }

  return (
    <div class="tool">
      {/* No share link: the input is an uploaded image file, not text — there's no
          practical way to carry arbitrary photo bytes in a shareable URL. */}
      <div class="tool-bar">
        <p class="field__hint">
          Runs a small AI model entirely in your browser — nothing is uploaded. The first image on this device downloads the model
          (~18&nbsp;MB total); every image after that is fast.
        </p>
        <span class="tool-bar__spacer" />
        <button type="button" class="btn" onClick={loadExample} title="Generate a sample image to try the tool with">
          Load example
        </button>
        <button type="button" class="btn" onClick={removeFile} disabled={!file} title="Remove the image and start over">
          Clear
        </button>
      </div>

      {!file && <FileDropzone file={file} onFileSelected={setFile} chooseLabel="Choose an image to remove the background from" accept="image/*" />}

      <ErrorMessage message={loadError} />

      {file && naturalSize && (
        <div class="bg-remove-result">
          <p class="field__hint">
            {file.name} · {naturalSize.width}×{naturalSize.height}px · {formatBytes(file.size)} original
          </p>

          <ErrorMessage message={processError} />

          {removingBackground && !cutoutPixels && (
            <p class="bg-remove-status" role="status">
              <span class="job__spinner job__spinner--lg" aria-hidden="true" /> Removing background… this can take a few seconds, longer
              the first time while the AI model downloads.
            </p>
          )}

          {cutoutPixels && (
            <>
              <div class="bg-options">
                <div class="seg" role="group" aria-label="Replacement background">
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={backgroundMode === 'transparent'}
                    onClick={() => selectBackgroundMode('transparent')}
                    title="Keep the cut-out area transparent — a PNG with an alpha channel."
                  >
                    Transparent
                  </button>
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={backgroundMode === 'color'}
                    onClick={() => selectBackgroundMode('color')}
                    title="Fill the cut-out area with a solid color."
                  >
                    Color
                  </button>
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={backgroundMode === 'gradient'}
                    onClick={() => selectBackgroundMode('gradient')}
                    title="Fill the cut-out area with a two-color gradient."
                  >
                    Gradient
                  </button>
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={backgroundMode === 'blur'}
                    onClick={() => selectBackgroundMode('blur')}
                    title="Blur or pixelate the original background instead of replacing it — the subject stays sharp."
                  >
                    Blur
                  </button>
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={backgroundMode === 'image'}
                    onClick={() => selectBackgroundMode('image')}
                    title="Place the cutout on another image — drag, resize and rotate it freely."
                  >
                    Image
                  </button>
                  <button
                    type="button"
                    class="seg__btn"
                    aria-pressed={backgroundMode === 'template'}
                    onClick={() => selectBackgroundMode('template')}
                    title="Fill the cut-out area with a ready-made background pattern."
                  >
                    Template
                  </button>
                </div>

                {backgroundMode === 'color' && (
                  <label class="control control--inline" title="Pick the solid color to fill the removed background with.">
                    <span class="field__hint">Background color</span>
                    <input
                      type="color"
                      class="color-input"
                      value={backgroundColor}
                      onInput={(event) => setBackgroundColor((event.target as HTMLInputElement).value)}
                      aria-label="Background color"
                    />
                  </label>
                )}

                {backgroundMode === 'gradient' && (
                  <>
                    <label class="control control--inline" title="The gradient's first color.">
                      <span class="field__hint">From</span>
                      <input
                        type="color"
                        class="color-input"
                        value={gradientColorA}
                        onInput={(event) => setGradientColorA((event.target as HTMLInputElement).value)}
                        aria-label="Gradient start color"
                      />
                    </label>
                    <label class="control control--inline" title="The gradient's second color.">
                      <span class="field__hint">To</span>
                      <input
                        type="color"
                        class="color-input"
                        value={gradientColorB}
                        onInput={(event) => setGradientColorB((event.target as HTMLInputElement).value)}
                        aria-label="Gradient end color"
                      />
                    </label>
                    <div class="seg" role="group" aria-label="Gradient direction">
                      {GRADIENT_DIRECTIONS.map((direction) => (
                        <button
                          key={direction.angle}
                          type="button"
                          class="seg__btn"
                          aria-pressed={gradientAngle === direction.angle}
                          onClick={() => setGradientAngle(direction.angle)}
                          title={direction.title}
                          aria-label={direction.title}
                        >
                          {direction.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {backgroundMode === 'image' && (
                  <div class="control control--inline">
                    <label class="btn" title="Choose an image to place the cutout on top of.">
                      {backgroundImageFile ? 'Change background image' : 'Choose background image'}
                      <input type="file" class="sr-only" accept="image/*" aria-label="Choose a replacement background image" onChange={chooseBackgroundImage} />
                    </label>
                    {backgroundImageFile && <span class="field__hint">{backgroundImageFile.name}</span>}
                    {!backgroundImageFile && <span class="field__hint">No background image chosen yet — the area stays transparent until you pick one.</span>}
                  </div>
                )}
                <ErrorMessage message={backgroundImageError} />

                {backgroundMode === 'blur' && (
                  <>
                    <div class="seg" role="group" aria-label="Blur style">
                      <button
                        type="button"
                        class="seg__btn"
                        aria-pressed={blurStyle === 'blur'}
                        onClick={() => updateBlurStyle('blur')}
                        title="Soft Gaussian-style blur — the least visually jarring option."
                      >
                        Blur
                      </button>
                      <button
                        type="button"
                        class="seg__btn"
                        aria-pressed={blurStyle === 'pixelate'}
                        onClick={() => updateBlurStyle('pixelate')}
                        title="Classic mosaic blocks."
                      >
                        Pixelate
                      </button>
                    </div>
                    <label
                      class="control"
                      title={blurStyle === 'pixelate' ? 'Larger blocks hide more background detail but look blockier.' : 'A larger radius blurs the background more strongly.'}
                    >
                      <span class="field__hint">{blurStyle === 'pixelate' ? `Block size (${blurStrength}px)` : `Blur strength (${blurStrength}px)`}</span>
                      <input
                        type="range"
                        min={blurStyle === 'pixelate' ? MIN_PIXEL_BLOCK_SIZE : MIN_BLUR_RADIUS}
                        max={blurStyle === 'pixelate' ? MAX_PIXEL_BLOCK_SIZE : MAX_BLUR_RADIUS}
                        value={blurStrength}
                        aria-label={blurStyle === 'pixelate' ? 'Pixelate block size' : 'Blur strength'}
                        onInput={(event) => setBlurStrength(Number((event.target as HTMLInputElement).value))}
                      />
                    </label>
                  </>
                )}

                {backgroundMode === 'template' && (
                  <div class="bg-template-scroll">
                    {TEMPLATE_CATEGORIES.map((cat) => (
                      <div key={cat.id} class="bg-template-category">
                        <h4 class="bg-template-category__title">{cat.label}</h4>
                        <div class="bg-template-gallery" role="group" aria-label={cat.label}>
                          {BACKGROUND_TEMPLATES.filter((template) => template.category === cat.id).map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              class="bg-template-thumb"
                              aria-pressed={templateId === template.id}
                              onClick={() => setTemplateId(template.id)}
                              title={template.kind === 'photo' && template.credit ? `${template.title} Photo: ${template.credit}.` : template.title}
                            >
                              <TemplateThumb template={template} width={64} height={40} />
                              <span class="bg-template-thumb__label">{template.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {placementReady && (
                <div class="place-section">
                  {/* The overlay below is a pointer-only convenience — every value it changes
                      is also a plain, fully keyboard-operable number field beneath it, the same
                      split the Image Cropper's crop box uses between its draggable stage and
                      the underlying number inputs. */}
                  <p class="field__hint">Drag the cutout to move it, the corner handle to resize, or the top handle to rotate.</p>
                  <div class="place-stage-wrap">
                    <div
                      class="place-stage"
                      ref={placeStageRef}
                      style={`aspect-ratio:${placementReady.size.width}/${placementReady.size.height}; width:min(100%, ${MAX_PLACE_STAGE_HEIGHT_REM}rem * ${placementReady.size.width} / ${placementReady.size.height})`}
                    >
                      {/* Clipped to the canvas bounds (what the export actually looks like) —
                          the handles below deliberately live outside this layer, since a
                          handle for a cutout scaled to fill the frame can easily land above
                          or beside the canvas itself and must stay visible/reachable there. */}
                      <div class="place-stage__frame">
                        <img
                          src={placementReady.url}
                          alt=""
                          class={`place-stage__bg${placementReady.cover ? ' place-stage__bg--cover' : ''}`}
                          draggable={false}
                        />
                        <img
                          src={placementReady.cutoutUrl}
                          alt=""
                          class="place-stage__cutout"
                          draggable={false}
                          style={cutoutStyle}
                          onPointerDown={beginPlaceDrag('move')}
                          onPointerMove={onPlaceDragMove}
                          onPointerUp={endPlaceDrag}
                        />
                      </div>
                      <div
                        class="place-handle place-handle--rotate"
                        style={rotateHandleStyle}
                        onPointerDown={beginPlaceDrag('rotate')}
                        onPointerMove={onPlaceDragMove}
                        onPointerUp={endPlaceDrag}
                        title="Drag to rotate"
                        aria-hidden="true"
                      >
                        ↻
                      </div>
                      <div
                        class="place-handle place-handle--scale"
                        style={scaleHandleStyle}
                        onPointerDown={beginPlaceDrag('scale')}
                        onPointerMove={onPlaceDragMove}
                        onPointerUp={endPlaceDrag}
                        title="Drag to resize"
                        aria-hidden="true"
                      >
                        ⤡
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div class="bg-options">
                <div class="seg" role="group" aria-label="Output format">
                  {OUTPUT_FORMATS.filter((f) => backgroundMode !== 'transparent' || f === 'image/png').map((f) => (
                    <button
                      key={f}
                      type="button"
                      class="seg__btn"
                      aria-pressed={format === f}
                      onClick={() => setFormat(f)}
                      title={
                        f === 'image/png'
                          ? 'PNG — lossless by default; switch to Lossy mode below for palette-based compression'
                          : `${OUTPUT_FORMAT_LABELS[f]} — lossy, adjustable quality`
                      }
                    >
                      {OUTPUT_FORMAT_LABELS[f]}
                    </button>
                  ))}
                </div>

                {format === 'image/png' && (
                  <div class="seg" role="group" aria-label="PNG compression mode">
                    <button type="button" class="seg__btn" aria-pressed={pngMode === 'lossless'} onClick={() => setPngMode('lossless')} title="No pixel is ever changed — the safe default.">
                      Lossless
                    </button>
                    <button
                      type="button"
                      class="seg__btn"
                      aria-pressed={pngMode === 'lossy'}
                      onClick={() => setPngMode('lossy')}
                      title="Reduces the image to a smaller color palette for a much smaller file — a real, visible quality trade-off."
                    >
                      Lossy (smaller)
                    </button>
                  </div>
                )}

                {(() => {
                  const isPngLossy = format === 'image/png' && pngMode === 'lossy';
                  if (!LOSSY_FORMATS.has(format) && !isPngLossy) return null;
                  return (
                    <label
                      class="control"
                      title={
                        isPngLossy
                          ? 'Fewer colors means a smaller file but more visible banding, especially in gradients and photos.'
                          : '70-85% is usually visually indistinguishable from the original while cutting file size dramatically.'
                      }
                    >
                      <span class="field__hint">{isPngLossy ? `Colors (~${qualityToColorCount(quality)})` : `Quality (${Math.round(quality * 100)}%)`}</span>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={Math.round(quality * 100)}
                        aria-label="Quality"
                        onInput={(event) => setQuality(Number((event.target as HTMLInputElement).value) / 100)}
                      />
                    </label>
                  );
                })()}
              </div>

              {exportResult ? (
                <>
                  <p class="bg-remove-result__stats">
                    <SavingsBadge beforeBytes={file.size} afterBytes={exportResult.blob.size} />
                    <span class="field__hint">
                      {formatBytes(file.size)} → {formatBytes(exportResult.blob.size)}
                    </span>
                    {busy && (
                      <span class="bg-remove-status" role="status">
                        <span class="job__spinner" aria-hidden="true" /> Updating result… this can take a few seconds
                      </span>
                    )}
                    <span class="tool-bar__spacer" />
                    <button type="button" class="btn btn--primary" onClick={download} title="Save the result">
                      <span aria-hidden="true">⭳</span> Download {OUTPUT_FORMAT_LABELS[format]}
                    </button>
                  </p>
                  <CompareSlider
                    beforeUrl={fileUrl}
                    afterUrl={exportResult.url}
                    width={exportResult.width}
                    height={exportResult.height}
                    beforeLabel="Original"
                    afterLabel="Result"
                    transparent
                  />
                </>
              ) : (
                compositing && (
                  <p class="bg-remove-status" role="status">
                    <span class="job__spinner" aria-hidden="true" /> Applying background… this can take a few seconds
                  </p>
                )
              )}
            </>
          )}
        </div>
      )}

      <style>{`
        .bg-remove-result { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }
        .bg-remove-result__stats { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin: 0; }
        .bg-options { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
        /* Same weight/size/color tokens as .field__label (tool.css) so this reads as a prominent
           status, not a passive hint — recompositing at this tool's model resolution genuinely
           takes noticeable time, and this message shouldn't blend into the byte-size readout next
           to it. Its own class rather than reusing .field__label directly: that class's
           justify-content: space-between rule is meant for label+control rows, and would misplace
           a single spinner-plus-text line. */
        .bg-remove-status { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); font-weight: 600; color: var(--text); }
        /* A larger variant of the shared .job__spinner (tool.css) for the very first wait on a
           fresh page load, which — unlike the Updating/Applying background passes above — can
           include downloading the model itself, not just a quick recomposite. Sizing only;
           reuses the same border colors and spin animation. */
        .job__spinner--lg { width: 1.4rem; height: 1.4rem; border-width: 3px; }
        .control { display: flex; flex-direction: column; gap: var(--space-1); }
        .control--inline { flex-direction: row; align-items: center; gap: var(--space-2); }
        .color-input { width: 2.5rem; height: 2rem; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: none; cursor: pointer; }

        /* A capped-height, vertically scrolling section — the gallery has grown past what
           fits inline (two categories, dozens of thumbnails), so it scrolls internally
           rather than pushing the rest of the tool's controls far down the page. */
        .bg-template-scroll { display: flex; flex-direction: column; gap: var(--space-3); max-height: 16rem; overflow-y: auto; padding-right: var(--space-1); }
        .bg-template-category { display: flex; flex-direction: column; gap: var(--space-2); }
        .bg-template-category__title {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          color: var(--text-subtle); font-family: var(--font-mono); font-weight: 600; margin: 0;
          position: sticky; top: 0; background: var(--surface); padding-block: 2px;
        }
        .bg-template-gallery { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .bg-template-thumb {
          display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
          width: 4.5rem; padding: var(--space-1); border: 2px solid transparent; border-radius: var(--radius);
          background: none; cursor: pointer;
        }
        .bg-template-thumb:hover { border-color: var(--border); }
        .bg-template-thumb[aria-pressed="true"] { border-color: var(--accent); }
        .bg-template-thumb__canvas { display: block; width: 4rem; height: 2.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border); object-fit: cover; }
        .bg-template-thumb__img { background: var(--surface-2); }
        .bg-template-thumb__label { font-size: var(--text-xs); color: var(--text-subtle); text-align: center; }

        .place-section { display: flex; flex-direction: column; gap: var(--space-2); }
        /* Top/side padding gives the rotate/scale handles room to sit outside the canvas
           frame (a cutout scaled to fill it pushes its handles past the frame's own edges)
           without overlapping the hint text above or getting clipped by a narrower viewport. */
        .place-stage-wrap { display: flex; padding: 1.5rem 1.5rem 0; }
        .place-stage { position: relative; margin: 0; touch-action: none; user-select: none; }
        /* Everything that's actually part of the exported image lives in this clipped inner
           layer; the handles below are meta-UI drawn on top of it and must stay reachable
           even when they land outside the canvas bounds, so they're siblings of this layer,
           not children of it. */
        .place-stage__frame {
          position: absolute; inset: 0; overflow: hidden;
          border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2);
        }
        .place-stage__bg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
        .place-stage__bg--cover { object-fit: cover; }
        .place-stage__cutout {
          position: absolute; top: 0; left: 0; height: auto; max-width: none;
          cursor: move; touch-action: none;
        }
        .place-handle {
          position: absolute; width: 1.75rem; height: 1.75rem; margin: -0.875rem;
          display: flex; align-items: center; justify-content: center;
          font-size: 1rem; line-height: 1; color: var(--accent-contrast);
          border-radius: 999px; background: var(--accent); border: 2px solid var(--accent-contrast);
          box-shadow: 0 1px 4px rgb(0 0 0 / 0.35); touch-action: none; user-select: none;
        }
        .place-handle--scale { cursor: nwse-resize; }
        .place-handle--rotate { cursor: alias; }
        /* .job__spinner (shared with every other worker-backed tool) lives in src/styles/tool.css. */
      `}</style>
    </div>
  );
}
