import { useEffect, useRef, useState } from 'preact/hooks';
import {
  convertDataFormat,
  detectFormat,
  DATA_FORMATS,
  DATA_FORMAT_LABELS,
  type DataFormat,
} from '../lib/tools/dataFormat';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

const SAMPLE: Record<DataFormat, string> = {
  json: '[\n  { "name": "Ada", "role": "Engineer" },\n  { "name": "Grace", "role": "Admiral" }\n]',
  yaml: '- name: Ada\n  role: Engineer\n- name: Grace\n  role: Admiral\n',
  csv: 'name,role\nAda,Engineer\nGrace,Admiral',
};

const EXTENSIONS: Record<DataFormat, string> = { json: 'json', yaml: 'yaml', csv: 'csv' };
const MIME_TYPES: Record<DataFormat, string> = { json: 'application/json', yaml: 'text/yaml', csv: 'text/csv' };

interface ShareState {
  input: string;
  from: DataFormat;
  to: DataFormat;
  delimiter: string;
  hasHeader: boolean;
}

export default function DataFormatConverter() {
  const [from, setFrom] = useState<DataFormat>('json');
  const [to, setTo] = useState<DataFormat>('yaml');
  const [input, setInput] = useState('');
  const [delimiter, setDelimiter] = useState(',');
  const [hasHeader, setHasHeader] = useState(true);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  /** Applies a bulk block of new text (a dropped file, or a paste into an empty box) and, unless it's ambiguous, switches "From" to match what it looks like. */
  const applyDetectedInput = (text: string) => {
    const detected = detectFormat(text);
    if (detected) setFrom(detected);
    setInput(text);
  };
  const { isDragActive, dropHandlers } = useTextFileDrop(applyDetectedInput);

  const handlePaste = (event: ClipboardEvent) => {
    // Only auto-detect when starting fresh — overriding "From" mid-edit on a paste into
    // existing content would be surprising, and the paste itself still goes through
    // untouched (this only adjusts the format selector, never the pasted text).
    if (input !== '') return;
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    const detected = detectFormat(text);
    if (detected) setFrom(detected);
  };

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setFrom(state.from);
      setTo(state.to);
      setInput(state.input);
      setDelimiter(state.delimiter);
      setHasHeader(state.hasHeader);
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

    void convertDataFormat(input, from, to, { delimiter, hasHeader }).then((result) => {
      // Ignore a stale response if the input changed again before this one resolved.
      if (id !== requestId.current) return;
      if (result.ok) {
        setOutput(result.value);
        setError(null);
      } else {
        setOutput('');
        setError(result.error);
      }
    });
  }, [input, from, to, delimiter, hasHeader]);

  const swap = () => {
    if (from === to) return;
    const nextInput = output !== '' ? output : input;
    setFrom(to);
    setTo(from);
    setInput(nextInput);
  };

  const usesCsv = from === 'csv' || to === 'csv';

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Formats">
        <label class="checkbox">
          <span class="field__hint">From</span>
          <select
            class="select"
            style="width:auto"
            value={from}
            aria-label="Convert from format"
            onChange={(event) => setFrom((event.target as HTMLSelectElement).value as DataFormat)}
          >
            {DATA_FORMATS.map((format) => (
              <option key={format} value={format}>
                {DATA_FORMAT_LABELS[format]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          class="btn"
          onClick={swap}
          disabled={from === to}
          title="Swap the From/To formats, using the current output as the new input"
        >
          <span aria-hidden="true">⇄</span> Swap
        </button>
        <label class="checkbox">
          <span class="field__hint">To</span>
          <select
            class="select"
            style="width:auto"
            value={to}
            aria-label="Convert to format"
            onChange={(event) => setTo((event.target as HTMLSelectElement).value as DataFormat)}
          >
            {DATA_FORMATS.map((format) => (
              <option key={format} value={format}>
                {DATA_FORMAT_LABELS[format]}
              </option>
            ))}
          </select>
        </label>

        {usesCsv && (
          <>
            <label class="checkbox">
              <span class="field__hint">Delimiter</span>
              <select
                class="select"
                style="width:auto"
                value={delimiter}
                aria-label="CSV delimiter"
                onChange={(event) => setDelimiter((event.target as HTMLSelectElement).value)}
              >
                <option value=",">, comma</option>
                <option value=";">; semicolon</option>
                <option value={'\t'}>tab</option>
                <option value="|">| pipe</option>
              </select>
            </label>
            <label class="checkbox">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(event) => setHasHeader((event.target as HTMLInputElement).checked)}
              />
              First row is a header
            </label>
          </>
        )}

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input, from, to, delimiter, hasHeader })} describe="this conversion" />
        <button type="button" class="btn" onClick={() => setInput(SAMPLE[from])} title="Load a small example">
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="data-input">
            <span>{DATA_FORMAT_LABELS[from]} input</span>
          </label>
          <textarea
            id="data-input"
            class={`textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            autocomplete="off"
            placeholder={`Paste ${DATA_FORMAT_LABELS[from]} here, or drop a file`}
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
            onPaste={handlePaste}
            {...dropHandlers}
          />
          {usesCsv && (
            <p class="field__hint">
              CSV values are always kept as text — numbers, booleans and dates aren't auto-detected, so a leading
              zero or a version string like "1.0" is never silently corrupted.
            </p>
          )}
        </div>

        <OutputPane
          label={`${DATA_FORMAT_LABELS[to]} output`}
          value={output}
          placeholder="Converted output appears here."
          tall
          describe={`${DATA_FORMAT_LABELS[to]} output`}
          actions={
            <DownloadButton
              value={output}
              filename={`data.${EXTENSIONS[to]}`}
              mimeType={MIME_TYPES[to]}
              describe={`${DATA_FORMAT_LABELS[to]} output`}
            />
          }
        />
      </div>

      <ErrorMessage message={error} />
    </div>
  );
}
