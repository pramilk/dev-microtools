import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  fromEpoch,
  fromDateString,
  nowBreakdown,
  type TimestampBreakdown,
  type TimestampUnit,
} from '../lib/tools/timestamp';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';

type Mode = 'epoch' | 'date';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <span class="ts-value">{value}</span>
        <CopyButton value={value} describe={label} />
      </dd>
    </>
  );
}

export default function TimestampConverter() {
  const [mode, setMode] = useState<Mode>('epoch');
  const [input, setInput] = useState('');
  const [unit, setUnit] = useState<TimestampUnit | 'auto'>('auto');
  const [now, setNow] = useState<TimestampBreakdown>(() => nowBreakdown());

  // The live clock is the reason many people open this page.
  useEffect(() => {
    const timer = setInterval(() => setNow(nowBreakdown()), 1000);
    return () => clearInterval(timer);
  }, []);

  const result = useMemo(() => {
    if (input.trim() === '') return null;
    return mode === 'epoch' ? fromEpoch(input, unit) : fromDateString(input);
  }, [input, mode, unit]);

  const value = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;

  return (
    <div class="tool">
      <div class="now-card">
        <div class="now-card__label">Current Unix time</div>
        <div class="now-card__value tnum">{now.seconds}</div>
        <div class="now-card__meta">
          {now.iso} · {now.timeZone}
        </div>
        <div class="tool-bar__group">
          <CopyButton value={String(now.seconds)} label="Copy seconds" describe="timestamp" />
          <CopyButton
            value={String(now.milliseconds)}
            label="Copy milliseconds"
            describe="timestamp"
          />
        </div>
      </div>

      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Conversion direction">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={mode === 'epoch'}
            onClick={() => setMode('epoch')}
          >
            Timestamp → date
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={mode === 'date'}
            onClick={() => setMode('date')}
          >
            Date → timestamp
          </button>
        </div>

        {mode === 'epoch' && (
          <label class="checkbox">
            <span class="field__hint">Unit</span>
            <select
              class="select"
              value={unit}
              aria-label="Timestamp unit"
              onChange={(event) =>
                setUnit((event.target as HTMLSelectElement).value as TimestampUnit | 'auto')
              }
            >
              <option value="auto">Auto-detect</option>
              <option value="seconds">Seconds</option>
              <option value="milliseconds">Milliseconds</option>
            </select>
          </label>
        )}

        <span class="tool-bar__spacer" />
        <button
          type="button"
          class="btn"
          onClick={() =>
            setInput(mode === 'epoch' ? String(now.seconds) : new Date().toISOString())
          }
        >
          Use now
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''}>
          Clear
        </button>
      </div>

      <div class="field">
        <label class="field__label" for="ts-input">
          <span>{mode === 'epoch' ? 'Unix timestamp' : 'Date'}</span>
          <span class="field__hint">
            {mode === 'epoch' ? 'Seconds or milliseconds' : 'ISO 8601 works best'}
          </span>
        </label>
        <input
          id="ts-input"
          class="input"
          spellcheck={false}
          autocomplete="off"
          placeholder={mode === 'epoch' ? '1700000000' : '2026-03-14T09:26:53Z'}
          value={input}
          aria-invalid={error !== null}
          onInput={(event) => setInput((event.target as HTMLInputElement).value)}
        />
      </div>

      <ErrorMessage message={error} />

      {value && (
        <dl class="ts-grid">
          <Row label="Unix seconds" value={String(value.seconds)} />
          <Row label="Unix milliseconds" value={String(value.milliseconds)} />
          <Row label="ISO 8601 (UTC)" value={value.iso} />
          <Row label="RFC 1123 (UTC)" value={value.utc} />
          <Row label="Your local time" value={value.local} />
          <Row label="Relative" value={value.relative} />
          <Row label="Day of week" value={value.dayOfWeek} />
        </dl>
      )}

      <style>{`
        .now-card {
          border: 1px solid var(--accent-border); background: var(--accent-subtle);
          border-radius: var(--radius-lg); padding: var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start;
        }
        .now-card__label {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em;
          font-family: var(--font-mono); font-weight: 600; color: var(--text-muted);
        }
        .now-card__value {
          font-family: var(--font-mono); font-size: var(--text-2xl); font-weight: 700;
          letter-spacing: -.02em; color: var(--text); line-height: 1.1;
        }
        .now-card__meta { font-size: var(--text-xs); color: var(--text-muted); }
        .ts-grid {
          display: grid; grid-template-columns: minmax(8rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-4); font-size: var(--text-sm);
        }
        .ts-grid dt { color: var(--text-muted); }
        .ts-grid dd {
          margin: 0; display: flex; align-items: center; gap: var(--space-2);
          justify-content: space-between; min-width: 0;
        }
        .ts-value {
          font-family: var(--font-mono); font-variant-numeric: tabular-nums;
          word-break: break-word; min-width: 0;
        }
      `}</style>
    </div>
  );
}
