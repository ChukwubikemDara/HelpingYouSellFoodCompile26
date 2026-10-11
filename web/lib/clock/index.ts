/**
 * Time for the whole app.
 *
 * - `now()` is the only way server code reads the current time, so tests can
 *   pin it with `setNow()`.
 * - Business dates are America/New_York local dates ("YYYY-MM-DD").
 * - API timestamps are ISO 8601 with the New York offset, seconds precision,
 *   e.g. "2026-10-11T17:30:00-04:00" (`toIso`).
 * - All helpers are correct across DST changes. Wall-clock times that do not
 *   exist (spring forward) move forward by the gap; times that occur twice
 *   (fall back) resolve to the first occurrence.
 */

export const BUSINESS_TIME_ZONE = "America/New_York";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type Instant = Date | string | number;
type NowSource = () => Date;

const holder = globalThis as typeof globalThis & { __appClockNow?: NowSource };

/** Current instant. Pinned by `setNow` in tests. */
export function now(): Date {
  const source = holder.__appClockNow;
  return source ? new Date(source().getTime()) : new Date();
}

/** Pin the clock. Accepts a fixed instant or a function returning one. Test use only. */
export function setNow(source: Instant | NowSource): void {
  if (typeof source === "function") {
    holder.__appClockNow = source;
    return;
  }
  const fixed = toDate(source);
  holder.__appClockNow = () => new Date(fixed.getTime());
}

/** Move a pinned clock forward (or back, with a negative value). Test use only. */
export function advanceNow(minutes: number): void {
  const next = new Date(now().getTime() + minutes * MINUTE_MS);
  setNow(next);
}

