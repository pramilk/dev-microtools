import { type ToolResult, ok, err } from './result';
import { type CronSchedule, scheduleFromUnix } from './cronSchedule';
import { CRON_PRESETS, DOW_NAMES, MONTH_NAMES, joinWithAnd, ordinal, parseCronExpression, type CronPreset } from './cron';
import { dayOfWeek, daysInMonth } from './dateMath';

/**
 * The three cron syntaxes developers actually meet:
 *  - `unix`:   5 fields, as in crontab — handled by `cron.ts`.
 *  - `quartz`: 6-7 fields with seconds and an optional year, `?`, `L`, `W` and `#` (Spring, Quartz, Jenkins).
 *  - `aws`:    6 fields, no seconds, year required, same specials (EventBridge rules, CloudWatch).
 * This module parses the last two into the dialect-neutral `CronSchedule` and describes them in words.
 */
export type CronDialect = 'unix' | 'quartz' | 'aws';

export interface CronDialectInfo {
  id: CronDialect;
  label: string;
  /** Field order, shown as the input's hint. */
  fields: string;
  placeholder: string;
}

export const CRON_DIALECTS: readonly CronDialectInfo[] = [
  { id: 'unix', label: 'Unix / crontab', fields: 'minute hour day-of-month month day-of-week', placeholder: '*/15 * * * *' },
  {
    id: 'quartz',
    label: 'Quartz / Spring',
    fields: 'second minute hour day-of-month month day-of-week [year]',
    placeholder: '0 */15 * * * ?',
  },
  {
    id: 'aws',
    label: 'AWS EventBridge',
    fields: 'minute hour day-of-month month day-of-week year',
    placeholder: '0/15 * * * ? *',
  },
];

export const CRON_PRESETS_BY_DIALECT: Record<CronDialect, CronPreset[]> = {
  unix: CRON_PRESETS,
  quartz: [
    { label: 'Every 30 seconds', expression: '0/30 * * * * ?' },
    { label: 'Every 15 minutes', expression: '0 0/15 * * * ?' },
    { label: 'Every day at noon', expression: '0 0 12 * * ?' },
    { label: 'Weekdays at 10:15', expression: '0 15 10 ? * MON-FRI' },
    { label: 'Last day of the month', expression: '0 0 0 L * ?' },
    { label: 'Last Friday of the month', expression: '0 0 12 ? * 6L' },
    { label: 'Third Monday of the month', expression: '0 0 9 ? * 2#3' },
    { label: 'Nearest weekday to the 15th', expression: '0 0 9 15W * ?' },
  ],
  aws: [
    { label: 'Every 15 minutes', expression: '0/15 * * * ? *' },
    { label: 'Every hour', expression: '0 * * * ? *' },
    { label: 'Every day at noon UTC', expression: '0 12 * * ? *' },
    { label: 'Weekdays at 10:15', expression: '15 10 ? * MON-FRI *' },
    { label: 'Monday–Friday every 5 minutes', expression: '0/5 8-17 ? * MON-FRI *' },
    { label: 'Last day of the month', expression: '0 0 L * ? *' },
    { label: 'First Monday of the month', expression: '0 8 ? * 2#1 *' },
    { label: 'Fixed rate, every 5 minutes', expression: 'rate(5 minutes)' },
  ],
};

export interface ExplainedCron {
  dialect: CronDialect;
  description: string;
  /** Null when the expression has no calendar to list runs for (an EventBridge rate). */
  schedule: CronSchedule | null;
  note?: string;
}

/* ------------------------------------------------------------ field parsing */

interface Segment {
  start: number;
  end: number;
  step: number;
  wildcard: boolean;
  wrapped: boolean;
}

interface NumericField {
  values: Set<number>;
  segments: Segment[];
  /** A bare `*` — every value. */
  wildcard: boolean;
  /** A `?`: "no specific value", valid only for day-of-month and day-of-week. */
  anyValue: boolean;
}

interface FieldRules {
  name: string;
  min: number;
  max: number;
  names?: Record<string, number>;
}

const MONTH_ALIASES: Record<string, number> = Object.fromEntries(
  MONTH_NAMES.map((name, index) => [name.slice(0, 3).toUpperCase(), index + 1])
);
// Quartz and EventBridge number weekdays 1 (Sunday) to 7 (Saturday).
const DOW_ALIASES: Record<string, number> = Object.fromEntries(
  DOW_NAMES.map((name, index) => [name.slice(0, 3).toUpperCase(), index + 1])
);

