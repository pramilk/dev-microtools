import { useEffect, useRef, useState } from 'preact/hooks';
import {
  markdownToHtml,
  htmlToMarkdown,
  DEFAULT_MARKDOWN_TO_HTML_OPTIONS,
  DEFAULT_HTML_TO_MARKDOWN_OPTIONS,
  type MarkdownDirection,
  type HeadingStyle,
  type BulletListMarker,
  type CodeBlockStyle,
} from '../lib/tools/markdownPreview';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

const SAMPLE_MARKDOWN = `# Release Notes

**v2.1** adds *dark mode* and fixes a login bug.

- Faster startup
- Smaller bundle size

> See the [full changelog](https://example.com/changelog) for details.
`;

const SAMPLE_HTML = `<h1>Release Notes</h1>
<p><strong>v2.1</strong> adds <em>dark mode</em> and fixes a login bug.</p>
<ul>
  <li>Faster startup</li>
  <li>Smaller bundle size</li>
</ul>
<blockquote><p>See the <a href="https://example.com/changelog">full changelog</a> for details.</p></blockquote>
`;

interface ShareState {
  direction: MarkdownDirection;
  input: string;
  breaks: boolean;
  headingStyle: HeadingStyle;
  bulletListMarker: BulletListMarker;
  codeBlockStyle: CodeBlockStyle;
}

/** Reads the site's explicit theme choice, if any — absent means "system", handled by the preview frame's own media query. */
function readCurrentTheme(): 'light' | 'dark' | null {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' || attr === 'dark' ? attr : null;
}

/**
 * Wraps sanitized HTML in a small self-contained document for the sandboxed preview
 * frame. The frame has no access to the page's own stylesheet, so a readable look is
 * rebuilt here from the same colour tokens as the rest of the site — including the
 * current theme, so the preview always matches what the visitor actually chose rather
 * than just falling back to system preference.
 */
function buildPreviewDocument(html: string, theme: 'light' | 'dark' | null): string {
  const themeAttr = theme ? ` data-theme="${theme}"` : '';
  return `<!doctype html>
<html${themeAttr}>
<head>
<meta charset="utf-8">
<style>
  :root {
    --bg: #fbfbfd; --surface: #ffffff; --surface-2: #f2f4f8; --border: #e2e6ee;
    --text: #0f151c; --text-muted: #57636f; --accent: #0b6e80;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0d1117; --surface: #151b23; --surface-2: #1b222c; --border: #2a3441;
      --text: #e6edf3; --text-muted: #9aa7b4; --accent: #3cbcd4;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0d1117; --surface: #151b23; --surface-2: #1b222c; --border: #2a3441;
    --text: #e6edf3; --text-muted: #9aa7b4; --accent: #3cbcd4;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 1rem 1.25rem; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 0.95rem; line-height: 1.65; overflow-wrap: break-word;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.4em 0 0.5em; }
  h1 { font-size: 1.75em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  h2 { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
  p, ul, ol, blockquote, table, pre { margin: 0.7em 0; }
  a { color: var(--accent); }
  img { max-width: 100%; }
  code {
    font-family: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.85em; background: var(--surface-2); padding: 0.15em 0.4em; border-radius: 4px;
  }
  pre { background: var(--surface-2); padding: 0.8em 1em; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid var(--border); margin-left: 0; padding: 0.1em 1em; color: var(--text-muted); }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--border); padding: 0.4em 0.7em; text-align: left; }
  th { background: var(--surface-2); }
  hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
  ul, ol { padding-left: 1.6em; }
</style>
</head>
<body>${html}</body>
</html>`;
}

