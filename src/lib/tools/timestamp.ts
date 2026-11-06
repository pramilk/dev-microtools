import { type ToolResult, ok, err } from './result';

/**
 * Every epoch this tool reads and writes. Unix time is the common one, but Windows,
 * .NET, Chrome, Apple and spreadsheets each count from a different starting moment and
 * in a different unit. The 100-nanosecond and nanosecond formats reach values past 2^53,
 * so all integer conversion runs on BigInt to stay exact.
 */
export type EpochUnit =
  | 'seconds'
  | 'milliseconds'
  | 'microseconds'
  | 'nanoseconds'
  | 'filetime'
  | 'dotnet-ticks'
  | 'webkit'
  | 'mac-absolute'
  | 'hfs-plus'
  | 'excel';

/** Kept under its original name: the Timestamp Converter island and its tests import it. */
export type TimestampUnit = EpochUnit;

export interface EpochFormat {
  unit: EpochUnit;
  label: string;
  /** Group heading in the unit picker. */
  group: 'Unix' | 'Other systems';
  /** Where this epoch starts, for the picker's tooltip. */
  description: string;
  /** Ticks in one second. Excel counts days and is handled separately. */
  perSecond: bigint;
  /** Milliseconds from 1970-01-01T00:00:00Z to this format's own epoch (negative if earlier). */
  epochOffsetMs: bigint;
  /** True for formats that cannot represent a moment before their epoch. */
  unsigned: boolean;
  /** Where the epoch starts, as a short date, for the "before epoch" note. */
  epochDate: string;
}

export const EPOCH_FORMATS: readonly EpochFormat[] = [
  { unit: 'seconds', label: 'Unix seconds', group: 'Unix', description: 'Seconds since 1970-01-01 UTC', perSecond: 1n, epochOffsetMs: 0n, unsigned: false, epochDate: '1970-01-01' },
  { unit: 'milliseconds', label: 'Unix milliseconds', group: 'Unix', description: 'Milliseconds since 1970-01-01 UTC (JavaScript, Java)', perSecond: 1_000n, epochOffsetMs: 0n, unsigned: false, epochDate: '1970-01-01' },
  { unit: 'microseconds', label: 'Unix microseconds', group: 'Unix', description: 'Microseconds since 1970-01-01 UTC (Python, Postgres)', perSecond: 1_000_000n, epochOffsetMs: 0n, unsigned: false, epochDate: '1970-01-01' },
  { unit: 'nanoseconds', label: 'Unix nanoseconds', group: 'Unix', description: 'Nanoseconds since 1970-01-01 UTC (Go, InfluxDB)', perSecond: 1_000_000_000n, epochOffsetMs: 0n, unsigned: false, epochDate: '1970-01-01' },
  { unit: 'filetime', label: 'Windows FILETIME / LDAP', group: 'Other systems', description: '100-nanosecond intervals since 1601-01-01 UTC (Windows, Active Directory)', perSecond: 10_000_000n, epochOffsetMs: -11_644_473_600_000n, unsigned: true, epochDate: '1601-01-01' },
  { unit: 'dotnet-ticks', label: '.NET ticks', group: 'Other systems', description: '100-nanosecond ticks since 0001-01-01 (DateTime.Ticks)', perSecond: 10_000_000n, epochOffsetMs: -62_135_596_800_000n, unsigned: true, epochDate: '0001-01-01' },
  { unit: 'webkit', label: 'WebKit / Chrome', group: 'Other systems', description: 'Microseconds since 1601-01-01 UTC (Chrome history and cookies)', perSecond: 1_000_000n, epochOffsetMs: -11_644_473_600_000n, unsigned: true, epochDate: '1601-01-01' },
  { unit: 'mac-absolute', label: 'Apple Cocoa / Core Data', group: 'Other systems', description: 'Seconds since 2001-01-01 UTC (NSDate, Core Data, iOS)', perSecond: 1n, epochOffsetMs: 978_307_200_000n, unsigned: false, epochDate: '2001-01-01' },
  { unit: 'hfs-plus', label: 'Mac HFS+', group: 'Other systems', description: 'Seconds since 1904-01-01 (classic Mac OS, HFS+ file times)', perSecond: 1n, epochOffsetMs: -2_082_844_800_000n, unsigned: true, epochDate: '1904-01-01' },
  // Excel counts fractional days, so perSecond is unused; see excelToMs / readEpoch.
  { unit: 'excel', label: 'Excel serial date', group: 'Other systems', description: 'Days since 1899-12-30 (Excel and Lotus 1-2-3, 1900 date system)', perSecond: 1n, epochOffsetMs: -2_209_161_600_000n, unsigned: false, epochDate: '1899-12-30' },
];

