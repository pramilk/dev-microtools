export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AspectPreset = 'free' | '1:1' | '4:3' | '16:9' | '3:2';

export const ASPECT_PRESETS: AspectPreset[] = ['free', '1:1', '4:3', '16:9', '3:2'];

export const ASPECT_PRESET_LABELS: Record<AspectPreset, string> = {
  free: 'Free',
  '1:1': '1:1',
  '4:3': '4:3',
  '16:9': '16:9',
  '3:2': '3:2',
};

/** width/height for every preset except "free", which has no fixed ratio. */
export function aspectRatioForPreset(preset: AspectPreset): number | null {
  switch (preset) {
    case '1:1':
      return 1;
    case '4:3':
      return 4 / 3;
    case '16:9':
      return 16 / 9;
    case '3:2':
      return 3 / 2;
    case 'free':
      return null;
  }
}

/**
 * Rounds a crop rectangle to whole pixels and clamps it to the image's own bounds,
 * keeping a minimum of 1×1 — the shared safety net every other crop function in this
 * file routes its result through, so a rect handed to the canvas is always drawable.
 */
export function clampCropRect(rect: CropRect, imageWidth: number, imageHeight: number): CropRect {
  const x = Math.min(Math.max(0, Math.round(rect.x)), Math.max(0, imageWidth - 1));
  const y = Math.min(Math.max(0, Math.round(rect.y)), Math.max(0, imageHeight - 1));
  const width = Math.min(Math.max(1, Math.round(rect.width)), imageWidth - x);
  const height = Math.min(Math.max(1, Math.round(rect.height)), imageHeight - y);
  return { x, y, width, height };
}

/**
 * Repositions a rectangle within the image bounds without changing its size — unlike
 * `clampCropRect`, which can shrink a rectangle that overflows. Used while dragging the
 * crop box to a new position, where shrinking it mid-move would feel like the selection
 * is deforming rather than simply being stopped at the edge.
 */
export function clampCropPosition(rect: CropRect, imageWidth: number, imageHeight: number): CropRect {
  const width = Math.min(Math.round(rect.width), imageWidth);
  const height = Math.min(Math.round(rect.height), imageHeight);
  const x = Math.min(Math.max(0, Math.round(rect.x)), imageWidth - width);
  const y = Math.min(Math.max(0, Math.round(rect.y)), imageHeight - height);
  return { x, y, width, height };
}

/**
 * Adjusts a rectangle's width/height to match the given aspect ratio, keeping its
 * top-left corner fixed, then clamps the result back within the image bounds. Widens or
 * narrows the rectangle's height to fit `ratio` when there's room; when the image is too
 * short for the rectangle's own width at that ratio, shrinks to whatever does fit rather
 * than spilling past the bottom edge.
 */
export function constrainRectToAspectRatio(
  rect: CropRect,
  ratio: number,
  imageWidth: number,
  imageHeight: number
): CropRect {
  const clampedStart = clampCropRect(rect, imageWidth, imageHeight);
  const maxHeight = imageHeight - clampedStart.y;
  const maxWidth = imageWidth - clampedStart.x;

  let width = clampedStart.width;
  let height = width / ratio;

  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  if (width > maxWidth) {
    width = maxWidth;
    height = width / ratio;
  }

  return clampCropRect({ x: clampedStart.x, y: clampedStart.y, width, height }, imageWidth, imageHeight);
}

/**
 * Resolves the final output dimensions for a crop, given optional explicit width/height
 * overrides. Both blank means "use the crop's own size" (resize is off). With aspect
 * ratio locked and only one dimension given, the other is derived from the crop's own
 * proportions; with both given, both are trusted as-is — the caller (the UI) is
 * responsible for keeping a locked pair in sync as the user types.
 */
export function resolveResizeDimensions(
  cropWidth: number,
  cropHeight: number,
  targetWidth: number | null,
  targetHeight: number | null,
  lockAspectRatio: boolean
): { width: number; height: number } {
  if (targetWidth === null && targetHeight === null) {
    return { width: Math.max(1, Math.round(cropWidth)), height: Math.max(1, Math.round(cropHeight)) };
  }

  if (lockAspectRatio) {
    const ratio = cropWidth / cropHeight;
    if (targetWidth !== null && targetHeight === null) {
      return { width: Math.max(1, Math.round(targetWidth)), height: Math.max(1, Math.round(targetWidth / ratio)) };
    }
    if (targetHeight !== null && targetWidth === null) {
      return { width: Math.max(1, Math.round(targetHeight * ratio)), height: Math.max(1, Math.round(targetHeight)) };
    }
  }

  return {
    width: Math.max(1, Math.round(targetWidth ?? cropWidth)),
    height: Math.max(1, Math.round(targetHeight ?? cropHeight)),
  };
}