/** Back to the real clock. */
export function resetNow(): void {
  delete holder.__appClockNow;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parse an ISO 8601 timestamp that carries an offset or "Z".
 * Returns null for anything else (no offset, impossible dates, garbage).
 */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = ISO_WITH_OFFSET.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (m[8] !== "Z") {
    const [oh, om] = m[8].slice(1).split(":").map(Number);
    if (oh > 23 || om > 59) return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** True for an ISO 8601 timestamp with an offset or "Z". */
export function isIsoInstant(value: unknown): value is string {
  return parseInstant(value) !== null;
}

/**
 * Instants the API accepts from clients: from 2000-01-01 (inclusive) to
 * 2100-01-01 (exclusive), UTC. Outside it `toIso` cannot always write a
 * string `parseInstant` reads back (New York used local mean time before
 * 1883, an offset with seconds; past 9999 the year has five digits), so a
 * stored record would break every later read.
 */
export const INSTANT_RANGE = {
  fromMs: Date.UTC(2000, 0, 1),
  untilMs: Date.UTC(2100, 0, 1),
  message: "Must be a time between 2000 and 2099.",
} as const;

/** True for an instant inside INSTANT_RANGE. */
export function isInstantInRange(value: Instant): boolean {
  const ms = toMs(value);
  return ms >= INSTANT_RANGE.fromMs && ms < INSTANT_RANGE.untilMs;
}

/** True for a real calendar date written "YYYY-MM-DD". */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = LOCAL_DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** True for a 24-hour local time "HH:MM" (00:00-23:59). */
export function isLocalTime(value: unknown): value is string {
  return typeof value === "string" && LOCAL_TIME.test(value);
}

/** Date, epoch ms or ISO string (with offset) to Date. Throws on invalid input. */
export function toDate(instant: Instant): Date {
  if (instant instanceof Date) {
    if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid Date");
    return new Date(instant.getTime());
  }
  if (typeof instant === "number") {
    if (!Number.isFinite(instant)) throw new RangeError(`Invalid epoch ms: ${instant}`);
    return new Date(instant);
  }
  const parsed = parseInstant(instant);
  if (!parsed) throw new RangeError(`Not an ISO 8601 timestamp with offset: ${instant}`);
  return parsed;
}

/** Epoch milliseconds of an instant. */
export function toMs(instant: Instant): number {
  return toDate(instant).getTime();
}

/* ------------------------------------------------------------------ */
/* New York wall clock                                                 */
/* ------------------------------------------------------------------ */

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function wallClock(ms: number): WallClock {
  const out: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    // Some engines print midnight as 24 even with h23.
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** New York UTC offset in ms at an instant (negative: -4h or -5h). */
function offsetMsAt(ms: number): number {
  const w = wallClock(ms);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

/** New York UTC offset in minutes at an instant, e.g. -240 in summer. */
export function nyOffsetMinutes(instant: Instant): number {
  return offsetMsAt(toMs(instant)) / MINUTE_MS;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const pad4 = (n: number) => String(n).padStart(4, "0");

/** ISO 8601 with the New York offset, seconds precision: "2026-10-11T17:30:00-04:00". */
export function toIso(instant: Instant): string {
  const ms = toMs(instant);
  const w = wallClock(ms);
  const offsetMin = offsetMsAt(ms) / MINUTE_MS;
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return (
    `${pad4(w.year)}-${pad2(w.month)}-${pad2(w.day)}T${pad2(w.hour)}:${pad2(w.minute)}:${pad2(w.second)}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

/** Current time as ISO 8601 with the New York offset. */
export function nowIso(): string {
  return toIso(now());
}

/**
 * UTC ISO string ("2026-10-11T21:30:00.000Z") of an instant. Sorts
 * lexicographically in time order, unlike offset strings across a DST change.
 * Use it for database sort keys, never for API output.
 */
export function utcKey(instant: Instant): string {
  return toDate(instant).toISOString();
}

/** New York local date "YYYY-MM-DD" of an instant. */
export function localDateOf(instant: Instant): string {
  const w = wallClock(toMs(instant));
  return `${pad4(w.year)}-${pad2(w.month)}-${pad2(w.day)}`;
}

/** Today's New York local date. */
export function today(): string {
  return localDateOf(now());
}

/** New York local time "HH:MM" (24-hour) of an instant. */
export function localTimeOf(instant: Instant): string {
  const w = wallClock(toMs(instant));
  return `${pad2(w.hour)}:${pad2(w.minute)}`;
}

/** "6:00 PM" style New York local time, for messages. */
export function formatTime12(instant: Instant): string {
  const w = wallClock(toMs(instant));
  const suffix = w.hour < 12 ? "AM" : "PM";
  const hour12 = w.hour % 12 === 0 ? 12 : w.hour % 12;
  return `${hour12}:${pad2(w.minute)} ${suffix}`;
}

function parseLocalDate(date: string): { year: number; month: number; day: number } {
  if (!isLocalDate(date)) throw new RangeError(`Not a local date YYYY-MM-DD: ${date}`);
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

/** The local date `days` after (or before, if negative) `date`. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * The instant of a New York wall-clock time on a local date.
 * Spring-forward gap times move forward by the gap (02:30 -> 03:30 EDT);
 * fall-back repeated times resolve to the first occurrence (EDT).
 */
export function zonedDateTime(date: string, time: string): Date {
  const { year, month, day } = parseLocalDate(date);
  if (!isLocalTime(time)) throw new RangeError(`Not a local time HH:MM: ${time}`);
  const [hour, minute] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  // The two offsets in force around this wall time (equal on most days).
  const offsetBefore = offsetMsAt(wallAsUtc - DAY_MS);
  const offsetAfter = offsetMsAt(wallAsUtc + DAY_MS);
  const matches: number[] = [];
  for (const offset of new Set([offsetBefore, offsetAfter])) {
    const candidate = wallAsUtc - offset;
    const w = wallClock(candidate);
    if (
      w.year === year &&
      w.month === month &&
      w.day === day &&
      w.hour === hour &&
      w.minute === minute
    ) {
      matches.push(candidate);
    }
  }
  if (matches.length > 0) return new Date(Math.min(...matches));
  // Gap: interpret with the offset in force before the change.
  return new Date(wallAsUtc - offsetBefore);
}

/** First instant of a New York local date (midnight). */
export function startOfLocalDate(date: string): Date {
  return zonedDateTime(date, "00:00");
}

/** First instant after a New York local date (exclusive end: next day's midnight). Days can be 23 or 25 h. */
export function endOfLocalDate(date: string): Date {
  return startOfLocalDate(addDays(date, 1));
}

/** The instant `minutes` after `instant`. */
export function addMinutes(instant: Instant, minutes: number): Date {
  return new Date(toMs(instant) + minutes * MINUTE_MS);
}

/** Whole and fractional minutes from `from` to `to` (negative if `to` is earlier). */
export function minutesBetween(from: Instant, to: Instant): number {
  return (toMs(to) - toMs(from)) / MINUTE_MS;
}

/** Round an instant up to the next multiple of `stepMinutes` (unchanged if already on one). */
export function roundUpToMinutes(instant: Instant, stepMinutes: number): Date {
  const step = stepMinutes * MINUTE_MS;
  const ms = toMs(instant);
  return new Date(Math.ceil(ms / step) * step);
}

/** Compare two instants: negative if a < b, 0 if equal, positive if a > b. */
export function compareInstants(a: Instant, b: Instant): number {
  return toMs(a) - toMs(b);
}
