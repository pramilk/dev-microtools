import { type ToolResult, ok, err } from './result';

/**
 * Renders an llms.txt (https://llmstxt.org) from fields a site owner fills in.
 *
 * Deliberately *not* the same code as `src/lib/llmsTxt.ts`, which renders this site's own
 * /llms.txt from its content collection: that one takes tools and derives sections from
 * `CATEGORIES`, this one takes whatever sections a stranger types in. The only thing they
 * would share is `join('\n')`, so keeping them apart is cheaper than an abstraction that
 * has to serve both shapes.
 */

/** One `- [title](url): description` row, plus the `## ` heading it belongs under. */
export interface ScaffoldLink {
  /** Stable key for list rendering; never appears in the output. */
  id: string;
  /** The `## ` heading this row is filed under. Rows sharing a section are grouped. */
  section: string;
  title: string;
  /** Absolute, or a path resolved against `siteUrl` when one is given. */
  url: string;
  description: string;
}

export interface LlmsTxtScaffoldOptions {
  siteName: string;
  /** Used to turn relative link paths into absolute URLs. Optional. */
  siteUrl: string;
  /** The single-line blockquote directly under the H1. */
  summary: string;
  /** Free prose between the summary and the first section; blank lines split paragraphs. */
  notes: string;
  links: ScaffoldLink[];
}

/** The section headings llms.txt files use most often, offered as a datalist in the UI. */
export const COMMON_SECTIONS: readonly string[] = ['Docs', 'Guides', 'API', 'Examples', 'Optional'];

export const DEFAULT_LLMS_TXT_OPTIONS: LlmsTxtScaffoldOptions = {
  siteName: '',
  siteUrl: '',
  summary: '',
  notes: '',
  links: [],
};

/** Markdown list rows are line-based, so a stray newline inside one would break the list. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Splits prose into paragraphs on blank lines, folding each to a single line. */
const paragraphs = (notes: string): string[] =>
  notes
    .split(/\n\s*\n/)
    .map(oneLine)
    .filter((paragraph) => paragraph !== '');

const isBlankRow = (link: ScaffoldLink): boolean =>
  link.title.trim() === '' && link.url.trim() === '' && link.description.trim() === '';

/**
 * Resolves a link's URL. A relative path becomes absolute when a site URL is given —
 * llms.txt is read by machines that may never have seen the page it came from, and the
 * spec's own examples are absolute — but a relative path is left alone rather than
 * rejected when there is no site URL to resolve it against.
 */
function resolveUrl(url: string, siteUrl: string): string {
  if (siteUrl === '' || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  try {
    return new URL(url, siteUrl).href;
  } catch {
    return url;
  }
}

export function buildLlmsTxtScaffold(options: LlmsTxtScaffoldOptions): ToolResult<string> {
  const siteName = oneLine(options.siteName);
  if (siteName === '') return err('Enter a site name — it becomes the "# " heading at the top of llms.txt.');

  const summary = oneLine(options.summary);
  if (summary === '') {
    return err('Enter a one-line summary. It becomes the "> " blockquote, which is the first thing a model reads.');
  }

  const siteUrl = options.siteUrl.trim();
  if (siteUrl !== '') {
    try {
      const parsed = new URL(siteUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return err('The site URL must be an http:// or https:// address.');
      }
    } catch {
      return err(`"${siteUrl}" is not a full URL. Use an absolute address, e.g. https://example.com`);
    }
  }

  const rows = options.links.filter((link) => !isBlankRow(link));
  for (const link of rows) {
    if (oneLine(link.title) === '') return err(`A link with the URL "${oneLine(link.url)}" has no title. Every row needs both.`);
    if (link.url.trim() === '') return err(`The link "${oneLine(link.title)}" has no URL. Every row needs both.`);
  }

  // Sections keep the order they were first used in, so the author controls the running
  // order by moving rows rather than by learning a sort rule.
  const sectionOrder: string[] = [];
  const bySection = new Map<string, ScaffoldLink[]>();
  for (const link of rows) {
    const section = oneLine(link.section) === '' ? 'Docs' : oneLine(link.section);
    const existing = bySection.get(section);
    if (existing) {
      existing.push(link);
    } else {
      sectionOrder.push(section);
      bySection.set(section, [link]);
    }
  }

  const sections = sectionOrder.map((section) => {
    const links = bySection.get(section) ?? [];
    const lines = links.map((link) => {
      const url = resolveUrl(link.url.trim(), siteUrl);
      const description = oneLine(link.description);
      return `- [${oneLine(link.title)}](${url})${description === '' ? '' : `: ${description}`}`;
    });
    return [`## ${section}`, '', ...lines].join('\n');
  });

  const blocks = [`# ${siteName}`, `> ${summary}`, ...paragraphs(options.notes), ...sections];

  // Trailing newline: llms.txt is a text file served to crawlers and read in terminals.
  return ok(`${blocks.join('\n\n')}\n`);
}
