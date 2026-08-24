/** Extensions of raster/vector image formats a browser can plausibly decode — used only as a fallback signal when a file's own `type` is blank, which some OSes/drag sources do for otherwise-legitimate images. */
const IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|tiff?|ico|svg)$/i;

export const hasImageExtension = (name: string): boolean => IMAGE_EXTENSION_PATTERN.test(name);

/**
 * Whether a file is plausibly an image, checked before any decode is attempted. A declared
 * `image/*` MIME type is trusted outright. A blank type (some drag sources omit it even for
 * real images) falls back to the file's own extension instead of being waved through
 * unconditionally — that unconditional leniency was the actual hole letting a non-image file
 * with no declared type get "accepted" by drag-and-drop, which bypasses an `<input accept>`
 * filter entirely (that attribute only constrains the native file-picker dialog).
 */
export function looksLikeImageFile(file: { type: string; name: string }): boolean {
  if (file.type !== '') return file.type.startsWith('image/');
  return hasImageExtension(file.name);
}
