import { getCollection } from 'astro:content';
import { OGImageRoute } from 'astro-og-canvas';

// One PNG per tool, generated at build time (not shipped to the browser — this endpoint
// runs only during `astro build`) so a link to any tool page previews with its own title
// and summary instead of the site's single generic social image. Keyed by tool id, so the
// output lands at `/og/<slug>.png`, matching the tool's own `/<slug>/` URL.
const tools = await getCollection('tools');
const pages = Object.fromEntries(tools.map((tool) => [tool.id, tool.data]));

export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  getImageOptions: (_path, page) => ({
    // The full meta description (70-160 chars, enforced by the content schema), not the
    // shorter homepage-card summary — more informative for a card seen out of context, and
    // long enough to wrap to 2-3 lines instead of leaving the card mostly empty.
    title: page.title,
    description: `${page.description}  —  devmicrotools.com`,
    // Matches the site's dark-theme tokens (`--bg` → `--surface-2`) rather than following
    // whichever theme the visitor has set — a shared social-card image can't adapt to the
    // viewer's local theme, so it picks one fixed look instead of a mismatched hybrid.
    bgGradient: [
      [13, 17, 23],
      [21, 27, 35],
    ],
    border: { color: [60, 188, 212], width: 10, side: 'block-start' },
    padding: 90,
    font: {
      title: { color: [230, 237, 243], size: 68, lineHeight: 1.15 },
      description: { color: [154, 167, 180], size: 34, lineHeight: 1.5 },
    },
  }),
});
