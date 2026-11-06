import { useEffect, useMemo, useState } from 'preact/hooks';
import { CRON_DIALECTS, CRON_PRESETS_BY_DIALECT, explainCron, type CronDialect } from '../lib/tools/cronDialects';
import { nextScheduleRuns } from '../lib/tools/cronSchedule';
import { browserTimeZone, isValidTimeZone } from '../lib/tools/timeZone';
import { COMMON_TIME_ZONES } from '../lib/tools/timestamp';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

interface ShareState {
  input: string;
  /** Absent in links made before Quartz and EventBridge support; those were all Unix. */
  dialect?: CronDialect;
  zone?: string;
}

const NEXT_RUN_COUNT = 5;
const BROWSER_ZONE = 'browser';

const DEFAULT_EXPRESSION: Record<CronDialect, string> = {
  unix: '*/15 * * * *',
  quartz: '0 0/15 * * * ?',
  aws: '0/15 * * * ? *',
};

function formatRun(date: Date, zone: string, withSeconds: boolean): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    timeZoneName: 'short',
  }).format(date);
}

export default function CronExplainer() {
  const [dialect, setDialect] = useState<CronDialect>('unix');
  const [input, setInput] = useState(DEFAULT_EXPRESSION.unix);
  const [zone, setZone] = useState(BROWSER_ZONE);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      setDialect(restored.value.dialect ?? 'unix');
      if (restored.value.zone) setZone(restored.value.zone);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => (input.trim() === '' ? null : explainCron(input, dialect)), [input, dialect]);
  const value = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;

  const effectiveZone = zone === BROWSER_ZONE ? browserTimeZone() : zone;
  const zoneIsValid = isValidTimeZone(effectiveZone);

  const nextRuns = useMemo(
    () =>
      value?.schedule && zoneIsValid ? nextScheduleRuns(value.schedule, NEXT_RUN_COUNT, new Date(), effectiveZone) : [],
    [value, effectiveZone, zoneIsValid]
  );

  const showSeconds = dialect === 'quartz';
  const info = CRON_DIALECTS.find((entry) => entry.id === dialect)!;

  const changeDialect = (next: CronDialect) => {
    if (next === dialect) return;
    setDialect(next);
    // Keep what the reader typed if it still means something in the new syntax; otherwise
    // start from a sensible example so the tool never opens on an error they did not cause.
    if (input.trim() === '' || !explainCron(input, next).ok) setInput(DEFAULT_EXPRESSION[next]);
    // EventBridge evaluates cron in UTC, so UTC is the honest default there.
    if (next === 'aws' && zone === BROWSER_ZONE) setZone('UTC');
  };

  const zoneOptions = useMemo(() => {
    const listed = new Set(['UTC', ...COMMON_TIME_ZONES.map((entry) => entry.zone)]);
    return zone !== BROWSER_ZONE && !listed.has(zone) ? [zone] : [];
  }, [zone]);

  return (
    <div class="tool">
      <div class="seg" role="group" aria-label="Cron syntax">
        {CRON_DIALECTS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            class="seg__btn"
            aria-pressed={dialect === entry.id}
            onClick={() => changeDialect(entry.id)}
            title={`Fields: ${entry.fields}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div class="presets" role="group" aria-label="Common schedules">
        {CRON_PRESETS_BY_DIALECT[dialect].map((preset) => (
          <button
            key={preset.label}
            type="button"
            class="preset-chip"
            onClick={() => setInput(preset.expression)}
            title={`Use "${preset.expression}"`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div class="field">
        <label class="field__label" for="cron-input">
          <span>Cron expression</span>
          <span class="field__hint">
            {info.fields}
            {dialect === 'unix' ? ', or an @-shortcut' : ''}
          </span>
        </label>
        <input
          id="cron-input"
          class="input"
          spellcheck={false}
          autocomplete="off"
          placeholder={info.placeholder}
          value={input}
          aria-invalid={error !== null}
          onInput={(event) => setInput((event.target as HTMLInputElement).value)}
        />
      </div>

      <div class="tool-bar">
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input, dialect, zone })} describe="this cron expression" />
      </div>

      <ErrorMessage message={error} />

      {value && (
        <>
          <div class="field">
            <div class="field__label">
              <span>What this means</span>
              <CopyButton value={value.description} describe="the description" />
            </div>
            <p class="description">{value.description}</p>
            {value.note && <p class="field__hint">{value.note}</p>}
          </div>

          {value.schedule && (
            <div class="field">
              <div class="field__label">
                <span>Next {NEXT_RUN_COUNT} runs</span>
                <label class="checkbox" title="Run times are worked out on this time zone's clock, including daylight saving">
                  <span class="field__hint">Time zone</span>
                  <select
                    class="select"
                    aria-label="Time zone for next runs"
                    value={zone}
                    onChange={(event) => setZone((event.target as HTMLSelectElement).value)}
                  >
                    <option value={BROWSER_ZONE}>Your browser ({browserTimeZone()})</option>
                    <option value="UTC">UTC</option>
                    {COMMON_TIME_ZONES.filter((entry) => entry.zone !== 'UTC').map((entry) => (
                      <option key={entry.zone} value={entry.zone}>
                        {entry.label} ({entry.zone})
                      </option>
                    ))}
                    {zoneOptions.map((extra) => (
                      <option key={extra} value={extra}>
                        {extra}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {!zoneIsValid ? (
                <ErrorMessage message={`"${effectiveZone}" is not a recognised time zone — choose one from the list.`} />
              ) : nextRuns.length > 0 ? (
                <ol class="next-runs">
                  {nextRuns.map((date) => (
                    <li key={date.toISOString()}>{formatRun(date, effectiveZone, showSeconds)}</li>
                  ))}
                </ol>
              ) : (
                <p class="field__hint">
                  This expression doesn't match any date in the next several years — check for a day-of-month that
                  doesn't exist in the given month (e.g. day 30 in February), or a year that has already passed.
                </p>
              )}
              <p class="field__hint">
                Calculated on the clock of the selected time zone. A time that daylight saving skips doesn't run that
                day.
              </p>
            </div>
          )}
        </>
      )}

      <style>{`
        .presets { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .preset-chip {
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); padding: 0.35rem 0.75rem;
          font: inherit; font-size: var(--text-sm); font-weight: 550; color: var(--text);
          cursor: pointer;
        }
        .preset-chip:hover { background: var(--surface-2); border-color: var(--text-subtle); }
        .description {
          margin: 0; padding: var(--space-3) var(--space-4);
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); font-size: var(--text-base); line-height: 1.6;
        }
        .next-runs {
          margin: 0; padding: 0; list-style: none;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); font-size: var(--text-sm); font-family: var(--font-mono);
        }
        .next-runs li {
          padding: 0.5rem var(--space-4);
        }
        .next-runs li:not(:last-child) { border-bottom: 1px solid var(--border); }
      `}</style>
    </div>
  );
}