export default function MarkdownPreviewer() {
  const [direction, setDirection] = useState<MarkdownDirection>('markdown-to-html');
  const [input, setInput] = useState('');
  const [breaks, setBreaks] = useState(DEFAULT_MARKDOWN_TO_HTML_OPTIONS.breaks);
  const [headingStyle, setHeadingStyle] = useState<HeadingStyle>(DEFAULT_HTML_TO_MARKDOWN_OPTIONS.headingStyle);
  const [bulletListMarker, setBulletListMarker] = useState<BulletListMarker>(DEFAULT_HTML_TO_MARKDOWN_OPTIONS.bulletListMarker);
  const [codeBlockStyle, setCodeBlockStyle] = useState<CodeBlockStyle>(DEFAULT_HTML_TO_MARKDOWN_OPTIONS.codeBlockStyle);
  const [output, setOutput] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  const requestId = useRef(0);

  const { isDragActive, dropHandlers } = useTextFileDrop(setInput);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setDirection(state.direction);
      setInput(state.input);
      setBreaks(state.breaks);
      setHeadingStyle(state.headingStyle);
      setBulletListMarker(state.bulletListMarker);
      setCodeBlockStyle(state.codeBlockStyle);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  // Keeps the sandboxed preview frame in sync with a theme change made via the site's
  // own toggle while this page is open — the frame is a separate document, so it can't
  // just inherit a CSS media query resolution the way the rest of the page does.
  useEffect(() => {
    setTheme(readCurrentTheme());
    const observer = new MutationObserver(() => setTheme(readCurrentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const id = (requestId.current += 1);
    const stale = () => id !== requestId.current;

    if (input.trim() === '') {
      setOutput('');
      setPreviewHtml('');
      setError(null);
      return;
    }

    void (async () => {
      if (direction === 'markdown-to-html') {
        const result = await markdownToHtml(input, { breaks });
        if (stale()) return;
        if (result.ok) {
          setOutput(result.value);
          setPreviewHtml(result.value);
          setError(null);
        } else {
          setOutput('');
          setPreviewHtml('');
          setError(result.error);
        }
        return;
      }

      const result = await htmlToMarkdown(input, { headingStyle, bulletListMarker, codeBlockStyle });
      if (stale()) return;
      if (!result.ok) {
        setOutput('');
        setPreviewHtml('');
        setError(result.error);
        return;
      }
      setOutput(result.value);
      setError(null);

      // Render the resulting Markdown back to HTML purely so the preview pane has
      // something to show — this is the only visual way to sanity-check an HTML → Markdown
      // conversion, since Markdown itself has no "invalid" state to warn about.
      const preview = await markdownToHtml(result.value);
      if (stale()) return;
      setPreviewHtml(preview.ok ? preview.value : '');
    })();
  }, [input, direction, breaks, headingStyle, bulletListMarker, codeBlockStyle]);

  const isMarkdownToHtml = direction === 'markdown-to-html';

  const swap = () => {
    const nextInput = output !== '' ? output : input;
    setDirection(isMarkdownToHtml ? 'html-to-markdown' : 'markdown-to-html');
    setInput(nextInput);
  };

  const loadExample = () => setInput(isMarkdownToHtml ? SAMPLE_MARKDOWN : SAMPLE_HTML);

  const shareState = (): ShareState => ({ direction, input, breaks, headingStyle, bulletListMarker, codeBlockStyle });

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Direction and options">
        <div class="seg" role="group" aria-label="Conversion direction">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={isMarkdownToHtml}
            onClick={() => setDirection('markdown-to-html')}
            title="Render Markdown as a live HTML preview, and show the generated HTML source"
          >
            Markdown → HTML
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={!isMarkdownToHtml}
            onClick={() => setDirection('html-to-markdown')}
            title="Convert HTML markup back into Markdown"
          >
            HTML → Markdown
          </button>
        </div>
        <button
          type="button"
          class="btn"
          onClick={swap}
          title="Swap direction, moving the current output into the input"
        >
          <span aria-hidden="true">⇄</span> Swap
        </button>

        {isMarkdownToHtml ? (
          <label
            class="checkbox"
            title="Turn a single newline into a line break, instead of requiring a blank line for a new paragraph"
          >
            <input type="checkbox" checked={breaks} onChange={(event) => setBreaks((event.target as HTMLInputElement).checked)} />
            Line breaks
          </label>
        ) : (
          <>
            <label class="checkbox">
              <span class="field__hint">Headings</span>
              <select
                class="select"
                style="width:auto"
                value={headingStyle}
                aria-label="Heading style"
                onChange={(event) => setHeadingStyle((event.target as HTMLSelectElement).value as HeadingStyle)}
              >
                <option value="atx"># ATX</option>
                <option value="setext">Setext (===)</option>
              </select>
            </label>
            <label class="checkbox">
              <span class="field__hint">Bullets</span>
              <select
                class="select"
                style="width:auto"
                value={bulletListMarker}
                aria-label="Bullet list marker"
                onChange={(event) => setBulletListMarker((event.target as HTMLSelectElement).value as BulletListMarker)}
              >
                <option value="-">-</option>
                <option value="*">*</option>
                <option value="+">+</option>
              </select>
            </label>
            <label class="checkbox">
              <span class="field__hint">Code blocks</span>
              <select
                class="select"
                style="width:auto"
                value={codeBlockStyle}
                aria-label="Code block style"
                onChange={(event) => setCodeBlockStyle((event.target as HTMLSelectElement).value as CodeBlockStyle)}
              >
                <option value="fenced">Fenced (```)</option>
                <option value="indented">Indented</option>
              </select>
            </label>
          </>
        )}

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={shareState} describe="this document" />
        <button type="button" class="btn" onClick={loadExample} title="Load a small example">
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="markdown-input">
            <span>{isMarkdownToHtml ? 'Markdown input' : 'HTML input'}</span>
          </label>
          <textarea
            id="markdown-input"
            class={`textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            autocomplete="off"
            placeholder={isMarkdownToHtml ? 'Paste Markdown here, or drop a .md file' : 'Paste HTML here, or drop an .html file'}
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
            {...dropHandlers}
          />
        </div>

        <div class="field">
          <div class="field__label">
            <span>{viewMode === 'preview' ? 'Preview' : isMarkdownToHtml ? 'HTML output' : 'Markdown output'}</span>
            <span class="tool-bar__group">
              <div class="seg" role="group" aria-label="Result view">
                <button
                  type="button"
                  class="seg__btn"
                  aria-pressed={viewMode === 'preview'}
                  onClick={() => setViewMode('preview')}
                  title={isMarkdownToHtml ? 'Show the rendered result' : 'Show what the converted Markdown renders as, so you can spot anything the conversion lost'}
                >
                  Preview
                </button>
                <button
                  type="button"
                  class="seg__btn"
                  aria-pressed={viewMode === 'source'}
                  onClick={() => setViewMode('source')}
                  title={isMarkdownToHtml ? 'Show the generated HTML as text' : 'Show the converted Markdown as text'}
                >
                  Source
                </button>
              </div>
              <CopyButton value={output} describe={isMarkdownToHtml ? 'the generated HTML' : 'the converted Markdown'} />
              <DownloadButton
                value={output}
                filename={isMarkdownToHtml ? 'document.html' : 'document.md'}
                mimeType={isMarkdownToHtml ? 'text/html' : 'text/markdown'}
                describe={isMarkdownToHtml ? 'the generated HTML' : 'the converted Markdown'}
              />
            </span>
          </div>

          {viewMode === 'preview' ? (
            previewHtml === '' ? (
              <p class="output output--empty output--tall">Rendered Markdown appears here.</p>
            ) : (
              <iframe
                class="md-preview-frame"
                title="Rendered Markdown preview"
                sandbox=""
                srcDoc={buildPreviewDocument(previewHtml, theme)}
              />
            )
          ) : (
            <pre class={`output output--tall${output === '' ? ' output--empty' : ''}`} tabIndex={0}>
              {output === '' ? (isMarkdownToHtml ? 'Generated HTML appears here.' : 'Converted Markdown appears here.') : output}
            </pre>
          )}
        </div>
      </div>

      <ErrorMessage message={error} />

      <style>{`
        .md-preview-frame {
          display: block;
          width: 100%;
          height: 16rem;
          min-height: 11rem;
          resize: vertical;
          overflow: auto;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--surface);
        }
      `}</style>
    </div>
  );
}
