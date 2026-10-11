import { describe, expect, it } from "vitest";
import { formatCents, plural } from "@/lib/services/format";
import { haversineMeters } from "@/lib/services/geo";

describe("formatCents", () => {
  it.each([
    [400, "$4.00"],
    [5, "$0.05"],
    [1234, "$12.34"],
    [0, "$0.00"],
    [100000, "$1000.00"],
  ])("%i -> %s", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
});

describe("plural", () => {
  it("uses the singular for 1", () => {
    expect(plural(1, "minute")).toBe("1 minute");
    expect(plural(30, "minute")).toBe("30 minutes");
  });
});

describe("haversineMeters", () => {
  it("is 0 for the same point and about 111 km per degree of latitude", () => {
    expect(haversineMeters(40.79, -77.86, 40.79, -77.86)).toBe(0);
    expect(haversineMeters(40, -77.86, 41, -77.86)).toBe(111195);
  });
});
