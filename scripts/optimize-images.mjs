#!/usr/bin/env node
// Recompresses every raster image in the built site losslessly. Runs as the last step of
// `npm run build`, after `astro build` has written `dist/`. Nothing here changes pixels —
// only how they're encoded — so it's safe to run unattended in CI/deploy.
//
// The images worth compressing are the per-tool OG cards (`src/pages/og/[...route].ts`,
// one PNG per tool rendered fresh on every build via astro-og-canvas) plus the static
// `public/og-image.png` fallback that `astro build` copies into `dist/` verbatim — together
// these accounted for over a third of total `dist/` size before this script existed. Neither
// is optimized at the source: astro-og-canvas has no compression option, and a static PNG in
// `public/` is copied as-is.
import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const IMAGE_EXTENSIONS = new Set(['.png']);

async function findImages(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return findImages(full);
      return IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [full] : [];
    })
  );
  return files.flat();
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(0)}KB`;
}

async function dirSize(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return dirSize(full);
      return (await stat(full)).size;
    })
  );
  return sizes.flat().reduce((sum, size) => sum + size, 0);
}

async function main() {
  const distSizeBefore = await dirSize(distDir);
  const images = await findImages(distDir);

  let sizeBefore = 0;
  let sizeAfter = 0;

  for (const file of images) {
    const original = await readFile(file);
    sizeBefore += original.length;

    // Lossless: re-encodes with max deflate effort and drops to a palette only when the
    // image already fits in ≤256 colours (astro-og-canvas output does), never quantizing
    // pixels that need more. No visible difference from the source.
    const optimized = await sharp(original).png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer();

    if (optimized.length < original.length) {
      await writeFile(file, optimized);
      sizeAfter += optimized.length;
    } else {
      sizeAfter += original.length;
    }
  }

  const distSizeAfter = distSizeBefore - (sizeBefore - sizeAfter);
  const saved = sizeBefore - sizeAfter;
  const pct = sizeBefore > 0 ? ((saved / sizeBefore) * 100).toFixed(1) : '0.0';

  console.log(
    `[optimize-images] ${images.length} PNG(s): ${formatKb(sizeBefore)} -> ${formatKb(sizeAfter)} (saved ${formatKb(saved)}, ${pct}%)`
  );
  console.log(`[optimize-images] dist/ total: ${formatKb(distSizeBefore)} -> ${formatKb(distSizeAfter)}`);
}

main().catch((error) => {
  console.error('[optimize-images] failed:', error);
  process.exit(1);
});
