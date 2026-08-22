import { useCallback, useEffect, useState } from 'preact/hooks';
import { generateUuids, inspectUuid, type UuidVersion } from '../lib/tools/uuid';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { CopyButton } from './shared/CopyButton';

export default function UuidGenerator() {
  const [version, setVersion] = useState<UuidVersion>('v4');
  const [count, setCount] = useState(5);
  const [uuids, setUuids] = useState<string[]>([]);
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
          >
            v4 (random)
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={version === 'v7'}
            onClick={() => setVersion('v7')}
          >
            v7 (time-ordered)
          </button>
        </div>

        <label class="checkbox">
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

        <button type="button" class="btn btn--primary" onClick={generate}>
          <span aria-hidden="true">↻</span> Generate
        </button>

        <span class="tool-bar__spacer" />
        <CopyButton value={uuids.join('\n')} label="Copy all" describe="UUIDs" />
      </div>

      <ErrorMessage message={error} />

      <OutputPane
        label={`Generated ${version.toUpperCase()} UUIDs`}
        value={uuids.join('\n')}
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
