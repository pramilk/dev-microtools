import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  DURATION_UNITS,
  applyDuration,
  describeDuration,
  durationFromFields,
  durationTotals,
  formatIsoDuration,
  parseIsoDuration,
  secondsToDuration,
  type DurationFields,
  type DurationUnit,
} from '../lib/tools/isoDuration';
import { parseLocalDateTime } from '../lib/tools/timeZone';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { ResultRows, type ResultRow } from './shared/ResultRows';
import { ShareLinkButton } from './shared/ShareLinkButton';

type Mode = 'parse' | 'build';

interface ShareState {
  mode: Mode;
  input: string;
  fields: DurationFields;
  negative: boolean;
  start: string;
}

const EMPTY_FIELDS: DurationFields = {
  years: '',
  months: '',
  weeks: '',
  days: '',
  hours: '',
  minutes: '',
  seconds: '',
};

/** Same value as the page's worked example, so the two never drift apart. */
const EXAMPLE_INPUT = 'P3Y6M4DT12H30M5S';

const PRESETS = [
  { label: '90 minutes', value: 'PT90M' },
  { label: '1 day 12 hours', value: 'P1DT12H' },
  { label: '2 weeks', value: 'P2W' },
  { label: 'Half a second', value: 'PT0.5S' },
  { label: 'Everything', value: EXAMPLE_INPUT },
];

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

const nowUtcLocal = (): string => new Date().toISOString().slice(0, 16);

