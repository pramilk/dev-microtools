import { useEffect, useMemo, useState } from 'preact/hooks';
import { parseCronExpression, nextCronRuns, CRON_PRESETS } from '../lib/tools/cron';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

interface ShareState {
  input: string;
}

const NEXT_RUN_COUNT = 5;

function formatRun(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CronExplainer() {
  const [input, setInput] = useState('*/15 * * * *');

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => (input.trim() === '' ? null : parseCronExpression(input)), [input]);
  const value = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;

  const nextRuns = useMemo(() => (value ? nextCronRuns(value, NEXT_RUN_COUNT, new Date()) : []), [value]);

  return (
    <div class="tool">
      <div class="presets" role="group" aria-label="Common schedules">
        {CRON_PRESETS.map((preset) => (
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
          <span class="field__hint">5-field (minute hour day-of-month month day-of-week), or an @-shortcut</span>
        </label>
        <input
          id="cron-input"
          class="input"
          spellcheck={false}
          autocomplete="off"
          placeholder="*/15 * * * *"
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
        <ShareLinkButton getState={() => ({ input })} describe="this cron expression" />
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
          </div>

          <div class="field">
            <span class="field__label">Next {NEXT_RUN_COUNT} runs</span>
            {nextRuns.length > 0 ? (
              <ol class="next-runs">
                {nextRuns.map((date) => (
                  <li key={date.toISOString()}>{formatRun(date)}</li>
                ))}
              </ol>
            ) : (
              <p class="field__hint">
                This expression doesn't match any date in the next few years — check for a day-of-month that
                doesn't exist in the given month (e.g. day 30 in February).
              </p>
            )}
            <p class="field__hint">Calculated in your browser's local timezone, not UTC or a server's timezone.</p>
          </div>
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
