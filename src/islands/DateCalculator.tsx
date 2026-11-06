import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  addBusinessDays,
  addDays,
  addToDate,
  dateDifference,
  describeBreakdown,
  describeDate,
  formatIsoDate,
  parseIsoDate,
  todayLocal,
  type CalendarDate,
  type DateFacts,
} from '../lib/tools/dateMath';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { ResultRows, type ResultRow } from './shared/ResultRows';
import { ShareLinkButton } from './shared/ShareLinkButton';

type Mode = 'difference' | 'add';
type Direction = 'add' | 'subtract';

interface ShareState {
  mode: Mode;
  start: string;
  end: string;
  includeEnd: boolean;
  direction: Direction;
  years: string;
  months: string;
  weeks: string;
  days: string;
  businessDays: string;
}

/** Matches the Date Calculator page's worked example, so the two never drift apart. */
const EXAMPLE_DIFFERENCE = { start: '2000-01-15', end: '2026-03-14' };
const EXAMPLE_ADD = { start: '2026-01-31', years: '', months: '1', weeks: '', days: '' };

const amount = (text: string): number => (text.trim() === '' ? 0 : Number(text));

const factRows = (label: string, facts: DateFacts): ResultRow[] => [
  { label: `${label} weekday`, value: facts.weekday },
  {
    label: `${label} week of year`,
    value: `Week ${facts.isoWeek.week} of ${facts.isoWeek.year}`,
    hint: `Day ${facts.dayOfYear} of the year · Q${facts.quarter}${facts.isLeapYear ? ' · leap year' : ''}`,
  },
];

function NumberField({
  id,
  label,
  value,
  onInput,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  hint?: string;
}) {
  return (
    <div class="field dc-amount">
      <label class="field__label" for={id}>
        <span>{label}</span>
      </label>
      <input
        id={id}
        class="input"
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        placeholder="0"
        value={value}
        title={hint}
        onInput={(event) => onInput((event.target as HTMLInputElement).value)}
      />
    </div>
  );
}

