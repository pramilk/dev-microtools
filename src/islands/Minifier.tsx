import { useEffect, useRef, useState } from 'preact/hooks';
import { minifyCode, MINIFY_LANGUAGES, MINIFY_LANGUAGE_LABELS, type MinifyLanguage } from '../lib/tools/minifier';
import { readShareStateFromLocation } from '../lib/shareLink';
import { formatBytes } from './shared/formatBytes';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

const SAMPLE: Record<MinifyLanguage, string> = {
  html: '<!DOCTYPE html>\n<html>\n  <head>\n    <!-- page title -->\n    <title>Example</title>\n  </head>\n  <body>\n    <p>\n      Hello, world!\n    </p>\n  </body>\n</html>\n',
  css: '/* base styles */\n.card {\n  display: flex;\n  padding: 16px;\n  margin: 0 auto;\n  border-radius: 8px;\n}\n\n.card__title {\n  font-size: 1.25rem;\n  font-weight: 600;\n}\n',
  js: 'function greet(name) {\n  // say hello\n  const message = `Hello, ${name}!`;\n  return message;\n}\n\nconsole.log(greet("world"));\n',
};

const EXTENSIONS: Record<MinifyLanguage, string> = { html: 'html', css: 'css', js: 'js' };
const MIME_TYPES: Record<MinifyLanguage, string> = { html: 'text/html', css: 'text/css', js: 'text/javascript' };

interface ShareState {
  input: string;
  language: MinifyLanguage;
}

export default function Minifier() {
  const [language, setLanguage] = useState<MinifyLanguage>('js');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const { isDragActive, dropHandlers } = useTextFileDrop(setInput);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setLanguage(restored.value.language);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  useEffect(() => {
    const id = (requestId.current += 1);

    if (input.trim() === '') {
      setOutput('');
      setError(null);
      return;
    }

    void minifyCode(input, language).then((result) => {
      // Ignore a stale response if the input or language changed again before this one resolved.
      if (id !== requestId.current) return;
      if (result.ok) {
        setOutput(result.value);
        setError(null);
      } else {
        setOutput('');
        setError(result.error);
      }
    });
  }, [input, language]);

  const originalBytes = new TextEncoder().encode(input).length;
  const minifiedBytes = new TextEncoder().encode(output).length;
  const savedPercent = originalBytes > 0 && output !== '' ? Math.round((1 - minifiedBytes / originalBytes) * 100) : null;

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Language">
        <label class="checkbox">
          <span class="field__hint">Language</span>
          <select
            class="select"
            style="width:auto"
            value={language}
            aria-label="Language to minify"
            onChange={(event) => setLanguage((event.target as HTMLSelectElement).value as MinifyLanguage)}
          >
            {MINIFY_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {MINIFY_LANGUAGE_LABELS[lang]}
              </option>
            ))}
          </select>
        </label>

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input, language })} describe="this code" />
        <button type="button" class="btn" onClick={() => setInput(SAMPLE[language])} title="Load a small example">
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="minify-input">
            <span>{MINIFY_LANGUAGE_LABELS[language]} input</span>
          </label>
          <textarea
            id="minify-input"
            class={`textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            autocomplete="off"
            placeholder={`Paste ${MINIFY_LANGUAGE_LABELS[language]} here, or drop a file`}
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
            {...dropHandlers}
          />
        </div>

        <OutputPane
          label="Minified output"
          value={output}
          placeholder="Minified output appears here."
          tall
          describe="the minified output"
          actions={
            <DownloadButton
              value={output}
              filename={`minified.${EXTENSIONS[language]}`}
              mimeType={MIME_TYPES[language]}
              describe="the minified output"
            />
          }
        />
      </div>

      {savedPercent !== null && (
        <p class="field__hint" data-testid="minify-stats">
          {formatBytes(originalBytes)} → {formatBytes(minifiedBytes)}{' '}
          {savedPercent > 0 ? `(${savedPercent}% smaller)` : savedPercent < 0 ? `(${-savedPercent}% larger)` : '(no change)'}
        </p>
      )}

      <ErrorMessage message={error} />
    </div>
  );
}
