import { describe, expect, it } from "vitest";
import { countNoShows, deriveDealStatus, deriveReservationStatus, isBlocked } from "@/lib/store/derive";

const PICKUP_END = "2026-10-11T18:00:00-04:00";

describe("deriveDealStatus", () => {
  const live = { status: "live" as const, quantity_left: 2, pickup_end: PICKUP_END };

  it("keeps draft and cancelled as stored", () => {
    expect(deriveDealStatus({ ...live, status: "draft", pickup_end: null }, PICKUP_END)).toBe("draft");
    expect(deriveDealStatus({ ...live, status: "draft" }, "2026-10-11T19:00:00-04:00")).toBe("draft");
    expect(deriveDealStatus({ ...live, status: "cancelled" }, "2026-10-11T19:00:00-04:00")).toBe("cancelled");
  });

  it("is live before pickup_end with units left", () => {
    expect(deriveDealStatus(live, "2026-10-11T17:59:59-04:00")).toBe("live");
  });

  it("is sold_out with no units left, and live again when a unit comes back", () => {
    expect(deriveDealStatus({ ...live, quantity_left: 0 }, "2026-10-11T17:00:00-04:00")).toBe("sold_out");
    expect(deriveDealStatus({ ...live, quantity_left: 1 }, "2026-10-11T17:00:00-04:00")).toBe("live");
  });

  it("is expired from pickup_end on, whether or not units are left", () => {
    expect(deriveDealStatus(live, PICKUP_END)).toBe("expired");
    expect(deriveDealStatus({ ...live, quantity_left: 0 }, "2026-10-11T18:30:00-04:00")).toBe("expired");
  });
});

describe("deriveReservationStatus", () => {
  const deal = { pickup_end: PICKUP_END };

  it("keeps picked_up and cancelled as stored", () => {
    expect(deriveReservationStatus({ status: "picked_up" }, deal, "2026-10-11T20:00:00-04:00")).toBe("picked_up");
    expect(deriveReservationStatus({ status: "cancelled" }, deal, "2026-10-11T20:00:00-04:00")).toBe("cancelled");
  });

  it("turns reserved into no_show at pickup_end + 15 min", () => {
    expect(deriveReservationStatus({ status: "reserved" }, deal, "2026-10-11T18:14:59-04:00")).toBe("reserved");
    expect(deriveReservationStatus({ status: "reserved" }, deal, "2026-10-11T18:15:00-04:00")).toBe("no_show");
  });
});

describe("countNoShows and isBlocked", () => {
  it("counts derived no-shows and blocks at 2", () => {
    const deals = new Map([
      ["d1", { pickup_end: "2026-10-10T18:00:00-04:00" }],
      ["d2", { pickup_end: "2026-10-11T18:00:00-04:00" }],
      ["d3", { pickup_end: "2026-10-11T21:00:00-04:00" }],
    ]);
    const reservations = [
      { status: "reserved" as const, deal_id: "d1" },
      { status: "reserved" as const, deal_id: "d2" },
      { status: "reserved" as const, deal_id: "d3" },
      { status: "picked_up" as const, deal_id: "d1" },
      { status: "cancelled" as const, deal_id: "d2" },
      { status: "reserved" as const, deal_id: "missing" },
    ];
    const now = "2026-10-11T19:00:00-04:00";
    const count = countNoShows(reservations, deals, now);
    expect(count).toBe(2);
    expect(isBlocked(count)).toBe(true);
    expect(isBlocked(1)).toBe(false);
    expect(countNoShows(reservations, deals, "2026-10-11T18:10:00-04:00")).toBe(1);
  });
});
