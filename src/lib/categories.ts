/**
 * Canonical list of tool categories, in the order they should appear on the homepage
 * and in the sidebar. Adding, renaming, or reordering a category happens here — nowhere
 * else — since `content.config.ts`'s schema and every category-grouped listing all derive
 * from this one array.
 */
export const CATEGORIES = [
  'Compare',
  'Convert',
  'Encode',
  'Format',
  'Generate',
  'Images',
  'Inspect',
  'Style',
] as const;

export type Category = (typeof CATEGORIES)[number];
