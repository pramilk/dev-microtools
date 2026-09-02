import { type ToolResult, ok, err, messageFrom } from './result';

export type MarkdownDirection = 'markdown-to-html' | 'html-to-markdown';

export type HeadingStyle = 'atx' | 'setext';
export type BulletListMarker = '-' | '*' | '+';
export type CodeBlockStyle = 'fenced' | 'indented';

export interface MarkdownToHtmlOptions {
  /** Turns a single newline into `<br>`, instead of requiring a blank line for a new paragraph. */
  breaks: boolean;
}

export interface HtmlToMarkdownOptions {
  headingStyle: HeadingStyle;
  bulletListMarker: BulletListMarker;
  codeBlockStyle: CodeBlockStyle;
}

export const DEFAULT_MARKDOWN_TO_HTML_OPTIONS: MarkdownToHtmlOptions = { breaks: false };

export const DEFAULT_HTML_TO_MARKDOWN_OPTIONS: HtmlToMarkdownOptions = {
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
};

/**
 * Both directions parse synchronously on the main thread with no way to show progress,
 * and the rendered preview re-parses on every keystroke.
 */
export const MAX_INPUT_LENGTH = 500_000;

let markedModule: typeof import('marked') | null = null;
async function loadMarked(): Promise<typeof import('marked')> {
  markedModule ??= await import('marked');
  return markedModule;
}

let purifyInstance: (typeof import('dompurify'))['default'] | null = null;
async function loadPurify(): Promise<(typeof import('dompurify'))['default']> {
  purifyInstance ??= (await import('dompurify')).default;
  return purifyInstance;
}

// `turndown` is a CommonJS `export =` module; the bundler wraps it as
// `{ default: TurndownService }` at runtime for a dynamic `import()`, which the
// DefinitelyTyped-style `export =` declaration doesn't reflect — hence the cast, the
// same pattern `qrcode.ts` uses for `qrcode-generator`.
type TurndownCtor = typeof import('turndown');

let turndownCtor: TurndownCtor | null = null;
let gfmPlugin: (typeof import('turndown-plugin-gfm'))['gfm'] | null = null;
async function loadTurndown() {
  if (!turndownCtor || !gfmPlugin) {
    const [turndownModule, gfmModule] = await Promise.all([
      import('turndown') as unknown as Promise<{ default: TurndownCtor }>,
      import('turndown-plugin-gfm'),
    ]);
    turndownCtor = turndownModule.default;
    gfmPlugin = gfmModule.gfm;
  }
  return { TurndownService: turndownCtor, gfm: gfmPlugin };
}

/**
 * Renders Markdown to sanitized HTML. GitHub Flavored Markdown (tables, strikethrough,
 * task lists, autolinks) is always on — that's what virtually every visitor means by
 * "Markdown" today.
 *
 * Sanitization is not optional and there is no toggle to disable it: the entire point of
 * a previewer is rendering text a visitor pasted from somewhere else, so the output must
 * never be a script-injection vector into whatever renders it — this page's own sandboxed
 * preview frame, or a page the user later pastes the generated HTML into.
 */
export async function markdownToHtml(
  input: string,
  options: MarkdownToHtmlOptions = DEFAULT_MARKDOWN_TO_HTML_OPTIONS
): Promise<ToolResult<string>> {
  if (input.trim() === '') return err('Enter some Markdown to preview.');
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to render in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }

  try {
    const { marked } = await loadMarked();
    const rawHtml = await marked(input, { gfm: true, breaks: options.breaks });
    const DOMPurify = await loadPurify();
    return ok(DOMPurify.sanitize(rawHtml));
  } catch (error) {
    return err(messageFrom(error, 'Could not render this Markdown.'));
  }
}

/**
 * Converts HTML to Markdown. The input is parsed with `DOMParser` rather than executed
 * or inserted into the live page, so embedded `<script>`s never run — but the conversion
 * only covers markup Markdown can actually represent; layout markup, inline styles and
 * anything else with no Markdown equivalent is flattened to its text content or dropped.
 */
export async function htmlToMarkdown(
  input: string,
  options: HtmlToMarkdownOptions = DEFAULT_HTML_TO_MARKDOWN_OPTIONS
): Promise<ToolResult<string>> {
  if (input.trim() === '') return err('Enter some HTML to convert.');
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to convert in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }

  try {
    const { TurndownService, gfm } = await loadTurndown();
    const turndownService = new TurndownService({
      headingStyle: options.headingStyle,
      bulletListMarker: options.bulletListMarker,
      codeBlockStyle: options.codeBlockStyle,
    });
    turndownService.use(gfm);
    // Turndown's default rule falls back to a node's text content for anything it doesn't
    // recognise, which would otherwise leak a <script>/<style> tag's source as stray text
    // in the output. Neither one has a Markdown equivalent, so drop both entirely.
    turndownService.remove(['script', 'style']);
    return ok(turndownService.turndown(input));
  } catch (error) {
    return err(messageFrom(error, 'Could not convert this HTML.'));
  }
}
