import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  convertBetweenZones,
  planMeeting,
  isoWithOffset,
  type ZoneReading,
} from '../lib/tools/timezoneConverter';
import {
  allTimeZones,
  browserTimeZone,
  formatLocalDateTime,
  isValidTimeZone,
  parseLocalDateTime,
  wallTimeAt,
  type WallTime,
} from '../lib/tools/timeZone';
import { COMMON_TIME_ZONES } from '../lib/tools/timestamp';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

interface ShareState {
  dateTime: string;
  sourceZone: string;
  targets: string[];
  workStart: number;
  workEnd: number;
}

const DEFAULT_TARGETS = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo'];

/** Matches the Timezone Converter page's worked example, so the two never drift apart. */
const EXAMPLE: ShareState = {
  dateTime: '2026-03-14T09:00',
  sourceZone: 'America/New_York',
  targets: ['UTC', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'],
  workStart: 9,
  workEnd: 17,
};

const pad = (n: number) => String(n).padStart(2, '0');

const nowInZone = (zone: string): string => formatLocalDateTime(wallTimeAt(Date.now(), zone));

function formatWall(wall: WallTime): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)));
}

const dayShiftLabel = (shift: number): string =>
  shift === 0 ? '' : shift > 0 ? `+${shift} day${shift === 1 ? '' : 's'}` : `${shift} day${shift === -1 ? '' : 's'}`;

const clockLabel = (hour: number, minute: number): string => `${pad(hour)}:${pad(minute)}`;

