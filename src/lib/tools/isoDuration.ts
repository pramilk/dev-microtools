import { type ToolResult, ok, err } from './result';
import { daysInMonth } from './dateMath';

/**
 * ISO 8601 durations: `P3Y6M4DT12H30M5S`, `PT36H`, `P2W`, `PT0.5S`.
 *
 * The designators are positional: date units (Y M W D) come after `P`, time units
 * (H M S) after `T`, and `M` therefore means months before the `T` and minutes after it.
 */

export interface IsoDuration {
  negative: boolean;
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export type DurationUnit = Exclude<keyof IsoDuration, 'negative'>;

export const DURATION_UNITS: { unit: DurationUnit; designator: string; label: string; time: boolean }[] = [
  { unit: 'years', designator: 'Y', label: 'years', time: false },
  { unit: 'months', designator: 'M', label: 'months', time: false },
  { unit: 'weeks', designator: 'W', label: 'weeks', time: false },
  { unit: 'days', designator: 'D', label: 'days', time: false },
  { unit: 'hours', designator: 'H', label: 'hours', time: true },
  { unit: 'minutes', designator: 'M', label: 'minutes', time: true },
  { unit: 'seconds', designator: 'S', label: 'seconds', time: true },
];

export interface ParsedDuration {
  duration: IsoDuration;
  /** Valid but unusual input, worth telling the reader about. */
  warnings: string[];
}

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const PATTERN = new RegExp(
  String.raw`^([+-])?P(?:${NUMBER}Y)?(?:${NUMBER}M)?(?:${NUMBER}W)?(?:${NUMBER}D)?(?:T(?:${NUMBER}H)?(?:${NUMBER}M)?(?:${NUMBER}S)?)?$`,
  'i'
);

const EXAMPLE_HINT = 'Write it like P1Y2M3DT4H5M6S — date units after P, time units after T.';

/** Seconds in the average Gregorian year and month, used only for the approximate totals. */
const SECONDS_PER_YEAR = 365.2425 * 86_400;
const SECONDS_PER_MONTH = SECONDS_PER_YEAR / 12;

export function parseIsoDuration(input: string): ToolResult<ParsedDuration> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter an ISO 8601 duration, for example P3DT4H or PT30M.');

  if (!/^[+-]?P/i.test(trimmed)) {
    return err(`An ISO 8601 duration starts with "P" (for period), e.g. P1D or PT30M — "${trimmed}" does not.`);
  }

  // The pattern below would accept a bare trailing "T" (all its time groups are optional),
  // which ISO 8601 forbids, so reject it first with a specific message.
  if (/T$/i.test(trimmed)) {
    return err('A "T" must be followed by at least one time unit (H, M or S), e.g. PT30M. ' + EXAMPLE_HINT);
  }

  const match = PATTERN.exec(trimmed);
  if (!match) {
    return err(`Could not read "${trimmed}" as an ISO 8601 duration. Units must appear in order (Y, M, W, D, then T, then H, M, S) with a number before each. ${EXAMPLE_HINT}`);
  }

  const [, sign, ...raw] = match;
  const values = raw.map((text) => (text === undefined ? undefined : Number(text.replace(',', '.'))));
  const present = values.map((value, index) => ({ value, index })).filter((entry) => entry.value !== undefined);
  if (present.length === 0) {
    return err('A duration needs at least one unit after the P, e.g. P1D or PT30M. ' + EXAMPLE_HINT);
  }
  if (values.some((value) => value !== undefined && !Number.isFinite(value))) {
    return err('One of the numbers is too large to represent.');
  }

  // ISO 8601 allows a decimal fraction only on the smallest (last) unit.
  const hasFraction = (index: number) => /[.,]/.test(raw[index] ?? '');
  const fractional = present.filter((entry) => hasFraction(entry.index));
  const last = present[present.length - 1]!;
  if (fractional.length > 1 || (fractional.length === 1 && fractional[0]!.index !== last.index)) {
    return err('Only the smallest unit in a duration may have a decimal fraction, e.g. PT1.5H or P1DT0.5S — not P1.5DT2H.');
  }

  const [years, months, weeks, days, hours, minutes, seconds] = values.map((value) => value ?? 0) as [
    number, number, number, number, number, number, number,
  ];
  const duration: IsoDuration = {
    negative: sign === '-',
    years, months, weeks, days, hours, minutes, seconds,
  };

  const warnings: string[] = [];
  if (weeks > 0 && (years > 0 || months > 0 || days > 0 || hours > 0 || minutes > 0 || seconds > 0)) {
    warnings.push(
      'Weeks are combined with other units. ISO 8601:2004 only allows weeks on their own (P2W); newer editions and most libraries accept the mix, but some parsers reject it.'
    );
  }
  if (Object.values(duration).every((value) => value === 0 || value === false)) {
    warnings.push('Every unit is zero, so this is an empty duration (PT0S).');
  }

  return ok({ duration, warnings });
}

const trimNumber = (n: number): string => {
  // Avoid exponent notation and floating-point tails like 0.30000000000000004.
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(9)));
};