const resolveValue = (token: string, rules: FieldRules): number =>
  rules.names && token.toUpperCase() in rules.names ? rules.names[token.toUpperCase()]! : /^\d+$/.test(token) ? Number(token) : Number.NaN;

function parseSegment(token: string, rules: FieldRules): ToolResult<Segment> {
  const { name, min, max } = rules;
  const [rangeText, stepText, ...extra] = token.split('/');
  if (extra.length > 0) return err(`"${token}" in the ${name} field has more than one "/" — expected at most one step.`);

  let step = 1;
  if (stepText !== undefined) {
    step = /^\d+$/.test(stepText) ? Number(stepText) : Number.NaN;
    if (!Number.isInteger(step) || step <= 0) {
      return err(`"${stepText}" is not a valid step in "${token}" (${name} field) — steps must be a positive whole number.`);
    }
  }

  const outOfRange = (value: number) =>
    err<Segment>(`${Number.isNaN(value) ? `"${token}"` : `${value}`} in the ${name} field is out of range — valid values are ${min}-${max}${rules.names ? ' (or names)' : ''}.`);

  if (rangeText === '*') return ok({ start: min, end: max, step, wildcard: true, wrapped: false });

  if (rangeText!.includes('-')) {
    const bounds = rangeText!.split('-');
    if (bounds.length !== 2 || bounds[0] === '' || bounds[1] === '') {
      return err(`"${token}" in the ${name} field is not a valid range.`);
    }
    const start = resolveValue(bounds[0]!, rules);
    const end = resolveValue(bounds[1]!, rules);
    if (Number.isNaN(start) || start < min || start > max) return outOfRange(start);
    if (Number.isNaN(end) || end < min || end > max) return outOfRange(end);
    return ok({ start, end, step, wildcard: false, wrapped: start > end });
  }

  const start = resolveValue(rangeText!, rules);
  if (Number.isNaN(start) || start < min || start > max) return outOfRange(start);
  // "5/15" means "from 5, every 15" through the field's maximum — not just the value 5.
  return ok({ start, end: stepText !== undefined ? max : start, step, wildcard: false, wrapped: false });
}

function expand(segment: Segment, rules: FieldRules): number[] {
  const span = rules.max - rules.min + 1;
  const last = segment.wrapped ? segment.end + span : segment.end;
  const values: number[] = [];
  for (let v = segment.start; v <= last; v += segment.step) values.push(v > rules.max ? v - span : v);
  return values;
}

/** Handles the plain numeric syntax shared by every field; callers deal with their own specials first. */
function parseNumericField(raw: string, rules: FieldRules, allowAnyValue: boolean): ToolResult<NumericField> {
  if (raw === '?') {
    if (!allowAnyValue) return err(`"?" is only allowed in the day-of-month and day-of-week fields, not ${rules.name}.`);
    return ok({ values: new Set(), segments: [], wildcard: false, anyValue: true });
  }
  const tokens = raw.split(',');
  if (tokens.some((token) => token.trim() === '')) return err(`The ${rules.name} field has an empty item — check for a stray comma.`);

  const segments: Segment[] = [];
  const values = new Set<number>();
  for (const token of tokens) {
    const segment = parseSegment(token.trim(), rules);
    if (!segment.ok) return segment;
    segments.push(segment.value);
    for (const value of expand(segment.value, rules)) values.add(value);
  }
  const wildcard = segments.length === 1 && segments[0]!.wildcard && segments[0]!.step === 1;
  return ok({ values, segments, wildcard, anyValue: false });
}

/* --------------------------------------------------------- day-of-month / week */

interface DomField extends NumericField {
  lastDay: boolean;
  /** `L-3` → 3 */
  lastOffsets: number[];
  lastWeekday: boolean;
  /** `15W` → 15 */
  nearestWeekdays: number[];
}

interface DowField extends NumericField {
  /** `2#3` → third Monday; weekday is 0-6. */
  nth: { weekday: number; n: number }[];
  /** `6L` → last Friday; weekday is 0-6. */
  lastOf: number[];
}

const DOM_RULES: FieldRules = { name: 'day-of-month', min: 1, max: 31 };
const DOW_RULES: FieldRules = { name: 'day-of-week', min: 1, max: 7, names: DOW_ALIASES };

