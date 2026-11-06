import { type ToolResult, ok, err } from './result';
import {
  type WallTime,
  formatOffset,
  instantForWallTime,
  isValidTimeZone,
  offsetMinutesAt,
  wallTimeAt,
  wallTimeStatus,
  zoneAbbreviation,
} from './timeZone';

export interface ZoneReading {
  zone: string;
  wall: WallTime;
  /** Offset from UTC in minutes at this instant. */
  offsetMinutes: number;
  /** "UTC+5:30" */
  offsetLabel: string;
  /** Short name Intl offers, e.g. "EST" or "GMT+1". */
  abbreviation: string;
  /** Calendar-day difference from the source zone's date: -1, 0, +1 ... */
  dayShift: number;
}

export interface ZoneConversion {
  instantMs: number;
  iso: string;
  source: ZoneReading;
  targets: ZoneReading[];
  /** Plain-language caveats, e.g. a repeated hour at a DST change. */
  notes: string[];
}

const DAY_MS = 86_400_000;

/** RFC 3339 / ISO 8601 text for a wall time with its offset, e.g. "2026-03-14T18:30:00+05:30". */
export function isoWithOffset(wall: WallTime, offsetMinutes: number): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  const date = `${p(wall.year, 4)}-${p(wall.month)}-${p(wall.day)}`;
  const time = `${p(wall.hour)}:${p(wall.minute)}:${p(wall.second)}`;
  if (offsetMinutes === 0) return `${date}T${time}Z`;
  const abs = Math.abs(offsetMinutes);
  return `${date}T${time}${offsetMinutes < 0 ? '-' : '+'}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

const dayNumber = (w: WallTime): number => Math.floor(Date.UTC(w.year, w.month - 1, w.day) / DAY_MS);

function readZone(instantMs: number, zone: string, sourceWall: WallTime): ZoneReading {
  const wall = wallTimeAt(instantMs, zone);
  const offsetMinutes = offsetMinutesAt(instantMs, zone);
  return {
    zone,
    wall,
    offsetMinutes,
    offsetLabel: formatOffset(offsetMinutes),
    abbreviation: zoneAbbreviation(instantMs, zone),
    dayShift: dayNumber(wall) - dayNumber(sourceWall),
  };
}

/** Converts one wall-clock time in a source zone into the same instant in every target zone. */
export function convertBetweenZones(
  wall: WallTime,
  sourceZone: string,
  targetZones: readonly string[]
): ToolResult<ZoneConversion> {
  if (!isValidTimeZone(sourceZone)) {
    return err(`"${sourceZone}" is not a recognised IANA time zone — pick one from the list, e.g. "America/New_York".`);
  }
  const badTarget = targetZones.find((zone) => !isValidTimeZone(zone));
  if (badTarget !== undefined) {
    return err(`"${badTarget}" is not a recognised IANA time zone — remove it or pick one from the list.`);
  }

  const status = wallTimeStatus(wall, sourceZone);
  if (status === 'gap') {
    return err(
      `That time does not exist in ${sourceZone}: clocks skip forward over it for daylight saving. Choose a time an hour earlier or later.`
    );
  }
  const instantMs = instantForWallTime(wall, sourceZone);
  if (instantMs === null) {
    return err(`Could not resolve that time in ${sourceZone}.`);
  }

  const notes: string[] = [];
  if (status === 'ambiguous') {
    notes.push(
      `That time happens twice in ${sourceZone} as clocks fall back for daylight saving. The earlier of the two (before the change) is used.`
    );
  }

  return ok({
    instantMs,
    iso: new Date(instantMs).toISOString(),
    source: readZone(instantMs, sourceZone, wall),
    targets: targetZones.map((zone) => readZone(instantMs, zone, wall)),
    notes,
  });
}

/* ------------------------------------------------------------- meeting planner */

export interface PlannerCell {
  /** Local hour 0-23 in this row's zone. */
  hour: number;
  minute: number;
  dayShift: number;
  working: boolean;
}

export interface PlannerRow {
  zone: string;
  cells: PlannerCell[];
}

export interface MeetingPlan {
  rows: PlannerRow[];
  /** Column index ranges [from, to) in which every zone is inside working hours. */
  commonWindows: { from: number; to: number }[];
}

export interface PlannerOptions {
  /** First working hour, inclusive. Default 9. */
  workStart?: number;
  /** End of the working day, exclusive. Default 17. */
  workEnd?: number;
}

/**
 * Lays out the 24 hours following local midnight in the anchor zone against every other
 * zone, flagging working hours, and finds the stretches when all zones overlap. Columns
 * are elapsed hours, so on a daylight-saving day the grid still has 24 columns.
 */
export function planMeeting(
  day: Pick<WallTime, 'year' | 'month' | 'day'>,
  anchorZone: string,
  zones: readonly string[],
  options: PlannerOptions = {}
): ToolResult<MeetingPlan> {
  const workStart = options.workStart ?? 9;
  const workEnd = options.workEnd ?? 17;
  if (!Number.isInteger(workStart) || !Number.isInteger(workEnd) || workStart < 0 || workEnd > 24 || workStart >= workEnd) {
    return err('Working hours must be whole hours with the start before the end, e.g. 9 to 17.');
  }
  const everyZone = [anchorZone, ...zones.filter((zone) => zone !== anchorZone)];
  const invalid = everyZone.find((zone) => !isValidTimeZone(zone));
  if (invalid !== undefined) {
    return err(`"${invalid}" is not a recognised IANA time zone.`);
  }

  // Local midnight can itself be skipped by a DST change in a few zones; fall back to the
  // first hour that exists so the grid still starts at the start of the day.
  let startMs: number | null = null;
  for (let hour = 0; hour < 4 && startMs === null; hour += 1) {
    startMs = instantForWallTime({ ...day, hour, minute: 0, second: 0 }, anchorZone);
  }
  if (startMs === null) return err(`Could not work out the start of that day in ${anchorZone}.`);
  const dayStart = startMs;

  const anchorDay = dayNumber({ ...day, hour: 0, minute: 0, second: 0 });
  const rows: PlannerRow[] = everyZone.map((zone) => ({
    zone,
    cells: Array.from({ length: 24 }, (_, index) => {
      const wall = wallTimeAt(dayStart + index * 3_600_000, zone);
      return {
        hour: wall.hour,
        minute: wall.minute,
        dayShift: dayNumber(wall) - anchorDay,
        working: wall.hour >= workStart && wall.hour < workEnd,
      };
    }),
  }));

  const commonWindows: { from: number; to: number }[] = [];
  let runStart: number | null = null;
  for (let index = 0; index <= 24; index += 1) {
    const everyoneWorks = index < 24 && rows.every((row) => row.cells[index]!.working);
    if (everyoneWorks && runStart === null) runStart = index;
    if (!everyoneWorks && runStart !== null) {
      commonWindows.push({ from: runStart, to: index });
      runStart = null;
    }
  }

  return ok({ rows, commonWindows });
}
