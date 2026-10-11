import { describe, expect, it } from "vitest";
import { setNow } from "@/lib/clock";
import { proposedLowerPrice } from "@/lib/services/suggestions";
import { api, dealBody, expectError, liveDeal, newCustomer, newMerchant, reserveOk, withFreshApi } from "./helpers";

withFreshApi();

type S = { id: string; type: string; deal_id: string | null };
const lowerPrice = (list: S[]) => list.filter((s) => s.type === "lower_price");
const listNow = (list: S[]) => list.filter((s) => s.type === "list_now");

describe("proposed price", () => {
  it.each([
    [400, 300],
    [425, 325],
    [500, 400],
    [999, 775],
    [100, 75],
    [50, 25],
    [30, 25],
    [25, 25],
  ])("%i cents -> %i cents (x0.8, down to 25-cent steps, min 25)", (current, proposed) => {
    expect(proposedLowerPrice(current)).toBe(proposed);
  });
});

describe("lower_price", () => {
  /** Published 16:00, pickup_end 18:00: half the time has passed at 17:00. 3 units at $4.00. */
  async function setup(overrides: Record<string, unknown> = {}) {
    const m = await newMerchant();
    const deal = await liveDeal(m.cookie, { quantity_total: 3, max_per_customer: 3, ...overrides });
    return { ...m, deal };
  }

  it("is shown when half the time has passed and fewer than half the units are reserved", async () => {
    const { cookie, merchant, deal } = await setup();
    await reserveOk((await newCustomer()).token, deal.id, 1);
    setNow("2026-10-11T16:59:59-04:00");
    expect(lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([]);
    setNow("2026-10-11T17:00:00-04:00");
    const res = await api.suggestions(cookie, merchant.id);
    expect(res.status).toBe(200);
    expect(lowerPrice(res.body.suggestions)).toEqual([
      {
        id: `s_lp_${deal.id}`,
        type: "lower_price",
        deal_id: deal.id,
        message: "1 of 3 reserved, 60 minutes left. Lower Croissants (2-pack) to $3.00?",
        proposed: { deal_price_cents: 300 },
        basis: { reserved: 1, total: 3, minutes_left: 60 },
      },
    ]);
  });

  it("is not shown when half or more of the units are reserved (picked-up units count)", async () => {
    const { cookie, merchant, deal } = await setup({ quantity_total: 4, max_per_customer: 4 });
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id, 2);
    setNow("2026-10-11T17:30:00-04:00");
    await api.redeem(cookie, { pickup_code: r.pickup_code });
    expect(lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([]);
  });

  it("is shown with nothing reserved, measured from published_at (not created_at)", async () => {
    const m = await newMerchant();
    const draft = (await api.createDeal(m.cookie, dealBody())).body; // created 16:00
    setNow("2026-10-11T17:00:00-04:00");
    await api.publishDeal(m.cookie, draft.id); // published 17:00, ends 18:00: half at 17:30
    setNow("2026-10-11T17:29:00-04:00");
    expect(lowerPrice((await api.suggestions(m.cookie, m.merchant.id)).body.suggestions)).toEqual([]);
    setNow("2026-10-11T17:30:00-04:00");
    const [s] = lowerPrice((await api.suggestions(m.cookie, m.merchant.id)).body.suggestions);
    expect(s).toMatchObject({ basis: { reserved: 0, total: 3, minutes_left: 30 } });
  });

  it("is not shown for sold_out, draft, cancelled or expired deals, or other merchants' deals", async () => {
    const { cookie, merchant } = await setup();
    const soldOut = await liveDeal(cookie, { quantity_total: 1 });
    await reserveOk((await newCustomer()).token, soldOut.id, 1);
    await api.createDeal(cookie, dealBody());
    const cancelled = await liveDeal(cookie);
    await api.cancelDeal(cookie, cancelled.id);
    const other = await newMerchant();
    await liveDeal(other.cookie);
    setNow("2026-10-11T17:30:00-04:00");
    const ids = lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions).map((s) => s.deal_id);
    expect(ids).not.toContain(soldOut.id);
    expect(ids).not.toContain(cancelled.id);
    expect(ids).toHaveLength(1);
    setNow("2026-10-11T18:00:00-04:00");
    expect(lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([]);
  });

  it("is not shown when the price is already at the 25-cent minimum", async () => {
    const { cookie, merchant } = await setup({ original_price_cents: 100, deal_price_cents: 25 });
    setNow("2026-10-11T17:30:00-04:00");
    expect(lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([]);
  });

  it("accept sets the proposed price, keeps existing reservations' unit price, and does not come back", async () => {
    const { cookie, merchant, deal } = await setup();
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id, 1);
    setNow("2026-10-11T17:00:00-04:00");
    const [s] = lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions);
    const accepted = await api.acceptSuggestion(cookie, s.id);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ id: deal.id, deal_price_cents: 300, status: "live" });
    expect((await api.getReservation(token, r.id)).body.unit_price_cents).toBe(400);
    setNow("2026-10-11T17:45:00-04:00");
    expect(lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([]);
    expectError(await api.acceptSuggestion(cookie, s.id), 404, "NOT_FOUND");
  });

  it("a manual price drop does not count as lowered by a suggestion", async () => {
    const { cookie, merchant, deal } = await setup();
    await api.patchDeal(cookie, deal.id, { deal_price_cents: 350 });
    setNow("2026-10-11T17:00:00-04:00");
    const [s] = lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions);
    expect(s.deal_id).toBe(deal.id);
    expect(s).toMatchObject({ proposed: { deal_price_cents: 275 } });
  });

  it("dismissed does not come back for that deal", async () => {
    const { cookie, merchant, deal } = await setup();
    setNow("2026-10-11T17:00:00-04:00");
    const [s] = lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions);
    expect((await api.dismissSuggestion(cookie, s.id)).body).toEqual({ ok: true });
    setNow("2026-10-11T17:50:00-04:00");
    expect(lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([]);
    expectError(await api.acceptSuggestion(cookie, s.id), 404, "NOT_FOUND");
    expect((await api.getDeal(deal.id)).body.deal_price_cents).toBe(400);
  });

  it("accept is 404 once the rule no longer holds, and for other merchants", async () => {
    const { cookie, merchant, deal } = await setup();
    setNow("2026-10-11T17:00:00-04:00");
    const [s] = lowerPrice((await api.suggestions(cookie, merchant.id)).body.suggestions);
    const other = await newMerchant();
    expectError(await api.acceptSuggestion(other.cookie, s.id), 404, "NOT_FOUND");
    expectError(await api.dismissSuggestion(other.cookie, s.id), 404, "NOT_FOUND");
    await reserveOk((await newCustomer()).token, deal.id, 2); // 2 of 3 reserved
    expectError(await api.acceptSuggestion(cookie, s.id), 404, "NOT_FOUND");
    expectError(await api.acceptSuggestion(cookie, "s_bogus"), 404, "NOT_FOUND");
    expectError(await api.dismissSuggestion(cookie, "nope"), 404, "NOT_FOUND");
  });
});

