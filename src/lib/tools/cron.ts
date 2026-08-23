import { type ToolResult, ok, err } from './result';

/**
 * Standard 5-field POSIX cron: minute hour day-of-month month day-of-week.
 * 6-field expressions with a leading seconds column (Quartz/Spring-style) are
 * deliberately not supported — they are a different, less common dialect, and
 * silently accepting one while parsing it as 5-field would produce a wrong result.
 */
const FIELD_MIN = { minute: 0, hour: 0, dayOfMonth: 1, month: 1, dayOfWeek: 0 } as const;
const FIELD_MAX = { minute: 59, hour: 23, dayOfMonth: 31, month: 12, dayOfWeek: 7 } as const;
type FieldName = keyof typeof FIELD_MIN;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH_NAME_MAP: Record<string, number> = Object.fromEntries(
  MONTH_NAMES.map((name, index) => [name.slice(0, 3).toUpperCase(), index + 1])
);
const DOW_NAME_MAP: Record<string, number> = Object.fromEntries(
  DOW_NAMES.map((name, index) => [name.slice(0, 3).toUpperCase(), index])
);

/** Every value cron's `@`-shortcuts expand to, as standard 5-field expressions. */
export const CRON_MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export interface CronPreset {
  label: string;
  expression: string;
}

export const CRON_PRESETS: CronPreset[] = [
  { label: 'Every minute', expression: '* * * * *' },
  { label: 'Every 15 minutes', expression: '*/15 * * * *' },
  { label: 'Every hour', expression: '0 * * * *' },
  { label: 'Every day at midnight', expression: '0 0 * * *' },
  { label: 'Every weekday at 9am', expression: '0 9 * * 1-5' },
  { label: 'Every Sunday at midnight', expression: '0 0 * * 0' },
  { label: 'First day of every month', expression: '0 0 1 * *' },
  { label: 'Every 6 hours', expression: '0 */6 * * *' },
];

interface RangePart {
  start: number;
  end: number;
  step: number;
  isWildcard: boolean;
}

interface ParsedField {
  values: Set<number>;
  parts: RangePart[];
  isWildcard: boolean;
}

export interface ParsedCron {
  minute: ParsedField;
  hour: ParsedField;
  dayOfMonth: ParsedField;
  month: ParsedField;
  dayOfWeek: ParsedField;
  description: string;
}

function resolveToken(token: string, names: Record<string, number> | null): number {
  const upper = token.toUpperCase();
  if (names && upper in names) return names[upper]!;
  return Number(token);
}

function parseRangePart(
  token: string,
  fieldName: FieldName,
  names: Record<string, number> | null
): ToolResult<RangePart> {
  const min = FIELD_MIN[fieldName];
  const max = FIELD_MAX[fieldName];
  const [rangeStr, stepStr, ...extra] = token.split('/');

  if (extra.length > 0) return err(`"${token}" in the ${fieldName} field has more than one "/" — expected at most one step.`);

  let step = 1;
  if (stepStr !== undefined) {
    step = Number(stepStr);
    if (!Number.isInteger(step) || step <= 0) {
      return err(`"${stepStr}" is not a valid step in "${token}" (${fieldName} field) — steps must be a positive whole number.`);
    }
  }

  let start: number;
  let end: number;
  let isWildcard = false;

  if (rangeStr === '*') {
    start = min;
    end = max;
    isWildcard = true;
  } else if (rangeStr!.includes('-')) {
    const [aRaw, bRaw, ...rest] = rangeStr!.split('-');
    if (rest.length > 0) return err(`"${token}" in the ${fieldName} field is not a valid range.`);
    start = resolveToken(aRaw!, names);
    end = resolveToken(bRaw!, names);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return err(`"${token}" in the ${fieldName} field contains a value that isn't a number.`);
    }
    if (start > end) {
      return err(
        `"${token}" in the ${fieldName} field runs backwards (${start} to ${end}). Wrap-around ranges spanning midnight or year-end aren't supported — list the values instead, e.g. "22,23,0,1,2".`
      );
    }
  } else {
    start = resolveToken(rangeStr!, names);
    if (Number.isNaN(start)) return err(`"${rangeStr}" in the ${fieldName} field isn't a number.`);
    // "5/15" means "starting at 5, every 15" through the field's max — not just the value 5.
    end = stepStr !== undefined ? max : start;
  }

  if (start < min || end > max) {
    return err(`"${token}" in the ${fieldName} field is out of range — valid values are ${min}-${max}.`);
  }

  return ok({ start, end, step, isWildcard });
}