function parseDomField(raw: string): ToolResult<DomField> {
  const field: DomField = {
    values: new Set(),
    segments: [],
    wildcard: false,
    anyValue: false,
    lastDay: false,
    lastOffsets: [],
    lastWeekday: false,
    nearestWeekdays: [],
  };
  if (raw === '?') return ok({ ...field, anyValue: true });

  const plainTokens: string[] = [];
  for (const rawToken of raw.split(',')) {
    const token = rawToken.trim();
    if (token === '') return err('The day-of-month field has an empty item — check for a stray comma.');
    let match: RegExpExecArray | null;
    if (/^L$/i.test(token)) {
      field.lastDay = true;
    } else if (/^LW$/i.test(token)) {
      field.lastWeekday = true;
    } else if ((match = /^L-(\d+)$/i.exec(token))) {
      const offset = Number(match[1]);
      if (offset < 1 || offset > 30) return err(`"${token}" is out of range — L-n counts back 1 to 30 days from the end of the month.`);
      field.lastOffsets.push(offset);
    } else if ((match = /^(\d+)W$/i.exec(token))) {
      const day = Number(match[1]);
      if (day < 1 || day > 31) return err(`"${token}" is out of range — nW needs a day of the month from 1 to 31.`);
      field.nearestWeekdays.push(day);
    } else {
      plainTokens.push(token);
    }
  }

  if (plainTokens.length > 0) {
    const plain = parseNumericField(plainTokens.join(','), DOM_RULES, false);
    if (!plain.ok) return plain;
    field.values = plain.value.values;
    field.segments = plain.value.segments;
    field.wildcard = plain.value.wildcard;
  }
  return ok(field);
}

function parseDowField(raw: string): ToolResult<DowField> {
  const field: DowField = { values: new Set(), segments: [], wildcard: false, anyValue: false, nth: [], lastOf: [] };
  if (raw === '?') return ok({ ...field, anyValue: true });

  const plainTokens: string[] = [];
  const weekdayToken = '([1-7]|SUN|MON|TUE|WED|THU|FRI|SAT)';
  for (const rawToken of raw.split(',')) {
    const token = rawToken.trim();
    if (token === '') return err('The day-of-week field has an empty item — check for a stray comma.');
    let match: RegExpExecArray | null;
    if (/^L$/i.test(token)) {
      // A bare L in this field means the last day of the week: Saturday (7).
      plainTokens.push('7');
    } else if ((match = new RegExp(`^${weekdayToken}L$`, 'i').exec(token))) {
      field.lastOf.push(resolveValue(match[1]!, DOW_RULES) - 1);
    } else if ((match = new RegExp(`^${weekdayToken}#(\\d+)$`, 'i').exec(token))) {
      const n = Number(match[2]);
      if (n < 1 || n > 5) return err(`"${token}" is out of range — the number after # is which occurrence in the month, 1 to 5.`);
      field.nth.push({ weekday: resolveValue(match[1]!, DOW_RULES) - 1, n });
    } else {
      plainTokens.push(token);
    }
  }

  if (plainTokens.length > 0) {
    const plain = parseNumericField(plainTokens.join(','), DOW_RULES, false);
    if (!plain.ok) {
      // Make the most common mistake — Unix-style 0-6 numbering — explicit.
      const zeroBased = plainTokens.some((token) => /(^|[-,/])0($|[-,/])/.test(token));
      return err(
        zeroBased
          ? `${plain.error} Quartz and EventBridge number the days 1 (Sunday) to 7 (Saturday), not 0-6 as in Unix cron.`
          : plain.error
      );
    }
    field.values = new Set([...plain.value.values].map((v) => v - 1));
    field.segments = plain.value.segments;
    field.wildcard = plain.value.wildcard;
  }
  return ok(field);
}

function lastWeekdayOfMonth(year: number, month: number): number {
  const last = daysInMonth(year, month);
  const weekday = dayOfWeek({ year, month, day: last });
  return weekday === 6 ? last - 1 : weekday === 0 ? last - 2 : last;
}

/** The weekday nearest `day` without crossing into another month, or null if the month is too short. */
function nearestWeekday(year: number, month: number, day: number): number | null {
  const length = daysInMonth(year, month);
  if (day > length) return null;
  const weekday = dayOfWeek({ year, month, day });
  if (weekday === 6) return day === 1 ? 3 : day - 1;
  if (weekday === 0) return day === length ? day - 2 : day + 1;
  return day;
}

function domMatches(field: DomField, year: number, month: number, day: number): boolean {
  const length = daysInMonth(year, month);
  return (
    field.values.has(day) ||
    (field.lastDay && day === length) ||
    field.lastOffsets.some((offset) => day === length - offset) ||
    (field.lastWeekday && day === lastWeekdayOfMonth(year, month)) ||
    field.nearestWeekdays.some((target) => nearestWeekday(year, month, target) === day)
  );
}

