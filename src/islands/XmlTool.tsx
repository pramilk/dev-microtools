import { useEffect, useRef, useState } from 'preact/hooks';
import { type ToolResult, ok } from '../lib/tools/result';
import { formatXml, minifyXml, validateXml, xmlToJson, DEFAULT_INDENT_SIZE, type XmlIndentStyle } from '../lib/tools/xml';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

type Mode = 'format' | 'minify' | 'validate' | 'json';

const MODES: Mode[] = ['format', 'minify', 'validate', 'json'];

const MODE_LABELS: Record<Mode, string> = {
  format: 'Format',
  minify: 'Minify',
  validate: 'Validate',
  json: 'To JSON',
};

const MODE_HINTS: Record<Mode, string> = {
  format: 'Pretty-print with indentation so nesting is easy to read',
  minify: 'Collapse to remove insignificant whitespace between tags',
  validate: 'Check that the document is well-formed XML',
  json: 'Convert to JSON using an explicit, documented attribute/text convention',
};

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <book id="bk101">
    <author>Gambardella, Matthew</author>
    <title>XML Developer's Guide</title>
    <price>44.95</price>
  </book>
  <book id="bk102">
    <author>Ralls, Kim</author>
    <title>Midnight Rain</title>
    <price>5.95</price>
  </book>
</catalog>
`;

interface ShareState {
  input: string;
  mode: Mode;
  indent: XmlIndentStyle;
}

/** Runs the selected mode over the source document, always through a `ToolResult`. */
function applyMode(source: string, mode: Mode, indent: XmlIndentStyle): ToolResult<string> {
  if (mode === 'format') return formatXml(source, indent);
  if (mode === 'minify') return minifyXml(source);
  if (mode === 'validate') {
    const result = validateXml(source);
    return result.ok ? ok('This document is well-formed XML.') : result;
  }
  const result = xmlToJson(source);
  return result.ok ? ok(JSON.stringify(result.value, null, 2)) : result;
}

export default function XmlTool() {
  const [mode, setMode] = useState<Mode>('format');
  const [indent, setIndent] = useState<XmlIndentStyle>(DEFAULT_INDENT_SIZE);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const { isDragActive, dropHandlers } = useTextFileDrop(setInput);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setMode(restored.value.mode);
      // Fall back for links made before indent was shared, rather than restoring `undefined`.
      setIndent(restored.value.indent ?? DEFAULT_INDENT_SIZE);
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

    const result = applyMode(input, mode, indent);
    // Guards against a stale synchronous result if this effect somehow re-fires out of
    // order — kept for consistency with every other tool's async result-handling shape.
    if (id !== requestId.current) return;
    if (result.ok) {
      setOutput(result.value);
      setError(null);
    } else {
      setOutput('');
      setError(result.error);
    }
  }, [input, mode, indent]);

  const isJsonMode = mode === 'json';
  const filename = isJsonMode ? 'data.json' : 'data.xml';
  const mimeType = isJsonMode ? 'application/json' : 'application/xml';

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Mode">
          {MODES.map((value) => (
            <button
              key={value}
              type="button"
              class="seg__btn"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              title={MODE_HINTS[value]}
            >
              {MODE_LABELS[value]}
            </button>
          ))}
        </div>

        <label
          class="checkbox"
          title={mode === 'format' ? 'Choose the indentation width used when formatting' : 'Only applies to Format mode'}
        >
          <span class="field__hint">Indent</span>
          <select
            class="select"
            value={String(indent)}
            disabled={mode !== 'format'}
            onChange={(event) => {
              const next = (event.target as HTMLSelectElement).value;
              setIndent(next === 'tab' ? 'tab' : (Number(next) as 2 | 4));
            }}
            aria-label="Indentation"
          >
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            <option value="tab">Tab</option>
          </select>
        </label>

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input, mode, indent })} describe="this document" />
        <button type="button" class="btn" onClick={() => setInput(SAMPLE)} title="Load a small example document">
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="xml-input">
            <span>XML input</span>
          </label>
          <textarea
            id="xml-input"
            class={`textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            placeholder="Paste XML here, or drop a file, e.g. <root><a>1</a></root>"
            value={input}
            aria-invalid={error !== null}
            aria-describedby={error ? 'xml-error' : undefined}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
            {...dropHandlers}
          />
        </div>

        <OutputPane
          label={isJsonMode ? 'JSON output' : mode === 'validate' ? 'Result' : 'XML output'}
          value={output}
          placeholder="Output appears here."
          tall
          describe={isJsonMode ? 'the JSON output' : 'the output'}
          actions={
            mode !== 'validate' && (
              <DownloadButton
                value={output}
                filename={filename}
                mimeType={mimeType}
                describe={isJsonMode ? 'the JSON output' : 'the XML output'}
              />
            )
          }
        />
      </div>

      <div id="xml-error">
        <ErrorMessage message={error} />
      </div>
    </div>
  );
}
