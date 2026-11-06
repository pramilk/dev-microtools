import { type ToolResult, ok, err } from './result';

/**
 * Calendar-date arithmetic on plain year/month/day values — no time of day, no time zone.
 * Working on whole dates avoids the daylight-saving off-by-one-hour bugs that creep in
 * when "add 30 days" is done with local `Date` objects. Everything here is proleptic
 * Gregorian, valid for years 1-9999.
 */

export interface CalendarDate {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

const MS_PER_DAY = 86_400_000;
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Days since 1970-01-01 (negative before it). `Date.UTC` mangles years 0-99, so build the date by hand. */
export function toDayNumber(date: CalendarDate): number {
  const d = new Date(0);
  d.setUTCFullYear(date.year, date.month - 1, date.day);
  return Math.round(d.getTime() / MS_PER_DAY);
}

export function fromDayNumber(dayNumber: number): CalendarDate {
  const d = new Date(dayNumber * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const inSupportedRange = (date: CalendarDate): boolean => date.year >= MIN_YEAR && date.year <= MAX_YEAR;

const OUT_OF_RANGE = `That date falls outside the supported years ${MIN_YEAR}–${MAX_YEAR}.`;

/** Strict `YYYY-MM-DD` — the format `<input type="date">` produces. */
export function parseIsoDate(input: string): ToolResult<CalendarDate> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter a date.');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return err('Enter the date as YYYY-MM-DD, for example 2026-03-14.');
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (date.year < MIN_YEAR) return err(OUT_OF_RANGE);
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) {
    return err(`${trimmed} is not a real calendar date — check the day against the month.`);
  }
  return ok(date);
}

export function formatIsoDate(date: CalendarDate): string {
  const p = (n: number, width: number) => String(n).padStart(width, '0');
  return `${p(date.year, 4)}-${p(date.month, 2)}-${p(date.day, 2)}`;
}

/** Today's date in the browser's local calendar. */
export function todayLocal(now: Date = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** 0 = Sunday ... 6 = Saturday */
export const dayOfWeek = (date: CalendarDate): number => (((toDayNumber(date) + 4) % 7) + 7) % 7;

export const isWeekend = (date: CalendarDate): boolean => {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
};

export const dayOfYear = (date: CalendarDate): number =>
  toDayNumber(date) - toDayNumber({ year: date.year, month: 1, day: 1 }) + 1;

/** ISO 8601 week number: weeks start Monday and week 1 is the one containing the year's first Thursday. */
export function isoWeek(date: CalendarDate): { year: number; week: number } {
  const dow = dayOfWeek(date);
  const isoDow = dow === 0 ? 7 : dow;
  const thursday = fromDayNumber(toDayNumber(date) + (4 - isoDow));
  return { year: thursday.year, week: Math.floor((dayOfYear(thursday) - 1) / 7) + 1 };
}

export interface DateFacts {
  weekday: string;
  dayOfYear: number;
  isoWeek: { year: number; week: number };
  quarter: number;
  isLeapYear: boolean;
  daysInMonth: number;
  daysLeftInYear: number;
}

export function describeDate(date: CalendarDate): DateFacts {
  const yearLength = isLeapYear(date.year) ? 366 : 365;
  return {
    weekday: WEEKDAY_NAMES[dayOfWeek(date)]!,
    dayOfYear: dayOfYear(date),
    isoWeek: isoWeek(date),
    quarter: Math.ceil(date.month / 3),
    isLeapYear: isLeapYear(date.year),
    daysInMonth: daysInMonth(date.year, date.month),
    daysLeftInYear: yearLength - dayOfYear(date),
  };
}

/** Adds calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: CalendarDate, months: number): ToolResult<CalendarDate> {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  const result = { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
  return inSupportedRange(result) ? ok(result) : err(OUT_OF_RANGE);
}

export function addDays(date: CalendarDate, days: number): ToolResult<CalendarDate> {
  const result = fromDayNumber(toDayNumber(date) + days);
  return inSupportedRange(result) ? ok(result) : err(OUT_OF_RANGE);
}

export interface DurationParts {
  years: number;
  months: number;
  weeks: number;
  days: number;
}

const isWholeNumber = (n: number): boolean => Number.isInteger(n) && Math.abs(n) <= 1_000_000;

/**
 * Adds (or, with `direction` -1, subtracts) years, months, weeks and days. Years and months
 * are applied first, with end-of-month clamping, then weeks and days — the order calendar
 * apps and most date libraries use.
 */
export function addToDate(
  date: CalendarDate,
  parts: DurationParts,
  direction: 1 | -1 = 1
): ToolResult<CalendarDate> {
  for (const [name, value] of Object.entries(parts)) {
    if (!isWholeNumber(value) || value < 0) {
      return err(`Enter ${name} as a whole number of 0 or more (up to 1,000,000).`);
    }
  }
  const withMonths = addMonths(date, (parts.years * 12 + parts.months) * direction);
  if (!withMonths.ok) return withMonths;
  return addDays(withMonths.value, (parts.weeks * 7 + parts.days) * direction);
}

/** Moves by weekdays only, skipping Saturdays and Sundays. Negative `count` goes backwards. */
export function addBusinessDays(date: CalendarDate, count: number): ToolResult<CalendarDate> {
  if (!Number.isInteger(count) || Math.abs(count) > 1_000_000) {
    return err('Enter business days as a whole number (up to 1,000,000).');
  }
  const step = count < 0 ? -1 : 1;
  let remaining = Math.abs(count);
  let dayNumber = toDayNumber(date);
  while (remaining > 0) {
    dayNumber += step;
    if (!isWeekend(fromDayNumber(dayNumber))) remaining -= 1;
  }
  const result = fromDayNumber(dayNumber);
  return inSupportedRange(result) ? ok(result) : err(OUT_OF_RANGE);
}

/** Weekdays in [from, to) — i.e. counting `from` but not `to`. Requires from <= to. */
function weekdaysBetween(from: CalendarDate, to: CalendarDate): number {
  const total = toDayNumber(to) - toDayNumber(from);
  const fullWeeks = Math.floor(total / 7);
  let count = fullWeeks * 5;
  const startDow = dayOfWeek(from);
  for (let i = 0; i < total % 7; i += 1) {
    const dow = (startDow + i) % 7;
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

export interface DateDifference {
  /** Which way the dates run: the second date is after, before, or the same as the first. */
  direction: 'forward' | 'backward' | 'same';
  years: number;
  months: number;
  days: number;
  totalMonths: number;
  totalDays: number;
  weeks: number;
  /** Days left over after whole weeks. */
  remainderDays: number;
  /** Mon-Fri days in the span (the end date is counted only when "include end date" is on). */
  businessDays: number;
  /** Saturdays and Sundays in the span, by the same rule. */
  weekendDays: number;
}

export interface DifferenceOptions {
  /** Count both the first and the last day, as in "the 1st through the 5th is 5 days". */
  includeEndDate?: boolean;
}

/** Years/months/days and day totals between two dates, whichever order they are given in. */
export function dateDifference(
  first: CalendarDate,
  second: CalendarDate,
  options: DifferenceOptions = {}
): DateDifference {
  const a = toDayNumber(first);
  const b = toDayNumber(second);
  const direction = b > a ? 'forward' : b < a ? 'backward' : 'same';
  const [early, late] = a <= b ? [first, second] : [second, first];

  let months = (late.year - early.year) * 12 + (late.month - early.month);
  if (late.day < early.day) months -= 1;
  // The anchor lies between two valid dates, so addMonths cannot leave the supported range;
  // the fallback only satisfies the type.
  const anchorResult = addMonths(early, months);
  const anchor = anchorResult.ok ? anchorResult.value : early;
  const days = toDayNumber(late) - toDayNumber(anchor);

  const inclusive = options.includeEndDate ? 1 : 0;
  const span = Math.abs(b - a) + inclusive;
  // Extend the end by a day for inclusive counting so the weekday tally includes it.
  const countEnd = inclusive ? fromDayNumber(toDayNumber(late) + 1) : late;
  const businessDays = weekdaysBetween(early, countEnd);

  return {
    direction,
    years: Math.floor(months / 12),
    months: months % 12,
    days,
    totalMonths: months,
    totalDays: span,
    weeks: Math.floor(span / 7),
    remainderDays: span % 7,
    businessDays,
    weekendDays: span - businessDays,
  };
}

const plural = (n: number, unit: string): string => `${n.toLocaleString('en-US')} ${unit}${n === 1 ? '' : 's'}`;

/** "1 year, 2 months, 3 days" — zero parts are dropped; an empty span reads "0 days". */
export function describeBreakdown(diff: Pick<DateDifference, 'years' | 'months' | 'days'>): string {
  const parts = [
    diff.years > 0 ? plural(diff.years, 'year') : '',
    diff.months > 0 ? plural(diff.months, 'month') : '',
    diff.days > 0 ? plural(diff.days, 'day') : '',
  ].filter(Boolean);
  return parts.length === 0 ? '0 days' : parts.join(', ');
}