function parseField(
  raw: string,
  fieldName: FieldName,
  names: Record<string, number> | null,
  normalize?: (n: number) => number
): ToolResult<ParsedField> {
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  if (tokens.length === 0) return err(`The ${fieldName} field is empty.`);

  const parts: RangePart[] = [];
  const values = new Set<number>();

  for (const token of tokens) {
    const result = parseRangePart(token, fieldName, names);
    if (!result.ok) return result;
    parts.push(result.value);
    for (let v = result.value.start; v <= result.value.end; v += result.value.step) {
      values.add(normalize ? normalize(v) : v);
    }
  }

  const isWildcard = parts.length === 1 && parts[0]!.isWildcard && parts[0]!.step === 1;
  return ok({ values, parts, isWildcard });
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function describeParts(
  parts: RangePart[],
  format: (n: number) => string,
  everyLabel: string,
  pluralLabel: string,
  single: (v: string) => string,
  range: (a: string, b: string) => string,
  steppedRange: (step: number, a: string, b: string) => string,
  listFormat: (values: string) => string
): string {
  // A list of plain single values ("1,15" or "0,30") reads far better with the
  // field name stated once — "day-of-month 1st and 15th" — than repeated per
  // item, which the generic per-part path below would otherwise produce.
  if (parts.length > 1 && parts.every((p) => !p.isWildcard && p.start === p.end)) {
    return listFormat(joinWithAnd(parts.map((p) => format(p.start))));
  }

  const phrases = parts.map((part) => {
    if (part.isWildcard && part.step === 1) return `every ${everyLabel}`;
    if (part.isWildcard) return `every ${part.step} ${pluralLabel}`;
    if (part.start === part.end) return single(format(part.start));
    if (part.step > 1) return steppedRange(part.step, format(part.start), format(part.end));
    return range(format(part.start), format(part.end));
  });
  return joinWithAnd(phrases);
}

const describeMinute = (parts: RangePart[]) =>
  describeParts(
    parts,
    String,
    'minute',
    'minutes',
    (v) => `minute ${v}`,
    (a, b) => `minutes ${a} through ${b}`,
    (s, a, b) => `every ${s} minutes from ${a} through ${b}`,
    (vals) => `minutes ${vals}`
  );

const describeHour = (parts: RangePart[]) =>
  describeParts(
    parts,
    String,
    'hour',
    'hours',
    (v) => `hour ${v}`,
    (a, b) => `hours ${a} through ${b}`,
    (s, a, b) => `every ${s} hours from ${a} through ${b}`,
    (vals) => `hours ${vals}`
  );

const ordinal = (n: number): string => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
};

const describeDayOfMonth = (parts: RangePart[]) =>
  describeParts(
    parts,
    ordinal,
    'day of the month',
    'days of the month',
    (v) => `day-of-month ${v}`,
    (a, b) => `days-of-month ${a} through ${b}`,
    (s, a, b) => `every ${s} days-of-month from ${a} through ${b}`,
    (vals) => `day-of-month ${vals}`
  );

const describeMonth = (parts: RangePart[]) =>
  describeParts(
    parts,
    (n) => MONTH_NAMES[n - 1]!,
    'month',
    'months',
    (v) => `in ${v}`,
    (a, b) => `from ${a} through ${b}`,
    (s, a, b) => `every ${s} months from ${a} through ${b}`,
    (vals) => `in ${vals}`
  );

const describeDayOfWeek = (parts: RangePart[]) =>
  describeParts(
    parts,
    (n) => DOW_NAMES[n % 7]!,
    'day of the week',
    'days of the week',
    (v) => `on ${v}`,
    (a, b) => `${a} through ${b}`,
    (s, a, b) => `every ${s} days from ${a} through ${b}`,
    (vals) => `on ${vals}`
  );

const capitalize = (s: string): string => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1));

function describeCron(fields: {
  minute: ParsedField;
  hour: ParsedField;
  dayOfMonth: ParsedField;
  month: ParsedField;
  dayOfWeek: ParsedField;
}): string {
  const isSingle = (field: ParsedField) =>
    field.parts.length === 1 && !field.parts[0]!.isWildcard && field.parts[0]!.start === field.parts[0]!.end;
  // A wildcard or a step (e.g. "*/15") already reads as a complete, self-explanatory
  // phrase ("every 15 minutes") — only a plain single value or range needs "every
  // hour" appended to make clear it's not a one-off.
  const minutePeriodic = fields.minute.parts.some((p) => p.isWildcard || p.step > 1);

  let timePhrase: string;
  if (isSingle(fields.minute) && isSingle(fields.hour)) {
    const hh = String(fields.hour.parts[0]!.start).padStart(2, '0');
    const mm = String(fields.minute.parts[0]!.start).padStart(2, '0');
    timePhrase = `At ${hh}:${mm}`;
  } else if (fields.hour.isWildcard) {
    timePhrase = minutePeriodic
      ? capitalize(describeMinute(fields.minute.parts))
      : `At ${describeMinute(fields.minute.parts)}, every hour`;
  } else if (fields.minute.isWildcard) {
    timePhrase = `Every minute, ${describeHour(fields.hour.parts)}`;
  } else {
    timePhrase = `${capitalize(describeMinute(fields.minute.parts))}, ${describeHour(fields.hour.parts)}`;
  }

  const clauses = [timePhrase];

  if (!fields.dayOfMonth.isWildcard || !fields.dayOfWeek.isWildcard) {
    if (fields.dayOfMonth.isWildcard) {
      clauses.push(describeDayOfWeek(fields.dayOfWeek.parts));
    } else if (fields.dayOfWeek.isWildcard) {
      clauses.push(describeDayOfMonth(fields.dayOfMonth.parts));
    } else {
      // POSIX cron treats day-of-month and day-of-week as OR'd when both are
      // restricted — a very common source of confusion, so it's spelled out
      // explicitly rather than left to read as an (incorrect) AND.
      clauses.push(`${describeDayOfMonth(fields.dayOfMonth.parts)}, or ${describeDayOfWeek(fields.dayOfWeek.parts)}`);
    }
  }

  if (!fields.month.isWildcard) clauses.push(describeMonth(fields.month.parts));

  return `${clauses.join(', ')}.`;
}