function dowMatches(field: DowField, year: number, month: number, day: number, weekday: number): boolean {
  const length = daysInMonth(year, month);
  return (
    field.values.has(weekday) ||
    field.nth.some((entry) => entry.weekday === weekday && Math.ceil(day / 7) === entry.n) ||
    field.lastOf.some((target) => target === weekday && day + 7 > length)
  );
}

/* ------------------------------------------------------------- descriptions */

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;
const capitalize = (text: string): string => (text === '' ? text : text[0]!.toUpperCase() + text.slice(1));
const pad2 = (n: number): string => String(n).padStart(2, '0');

const isSingleValue = (field: NumericField): boolean =>
  field.segments.length === 1 && !field.segments[0]!.wildcard && field.segments[0]!.start === field.segments[0]!.end && field.segments[0]!.step === 1;

/** "minutes 0 and 30", "every 5 minutes", "minutes 10 through 20" — no leading preposition. */
function phraseFor(field: NumericField, unit: string, rules: FieldRules, format: (n: number) => string = String): string {
  const { segments } = field;
  if (segments.length > 1 && segments.every((s) => !s.wildcard && s.start === s.end)) {
    return `${unit}s ${joinWithAnd(segments.map((s) => format(s.start)))}`;
  }
  return joinWithAnd(
    segments.map((s) => {
      if (s.wildcard) return s.step === 1 ? `every ${unit}` : `every ${plural(s.step, unit)}`;
      if (s.start === s.end && s.step === 1) return `${unit} ${format(s.start)}`;
      if (s.step > 1 && !s.wrapped && s.end === rules.max && s.start === rules.min) return `every ${plural(s.step, unit)}`;
      if (s.step > 1 && !s.wrapped && s.end === rules.max) return `every ${plural(s.step, unit)} starting at ${unit} ${format(s.start)}`;
      if (s.step > 1) return `every ${plural(s.step, unit)} from ${unit} ${format(s.start)} through ${format(s.end)}`;
      return `${unit}s ${format(s.start)} through ${format(s.end)}${s.wrapped ? ' (wrapping around)' : ''}`;
    })
  );
}

const withPreposition = (phrase: string, preposition: string): string =>
  phrase.startsWith('every ') ? phrase : `${preposition} ${phrase}`;

/** "Monday through Friday", "January and March" — names looked up by value, expanding steps into the values they land on. */
function namedList(field: NumericField, names: readonly string[], rules: FieldRules): string {
  const phrases = field.segments.map((s) => {
    if (s.start === s.end && s.step === 1) return names[s.start - rules.min]!;
    if (s.step === 1 && !s.wildcard) return `${names[s.start - rules.min]!} through ${names[s.end - rules.min]!}`;
    return joinWithAnd(
      expand(s, rules)
        .sort((a, b) => a - b)
        .map((v) => names[v - rules.min]!)
    );
  });
  return joinWithAnd(phrases);
}

/** "2026", "2026 through 2030", "2026 and 2028" */
function yearList(field: NumericField, rules: FieldRules): string {
  return joinWithAnd(
    field.segments.map((s) => {
      if (s.start === s.end && s.step === 1) return String(s.start);
      if (s.step === 1 && !s.wildcard) return `${s.start} through ${s.end}`;
      return joinWithAnd(expand(s, rules).map(String));
    })
  );
}

interface ExtendedFields {
  seconds: NumericField;
  minutes: NumericField;
  hours: NumericField;
  dom: DomField;
  months: NumericField;
  dow: DowField;
  years: NumericField | null;
}

const SECOND_RULES: FieldRules = { name: 'second', min: 0, max: 59 };
const MINUTE_RULES: FieldRules = { name: 'minute', min: 0, max: 59 };
const HOUR_RULES: FieldRules = { name: 'hour', min: 0, max: 23 };
const MONTH_RULES: FieldRules = { name: 'month', min: 1, max: 12, names: MONTH_ALIASES };