describe("list_now", () => {
  it("is shown within 2 h before closes_at when no deal was created today", async () => {
    const { cookie, merchant } = await newMerchant(); // closes 18:00
    setNow("2026-10-11T15:59:59-04:00");
    expect(listNow((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([]);
    setNow("2026-10-11T16:00:00-04:00");
    expect(listNow((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([
      {
        id: `s_ln_2026-10-11_${merchant.id}`,
        type: "list_now",
        deal_id: null,
        message: "You close at 6:00 PM, in 120 minutes, and have not created a deal today. List what you have now?",
        proposed: null,
        basis: { minutes_to_close: 120, deals_today: 0 },
      },
    ]);
    setNow("2026-10-11T17:59:00-04:00");
    expect(listNow((await api.suggestions(cookie, merchant.id)).body.suggestions)).toHaveLength(1);
    setNow("2026-10-11T18:00:00-04:00");
    expect(listNow((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([]);
  });

  it("is not shown once the merchant created any deal today, even a draft or a cancelled one", async () => {
    const { cookie, merchant } = await newMerchant();
    const draft = (await api.createDeal(cookie, { title: "Bread" })).body;
    await api.cancelDeal(cookie, draft.id);
    expect(listNow((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([]);
  });

  it("a deal from yesterday does not count", async () => {
    setNow("2026-10-10T16:30:00-04:00");
    const { cookie, merchant } = await newMerchant();
    await api.createDeal(cookie, { title: "Bread" });
    setNow("2026-10-11T16:30:00-04:00");
    expect(listNow((await api.suggestions(cookie, merchant.id)).body.suggestions)).toHaveLength(1);
  });

  it("accept returns { ok: true } and changes nothing on the server", async () => {
    const { cookie, merchant } = await newMerchant();
    const [s] = listNow((await api.suggestions(cookie, merchant.id)).body.suggestions);
    expect((await api.acceptSuggestion(cookie, s.id)).body).toEqual({ ok: true });
    expect(listNow((await api.suggestions(cookie, merchant.id)).body.suggestions)).toHaveLength(1);
    const other = await newMerchant();
    expectError(await api.acceptSuggestion(other.cookie, s.id), 404, "NOT_FOUND");
  });

  it("dismissed does not come back that day, but does the next day", async () => {
    const { cookie, merchant } = await newMerchant();
    const [s] = listNow((await api.suggestions(cookie, merchant.id)).body.suggestions);
    const other = await newMerchant();
    expectError(await api.dismissSuggestion(other.cookie, s.id), 404, "NOT_FOUND");
    expect(listNow((await api.suggestions(cookie, merchant.id)).body.suggestions)).toHaveLength(1);
    expect((await api.dismissSuggestion(cookie, s.id)).body).toEqual({ ok: true });
    setNow("2026-10-11T17:30:00-04:00");
    expect(listNow((await api.suggestions(cookie, merchant.id)).body.suggestions)).toEqual([]);
    setNow("2026-10-12T16:30:00-04:00");
    expect(listNow((await api.suggestions(cookie, merchant.id)).body.suggestions)).toHaveLength(1);
  });
});
