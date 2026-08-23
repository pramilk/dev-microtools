import { useEffect, useState } from 'preact/hooks';
import {
  generateFakeData,
  FAKE_FIELD_TYPES,
  FAKE_FIELD_LABELS,
  RANGED_FIELD_TYPES,
  MIN_ROWS,
  MAX_ROWS,
  DEFAULT_INTEGER_RANGE,
  DEFAULT_FLOAT_RANGE,
  type FakeDataField,
  type FakeDataFormat,
  type FakeFieldType,
} from '../lib/tools/fakeData';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

let nextId = 0;
const newField = (type: FakeFieldType): FakeDataField => ({
  id: `f${(nextId += 1)}`,
  type,
  label: FAKE_FIELD_LABELS[type],
  ...(type === 'integer' ? DEFAULT_INTEGER_RANGE : {}),
  ...(type === 'float' ? DEFAULT_FLOAT_RANGE : {}),
});

const DEFAULT_FIELDS: FakeDataField[] = [newField('fullName'), newField('email'), newField('jobTitle')];

interface ShareState {
  fields: FakeDataField[];
  rowCount: number;
  format: FakeDataFormat;
  seed: number | null;
}

export default function FakeDataGenerator() {
  const [fields, setFields] = useState<FakeDataField[]>(DEFAULT_FIELDS);
  const [rowCount, setRowCount] = useState(10);
  const [format, setFormat] = useState<FakeDataFormat>('json');
  const [pinnedSeed, setPinnedSeed] = useState<number | null>(null);
  const [regenerateNonce, setRegenerateNonce] = useState(0);
  const [output, setOutput] = useState('');
  const [resolvedSeed, setResolvedSeed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setFields(restored.value.fields);
      setRowCount(restored.value.rowCount);
      setFormat(restored.value.format);
      setPinnedSeed(restored.value.seed);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  useEffect(() => {
    const result = generateFakeData({ rowCount, fields, format, seed: pinnedSeed });
    if (result.ok) {
      setOutput(result.value.text);
      setResolvedSeed(result.value.seed);
      setError(null);
    } else {
      setOutput('');
      setResolvedSeed(null);
      setError(result.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount, fields, format, pinnedSeed, regenerateNonce]);

  const updateField = (id: string, patch: Partial<FakeDataField>) => {
    setFields((current) => current.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const changeFieldType = (id: string, type: FakeFieldType) => {
    setFields((current) => current.map((f) => (f.id === id ? { ...newField(type), id } : f)));
  };

  const removeField = (id: string) => setFields((current) => current.filter((f) => f.id !== id));
  const addField = () => setFields((current) => [...current, newField('firstName')]);

  const extension = format === 'json' ? 'json' : 'csv';
  const mimeType = format === 'json' ? 'application/json' : 'text/csv';

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Output options">
        <label class="checkbox">
          <span class="field__hint">Rows</span>
          <input
            type="number"
            class="input"
            style="width:6rem"
            min={MIN_ROWS}
            max={MAX_ROWS}
            value={rowCount}
            aria-label="Row count"
            onInput={(event) => setRowCount(Number((event.target as HTMLInputElement).value))}
          />
        </label>
        <label class="checkbox">
          <span class="field__hint">Format</span>
          <select
            class="select"
            style="width:auto"
            value={format}
            aria-label="Output format"
            onChange={(event) => setFormat((event.target as HTMLSelectElement).value as FakeDataFormat)}
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <label class="checkbox" title="Leave blank for a fresh random batch each time; enter a number to reproduce the same data every time">
          <span class="field__hint">Seed</span>
          <input
            type="number"
            class="input"
            style="width:8rem"
            placeholder="random"
            value={pinnedSeed ?? ''}
            aria-label="Seed (optional, for reproducible output)"
            onInput={(event) => {
              const raw = (event.target as HTMLInputElement).value;
              setPinnedSeed(raw === '' ? null : Number(raw));
            }}
          />
        </label>
        <button
          type="button"
          class="btn"
          onClick={() => {
            setPinnedSeed(null);
            setRegenerateNonce((n) => n + 1);
          }}
          title="Draw a fresh random batch"
        >
          <span aria-hidden="true">🎲</span> Regenerate
        </button>

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ fields, rowCount, format, seed: pinnedSeed })} describe="this dataset config" />
      </div>

      <div class="field">
        <span class="field__label">Fields</span>
        <p class="field__hint">
          Pick what each field generates from the dropdown — its column/key name is filled in for you, but you can
          change that name to anything you like without affecting what the field generates.
        </p>
        <div class="fake-fields">
          {fields.map((f) => (
            <div class="fake-field-row" key={f.id}>
              <select
                class="select"
                value={f.type}
                aria-label="Field type"
                onChange={(event) => changeFieldType(f.id, (event.target as HTMLSelectElement).value as FakeFieldType)}
              >
                {FAKE_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {FAKE_FIELD_LABELS[type]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                class="input fake-field-name"
                value={f.label}
                aria-label="Column name"
                placeholder="Column name"
                onInput={(event) => updateField(f.id, { label: (event.target as HTMLInputElement).value })}
              />
              {RANGED_FIELD_TYPES.has(f.type) && (
                <>
                  <input
                    type="number"
                    class="input"
                    style="width:5rem"
                    value={f.min}
                    aria-label="Minimum"
                    placeholder="min"
                    onInput={(event) => updateField(f.id, { min: Number((event.target as HTMLInputElement).value) })}
                  />
                  <input
                    type="number"
                    class="input"
                    style="width:5rem"
                    value={f.max}
                    aria-label="Maximum"
                    placeholder="max"
                    onInput={(event) => updateField(f.id, { max: Number((event.target as HTMLInputElement).value) })}
                  />
                </>
              )}
              {f.type === 'float' && (
                <input
                  type="number"
                  class="input"
                  style="width:5rem"
                  min={0}
                  max={10}
                  value={f.decimals}
                  aria-label="Decimal places"
                  placeholder="decimals"
                  onInput={(event) => updateField(f.id, { decimals: Number((event.target as HTMLInputElement).value) })}
                />
              )}
              <button
                type="button"
                class="btn"
                onClick={() => removeField(f.id)}
                disabled={fields.length <= 1}
                title="Remove this field"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button type="button" class="btn" onClick={addField} title="Add another field">
          + Add field
        </button>
      </div>

      <OutputPane
        label={`Generated ${format.toUpperCase()}`}
        value={output}
        placeholder="Generated data appears here."
        tall
        describe="the generated data"
        actions={<DownloadButton value={output} filename={`fake-data.${extension}`} mimeType={mimeType} describe="the generated data" />}
      />

      {resolvedSeed !== null && (
        <p class="field__hint">
          Seed used: <code>{resolvedSeed}</code> — enter it in the Seed field above to reproduce this exact data.
        </p>
      )}

      <ErrorMessage message={error} />

      <style>{`
        .fake-fields { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-2); }
        .fake-field-row { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
        .fake-field-row .select { width: auto; }
        .fake-field-name { flex: 1; min-width: 8rem; }
      `}</style>
    </div>
  );
}