function describeTime(f: ExtendedFields, showSeconds: boolean): string {
  const secondsAreZero = f.seconds.values.size === 1 && f.seconds.values.has(0);
  if (isSingleValue(f.minutes) && isSingleValue(f.hours) && (!showSeconds || isSingleValue(f.seconds))) {
    const clock = `${pad2([...f.hours.values][0]!)}:${pad2([...f.minutes.values][0]!)}`;
    const seconds = showSeconds ? [...f.seconds.values][0]! : 0;
    return `At ${seconds === 0 ? clock : `${clock}:${pad2(seconds)}`}`;
  }

  const clauses: string[] = [];
  const secondsClause = showSeconds && !secondsAreZero;
  if (secondsClause) clauses.push(f.seconds.wildcard ? 'every second' : withPreposition(phraseFor(f.seconds, 'second', SECOND_RULES), 'at'));
  const minutePhrase = f.minutes.wildcard ? 'every minute' : withPreposition(phraseFor(f.minutes, 'minute', MINUTE_RULES), 'at');
  if (!(secondsClause && f.minutes.wildcard)) clauses.push(minutePhrase);
  if (!f.hours.wildcard) {
    clauses.push(withPreposition(phraseFor(f.hours, 'hour', HOUR_RULES), 'during'));
  } else if (!minutePhrase.startsWith('every ') && !secondsClause) {
    clauses.push('every hour');
  }
  return capitalize(clauses.join(', '));
}

function describeDom(field: DomField): string {
  const parts: string[] = [];
  if (field.lastDay) parts.push('the last day of the month');
  for (const offset of field.lastOffsets) parts.push(`the date ${plural(offset, 'day')} before the last day of the month`);
  if (field.lastWeekday) parts.push('the last weekday of the month');
  for (const day of field.nearestWeekdays) parts.push(`the weekday nearest the ${ordinal(day)} of the month`);
  if (field.segments.length > 0 && !field.wildcard) {
    const singles = field.segments.every((s) => !s.wildcard && s.start === s.end);
    parts.push(
      singles
        ? `the ${joinWithAnd(field.segments.map((s) => ordinal(s.start)))} of the month`
        : `${phraseFor(field, 'day', DOM_RULES)} of the month`
    );
  }
  return parts.length === 0 ? '' : `on ${joinWithAnd(parts)}`;
}

function describeDow(field: DowField): string {
  const parts: string[] = [];
  if (field.segments.length > 0 && !field.wildcard) parts.push(namedList(field, DOW_NAMES, DOW_RULES));
  for (const entry of field.nth) parts.push(`the ${ordinal(entry.n)} ${DOW_NAMES[entry.weekday]!} of the month`);
  for (const weekday of field.lastOf) parts.push(`the last ${DOW_NAMES[weekday]!} of the month`);
  return parts.length === 0 ? '' : `on ${joinWithAnd(parts)}`;
}

function describeExtended(f: ExtendedFields, showSeconds: boolean, yearRules: FieldRules): string {
  const clauses = [describeTime(f, showSeconds)];
  clauses.push(f.dom.anyValue ? describeDow(f.dow) : describeDom(f.dom));
  if (!f.months.wildcard) clauses.push(`in ${namedList(f.months, MONTH_NAMES, MONTH_RULES)}`);
  if (f.years && !f.years.wildcard) clauses.push(`in ${yearList(f.years, yearRules)}`);
  return `${clauses.filter((clause) => clause !== '').join(', ')}.`;
}

/* ------------------------------------------------------------ Quartz and AWS */

interface DialectRules {
  dialect: 'quartz' | 'aws';
  maxYear: number;
}

