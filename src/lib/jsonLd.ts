/**
 * Serialises a JSON-LD value for embedding inside a `<script type="application/ld+json">`.
 *
 * `JSON.stringify` alone doesn't escape "</script" — FAQ copy that happens to mention a
 * literal `</script>` tag (as the HTML/CSS/JS minifier's does) would otherwise terminate
 * the script element early and spill the rest of the JSON as visible page text. `<` has
 * no special meaning in JSON, so escaping every occurrence is always safe here.
 *
 * Lives in `lib/` rather than inline in `BaseLayout.astro` because this exact hole has
 * already caused one production bug, and a `.astro` frontmatter helper cannot be tested.
 */
export function toSafeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