export default function DateCalculator() {
  const today = useMemo(() => todayLocal(), []);
  const [mode, setMode] = useState<Mode>('difference');
  const [start, setStart] = useState(() => formatIsoDate(today));
  const [end, setEnd] = useState(() => {
    const later = addDays(today, 30);
    return later.ok ? formatIsoDate(later.value) : formatIsoDate(today);
  });
  const [includeEnd, setIncludeEnd] = useState(false);
  const [direction, setDirection] = useState<Direction>('add');
  const [years, setYears] = useState('');
  const [months, setMonths] = useState('');
  const [weeks, setWeeks] = useState('');
  const [days, setDays] = useState('30');
  const [businessDays, setBusinessDays] = useState('');

  // Restore state from a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const s = restored.value;
      setMode(s.mode);
      setStart(s.start);
      setEnd(s.end);
      setIncludeEnd(s.includeEnd);
      setDirection(s.direction);
      setYears(s.years);
      setMonths(s.months);
      setWeeks(s.weeks);
      setDays(s.days);
      setBusinessDays(s.businessDays);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const startParsed = useMemo(() => parseIsoDate(start), [start]);
  const endParsed = useMemo(() => parseIsoDate(end), [end]);

  const differenceResult = useMemo(() => {
    if (mode !== 'difference' || !startParsed.ok || !endParsed.ok) return null;
    return dateDifference(startParsed.value, endParsed.value, { includeEndDate: includeEnd });
  }, [mode, startParsed, endParsed, includeEnd]);

  const addResult = useMemo(() => {
    if (mode !== 'add' || !startParsed.ok) return null;
    const sign = direction === 'add' ? 1 : -1;
    const calendar = addToDate(
      startParsed.value,
      { years: amount(years), months: amount(months), weeks: amount(weeks), days: amount(days) },
      sign
    );
    if (!calendar.ok) return calendar;
    const business = amount(businessDays);
    return business === 0 ? calendar : addBusinessDays(calendar.value, business * sign);
  }, [mode, startParsed, direction, years, months, weeks, days, businessDays]);

  // Which inputs are relevant decides which parse error is worth showing: an empty
  // field is "not yet filled in", not a mistake, so it shows nothing.
  const inputError =
    start.trim() !== '' && !startParsed.ok
      ? startParsed.error
      : mode === 'difference' && end.trim() !== '' && !endParsed.ok
        ? endParsed.error
        : null;
  const calcError = addResult && !addResult.ok ? addResult.error : null;

  const loadExample = () => {
    if (mode === 'difference') {
      setStart(EXAMPLE_DIFFERENCE.start);
      setEnd(EXAMPLE_DIFFERENCE.end);
      setIncludeEnd(false);
    } else {
      setStart(EXAMPLE_ADD.start);
      setDirection('add');
      setYears(EXAMPLE_ADD.years);
      setMonths(EXAMPLE_ADD.months);
      setWeeks(EXAMPLE_ADD.weeks);
      setDays(EXAMPLE_ADD.days);
      setBusinessDays('');
    }
  };

  const clearAll = () => {
    setStart('');
    setEnd('');
    setYears('');
    setMonths('');
    setWeeks('');
    setDays('');
    setBusinessDays('');
  };

  const todayText = formatIsoDate(today);
  const nothingToClear =
    start === '' && end === '' && years === '' && months === '' && weeks === '' && days === '' && businessDays === '';

  const differenceRows = (diff: NonNullable<typeof differenceResult>, a: CalendarDate, b: CalendarDate): ResultRow[] => [
    {
      label: 'Difference',
      value: describeBreakdown(diff),
      hint:
        diff.direction === 'backward'
          ? 'The end date is before the start date'
          : diff.direction === 'same'
            ? 'Both dates are the same day'
            : undefined,
    },
    { label: 'Total days', value: diff.totalDays.toLocaleString('en-US'), copyValue: String(diff.totalDays) },
    {
      label: 'Weeks and days',
      value: `${diff.weeks.toLocaleString('en-US')} week${diff.weeks === 1 ? '' : 's'}, ${diff.remainderDays} day${diff.remainderDays === 1 ? '' : 's'}`,
    },
    { label: 'Total months', value: String(diff.totalMonths), hint: 'Whole calendar months' },
    {
      label: 'Business days',
      value: diff.businessDays.toLocaleString('en-US'),
      copyValue: String(diff.businessDays),
      hint: 'Monday–Friday; public holidays are not subtracted',
    },
    { label: 'Weekend days', value: diff.weekendDays.toLocaleString('en-US'), copyValue: String(diff.weekendDays) },
    ...factRows('Start', describeDate(a)),
    ...factRows('End', describeDate(b)),
  ];

  const addRows = (result: CalendarDate): ResultRow[] => {
    const facts = describeDate(result);
    return [
      { label: 'Resulting date', value: formatIsoDate(result), hint: `${facts.weekday}` },
      ...factRows('Result', facts).slice(1),
    ];
  };

  return (
    <div class="tool">
      <div class="tool-bar">
        <div class="seg" role="group" aria-label="Calculation type">
          <button
            type="button"
            class="seg__btn"
            aria-pressed={mode === 'difference'}
            onClick={() => setMode('difference')}
            title="Find how long it is between two dates"
          >
            Days between dates
          </button>
          <button
            type="button"
            class="seg__btn"
            aria-pressed={mode === 'add'}
            onClick={() => setMode('add')}
            title="Add time to a date, or subtract it"
          >
            Add / subtract
          </button>
        </div>
        <span class="tool-bar__spacer" />
        <ShareLinkButton
          getState={() => ({ mode, start, end, includeEnd, direction, years, months, weeks, days, businessDays })}
          describe="this calculation"
        />
        <button type="button" class="btn" onClick={loadExample} title="Fill in a sample calculation">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={nothingToClear} title="Clear every field">
          Clear
        </button>
      </div>

      <div class="dc-dates">
        <div class="field">
          <div class="field__label">
            <label for="dc-start">Start date</label>
            <button type="button" class="dc-today" onClick={() => setStart(todayText)} title="Use today's date">
              Today
            </button>
          </div>
          <input
            id="dc-start"
            class="input"
            type="date"
            value={start}
            aria-invalid={start.trim() !== '' && !startParsed.ok}
            onInput={(event) => setStart((event.target as HTMLInputElement).value)}
          />
        </div>

        {mode === 'difference' && (
          <div class="field">
            <div class="field__label">
              <label for="dc-end">End date</label>
              <button type="button" class="dc-today" onClick={() => setEnd(todayText)} title="Use today's date">
                Today
              </button>
            </div>
            <input
              id="dc-end"
              class="input"
              type="date"
              value={end}
              aria-invalid={end.trim() !== '' && !endParsed.ok}
              onInput={(event) => setEnd((event.target as HTMLInputElement).value)}
            />
          </div>
        )}
      </div>

      {mode === 'difference' && (
        <label class="checkbox" title="Count both the first and the last day, so 1 March to 5 March is 5 days, not 4">
          <input
            type="checkbox"
            checked={includeEnd}
            onChange={(event) => setIncludeEnd((event.target as HTMLInputElement).checked)}
          />
          <span>Include the end date in the count</span>
        </label>
      )}

      {mode === 'add' && (
        <>
          <div class="seg" role="group" aria-label="Add or subtract">
            <button type="button" class="seg__btn" aria-pressed={direction === 'add'} onClick={() => setDirection('add')}>
              Add
            </button>
            <button
              type="button"
              class="seg__btn"
              aria-pressed={direction === 'subtract'}
              onClick={() => setDirection('subtract')}
            >
              Subtract
            </button>
          </div>
          <div class="dc-amounts">
            <NumberField id="dc-years" label="Years" value={years} onInput={setYears} />
            <NumberField id="dc-months" label="Months" value={months} onInput={setMonths} />
            <NumberField id="dc-weeks" label="Weeks" value={weeks} onInput={setWeeks} />
            <NumberField id="dc-days" label="Days" value={days} onInput={setDays} />
            <NumberField
              id="dc-business"
              label="Business days"
              value={businessDays}
              onInput={setBusinessDays}
              hint="Counts Monday to Friday only, skipping weekends. Applied after the calendar amounts above."
            />
          </div>
          <p class="field__hint">
            Months are added first, and a day that does not exist in the target month moves to its last day (31 January
            plus one month is 28 February). Business days skip weekends but not public holidays.
          </p>
        </>
      )}

      <ErrorMessage message={inputError ?? calcError} />

      {differenceResult && startParsed.ok && endParsed.ok && (
        <ResultRows
          label="Date difference"
          rows={differenceRows(differenceResult, startParsed.value, endParsed.value)}
        />
      )}
      {addResult?.ok && <ResultRows label="Resulting date" rows={addRows(addResult.value)} />}

      <style>{`
        .dc-dates { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--space-4); }
        .dc-amounts { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: var(--space-3); }
        .dc-today {
          background: none; border: none; padding: 0; cursor: pointer; font: inherit;
          font-size: var(--text-xs); font-weight: 600; color: var(--accent); text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