function ZoneRow({
  reading,
  isSource,
  onRemove,
}: {
  reading: ZoneReading;
  isSource: boolean;
  onRemove?: () => void;
}) {
  const copyValue = isoWithOffset(reading.wall, reading.offsetMinutes);
  return (
    <li class="tz-row">
      <div class="tz-row__zone">
        <span class="tz-row__name">{reading.zone}</span>
        <span class="tz-row__meta">
          {reading.abbreviation} · {reading.offsetLabel}
          {isSource ? ' · source' : ''}
        </span>
      </div>
      <div class="tz-row__time">
        <span class="tz-row__value">{formatWall(reading.wall)}</span>
        {reading.dayShift !== 0 && <span class="tz-badge">{dayShiftLabel(reading.dayShift)}</span>}
      </div>
      <div class="tz-row__actions">
        <CopyButton value={copyValue} describe={`${reading.zone} time (ISO 8601)`} />
        {onRemove && (
          <button
            type="button"
            class="zone-remove"
            onClick={onRemove}
            title={`Remove ${reading.zone}`}
            aria-label={`Remove ${reading.zone}`}
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

export default function TimezoneConverter() {
  const [sourceZone, setSourceZone] = useState(() => browserTimeZone());
  const [dateTime, setDateTime] = useState(() => nowInZone(browserTimeZone()));
  const [targets, setTargets] = useState<string[]>(() =>
    DEFAULT_TARGETS.filter((zone) => zone !== browserTimeZone())
  );
  const [workStart, setWorkStart] = useState(9);
  const [workEnd, setWorkEnd] = useState(17);
  const [zoneDraft, setZoneDraft] = useState('');
  const [zoneError, setZoneError] = useState<string | null>(null);

  const zoneList = useMemo(() => allTimeZones(COMMON_TIME_ZONES.map((z) => z.zone)), []);

  // Restore state from a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setDateTime(restored.value.dateTime);
      setSourceZone(restored.value.sourceZone);
      setTargets(restored.value.targets);
      setWorkStart(restored.value.workStart);
      setWorkEnd(restored.value.workEnd);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const parsed = useMemo(() => parseLocalDateTime(dateTime), [dateTime]);

  const conversion = useMemo(
    () => (parsed.ok ? convertBetweenZones(parsed.value, sourceZone, targets) : null),
    [parsed, sourceZone, targets]
  );

  const plan = useMemo(
    () =>
      parsed.ok && isValidTimeZone(sourceZone)
        ? planMeeting(parsed.value, sourceZone, targets, { workStart, workEnd })
        : null,
    [parsed, sourceZone, targets, workStart, workEnd]
  );

  const error =
    dateTime.trim() === ''
      ? null
      : !parsed.ok
        ? parsed.error
        : conversion && !conversion.ok
          ? conversion.error
          : null;

  const addZone = (zone: string) => {
    const trimmed = zone.trim();
    if (trimmed === '') return;
    if (!isValidTimeZone(trimmed)) {
      setZoneError(`"${trimmed}" is not a recognised IANA time zone — pick one from the suggestions, e.g. "Europe/Paris".`);
      return;
    }
    setZoneError(null);
    if (trimmed !== sourceZone && !targets.includes(trimmed)) setTargets([...targets, trimmed]);
    setZoneDraft('');
  };

  const loadExample = () => {
    setDateTime(EXAMPLE.dateTime);
    setSourceZone(EXAMPLE.sourceZone);
    setTargets(EXAMPLE.targets);
    setWorkStart(EXAMPLE.workStart);
    setWorkEnd(EXAMPLE.workEnd);
    setZoneError(null);
  };

  const changeSourceZone = (value: string) => {
    setSourceZone(value);
    // A zone that is now the source no longer belongs in the list of targets.
    setTargets((current) => current.filter((zone) => zone !== value));
  };

  const result = conversion?.ok ? conversion.value : null;
  const suggestions = COMMON_TIME_ZONES.filter((z) => z.zone !== sourceZone && !targets.includes(z.zone));
  const planValue = plan?.ok ? plan.value : null;
  const planError = plan && !plan.ok ? plan.error : null;
  const anchorRow = planValue?.rows[0];

  return (
    <div class="tool">
      <div class="tool-bar">
        <ShareLinkButton
          getState={() => ({ dateTime, sourceZone, targets, workStart, workEnd })}
          describe="this conversion"
        />
        <button type="button" class="btn" onClick={loadExample} title="Fill in a sample meeting time across five zones">
          Load example
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => setDateTime(nowInZone(isValidTimeZone(sourceZone) ? sourceZone : 'UTC'))}
          title="Set the time to the current moment in the source zone"
        >
          Use now
        </button>
        <span class="tool-bar__spacer" />
        <button
          type="button"
          class="btn"
          onClick={() => setDateTime('')}
          disabled={dateTime === ''}
          title="Clear the date and time"
        >
          Clear
        </button>
      </div>

      <div class="tz-inputs">
        <div class="field">
          <label class="field__label" for="tz-datetime">
            <span>Date and time</span>
            <span class="field__hint">In the source zone</span>
          </label>
          <input
            id="tz-datetime"
            class="input"
            type="datetime-local"
            value={dateTime}
            aria-invalid={error !== null}
            onInput={(event) => setDateTime((event.target as HTMLInputElement).value)}
          />
        </div>

        <div class="field">
          <label class="field__label" for="tz-source">
            <span>Source time zone</span>
            <span class="field__hint">Type to search</span>
          </label>
          <input
            id="tz-source"
            class="input"
            list="tz-zone-list"
            spellcheck={false}
            autocomplete="off"
            value={sourceZone}
            aria-invalid={!isValidTimeZone(sourceZone)}
            title="The IANA time zone the date and time above are in, e.g. America/New_York"
            onInput={(event) => changeSourceZone((event.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      <datalist id="tz-zone-list">
        {zoneList.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      <ErrorMessage message={error ?? (isValidTimeZone(sourceZone) ? null : `"${sourceZone}" is not a recognised IANA time zone — pick one from the suggestions.`)} />

      {result?.notes.map((note) => (
        <p key={note} class="msg msg--info" role="status">
          <span class="msg__icon" aria-hidden="true">
            i
          </span>
          <span>{note}</span>
        </p>
      ))}

      {result && (
        <ul class="tz-list" aria-label="Converted times">
          <ZoneRow reading={result.source} isSource />
          {result.targets.map((reading) => (
            <ZoneRow
              key={reading.zone}
              reading={reading}
              isSource={false}
              onRemove={() => setTargets((current) => current.filter((zone) => zone !== reading.zone))}
            />
          ))}
        </ul>
      )}

      <div class="field">
        <label class="field__label" for="tz-add">
          <span>Add a time zone</span>
          <span class="field__hint">Type an IANA name or pick a city</span>
        </label>
        <div class="tz-add">
          <input
            id="tz-add"
            class="input"
            list="tz-zone-list"
            spellcheck={false}
            autocomplete="off"
            placeholder="Europe/Paris"
            value={zoneDraft}
            aria-invalid={zoneError !== null}
            onInput={(event) => setZoneDraft((event.target as HTMLInputElement).value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addZone(zoneDraft);
            }}
          />
          <button type="button" class="btn" onClick={() => addZone(zoneDraft)} disabled={zoneDraft.trim() === ''}>
            Add
          </button>
        </div>
        <ErrorMessage message={zoneError} />
        {suggestions.length > 0 && (
          <div class="tz-chips" role="group" aria-label="Quick-add cities">
            {suggestions.map(({ label, zone }) => (
              <button key={zone} type="button" class="preset-chip" onClick={() => addZone(zone)} title={`Add ${zone}`}>
                + {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {plan && (
        <section class="tz-planner" aria-labelledby="tz-planner-title">
          <div class="tz-planner__head">
            <h3 id="tz-planner-title" class="tz-planner__title">
              Meeting planner
            </h3>
            <div class="tz-hours">
              <label class="checkbox" title="First hour of the working day, in each person's own time zone">
                <span class="field__hint">Work starts</span>
                <select
                  class="select"
                  aria-label="Working day starts at"
                  value={workStart}
                  onChange={(event) => setWorkStart(Number((event.target as HTMLSelectElement).value))}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {pad(hour)}:00
                    </option>
                  ))}
                </select>
              </label>
              <label class="checkbox" title="Hour the working day ends, in each person's own time zone">
                <span class="field__hint">ends</span>
                <select
                  class="select"
                  aria-label="Working day ends at"
                  value={workEnd}
                  onChange={(event) => setWorkEnd(Number((event.target as HTMLSelectElement).value))}
                >
                  {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
                    <option key={hour} value={hour}>
                      {pad(hour % 24)}:00
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <ErrorMessage message={planError} />

          {planValue && anchorRow && (
            <>
          <p class="tz-planner__summary" role="status">
            {planValue.commonWindows.length === 0
              ? 'No hour on this day falls inside everyone’s working hours.'
              : `Everyone is within working hours: ${planValue.commonWindows
                  .map(({ from, to }) => {
                    const first = anchorRow.cells[from]!;
                    const last = anchorRow.cells[to - 1]!;
                    return `${clockLabel(first.hour, first.minute)}–${clockLabel((last.hour + 1) % 24, last.minute)}`;
                  })
                  .join(', ')} ${sourceZone} time.`}
          </p>

          <div class="tz-grid-wrap" tabIndex={0} role="region" aria-label="Hour-by-hour overlap grid, scrolls horizontally">
            <table class="tz-grid">
              <caption class="sr-only">Local hour in each time zone across 24 hours of the source day</caption>
              <tbody>
                {planValue.rows.map((row) => (
                  <tr key={row.zone}>
                    <th scope="row">{row.zone}</th>
                    {row.cells.map((cell, index) => {
                      const common = planValue.commonWindows.some((w) => index >= w.from && index < w.to);
                      return (
                        <td
                          key={index}
                          class={`tz-cell${cell.working ? ' tz-cell--work' : ''}${common ? ' tz-cell--common' : ''}`}
                          title={`${row.zone}: ${clockLabel(cell.hour, cell.minute)}${cell.dayShift ? ` (${dayShiftLabel(cell.dayShift)})` : ''}${cell.working ? ', working hours' : ''}`}
                        >
                          {cell.minute === 0 ? pad(cell.hour) : clockLabel(cell.hour, cell.minute)}
                          {cell.dayShift !== 0 && <sup>{cell.dayShift > 0 ? '+' : '−'}</sup>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="field__hint">
            Columns are the 24 hours after midnight on the chosen date in {sourceZone}. Shaded hours are working
            hours; the bordered columns are working hours for everyone. “+” or “−” marks the next or previous
            calendar day.
          </p>
            </>
          )}
        </section>
      )}

      <style>{`
        .tz-inputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--space-4); }
        .tz-list {
          list-style: none; margin: 0; padding: 0;
          border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);
        }
        .tz-row {
          display: grid; grid-template-columns: minmax(9rem, 1fr) 2fr auto; gap: var(--space-3);
          align-items: center; padding: var(--space-3) var(--space-4);
        }
        .tz-row:not(:last-child) { border-bottom: 1px solid var(--border); }
        .tz-row__zone { display: flex; flex-direction: column; min-width: 0; }
        .tz-row__name { font-weight: 600; overflow-wrap: anywhere; }
        .tz-row__meta { font-size: var(--text-xs); color: var(--text-muted); }
        .tz-row__time { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
        .tz-row__value { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--text-sm); }
        .tz-row__actions { display: flex; align-items: center; gap: var(--space-2); }
        .tz-badge {
          font-size: var(--text-xs); font-weight: 600; padding: 0.1rem 0.45rem; border-radius: var(--radius);
          background: var(--accent-subtle); border: 1px solid var(--accent-border); color: var(--text);
        }
        .zone-remove {
          background: none; border: none; cursor: pointer; color: var(--text-subtle);
          font-size: var(--text-xs); padding: var(--space-1);
        }
        .zone-remove:hover { color: var(--danger); }
        .tz-add { display: flex; gap: var(--space-2); }
        .tz-add .input { flex: 1; min-width: 0; }
        .tz-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
        .preset-chip {
          border: 1px solid var(--border-strong); border-radius: var(--radius);
          background: var(--surface); padding: 0.3rem 0.65rem;
          font: inherit; font-size: var(--text-sm); font-weight: 550; color: var(--text); cursor: pointer;
        }
        .preset-chip:hover { background: var(--surface-2); border-color: var(--text-subtle); }
        .tz-planner { display: flex; flex-direction: column; gap: var(--space-3); }
        .tz-planner__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
        .tz-planner__title { margin: 0; font-size: var(--text-lg); }
        .tz-hours { display: flex; flex-wrap: wrap; gap: var(--space-3); }
        .tz-planner__summary { margin: 0; font-weight: 550; }
        .tz-grid-wrap {
          overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);
        }
        .tz-grid { border-collapse: collapse; font-family: var(--font-mono); font-size: var(--text-xs); min-width: 46rem; width: 100%; }
        .tz-grid th {
          position: sticky; left: 0; background: var(--surface); text-align: left; font-family: inherit;
          padding: var(--space-2) var(--space-3); white-space: nowrap; border-right: 1px solid var(--border); z-index: 1;
        }
        .tz-cell { text-align: center; padding: var(--space-2) 0; min-width: 1.6rem; color: var(--text-muted); border-left: 1px solid var(--border); }
        .tz-cell sup { font-size: 0.7em; color: var(--accent); margin-left: 1px; }
        .tz-cell--work { background: var(--accent-subtle); color: var(--text); }
        .tz-cell--common { box-shadow: inset 0 0 0 2px var(--accent); font-weight: 700; }
        @media (max-width: 40rem) {
          .tz-row { grid-template-columns: 1fr auto; }
          .tz-row__time { grid-column: 1 / -1; order: 3; }
        }
      `}</style>
    </div>
  );
}
