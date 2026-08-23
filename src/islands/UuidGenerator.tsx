import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import {
  generateUuids,
  inspectUuid,
  formatUuids,
  UUID_BULK_FORMATS,
  type UuidVersion,
  type UuidBulkFormat,
} from '../lib/tools/uuid';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { CopyButton } from './shared/CopyButton';
import { DownloadButton } from './shared/DownloadButton';

const FORMAT_LABELS: Record<UuidBulkFormat, { label: string; hint: string }> = {
  lines: { label: 'One per line', hint: 'Plain list — one UUID per line' },
  json: { label: 'JSON array', hint: 'A JSON array of strings, e.g. for a fixtures file' },
  csv: { label: 'Comma-separated', hint: 'A single comma-separated line' },
  sql: { label: 'SQL values', hint: "A ('uuid'), list ready to paste into an INSERT ... VALUES statement" },
};

const FORMAT_FILES: Record<UuidBulkFormat, { filename: string; mimeType: string }> = {
  lines: { filename: 'uuids.txt', mimeType: 'text/plain' },
  json: { filename: 'uuids.json', mimeType: 'application/json' },
  csv: { filename: 'uuids.csv', mimeType: 'text/csv' },
  sql: { filename: 'uuids.sql', mimeType: 'text/plain' },
};

export default function UuidGenerator() {
  const [version, setVersion] = useState<UuidVersion>('v4');
  const [count, setCount] = useState(5);
  const [uuids, setUuids] = useState<string[]>([]);
  const [format, setFormat] = useState<UuidBulkFormat>('lines');
  const [error, setError] = useState<string | null>(null);

  const [inspectInput, setInspectInput] = useState('');

  const generate = useCallback(() => {
    const result = generateUuids(count, version);
    if (result.ok) {
      setUuids(result.value);
      setError(null);
    } else {
      setUuids([]);
      setError(result.error);
    }
  }, [count, version]);

  // Generate an initial batch so the tool is useful the moment it loads.
  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first render only
  }, []);

  const output = useMemo(() => formatUuids(uuids, format), [uuids, format]);

  const inspection = inspectInput.trim() === '' ? null : inspectUuid(inspectInput);

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="UUID version">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={version === 'v4'}
            onClick={() => setVersion('v4')}
            title="Fully random UUIDs — reveal nothing about when they were created"
          >
            v4 (random)
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={version === 'v7'}
            onClick={() => setVersion('v7')}
            title="UUIDs that sort by creation time — better for database primary keys"
          >
            v7 (time-ordered)
          </button>
        </div>

        <label class="checkbox" title="How many UUIDs to create the next time you press Generate">
          <span class="field__hint">How many</span>
          <input
            type="number"
            class="input"
            style="width: 6rem"
            min={1}
            max={1000}
            value={count}
            aria-label="Number of UUIDs to generate"
            onInput={(event) => setCount(Number((event.target as HTMLInputElement).value))}
          />
        </label>

        <button
          type="button"
          class="btn btn--primary"
          onClick={generate}
          title="Create a new batch of UUIDs"
        >
          <span aria-hidden="true">↻</span> Generate
        </button>

        <label class="checkbox" title="How the batch below is formatted — pick the shape you need to paste elsewhere">
          <span class="field__hint">Format</span>
          <select
            class="select"
            value={format}
            aria-label="Output format"
            onChange={(event) => setFormat((event.target as HTMLSelectElement).value as UuidBulkFormat)}
          >
            {UUID_BULK_FORMATS.map((value) => (
              <option key={value} value={value} title={FORMAT_LABELS[value].hint}>
                {FORMAT_LABELS[value].label}
              </option>
            ))}
          </select>
        </label>

        <span class="tool-bar__spacer" />
        <CopyButton value={output} label="Copy all" describe="UUIDs" />
        <DownloadButton
          value={output}
          filename={FORMAT_FILES[format].filename}
          mimeType={FORMAT_FILES[format].mimeType}
          describe="UUIDs"
        />
      </div>

      <ErrorMessage message={error} />

      <OutputPane
        label={`Generated ${version.toUpperCase()} UUIDs`}
        value={output}
        placeholder="Press Generate to create UUIDs."
        describe="UUIDs"
        tall
      />

      <hr style="border:0;border-top:1px solid var(--border);margin:0" />

      <div class="field">
        <label class="field__label" for="uuid-inspect">
          <span>Inspect an existing UUID</span>
          <span class="field__hint">Reads the version, and the timestamp inside a v7</span>
        </label>
        <input
          id="uuid-inspect"
          class="input"
          spellcheck={false}
          autocomplete="off"
          placeholder="Paste a UUID to check whether it is valid…"
          value={inspectInput}
          aria-invalid={inspection !== null && !inspection.ok}
          onInput={(event) => setInspectInput((event.target as HTMLInputElement).value)}
        />
      </div>

      {inspection && !inspection.ok && <ErrorMessage message={inspection.error} />}

      {inspection?.ok && (
        <p class="msg msg--success">
          <span class="msg__icon" aria-hidden="true">
            ✓
          </span>
          <span>
            Valid UUID, version {inspection.value.version} ({inspection.value.variant})
            {inspection.value.timestamp
              ? `, created ${inspection.value.timestamp.toISOString()}`
              : ''}
            .
          </span>
        </p>
      )}
    </div>
  );
}
