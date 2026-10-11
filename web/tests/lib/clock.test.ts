import { afterEach, describe, expect, it } from "vitest";
import {
  addDays,
  addMinutes,
  advanceNow,
  endOfLocalDate,
  formatTime12,
  isIsoInstant,
  isLocalDate,
  isLocalTime,
  localDateOf,
  localTimeOf,
  minutesBetween,
  now,
  nowIso,
  nyOffsetMinutes,
  parseInstant,
  resetNow,
  roundUpToMinutes,
  setNow,
  startOfLocalDate,
  toIso,
  today,
  utcKey,
  zonedDateTime,
} from "@/lib/clock";

afterEach(() => resetNow());

describe("injectable now", () => {
  it("pins, advances and resets the clock", () => {
    setNow("2026-10-11T16:00:00-04:00");
    expect(nowIso()).toBe("2026-10-11T16:00:00-04:00");
    advanceNow(30);
    expect(nowIso()).toBe("2026-10-11T16:30:00-04:00");
    expect(today()).toBe("2026-10-11");
    const pinned = now();
    pinned.setFullYear(2000);
    expect(nowIso()).toBe("2026-10-11T16:30:00-04:00");
    resetNow();
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("accepts a function source", () => {
    let ms = Date.parse("2026-10-11T20:00:00Z");
    setNow(() => new Date(ms));
    expect(nowIso()).toBe("2026-10-11T16:00:00-04:00");
    ms += 60_000;
    expect(nowIso()).toBe("2026-10-11T16:01:00-04:00");
  });
});

describe("toIso", () => {
  it("writes the New York offset in summer and winter, seconds precision", () => {
    expect(toIso("2026-10-11T21:30:00.789Z")).toBe("2026-10-11T17:30:00-04:00");
    expect(toIso("2026-12-01T17:00:00Z")).toBe("2026-12-01T12:00:00-05:00");
    expect(toIso(new Date("2026-10-11T04:00:00Z"))).toBe("2026-10-11T00:00:00-04:00");
  });

  it("is correct around the fall-back change (2026-11-01)", () => {
    expect(toIso("2026-11-01T05:30:00Z")).toBe("2026-11-01T01:30:00-04:00");
    expect(toIso("2026-11-01T06:30:00Z")).toBe("2026-11-01T01:30:00-05:00");
  });

  it("is correct around the spring-forward change (2026-03-08)", () => {
    expect(toIso("2026-03-08T06:59:00Z")).toBe("2026-03-08T01:59:00-05:00");
    expect(toIso("2026-03-08T07:00:00Z")).toBe("2026-03-08T03:00:00-04:00");
  });

  it("round-trips through parseInstant", () => {
    const iso = "2026-10-11T17:30:00-04:00";
    expect(toIso(parseInstant(iso)!)).toBe(iso);
  });
});

describe("local dates and times", () => {
  it("gives the New York date of an instant, not the UTC date", () => {
    expect(localDateOf("2026-10-12T02:00:00Z")).toBe("2026-10-11");
    expect(localDateOf("2026-10-12T04:00:00Z")).toBe("2026-10-12");
    expect(localTimeOf("2026-10-12T02:05:00Z")).toBe("22:05");
    expect(localTimeOf("2026-10-12T04:00:00Z")).toBe("00:00");
  });

  it("computes start and end of a local date across DST", () => {
    expect(startOfLocalDate("2026-10-11").toISOString()).toBe("2026-10-11T04:00:00.000Z");
    expect(endOfLocalDate("2026-10-11").toISOString()).toBe("2026-10-12T04:00:00.000Z");
    // Fall back: 25-hour day.
    expect(minutesBetween(startOfLocalDate("2026-11-01"), endOfLocalDate("2026-11-01"))).toBe(25 * 60);
    // Spring forward: 23-hour day.
    expect(minutesBetween(startOfLocalDate("2026-03-08"), endOfLocalDate("2026-03-08"))).toBe(23 * 60);
  });

  it("turns a local date and time into an instant", () => {
    expect(toIso(zonedDateTime("2026-10-11", "18:00"))).toBe("2026-10-11T18:00:00-04:00");
    expect(toIso(zonedDateTime("2026-12-24", "18:00"))).toBe("2026-12-24T18:00:00-05:00");
    // Repeated hour resolves to the first occurrence.
    expect(toIso(zonedDateTime("2026-11-01", "01:30"))).toBe("2026-11-01T01:30:00-04:00");
    // Missing hour moves forward by the gap.
    expect(toIso(zonedDateTime("2026-03-08", "02:30"))).toBe("2026-03-08T03:30:00-04:00");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("formats 12-hour times for messages", () => {
    expect(formatTime12("2026-10-11T18:00:00-04:00")).toBe("6:00 PM");
    expect(formatTime12("2026-10-11T00:05:00-04:00")).toBe("12:05 AM");
    expect(formatTime12("2026-10-11T12:00:00-04:00")).toBe("12:00 PM");
  });

  it("reports the offset in minutes", () => {
    expect(nyOffsetMinutes("2026-10-11T12:00:00Z")).toBe(-240);
    expect(nyOffsetMinutes("2026-12-11T12:00:00Z")).toBe(-300);
  });
});

describe("validation and arithmetic", () => {
  it("accepts only ISO timestamps with an offset", () => {
    expect(isIsoInstant("2026-10-11T17:30:00-04:00")).toBe(true);
    expect(isIsoInstant("2026-10-11T21:30:00Z")).toBe(true);
    expect(isIsoInstant("2026-10-11T21:30:00.123Z")).toBe(true);
    expect(isIsoInstant("2026-10-11T17:30-04:00")).toBe(true);
    expect(isIsoInstant("2026-10-11T17:30:00")).toBe(false);
    expect(isIsoInstant("2026-10-11")).toBe(false);
    expect(isIsoInstant("2026-02-30T10:00:00Z")).toBe(false);
    expect(isIsoInstant("2026-10-11T24:00:00Z")).toBe(false);
    expect(isIsoInstant(12345)).toBe(false);
  });

  it("validates local dates and times", () => {
    expect(isLocalDate("2026-10-11")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-1-1")).toBe(false);
    expect(isLocalTime("18:00")).toBe(true);
    expect(isLocalTime("00:00")).toBe(true);
    expect(isLocalTime("24:00")).toBe(false);
    expect(isLocalTime("6:00")).toBe(false);
  });

  it("adds minutes, rounds up and makes sortable UTC keys", () => {
    expect(toIso(addMinutes("2026-10-11T17:30:00-04:00", 45))).toBe("2026-10-11T18:15:00-04:00");
    expect(toIso(roundUpToMinutes("2026-10-11T16:01:30-04:00", 5))).toBe("2026-10-11T16:05:00-04:00");
    expect(toIso(roundUpToMinutes("2026-10-11T16:05:00-04:00", 5))).toBe("2026-10-11T16:05:00-04:00");
    const a = utcKey("2026-11-01T01:45:00-04:00");
    const b = utcKey("2026-11-01T01:15:00-05:00");
    expect(a < b).toBe(true);
  });
});