const FORMAT_BY_UNIT: ReadonlyMap<EpochUnit, EpochFormat> = new Map(
  EPOCH_FORMATS.map((format) => [format.unit, format])
);

export interface EpochReading {
  unit: EpochUnit;
  label: string;
  /** Null when the moment cannot be written in this format (before its epoch). */
  value: string | null;
  note?: string;
}

export interface TimestampBreakdown {
  seconds: number;
  milliseconds: number;
  iso: string;
  utc: string;
  local: string;
  relative: string;
  dayOfWeek: string;
  timeZone: string;
  /** The same instant in every epoch format. */
  epochs: EpochReading[];
}

/**
 * Heuristic used when the unit is set to auto-detect, by magnitude: ten digits is a
 * second-precision timestamp until the year 2286, thirteen digits is milliseconds, sixteen
 * microseconds, nineteen nanoseconds. This is the same assumption every epoch converter
 * makes and it is right for essentially all real input. The Windows/.NET/WebKit/Apple
 * epochs overlap these ranges, so they are never guessed — pick them explicitly.
 */
export const guessUnit = (
  value: number | bigint
): 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds' => {
  const magnitude = typeof value === 'bigint' ? (value < 0n ? -value : value) : BigInt(Math.trunc(Math.abs(value)));
  if (magnitude >= 1_000_000_000_000_000_000n) return 'nanoseconds';
  if (magnitude >= 1_000_000_000_000_000n) return 'microseconds';
  if (magnitude >= 1_000_000_000_000n) return 'milliseconds';
  return 'seconds';
};

const MAX_DATE_MS = 8_640_000_000_000_000n;
const UINT64_LIMIT = 18_446_744_073_709_551_616n;
const MS_PER_DAY = 86_400_000;

/** Floor division, which BigInt's `/` is not (it truncates toward zero). */
const floorDiv = (numerator: bigint, denominator: bigint): bigint => {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n !== denominator < 0n ? quotient - 1n : quotient;
};

/** Milliseconds since the Unix epoch for an integer epoch value, or null if outside Date's range. */
function integerEpochToMs(value: bigint, format: EpochFormat): number | null {
  const ms = floorDiv(value * 1000n, format.perSecond) + format.epochOffsetMs;
  if (ms > MAX_DATE_MS || ms < -MAX_DATE_MS) return null;
  return Number(ms);
}

function excelToMs(days: number, format: EpochFormat): number | null {
  const ms = Math.round(days * MS_PER_DAY) + Number(format.epochOffsetMs);
  return Math.abs(ms) > Number(MAX_DATE_MS) ? null : ms;
}

/** Writes a moment (ms since Unix epoch) in one epoch format. */
function readEpoch(ms: number, format: EpochFormat): EpochReading {
  const { unit, label } = format;
  if (unit === 'excel') {
    const days = (ms - Number(format.epochOffsetMs)) / MS_PER_DAY;
    const rounded = Number(days.toFixed(6));
    return {
      unit,
      label,
      value: String(rounded),
      ...(rounded < 61 ? { note: 'Serials before 1 March 1900 are off by one because of a historic Excel/Lotus leap-year bug.' } : {}),
    };
  }
  const ticks = floorDiv((BigInt(ms) - format.epochOffsetMs) * format.perSecond, 1000n);
  if (format.unsigned && ticks < 0n) {
    return { unit, label, value: null, note: `Before this format's epoch (${format.epochDate}), so it cannot be written in it.` };
  }
  return { unit, label, value: ticks.toString() };
}

const RELATIVE_STEPS: [limit: number, divisor: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [2620800, 86400, 'day'],
  [31449600, 2620800, 'month'],
  [Number.POSITIVE_INFINITY, 31449600, 'year'],
];

