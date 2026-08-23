import { type ToolResult, ok, err, messageFrom } from './result';

export type MinifyLanguage = 'html' | 'css' | 'js';

export const MINIFY_LANGUAGES: MinifyLanguage[] = ['html', 'css', 'js'];

export const MINIFY_LANGUAGE_LABELS: Record<MinifyLanguage, string> = {
  html: 'HTML',
  css: 'CSS',
  js: 'JavaScript',
};

/**
 * Bounds how much text this tool will attempt to minify client-side. CSS/HTML
 * minification and Terser's parse are all synchronous and run on the main thread with
 * no way to show progress.
 */
export const MAX_INPUT_LENGTH = 1_000_000;

// --------------------------------------------------------------------------- CSS

/**
 * Minifies CSS with a hand-rolled single-pass scan rather than a full parser: strips
 * comments, collapses whitespace, and removes whitespace that touches a structural
 * character (`{ } ; : , > + ~`). Deliberately leaves whitespace *inside* parentheses
 * untouched — `calc(100% - 10px)` and `:nth-child(2n + 1)` both require exactly one
 * space around their operators, and a generic minifier that strips it silently changes
 * what the rule means. That's a real bug class in naive CSS minifiers; this tool trades
 * a little extra output size for never producing broken CSS.
 */
export function minifyCss(input: string): string {
  const STRUCTURAL = new Set(['{', '}', ';', ':', ',', '>', '+', '~']);
  let out = '';
  let i = 0;
  let parenDepth = 0;
  let quote: '"' | "'" | null = null;

  const isWhitespace = (char: string) => char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

  while (i < input.length) {
    const char = input[i]!;

    if (quote) {
      out += char;
      if (char === '\\' && i + 1 < input.length) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      i += 1;
      continue;
    }

    if (char === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      i = end === -1 ? input.length : end + 2;
      continue;
    }

    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth = Math.max(0, parenDepth - 1);

    if (isWhitespace(char)) {
      // Consume the whole run at once.
      let j = i;
      while (j < input.length && isWhitespace(input[j]!)) j += 1;

      if (parenDepth > 0) {
        out += ' ';
      } else {
        const prev = out[out.length - 1];
        const next = input[j];
        const touchesStructural =
          (prev !== undefined && STRUCTURAL.has(prev)) || (next !== undefined && STRUCTURAL.has(next));
        if (!touchesStructural) out += ' ';
      }
      i = j;
      continue;
    }

    if (parenDepth === 0 && STRUCTURAL.has(char)) {
      // Drop whitespace already written immediately before a structural character.
      while (out.endsWith(' ')) out = out.slice(0, -1);
      out += char;
      i += 1;
      continue;
    }

    out += char;
    i += 1;
  }

  // A trailing semicolon right before a closing brace is redundant.
  out = out.replace(/;}/g, '}');
  return out.trim();
}

// --------------------------------------------------------------------------- HTML

/** Tag names whose content must be copied through byte-for-byte, never whitespace-collapsed. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'pre', 'textarea']);

/**
 * Minifies HTML with a hand-rolled scan: strips comments and collapses runs of
 * whitespace to a single space. Never collapses whitespace to *nothing* between tags —
 * `<span>A</span> <span>B</span>` relies on that one space to keep "A" and "B" from
 * visually running together as "AB", so this tool always leaves at least one space
 * rather than guessing which gaps are "safe" to remove entirely. Content inside
 * `<script>`, `<style>`, `<pre>` and `<textarea>` is copied through untouched — collapsing
 * whitespace inside a `<pre>` block or a template literal would change what it renders.
 */
export function minifyHtml(input: string): string {
  let out = '';
  let i = 0;

  const isWhitespace = (char: string) => char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

  while (i < input.length) {
    const char = input[i]!;

    if (char === '<' && input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }

    if (char === '<' && input[i + 1] !== '!' && input[i + 1] !== '/') {
      const tagMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(input.slice(i));
      const tagName = tagMatch?.[1]?.toLowerCase();
      if (tagName && RAW_TEXT_TAGS.has(tagName)) {
        const closeTag = `</${tagName}`;
        const closeIndex = input.toLowerCase().indexOf(closeTag, i);
        if (closeIndex === -1) {
          out += input.slice(i);
          i = input.length;
          continue;
        }
        const tagEnd = input.indexOf('>', closeIndex);
        const sliceEnd = tagEnd === -1 ? input.length : tagEnd + 1;
        out += input.slice(i, sliceEnd);
        i = sliceEnd;
        continue;
      }
    }

    if (isWhitespace(char)) {
      let j = i;
      while (j < input.length && isWhitespace(input[j]!)) j += 1;
      out += ' ';
      i = j;
      continue;
    }

    out += char;
    i += 1;
  }

  return out.trim();
}

// --------------------------------------------------------------------------- JS

let terserModule: typeof import('terser') | null = null;
async function loadTerser(): Promise<typeof import('terser')> {
  terserModule ??= await import('terser');
  return terserModule;
}

async function minifyJs(input: string): Promise<ToolResult<string>> {
  try {
    const terser = await loadTerser();
    const result = await terser.minify(input);
    if (result.code === undefined) {
      return err('Terser produced no output for this input.');
    }
    return ok(result.code);
  } catch (error) {
    const e = error as { message?: string; line?: number; col?: number };
    const location = e.line !== undefined ? ` at line ${e.line}, column ${e.col ?? 0}` : '';
    return err(`Could not minify this JavaScript: ${messageFrom(error, 'unknown syntax error')}${location}.`);
  }
}

// --------------------------------------------------------------------------- Shared entry point

export async function minifyCode(input: string, language: MinifyLanguage): Promise<ToolResult<string>> {
  if (input.trim() === '') return err(`Enter some ${MINIFY_LANGUAGE_LABELS[language]} to minify.`);
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to minify in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }

  if (language === 'css') return ok(minifyCss(input));
  if (language === 'html') return ok(minifyHtml(input));
  return minifyJs(input);
}