/** Parses a 5-field cron expression (or a supported `@`-shortcut) into its matcher and a plain-English description. */
export function parseCronExpression(input: string): ToolResult<ParsedCron> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter a cron expression.');

  let expanded = trimmed;
  if (trimmed.startsWith('@')) {
    const macro = CRON_MACROS[trimmed.toLowerCase()];
    if (!macro) {
      if (trimmed.toLowerCase() === '@reboot') {
        return err('"@reboot" runs once at startup, not on a recurring schedule, so there is no description or next run time to compute.');
      }
      return err(`Unknown shortcut "${trimmed}". Supported: ${Object.keys(CRON_MACROS).join(', ')}.`);
    }
    expanded = macro;
  }

  const tokens = expanded.split(/\s+/).filter(Boolean);
  if (tokens.length !== 5) {
    return err(
      `A cron expression needs exactly 5 fields (minute hour day-of-month month day-of-week) — got ${tokens.length}. 6-field expressions with a seconds column aren't supported.`
    );
  }
  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = tokens as [string, string, string, string, string];

  const minute = parseField(minuteRaw, 'minute', null);
  if (!minute.ok) return minute;
  const hour = parseField(hourRaw, 'hour', null);
  if (!hour.ok) return hour;
  const dayOfMonth = parseField(domRaw, 'dayOfMonth', null);
  if (!dayOfMonth.ok) return dayOfMonth;
  const month = parseField(monthRaw, 'month', MONTH_NAME_MAP);
  if (!month.ok) return month;
  // 0 and 7 both mean Sunday — normalise on insertion so the *matching* set is
  // correct, while leaving `parts` (start/end as written) alone for description text.
  const dayOfWeek = parseField(dowRaw, 'dayOfWeek', DOW_NAME_MAP, (n) => (n === 7 ? 0 : n));
  if (!dayOfWeek.ok) return dayOfWeek;

  const fields = {
    minute: minute.value,
    hour: hour.value,
    dayOfMonth: dayOfMonth.value,
    month: month.value,
    dayOfWeek: dayOfWeek.value,
  };

  return ok({ ...fields, description: describeCron(fields) });
}

function matchesDay(parsed: ParsedCron, date: Date): boolean {
  const domRestricted = !parsed.dayOfMonth.isWildcard;
  const dowRestricted = !parsed.dayOfWeek.isWildcard;
  const domOk = parsed.dayOfMonth.values.has(date.getDate());
  const dowOk = parsed.dayOfWeek.values.has(date.getDay());

  if (domRestricted && dowRestricted) return domOk || dowOk;
  if (domRestricted) return domOk;
  if (dowRestricted) return dowOk;
  return true;
}

const startOfNextMinute = (date: Date): Date => {
  const d = new Date(date.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  return d;
};

/**
 * Computes the next `count` times a cron expression fires, from `from` onward.
 *
 * Jumps forward by whichever field fails to match (month, then day, then hour,
 * then minute) instead of stepping minute-by-minute, so even a schedule that
 * matches rarely (once a year) or never (e.g. day-of-month 30 in February)
 * resolves in at most a few hundred cheap iterations rather than millions —
 * this runs on every keystroke, so it has to stay fast regardless of input.
 */
export function nextCronRuns(parsed: ParsedCron, count: number, from: Date = new Date(), maxYearsAhead = 4): Date[] {
  const results: Date[] = [];
  let candidate = startOfNextMinute(from);
  const limit = new Date(from.getTime());
  limit.setFullYear(limit.getFullYear() + maxYearsAhead);

  let safety = 0;
  const safetyCap = 200_000;

  while (results.length < count && candidate <= limit && safety < safetyCap) {
    safety += 1;

    if (!parsed.month.values.has(candidate.getMonth() + 1)) {
      candidate = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 1, 0, 0, 0, 0);
      continue;
    }
    if (!matchesDay(parsed, candidate)) {
      candidate = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate() + 1, 0, 0, 0, 0);
      continue;
    }
    if (!parsed.hour.values.has(candidate.getHours())) {
      candidate = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate(), candidate.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!parsed.minute.values.has(candidate.getMinutes())) {
      candidate = new Date(candidate.getTime() + 60_000);
      continue;
    }

    results.push(new Date(candidate.getTime()));
    candidate = new Date(candidate.getTime() + 60_000);
  }

  return results;
}