/** Writes a duration as canonical ISO 8601: zero units dropped, `PT0S` when nothing is left. */
export function formatIsoDuration(duration: IsoDuration): string {
  const piece = (unit: DurationUnit, designator: string) =>
    duration[unit] > 0 ? `${trimNumber(duration[unit])}${designator}` : '';
  const date = piece('years', 'Y') + piece('months', 'M') + piece('weeks', 'W') + piece('days', 'D');
  const time = piece('hours', 'H') + piece('minutes', 'M') + piece('seconds', 'S');
  if (date === '' && time === '') return 'PT0S';
  return `${duration.negative ? '-' : ''}P${date}${time === '' ? '' : `T${time}`}`;
}

const plural = (n: number, unit: string): string => `${trimNumber(n)} ${unit}${n === 1 ? '' : 's'}`;

/** "3 years, 6 months, 4 days, 12 hours, 30 minutes, 5 seconds" */
export function describeDuration(duration: IsoDuration): string {
  const parts = DURATION_UNITS.filter(({ unit }) => duration[unit] > 0).map(({ unit, label }) =>
    plural(duration[unit], label.slice(0, -1))
  );
  if (parts.length === 0) return '0 seconds';
  const text = parts.join(', ');
  return duration.negative ? `Minus ${text}` : text;
}

export interface DurationTotals {
  seconds: number;
  /** True when years or months were involved, whose length in seconds varies. */
  approximate: boolean;
}

/** Length in seconds. Years and months use their average Gregorian length and flag the result approximate. */
export function durationTotals(duration: IsoDuration): DurationTotals {
  const seconds =
    duration.years * SECONDS_PER_YEAR +
    duration.months * SECONDS_PER_MONTH +
    duration.weeks * 604_800 +
    duration.days * 86_400 +
    duration.hours * 3_600 +
    duration.minutes * 60 +
    duration.seconds;
  return { seconds: duration.negative ? -seconds : seconds, approximate: duration.years > 0 || duration.months > 0 };
}

/**
 * Applies a duration to an instant, in UTC. Years and months move the calendar date (with
 * end-of-month clamping); everything else is exact elapsed time. Fractional years or months
 * have no calendar meaning and are refused rather than guessed at.
 */
export function applyDuration(startMs: number, duration: IsoDuration): ToolResult<number> {
  if (!Number.isInteger(duration.years) || !Number.isInteger(duration.months)) {
    return err('A fractional year or month cannot be added to a calendar date — use whole years and months, or express the fraction in days.');
  }
  const sign = duration.negative ? -1 : 1;
  const start = new Date(startMs);
  if (Number.isNaN(start.getTime())) return err('That start date is not valid.');

  const monthIndex = start.getUTCFullYear() * 12 + start.getUTCMonth() + sign * (duration.years * 12 + duration.months);
  const year = Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const shifted = new Date(startMs);
  shifted.setUTCFullYear(year, month, Math.min(start.getUTCDate(), daysInMonth(year, month + 1)));

  const elapsedSeconds =
    duration.weeks * 604_800 + duration.days * 86_400 + duration.hours * 3_600 + duration.minutes * 60 + duration.seconds;
  const result = shifted.getTime() + sign * Math.round(elapsedSeconds * 1000);
  if (!Number.isFinite(result) || Math.abs(result) > 8.64e15) {
    return err('The result is outside the range of dates a browser can represent.');
  }
  return ok(result);
}

/** Splits a number of seconds into days, hours, minutes and seconds — the form most APIs and players use. */
export function secondsToDuration(totalSeconds: number): ToolResult<IsoDuration> {
  if (!Number.isFinite(totalSeconds)) return err('Enter a number of seconds.');
  if (Math.abs(totalSeconds) > 1e12) return err('That is too many seconds to express as a duration.');
  const negative = totalSeconds < 0;
  // Work in whole milliseconds so 90.1 seconds does not become 90.09999999999.
  let remaining = Math.round(Math.abs(totalSeconds) * 1000);
  const days = Math.floor(remaining / 86_400_000);
  remaining -= days * 86_400_000;
  const hours = Math.floor(remaining / 3_600_000);
  remaining -= hours * 3_600_000;
  const minutes = Math.floor(remaining / 60_000);
  remaining -= minutes * 60_000;
  return ok({ negative, years: 0, months: 0, weeks: 0, days, hours, minutes, seconds: remaining / 1000 });
}

export type DurationFields = Record<DurationUnit, string>;

/**
 * Builds the ISO string from form fields (each possibly blank), validating through the same
 * parser as typed input so the two paths cannot disagree.
 */
export function durationFromFields(fields: DurationFields, negative = false): ToolResult<ParsedDuration> {
  const duration: IsoDuration = { negative, years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  for (const { unit, label } of DURATION_UNITS) {
    const text = fields[unit].trim();
    if (text === '') continue;
    const value = Number(text.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      return err(`Enter ${label} as a number of 0 or more.`);
    }
    duration[unit] = value;
  }
  const text = formatIsoDuration(duration);
  const parsed = parseIsoDuration(text);
  if (!parsed.ok) return parsed;
  // Keep the sign even for an all-zero duration, which formats without one.
  return ok({ duration: { ...parsed.value.duration, negative }, warnings: parsed.value.warnings });
}