function parseExtended(input: string, rules: DialectRules): ToolResult<ExplainedCron> {
  const { dialect, maxYear } = rules;
  let text = input.trim();

  if (dialect === 'aws') {
    const rate = /^rate\(\s*(\d+)\s+(minute|minutes|hour|hours|day|days)\s*\)$/i.exec(text);
    if (rate) return explainRate(Number(rate[1]), rate[2]!.toLowerCase());
    const wrapped = /^cron\(\s*(.*?)\s*\)$/i.exec(text);
    if (wrapped) text = wrapped[1]!;
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  const label = dialect === 'quartz' ? 'Quartz' : 'EventBridge';
  if (dialect === 'quartz' && tokens.length !== 6 && tokens.length !== 7) {
    return err(
      `A Quartz expression needs 6 fields (second minute hour day-of-month month day-of-week) or 7 with a trailing year — got ${tokens.length}.${tokens.length === 5 ? ' For a 5-field crontab line, switch the syntax to Unix / crontab.' : ''}`
    );
  }
  if (dialect === 'aws' && tokens.length !== 6) {
    return err(
      `An EventBridge cron expression needs exactly 6 fields (minute hour day-of-month month day-of-week year) — got ${tokens.length}. It has no seconds field, and the year is required (use * for any).${tokens.length === 5 ? ' For a 5-field crontab line, switch the syntax to Unix / crontab.' : ''}`
    );
  }

  const [secondText, minuteText, hourText, domText, monthText, dowText, yearText] =
    dialect === 'quartz' ? tokens : ['0', ...tokens];

  const seconds = parseNumericField(secondText!, SECOND_RULES, false);
  if (!seconds.ok) return seconds;
  const minutes = parseNumericField(minuteText!, MINUTE_RULES, false);
  if (!minutes.ok) return minutes;
  const hours = parseNumericField(hourText!, HOUR_RULES, false);
  if (!hours.ok) return hours;
  const dom = parseDomField(domText!);
  if (!dom.ok) return dom;
  const months = parseNumericField(monthText!, MONTH_RULES, false);
  if (!months.ok) return months;
  const dow = parseDowField(dowText!);
  if (!dow.ok) return dow;

  let years: NumericField | null = null;
  if (yearText !== undefined) {
    const parsedYears = parseNumericField(yearText, { name: 'year', min: 1970, max: maxYear }, false);
    if (!parsedYears.ok) return parsedYears;
    years = parsedYears.value;
  }

  if (dom.value.anyValue && dow.value.anyValue) {
    return err(`Only one of day-of-month and day-of-week can be "?" — the other must say which days to run on, e.g. ${dialect === 'quartz' ? '0 0 12 * * ?' : '0 12 * * ? *'}.`);
  }
  if (!dom.value.anyValue && !dow.value.anyValue) {
    return err(
      `${label} can't take both a day-of-month and a day-of-week value. Put "?" in one of them — for example ${dialect === 'quartz' ? '0 0 12 * * ?' : '0 12 * * ? *'} for every day, or ${dialect === 'quartz' ? '0 0 12 ? * MON' : '0 12 ? * MON *'} for Mondays.`
    );
  }

  const fields: ExtendedFields = {
    seconds: seconds.value,
    minutes: minutes.value,
    hours: hours.value,
    dom: dom.value,
    months: months.value,
    dow: dow.value,
    years,
  };

  const schedule: CronSchedule = {
    seconds: fields.seconds.values,
    minutes: fields.minutes.values,
    hours: fields.hours.values,
    months: fields.months.values,
    years: years && !years.wildcard ? years.values : null,
    matchesDay: (year, month, day, weekday) =>
      dom.value.anyValue ? dowMatches(dow.value, year, month, day, weekday) : domMatches(dom.value, year, month, day),
  };

  return ok({
    dialect,
    description: describeExtended(fields, dialect === 'quartz', { name: 'year', min: 1970, max: maxYear }),
    schedule,
    ...(dialect === 'aws' ? { note: 'EventBridge rules evaluate cron expressions in UTC unless the rule or schedule sets another time zone.' } : {}),
  });
}

function explainRate(value: number, unit: string): ToolResult<ExplainedCron> {
  const singular = unit.replace(/s$/, '');
  if (value < 1) return err('A rate must be at least 1, e.g. rate(5 minutes).');
  if (value === 1 && unit !== singular) return err('Use the singular unit for 1 — rate(1 minute), not rate(1 minutes).');
  if (value > 1 && unit === singular) return err(`Use the plural unit for more than 1 — rate(${value} ${singular}s), not rate(${value} ${singular}).`);
  return ok({
    dialect: 'aws',
    description: value === 1 ? `Every ${singular}.` : `Every ${value} ${singular}s.`,
    schedule: null,
    note: 'A rate expression runs at a fixed interval counted from when the rule is created, so there is no calendar of run times to list.',
  });
}

/** Explains a cron expression in the chosen dialect: plain English plus a schedule that can list upcoming runs. */
export function explainCron(input: string, dialect: CronDialect): ToolResult<ExplainedCron> {
  if (input.trim() === '') return err('Enter a cron expression.');

  if (dialect === 'unix') {
    const parsed = parseCronExpression(input);
    if (!parsed.ok) {
      const count = input.trim().split(/\s+/).length;
      const looksExtended = !input.trim().startsWith('@') && (count === 6 || count === 7);
      return looksExtended
        ? err(`${parsed.error} If this is a Quartz/Spring or AWS EventBridge expression, switch the syntax selector above.`)
        : parsed;
    }
    return ok({ dialect, description: parsed.value.description, schedule: scheduleFromUnix(parsed.value) });
  }

  return parseExtended(input, { dialect, maxYear: dialect === 'quartz' ? 2099 : 2199 });
}