/** Human-readable offset from `now`, e.g. "3 days ago". */
export function describeRelative(date: Date, now: Date = new Date()): string {
  const deltaSeconds = (date.getTime() - now.getTime()) / 1000;
  const magnitude = Math.abs(deltaSeconds);

  if (magnitude < 1) return 'just now';

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [limit, divisor, unit] of RELATIVE_STEPS) {
    if (magnitude < limit) {
      return formatter.format(Math.round(deltaSeconds / divisor), unit);
    }
  }
  return formatter.format(Math.round(deltaSeconds / 31449600), 'year');
}

const describe = (date: Date, now: Date): TimestampBreakdown => ({
  seconds: Math.floor(date.getTime() / 1000),
  milliseconds: date.getTime(),
  iso: date.toISOString(),
  utc: date.toUTCString(),
  local: new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(date),
  relative: describeRelative(date, now),
  dayOfWeek: new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  epochs: EPOCH_FORMATS.map((format) => readEpoch(date.getTime(), format)),
});

/** Converts a numeric epoch value into every representation the tool shows. */
export function fromEpoch(
  input: string,
  unit: EpochUnit | 'auto' = 'auto',
  now: Date = new Date()
): ToolResult<TimestampBreakdown> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter an epoch timestamp.');

  if (unit === 'excel') {
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return err('An Excel serial date is a number of days, optionally with a decimal fraction, e.g. 45000.5.');
    }
    const ms = excelToMs(Number(trimmed), FORMAT_BY_UNIT.get('excel')!);
    if (ms === null) return err('That serial date is outside the range of dates JavaScript can represent.');
    return ok(describe(new Date(ms), now));
  }

  if (!/^-?\d+$/.test(trimmed)) {
    return err('An epoch timestamp is a whole number (for example 1700000000) — no decimals, units or separators.');
  }

  const value = BigInt(trimmed);
  if (value >= UINT64_LIMIT || value <= -UINT64_LIMIT) {
    return err('That number is too large to be a valid timestamp.');
  }

  const resolved = unit === 'auto' ? guessUnit(value) : unit;
  const ms = integerEpochToMs(value, FORMAT_BY_UNIT.get(resolved)!);
  if (ms === null) {
    return err('That timestamp is outside the range of dates JavaScript can represent.');
  }

  return ok(describe(new Date(ms), now));
}

/** Parses a date string (ISO 8601 and other formats Date accepts) into epoch values. */
export function fromDateString(
  input: string,
  now: Date = new Date()
): ToolResult<TimestampBreakdown> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter a date.');

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return err('Could not read that as a date. ISO 8601 works best, for example 2026-03-14T09:26:53Z.');
  }

  return ok(describe(date, now));
}

/** Current time, for the "now" readout the page shows on load. */
export const nowBreakdown = (now: Date = new Date()): TimestampBreakdown => describe(now, now);

/** A handful of widely-useful zones, for a quick "add another time zone" picker. */
export const COMMON_TIME_ZONES: { label: string; zone: string }[] = [
  { label: 'UTC', zone: 'UTC' },
  { label: 'New York', zone: 'America/New_York' },
  { label: 'Chicago', zone: 'America/Chicago' },
  { label: 'Los Angeles', zone: 'America/Los_Angeles' },
  { label: 'São Paulo', zone: 'America/Sao_Paulo' },
  { label: 'London', zone: 'Europe/London' },
  { label: 'Paris', zone: 'Europe/Paris' },
  { label: 'Berlin', zone: 'Europe/Berlin' },
  { label: 'Moscow', zone: 'Europe/Moscow' },
  { label: 'Dubai', zone: 'Asia/Dubai' },
  { label: 'Mumbai', zone: 'Asia/Kolkata' },
  { label: 'Singapore', zone: 'Asia/Singapore' },
  { label: 'Shanghai', zone: 'Asia/Shanghai' },
  { label: 'Tokyo', zone: 'Asia/Tokyo' },
  { label: 'Sydney', zone: 'Australia/Sydney' },
  { label: 'Auckland', zone: 'Pacific/Auckland' },
];

/** Renders an instant as a full date/time string in an arbitrary IANA time zone. */
export function formatInTimeZone(date: Date, timeZone: string): ToolResult<string> {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long', timeZone });
  } catch {
    return err(`"${timeZone}" is not a recognised IANA time zone name, e.g. "America/New_York".`);
  }
  return ok(formatter.format(date));
}
