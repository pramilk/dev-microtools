import { CATEGORIES, type Category } from './categories';

/**
 * The minimum a tool has to expose to appear in llms.txt. Deliberately not the full
 * content-collection entry: this renderer needs four fields, so it asks for four fields
 * and stays trivially testable without fixture-building the whole schema.
 */
export interface LlmsTxtTool {
  /** Slug; the tool lives at `/<slug>/`. */
  slug: string;
  title: string;
  /** One-line description — the homepage card `summary`. */
  summary: string;
  category: Category;
  /** Sort order within the category, matching the homepage listing. */
  order: number;
}

/** A non-tool page worth listing (About, Privacy). */
export interface LlmsTxtPage {
  path: string;
  title: string;
  summary: string;
}

export interface LlmsTxtInput {
  siteName: string;
  /** Site origin, with or without a trailing slash. */
  siteUrl: string;
  /** The blockquote summary directly under the H1. Kept to a single line by the spec. */
  summary: string;
  /** Free-form paragraphs between the summary and the first section. */
  notes: string[];
  tools: LlmsTxtTool[];
  /** Listed under "## Optional" — context an LLM can skip without losing the point. */
  optionalPages: LlmsTxtPage[];
}

const absolute = (siteUrl: string, path: string) => new URL(path, siteUrl).href;

/** Markdown link-text and list rows are line-based; a stray newline would break the list. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Renders an llms.txt document (https://llmstxt.org): an H1, a blockquote summary,
 * optional prose, then H2 sections of `- [name](url): description` links.
 *
 * Generated from the content collection rather than hand-maintained in `public/`, so
 * adding tool #34 does not mean remembering to edit a static file that nothing validates.
 * Tools are grouped by `CATEGORIES` and ordered within a group exactly as the homepage
 * orders them, so the two listings never disagree.
 */
export function renderLlmsTxt(input: LlmsTxtInput): string {
  const { siteName, siteUrl, summary, notes, tools, optionalPages } = input;

  const toolRow = (tool: LlmsTxtTool) =>
    `- [${oneLine(tool.title)}](${absolute(siteUrl, `/${tool.slug}/`)}): ${oneLine(tool.summary)}`;

  const sections = CATEGORIES.map((category) => {
    const inCategory = tools
      .filter((tool) => tool.category === category)
      .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

    // A category with no tools yet is skipped rather than emitted as an empty heading.
    return inCategory.length === 0 ? null : [`## ${category}`, '', ...inCategory.map(toolRow)].join('\n');
  }).filter((section): section is string => section !== null);

  if (optionalPages.length > 0) {
    sections.push(
      [
        '## Optional',
        '',
        ...optionalPages.map(
          (page) => `- [${oneLine(page.title)}](${absolute(siteUrl, page.path)}): ${oneLine(page.summary)}`
        ),
      ].join('\n')
    );
  }

  const blocks = [`# ${siteName}`, `> ${oneLine(summary)}`, ...notes.map(oneLine), ...sections];

  // Trailing newline: llms.txt is a text file served to crawlers and read in terminals.
  return `${blocks.join('\n\n')}\n`;
}
