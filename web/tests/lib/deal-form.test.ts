import { describe, expect, it } from "vitest";
import { kindFor, validateDealForm, type DealForm } from "@/lib/client/deal-form";

const form = (overrides: Partial<DealForm> = {}): DealForm => ({
  title: "Slice",
  unitSize: "1",
  original: "4.00",
  price: "2.00",
  quantity: "5",
  maxPerCustomer: "2",
  start: "17:00",
  end: "18:00",
  allergens: [],
  note: "",
  ...overrides,
});

describe("validateDealForm pickup times", () => {
  it("puts both times on the given New York date", () => {
    const { values } = validateDealForm(form(), "2026-10-11", new Date("2026-10-11T20:50:00Z"));
    expect(values).toMatchObject({ pickup_start: "2026-10-11T17:00:00-04:00", pickup_end: "2026-10-11T18:00:00-04:00" });
  });

  it("an end time earlier than the start time ends after midnight, on the next day", () => {
    const at = new Date("2026-10-12T02:50:00Z"); // 22:50 New York
    const { errors, values } = validateDealForm(form({ start: "23:00", end: "00:30" }), "2026-10-11", at);
    expect(errors).toEqual({});
    expect(values).toMatchObject({ pickup_start: "2026-10-11T23:00:00-04:00", pickup_end: "2026-10-12T00:30:00-04:00" });
  });

  it("an end time equal to the start time is an error", () => {
    const { errors } = validateDealForm(form({ start: "17:00", end: "17:00" }), "2026-10-11", new Date("2026-10-11T20:00:00Z"));
    expect(errors.end).toBe("Pickup must end after it starts.");
  });

  it("an end time already past is an error", () => {
    const { errors } = validateDealForm(form({ start: "15:00", end: "15:30" }), "2026-10-11", new Date("2026-10-11T20:00:00Z"));
    expect(errors.end).toBe("Pickup end must be later than now.");
  });
});

describe("kindFor", () => {
  it("surplus within 2 h of closing, timed otherwise", () => {
    expect(kindFor("2026-10-11T16:30:00-04:00", "18:00", "2026-10-11")).toBe("surplus");
    expect(kindFor("2026-10-11T13:00:00-04:00", "18:00", "2026-10-11")).toBe("timed");
  });

  it("uses the closing time after midnight for a pickup that ends after midnight", () => {
    expect(kindFor("2026-10-12T00:30:00-04:00", "01:00", "2026-10-11")).toBe("surplus");
    expect(kindFor("2026-10-11T23:30:00-04:00", "01:00", "2026-10-11")).toBe("surplus");
    expect(kindFor("2026-10-11T18:00:00-04:00", "01:00", "2026-10-11")).toBe("timed");
  });
});
