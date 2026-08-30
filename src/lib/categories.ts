/**
 * Canonical list of tool categories, in the order they should appear on the homepage
 * and in the sidebar. Adding, renaming, or reordering a category happens here — nowhere
 * else — since `content.config.ts`'s schema and every category-grouped listing all derive
 * from this one array.
 *
 * The order is deliberate, not alphabetical: the broadest, highest-traffic groups lead and
 * the narrowest (`CSS`) trails, so the homepage grid opens on the sections most visitors
 * came for. Alphabetical would put the two-item `CSS` section first.
 */
export const CATEGORIES = [
  'Convert',
  'Format',
  'Generate',
  'Security',
  'Text',
  'AI',
  'Web & Network',
  'Images',
  'CSS',
] as const;

export type Category = (typeof CATEGORIES)[number];