export default function IsoDurationParser() {
  const [mode, setMode] = useState<Mode>('parse');
  const [input, setInput] = useState(EXAMPLE_INPUT);
  const [fields, setFields] = useState<DurationFields>(EMPTY_FIELDS);
  const [negative, setNegative] = useState(false);
  const [start, setStart] = useState(nowUtcLocal);
  const [secondsDraft, setSecondsDraft] = useState('');
  const [secondsError, setSecondsError] = useState<string | null>(null);

  // Restore state from a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setMode(restored.value.mode);
      setInput(restored.value.input);
      setFields({ ...EMPTY_FIELDS, ...restored.value.fields });
      setNegative(restored.value.negative);
      setStart(restored.value.start);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const parsed = useMemo(() => {
    if (mode === 'parse') return input.trim() === '' ? null : parseIsoDuration(input);
    return Object.values(fields).every((text) => text.trim() === '') ? null : durationFromFields(fields, negative);
  }, [mode, input, fields, negative]);

  const value = parsed?.ok ? parsed.value : null;
  const error = parsed && !parsed.ok ? parsed.error : null;

  const applied = useMemo(() => {
    if (!value || start.trim() === '') return null;
    const wall = parseLocalDateTime(start);
    if (!wall.ok) return wall;
    const startMs = Date.UTC(wall.value.year, wall.value.month - 1, wall.value.day, wall.value.hour, wall.value.minute, wall.value.second);
    return applyDuration(startMs, value.duration);
  }, [value, start]);

  const rows: ResultRow[] = useMemo(() => {
    if (!value) return [];
    const { duration } = value;
    const totals = durationTotals(duration);
    const approx = totals.approximate ? '≈ ' : '';
    const approxHint = totals.approximate ? 'Approximate: a year or month has no fixed length, so averages are used' : undefined;
    const rowsOut: ResultRow[] = [
      { label: 'ISO 8601', value: formatIsoDuration(duration) },
      { label: 'In words', value: describeDuration(duration) },
      {
        label: 'Total seconds',
        value: `${approx}${number.format(totals.seconds)}`,
        copyValue: String(totals.seconds),
        hint: approxHint,
      },
      { label: 'Total minutes', value: `${approx}${number.format(totals.seconds / 60)}`, copyValue: String(totals.seconds / 60) },
      { label: 'Total hours', value: `${approx}${number.format(totals.seconds / 3600)}`, copyValue: String(totals.seconds / 3600) },
      { label: 'Total days', value: `${approx}${number.format(totals.seconds / 86_400)}`, copyValue: String(totals.seconds / 86_400) },
    ];
    if (applied?.ok) {
      rowsOut.push({
        label: `${duration.negative ? 'Minus' : 'Plus'} ${start.replace('T', ' ')} UTC`,
        value: new Date(applied.value).toISOString(),
        hint: 'Years and months move the calendar date; everything else is exact elapsed time',
      });
    }
    return rowsOut;
  }, [value, applied, start]);

  const setField = (unit: DurationUnit, text: string) => setFields((current) => ({ ...current, [unit]: text }));

  const fillFromSeconds = () => {
    const text = secondsDraft.trim();
    const result = secondsToDuration(text === '' ? Number.NaN : Number(text));
    if (!result.ok) {
      setSecondsError(result.error);
      return;
    }
    setSecondsError(null);
    const d = result.value;
    setNegative(d.negative);
    setFields({
      ...EMPTY_FIELDS,
      days: d.days ? String(d.days) : '',
      hours: d.hours ? String(d.hours) : '',
      minutes: d.minutes ? String(d.minutes) : '',
      seconds: d.seconds ? String(d.seconds) : '',
    });
    setMode('build');
  };

  const clearAll = () => {
    setInput('');
    setFields(EMPTY_FIELDS);
    setNegative(false);
    setSecondsDraft('');
    setSecondsError(null);
  };
  const nothingToClear = mode === 'parse' ? input === '' : Object.values(fields).every((t) => t === '') && !negative;

  return (
    <div class="tool">
      <div class="seg" role="group" aria-label="Mode">
        <button
          type="button"
          class="seg__btn"
          aria-pressed={mode === 'parse'}
          onClick={() => setMode('parse')}
          title="Read an ISO 8601 duration such as PT1H30M"
        >
          Parse a duration
        </button>
        <button
          type="button"
          class="seg__btn"
          aria-pressed={mode === 'build'}
          onClick={() => setMode('build')}
          title="Build an ISO 8601 duration from years, days, hours and so on"
        >
          Build a duration
        </button>
      </div>

      {mode === 'parse' ? (
        <>
          <div class="presets" role="group" aria-label="Example durations">
            {PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                class="preset-chip"
                onClick={() => setInput(preset.value)}
                title={`Use "${preset.value}"`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div class="field">
            <label class="field__label" for="iso-duration-input">
              <span>ISO 8601 duration</span>
              <span class="field__hint">P = period, T = time, e.g. P1DT2H30M</span>
            </label>
            <input
              id="iso-duration-input"
              class="input"
              spellcheck={false}
              autocomplete="off"
              placeholder="P3Y6M4DT12H30M5S"
              value={input}
              aria-invalid={error !== null}
              onInput={(event) => setInput((event.target as HTMLInputElement).value)}
            />
          </div>
        </>
      ) : (
        <>
          <div class="iso-fields">
            {DURATION_UNITS.map(({ unit, label, time }) => (
              <div class="field" key={unit}>
                <label class="field__label" for={`iso-${unit}`}>
                  <span>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
                  <span class="field__hint">{time ? 'time' : 'date'}</span>
                </label>
                <input
                  id={`iso-${unit}`}
                  class="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={fields[unit]}
                  onInput={(event) => setField(unit, (event.target as HTMLInputElement).value)}
                />
              </div>
            ))}
          </div>
          <label class="checkbox" title="Write the duration with a leading minus sign, for a span that runs backwards">
            <input type="checkbox" checked={negative} onChange={(event) => setNegative((event.target as HTMLInputElement).checked)} />
            <span>Negative duration</span>
          </label>

          <div class="field">
            <label class="field__label" for="iso-total-seconds">
              <span>Or start from a number of seconds</span>
              <span class="field__hint">e.g. a video length or timeout</span>
            </label>
            <div class="iso-seconds">
              <input
                id="iso-total-seconds"
                class="input"
                inputMode="decimal"
                placeholder="5400"
                value={secondsDraft}
                aria-invalid={secondsError !== null}
                onInput={(event) => setSecondsDraft((event.target as HTMLInputElement).value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') fillFromSeconds();
                }}
              />
              <button type="button" class="btn" onClick={fillFromSeconds} disabled={secondsDraft.trim() === ''}>
                Fill fields
              </button>
            </div>
            <ErrorMessage message={secondsError} />
          </div>
        </>
      )}

      <div class="tool-bar">
        <button type="button" class="btn" onClick={clearAll} disabled={nothingToClear} title="Clear the input">
          Clear
        </button>
        <span class="tool-bar__spacer" />
        <ShareLinkButton
          getState={() => ({ mode, input, fields, negative, start })}
          describe="this duration"
        />
      </div>

      <ErrorMessage message={error} />

      {value?.warnings.map((warning) => (
        <p key={warning} class="msg msg--info" role="status">
          <span class="msg__icon" aria-hidden="true">
            i
          </span>
          <span>{warning}</span>
        </p>
      ))}

      {value && (
        <div class="field">
          <label class="field__label" for="iso-start">
            <span>Apply to a date and time (UTC)</span>
            <span class="field__hint">Optional — shows where the duration lands</span>
          </label>
          <input
            id="iso-start"
            class="input"
            type="datetime-local"
            value={start}
            onInput={(event) => setStart((event.target as HTMLInputElement).value)}
          />
        </div>
      )}
      <ErrorMessage message={applied && !applied.ok ? applied.error : null} />

      {rows.length > 0 && <ResultRows label="Duration breakdown" rows={rows} />}

      <style>{`
        .presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .preset-chip {
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); padding: 0.35rem 0.75rem;
          font: inherit; font-size: var(--text-sm); font-weight: 550; color: var(--text); cursor: pointer;
        }
        .preset-chip:hover { background: var(--surface-2); border-color: var(--text-subtle); }
        .iso-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); gap: var(--space-3); }
        .iso-seconds { display: flex; gap: var(--space-2); }
        .iso-seconds .input { flex: 1; min-width: 0; }
      `}</style>
    </div>
  );
}
