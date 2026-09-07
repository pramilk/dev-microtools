import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  buildCronExpression,
  parseCronExpression,
  nextCronRuns,
  cronBuilderStateFromParsed,
  DEFAULT_CRON_BUILDER_STATE,
  CRON_PRESETS,
  type CronBuilderState,
  type CronFieldState,
  type CronFieldMode,
  type FieldName,
} from '../lib/tools/cron';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { ShareLinkButton } from './shared/ShareLinkButton';

interface ShareState {
  fields: CronBuilderState;
}

const NEXT_RUN_COUNT = 5;

/** Every field reset to a wildcard — the closest thing a builder has to an "empty" state. */
const CLEARED_STATE: CronBuilderState = {
  minute: { mode: 'every', step: 1, values: [] },
  hour: { mode: 'every', step: 1, values: [] },
  dayOfMonth: { mode: 'every', step: 1, values: [] },
  month: { mode: 'every', step: 1, values: [] },
  dayOfWeek: { mode: 'every', step: 1, values: [] },
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

interface FieldBuilderProps {
  fieldKey: FieldName;
  label: string;
  singular: string;
  min: number;
  max: number;
  state: CronFieldState;
  onChange: (next: CronFieldState) => void;
  formatValue?: (n: number) => string;
}

function FieldBuilder({ fieldKey, label, singular, min, max, state, onChange, formatValue }: FieldBuilderProps) {
  const fmt = formatValue ?? ((n: number) => String(n));
  const values = useMemo(() => Array.from({ length: max - min + 1 }, (_, i) => i + min), [min, max]);

  const setMode = (mode: CronFieldMode) => onChange({ ...state, mode });
  const setStep = (step: number) => onChange({ ...state, mode: 'step', step });
  const toggleValue = (n: number) => {
    const next = state.values.includes(n) ? state.values.filter((v) => v !== n) : [...state.values, n];
    onChange({ ...state, mode: 'specific', values: next });
  };

  return (
    <div class="field">
      <span class="field__label">{label}</span>
      <div class="seg" role="group" aria-label={`${label} mode`}>
        <button type="button" class="seg__btn" aria-pressed={state.mode === 'every'} onClick={() => setMode('every')}>
          Every {singular}
        </button>
        <button type="button" class="seg__btn" aria-pressed={state.mode === 'step'} onClick={() => setMode('step')}>
          Every N {singular}s
        </button>
        <button
          type="button"
          class="seg__btn"
          aria-pressed={state.mode === 'specific'}
          onClick={() => setMode('specific')}
        >
          Specific
        </button>
      </div>

      {state.mode === 'step' && (
        <div class="step-input">
          <span>Every</span>
          <input
            type="number"
            class="input step-input__number"
            min={1}
            max={max - min + 1}
            value={state.step}
            aria-label={`Step for ${label.toLowerCase()}`}
            onInput={(event) => {
              const raw = Number((event.target as HTMLInputElement).value);
              setStep(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1);
            }}
          />
          <span>{singular}(s)</span>
        </div>
      )}

      {state.mode === 'specific' && (
        <>
          <div class="value-grid" role="group" aria-label={`Specific ${label.toLowerCase()} values`}>
            {values.map((n) => (
              <button
                key={`${fieldKey}-${n}`}
                type="button"
                class="value-chip"
                aria-pressed={state.values.includes(n)}
                onClick={() => toggleValue(n)}
              >
                {fmt(n)}
              </button>
            ))}
          </div>
          {state.values.length === 0 && (
            <span class="field__hint">Select at least one value — otherwise this acts as every {singular}.</span>
          )}
        </>
      )}
    </div>
  );
}

export default function CronGenerator() {
  const [fields, setFields] = useState<CronBuilderState>(DEFAULT_CRON_BUILDER_STATE);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setFields(restored.value.fields);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const patchField = (key: FieldName, next: CronFieldState) => setFields((current) => ({ ...current, [key]: next }));

  const expression = useMemo(() => buildCronExpression(fields), [fields]);
  const result = useMemo(() => parseCronExpression(expression), [expression]);
  const value = result.ok ? result.value : null;
  const error = result.ok ? null : result.error;

  const nextRuns = useMemo(() => (value ? nextCronRuns(value, NEXT_RUN_COUNT, new Date()) : []), [value]);

  const isCleared = JSON.stringify(fields) === JSON.stringify(CLEARED_STATE);

  const applyPreset = (presetExpression: string) => {
    const parsed = parseCronExpression(presetExpression);
    if (parsed.ok) setFields(cronBuilderStateFromParsed(parsed.value));
  };

  return (
    <div class="tool">
      <div class="presets" role="group" aria-label="Common schedules">
        {CRON_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            class="preset-chip"
            onClick={() => applyPreset(preset.expression)}
            title={`Use "${preset.expression}"`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <FieldBuilder
        fieldKey="minute"
        label="Minute"
        singular="minute"
        min={0}
        max={59}
        state={fields.minute}
        onChange={(next) => patchField('minute', next)}
        formatValue={(n) => String(n).padStart(2, '0')}
      />
      <FieldBuilder
        fieldKey="hour"
        label="Hour"
        singular="hour"
        min={0}
        max={23}
        state={fields.hour}
        onChange={(next) => patchField('hour', next)}
        formatValue={(n) => String(n).padStart(2, '0')}
      />
      <FieldBuilder
        fieldKey="dayOfMonth"
        label="Day of month"
        singular="day"
        min={1}
        max={31}
        state={fields.dayOfMonth}
        onChange={(next) => patchField('dayOfMonth', next)}
      />
      <FieldBuilder
        fieldKey="month"
        label="Month"
        singular="month"
        min={1}
        max={12}
        state={fields.month}
        onChange={(next) => patchField('month', next)}
        formatValue={(n) => MONTH_LABELS[n - 1]!}
      />
      <FieldBuilder
        fieldKey="dayOfWeek"
        label="Day of week"
        singular="weekday"
        min={0}
        max={6}
        state={fields.dayOfWeek}
        onChange={(next) => patchField('dayOfWeek', next)}
        formatValue={(n) => DOW_LABELS[n]!}
      />

      <div class="tool-bar">
        <button type="button" class="btn" onClick={() => setFields(CLEARED_STATE)} disabled={isCleared} title="Reset every field to a wildcard">
          Clear
        </button>
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={(): ShareState => ({ fields })} describe="this schedule" />
      </div>

      <OutputPane label="Cron expression" value={expression} placeholder="" describe="the cron expression" />

      <ErrorMessage message={error} />

      {value && (
        <>
          <div class="field">
            <span class="field__label">What this means</span>
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
                This schedule doesn't match any date in the next few years — check for a day-of-month that doesn't
                exist in the given month (e.g. day 30 in February).
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
        .step-input { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-muted); }
        .step-input__number { width: 5rem; }
        .value-grid { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .value-chip {
          border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
          background: var(--surface); padding: 0.3rem 0.6rem; min-width: 2.5rem;
          font: inherit; font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 600;
          color: var(--text-muted); cursor: pointer;
        }
        .value-chip:hover { background: var(--surface-2); color: var(--text); }
        .value-chip[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
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
        .next-runs li { padding: 0.5rem var(--space-4); }
        .next-runs li:not(:last-child) { border-bottom: 1px solid var(--border); }
      `}</style>
    </div>
  );
}
