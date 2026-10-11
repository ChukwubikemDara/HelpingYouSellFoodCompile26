import { afterEach, describe, expect, it } from "vitest";
import { advanceNow, setNow } from "@/lib/clock";
import {
  api,
  dealBody,
  DATE,
  expectError,
  liveDeal,
  newCustomer,
  newMerchant,
  reserveOk,
  withFreshApi,
} from "./helpers";

const store = withFreshApi();

afterEach(() => {
  delete process.env.PLAN_GATE;
});

describe("POST /deals (manual draft)", () => {
  it("creates a draft from a title alone, with nulls for what is missing", async () => {
    const { cookie, merchant } = await newMerchant();
    const res = await api.createDeal(cookie, { title: "Sourdough loaf" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^d_/),
      merchant_id: merchant.id,
      merchant: {
        id: merchant.id,
        name: merchant.name,
        category: merchant.category,
        address: merchant.address,
        lat: merchant.lat,
        lng: merchant.lng,
      },
      title: "Sourdough loaf",
      items: [{ name: "Sourdough loaf", qty: 1 }],
      original_price_cents: null,
      deal_price_cents: null,
      kind: "surplus",
      quantity_total: null,
      quantity_left: null,
      max_per_customer: 2,
      unsold_action: "none",
      pickup_start: "2026-10-11T16:00:00-04:00",
      pickup_end: null,
      allergens: null,
      note: null,
      photo_url: null,
      status: "draft",
      created_at: "2026-10-11T16:00:00-04:00",
      published_at: null,
      distance_m: null,
    });
  });

  it("takes every editable field and ignores server-owned ones", async () => {
    const { cookie } = await newMerchant();
    const res = await api.createDeal(cookie, {
      ...dealBody(),
      id: "d_mine",
      status: "live",
      quantity_left: 99,
      photo_url: "https://example.com/x.jpg",
      published_at: "2026-10-11T15:00:00-04:00",
      unsold_action: "donated",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: "Croissants (2-pack)",
      items: [{ name: "Butter croissant", qty: 2 }],
      original_price_cents: 800,
      deal_price_cents: 400,
      kind: "surplus",
      quantity_total: 3,
      quantity_left: 3,
      max_per_customer: 2,
      pickup_start: "2026-10-11T17:00:00-04:00",
      pickup_end: "2026-10-11T18:00:00-04:00",
      allergens: ["wheat", "milk", "egg"],
      note: "Baked this morning.",
      status: "draft",
      photo_url: null,
      published_at: null,
      unsold_action: "none",
    });
    expect(res.body.id).not.toBe("d_mine");
  });

  it("normalizes times to the New York offset", async () => {
    const { cookie } = await newMerchant();
    const res = await api.createDeal(cookie, dealBody({ pickup_end: "2026-10-11T22:00:00Z" }));
    expect(res.body.pickup_end).toBe("2026-10-11T18:00:00-04:00");
  });

  it("defaults kind with the agent rule: surplus near closes_at, timed otherwise", async () => {
    const { cookie } = await newMerchant(); // closes 18:00
    const { kind: _k, ...withoutKind } = dealBody();
    void _k;
    expect((await api.createDeal(cookie, withoutKind)).body.kind).toBe("surplus");
    // 16:30 is 90 min before closing: still surplus.
    const near = await api.createDeal(cookie, {
      ...withoutKind,
      pickup_start: "2026-10-11T16:00:00-04:00",
      pickup_end: "2026-10-11T16:30:00-04:00",
    });
    expect(near.body.kind).toBe("surplus");
    const late = await newMerchant({ closes_at: "23:00" });
    const lunch = await api.createDeal(late.cookie, {
      ...withoutKind,
      pickup_start: "2026-10-11T16:00:00-04:00",
      pickup_end: "2026-10-11T16:30:00-04:00",
    });
    expect(lunch.body.kind).toBe("timed");
  });

  it.each([
    ["deal price equal to the regular price", { deal_price_cents: 800 }],
    ["deal price above the regular price", { deal_price_cents: 900 }],
    ["quantity_total 0", { quantity_total: 0 }],
    ["quantity_total not an integer", { quantity_total: 1.5 }],
    ["price not integer cents", { deal_price_cents: 3.99 }],
    ["negative price", { original_price_cents: -100 }],
    ["zero price", { deal_price_cents: 0 }],
    ["pickup_end in the past", { pickup_start: "2026-10-11T15:00:00-04:00", pickup_end: "2026-10-11T15:30:00-04:00" }],
    ["pickup_end equal to now", { pickup_start: "2026-10-11T15:00:00-04:00", pickup_end: "2026-10-11T16:00:00-04:00" }],
    ["pickup_end before pickup_start", { pickup_start: "2026-10-11T17:30:00-04:00", pickup_end: "2026-10-11T17:00:00-04:00" }],
    ["pickup_end equal to pickup_start", { pickup_start: "2026-10-11T17:00:00-04:00", pickup_end: "2026-10-11T17:00:00-04:00" }],
    ["time without offset", { pickup_end: "2026-10-11T18:00:00" }],
    ["unknown kind", { kind: "flash" }],
    ["allergens not a list", { allergens: "wheat" }],
    ["empty allergen name", { allergens: ["wheat", " "] }],
    ["empty items", { items: [] }],
    ["item qty 0", { items: [{ name: "Croissant", qty: 0 }] }],
    ["max_per_customer 0", { max_per_customer: 0 }],
    ["empty title", { title: "  " }],
  ])("rejects %s with 422 VALIDATION", async (_label, override) => {
    const { cookie } = await newMerchant();
    expectError(await api.createDeal(cookie, dealBody(override)), 422, "VALIDATION");
  });

  it("requires a title", async () => {
    const { cookie } = await newMerchant();
    expectError(await api.createDeal(cookie, { deal_price_cents: 100 }), 422, "VALIDATION");
  });

  it.each([
    ["before 1883, when New York used local mean time", "1800-01-01T00:00:00Z"],
    ["in year 1", "0001-01-01T00:00:00Z"],
    ["that is past year 9999 in New York", "9999-12-31T23:59:59-14:00"],
    ["before 2000", "1999-12-31T23:59:59Z"],
    ["from 2100 on", "2100-01-01T00:00:00Z"],
  ])("rejects a pickup time %s with 422 and saves nothing", async (_label, value) => {
    const { cookie, merchant } = await newMerchant();
    const start = await api.createDeal(cookie, { title: "Croissant", pickup_start: value });
    expectError(start, 422, "VALIDATION");
    expect(start.body.error.message).toBe("pickup_start: Must be a time between 2000 and 2099.");
    expectError(await api.createDeal(cookie, dealBody({ pickup_end: value })), 422, "VALIDATION");
    const draft = (await api.createDeal(cookie, dealBody())).body;
    expectError(await api.patchDeal(cookie, draft.id, { pickup_end: value }), 422, "VALIDATION");
    expectError(await api.patchDeal(cookie, draft.id, { pickup_start: value }), 422, "VALIDATION");
    const list = await api.merchantDeals(cookie, merchant.id);
    expect(list.status).toBe(200);
    expect(list.body.deals.map((d: { id: string }) => d.id)).toEqual([draft.id]);
  });
});

describe("PATCH /deals/{id} while draft", () => {
  it("edits draft fields and keeps quantity_left equal to quantity_total", async () => {
    const { cookie } = await newMerchant();
    const draft = (await api.createDeal(cookie, { title: "Muffin" })).body;
    const res = await api.patchDeal(cookie, draft.id, {
      title: "Blueberry muffin",
      items: [{ name: "Blueberry muffin", qty: 1 }],
      original_price_cents: 350,
      deal_price_cents: 175,
      kind: "timed",
      quantity_total: 4,
      max_per_customer: 1,
      pickup_start: "2026-10-11T16:30:00-04:00",
      pickup_end: "2026-10-11T17:30:00-04:00",
      allergens: [],
      note: "Fresh",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: "Blueberry muffin",
      original_price_cents: 350,
      deal_price_cents: 175,
      kind: "timed",
      quantity_total: 4,
      quantity_left: 4,
      max_per_customer: 1,
      allergens: [],
      note: "Fresh",
      status: "draft",
    });
    // Back to "not answered", and clearing the note.
    const cleared = await api.patchDeal(cookie, draft.id, { allergens: null, note: "", quantity_total: null });
    expect(cleared.body).toMatchObject({ allergens: null, note: null, quantity_total: null, quantity_left: null });
  });

  it("checks the price rule against the stored price", async () => {
    const { cookie } = await newMerchant();
    const draft = (await api.createDeal(cookie, dealBody())).body; // 800 / 400
    expectError(await api.patchDeal(cookie, draft.id, { deal_price_cents: 800 }), 422, "VALIDATION");
    expectError(await api.patchDeal(cookie, draft.id, { original_price_cents: 400 }), 422, "VALIDATION");
    expect((await api.patchDeal(cookie, draft.id, { original_price_cents: 500 })).status).toBe(200);
  });

  it("checks pickup times against the stored window", async () => {
    const { cookie } = await newMerchant();
    const draft = (await api.createDeal(cookie, dealBody())).body; // 17:00-18:00
    expectError(await api.patchDeal(cookie, draft.id, { pickup_start: "2026-10-11T18:30:00-04:00" }), 422, "VALIDATION");
    expectError(await api.patchDeal(cookie, draft.id, { pickup_end: "2026-10-11T15:00:00-04:00" }), 422, "VALIDATION");
    expectError(await api.patchDeal(cookie, draft.id, { pickup_end: "2026-10-11T16:30:00-04:00" }), 422, "VALIDATION");
    expect((await api.patchDeal(cookie, draft.id, { pickup_end: "2026-10-11T19:00:00-04:00" })).status).toBe(200);
  });

  it("returns 404 for another merchant's deal or an unknown id", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const draft = (await api.createDeal(a.cookie, dealBody())).body;
    expectError(await api.patchDeal(b.cookie, draft.id, { title: "Mine now" }), 404, "NOT_FOUND");
    expectError(await api.publishDeal(b.cookie, draft.id), 404, "NOT_FOUND");
    expectError(await api.cancelDeal(b.cookie, draft.id), 404, "NOT_FOUND");
    expectError(await api.markDonated(b.cookie, draft.id), 404, "NOT_FOUND");
    expectError(await api.patchDeal(a.cookie, "d_unknown", { title: "x" }), 404, "NOT_FOUND");
  });
});

describe("POST /deals/{id}/publish", () => {
  it("draft -> live: sets published_at and quantity_left", async () => {
    const { cookie } = await newMerchant();
    const draft = (await api.createDeal(cookie, dealBody())).body;
    advanceNow(4);
    const res = await api.publishDeal(cookie, draft.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "live",
      published_at: "2026-10-11T16:04:00-04:00",
      created_at: "2026-10-11T16:00:00-04:00",
      quantity_total: 3,
      quantity_left: 3,
    });
  });

  it("is blocked while required fields are null, and names them", async () => {
    const { cookie } = await newMerchant();
    const draft = (await api.createDeal(cookie, { title: "Soup" })).body;
    const res = await api.publishDeal(cookie, draft.id);
    expectError(res, 422, "VALIDATION");
    expect(res.body.error.message).toBe(
      "Fill in before publishing: regular price, deal price, quantity, pickup end time, allergens.",
    );
  });

  it("allergens null blocks publish; [] (none) is allowed", async () => {
    const { cookie } = await newMerchant();
    const draft = (await api.createDeal(cookie, dealBody({ allergens: null }))).body;
    const blocked = await api.publishDeal(cookie, draft.id);
    expectError(blocked, 422, "VALIDATION");
    expect(blocked.body.error.message).toContain("allergens");
    await api.patchDeal(cookie, draft.id, { allergens: [] });
    const published = await api.publishDeal(cookie, draft.id);
    expect(published.status).toBe(200);
    expect(published.body.allergens).toEqual([]);
  });

  it("rechecks pickup_end > now at publish time", async () => {
    const { cookie } = await newMerchant();
    const draft = (await api.createDeal(cookie, dealBody())).body;
    advanceNow(120); // 18:00 = pickup_end
    expectError(await api.publishDeal(cookie, draft.id), 422, "VALIDATION");
  });

  it("only a draft can be published", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    expectError(await api.publishDeal(cookie, deal.id), 422, "VALIDATION");
    const draft = (await api.createDeal(cookie, dealBody())).body;
    await api.cancelDeal(cookie, draft.id);
    expectError(await api.publishDeal(cookie, draft.id), 422, "VALIDATION");
  });

  it("PLAN_GATE=1 returns 402 PLAN_REQUIRED when plan_status is none", async () => {
    const { cookie, merchant } = await newMerchant();
    const draft = (await api.createDeal(cookie, dealBody())).body;
    process.env.PLAN_GATE = "1";
    expectError(await api.publishDeal(cookie, draft.id), 402, "PLAN_REQUIRED");
    expect((await api.getDeal(draft.id, cookie)).body.status).toBe("draft");
    await store().updateMerchant(merchant.id, { plan_status: "active" });
    expect((await api.publishDeal(cookie, draft.id)).status).toBe(200);
  });

  it("the plan gate is off by default", async () => {
    const { cookie } = await newMerchant();
    const draft = (await api.createDeal(cookie, dealBody())).body;
    expect((await api.publishDeal(cookie, draft.id)).status).toBe(200);
  });
});

describe("PATCH /deals/{id} while live", () => {
  it("lowers the price; existing reservations keep unit_price_cents", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 5 });
    const { token } = await newCustomer();
    const before = await reserveOk(token, deal.id, 2);
    expect(before).toMatchObject({ unit_price_cents: 400, total_cents: 800 });

    const lowered = await api.patchDeal(cookie, deal.id, { deal_price_cents: 300 });
    expect(lowered.status).toBe(200);
    expect(lowered.body.deal_price_cents).toBe(300);

    const kept = await api.getReservation(token, before.id);
    expect(kept.body).toMatchObject({ unit_price_cents: 400, total_cents: 800 });
    expect(kept.body.deal.deal_price_cents).toBe(300);

    const { token: other } = await newCustomer();
    const after = await reserveOk(other, deal.id, 2);
    expect(after).toMatchObject({ unit_price_cents: 300, total_cents: 600 });
  });

  it("rejects raising the price; the same price is a no-op", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    expectError(await api.patchDeal(cookie, deal.id, { deal_price_cents: 450 }), 422, "VALIDATION");
    const same = await api.patchDeal(cookie, deal.id, { deal_price_cents: 400 });
    expect(same.status).toBe(200);
    expect(same.body.deal_price_cents).toBe(400);
    expectError(await api.patchDeal(cookie, deal.id, { deal_price_cents: null }), 422, "VALIDATION");
  });

  it("quantity_total cannot go below the reserved units; changes move quantity_left", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 4 });
    const { token } = await newCustomer();
    await reserveOk(token, deal.id, 2);
    expectError(await api.patchDeal(cookie, deal.id, { quantity_total: 1 }), 422, "VALIDATION");
    const down = await api.patchDeal(cookie, deal.id, { quantity_total: 2 });
    expect(down.body).toMatchObject({ quantity_total: 2, quantity_left: 0, status: "sold_out" });
    const up = await api.patchDeal(cookie, deal.id, { quantity_total: 6 });
    expect(up.body).toMatchObject({ quantity_total: 6, quantity_left: 4, status: "live" });
    expectError(await api.patchDeal(cookie, deal.id, { quantity_total: null }), 422, "VALIDATION");
  });

  it("changes pickup_end (in the future, after pickup_start) and note", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const res = await api.patchDeal(cookie, deal.id, { pickup_end: "2026-10-11T19:00:00-04:00", note: "Last batch." });
    expect(res.body).toMatchObject({ pickup_end: "2026-10-11T19:00:00-04:00", note: "Last batch." });
    expectError(await api.patchDeal(cookie, deal.id, { pickup_end: "2026-10-11T15:59:00-04:00" }), 422, "VALIDATION");
    expectError(await api.patchDeal(cookie, deal.id, { pickup_end: "2026-10-11T16:59:00-04:00" }), 422, "VALIDATION");
    expectError(await api.patchDeal(cookie, deal.id, { pickup_end: null }), 422, "VALIDATION");
  });

  it.each([
    ["title", { title: "Something else" }],
    ["items", { items: [{ name: "Other", qty: 1 }] }],
    ["original_price_cents", { original_price_cents: 900 }],
    ["kind", { kind: "timed" }],
    ["max_per_customer", { max_per_customer: 5 }],
    ["pickup_start", { pickup_start: "2026-10-11T16:30:00-04:00" }],
    ["allergens", { allergens: [] }],
  ])("rejects a change to %s after publish", async (_field, patch) => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    expectError(await api.patchDeal(cookie, deal.id, patch), 422, "VALIDATION");
  });

  it("accepts the whole form echoed back unchanged with a live change", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const res = await api.patchDeal(cookie, deal.id, { ...dealBody(), pickup_start: "2026-10-11T21:00:00Z", deal_price_cents: 350 });
    expect(res.status).toBe(200);
    expect(res.body.deal_price_cents).toBe(350);
  });

  it("treats echoed items with a different key order as unchanged", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const res = await api.patchDeal(cookie, deal.id, { items: [{ qty: 2, name: "Butter croissant" }], note: "x" });
    expect(res.status).toBe(200);
  });

  it("an ended deal cannot be edited (409 DEAL_NOT_LIVE)", async () => {
    const { cookie } = await newMerchant();
    const expired = await liveDeal(cookie);
    const cancelled = await liveDeal(cookie);
    await api.cancelDeal(cookie, cancelled.id);
    expectError(await api.patchDeal(cookie, cancelled.id, { note: "x" }), 409, "DEAL_NOT_LIVE");
    setNow("2026-10-11T18:00:00-04:00");
    expectError(await api.patchDeal(cookie, expired.id, { note: "x" }), 409, "DEAL_NOT_LIVE");
  });
});

describe("deal status transitions", () => {
  it("live -> sold_out when quantity_left hits 0, back to live when a cancel frees a unit", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 2 });
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id, 2);
    expect((await api.getDeal(deal.id)).body).toMatchObject({ status: "sold_out", quantity_left: 0 });
    // sold_out deals stay in the list.
    expect((await api.listDeals()).body.deals.map((d: { id: string }) => d.id)).toContain(deal.id);
    await api.cancelReservation(token, r.id);
    expect((await api.getDeal(deal.id)).body).toMatchObject({ status: "live", quantity_left: 2 });
  });

  it("live / sold_out -> expired at pickup_end, derived on read", async () => {
    const { cookie } = await newMerchant();
    const live = await liveDeal(cookie);
    const soldOut = await liveDeal(cookie, { quantity_total: 1 });
    const { token } = await newCustomer();
    await reserveOk(token, soldOut.id, 1);
    setNow("2026-10-11T17:59:59-04:00");
    expect((await api.getDeal(live.id)).body.status).toBe("live");
    setNow("2026-10-11T18:00:00-04:00");
    expect((await api.getDeal(live.id)).body.status).toBe("expired");
    expect((await api.getDeal(soldOut.id)).body.status).toBe("expired");
    expect((await api.listDeals()).body.deals).toEqual([]);
  });

  it("draft / live / sold_out -> cancelled; open reservations become cancelled", async () => {
    const { cookie } = await newMerchant();
    const draft = (await api.createDeal(cookie, dealBody())).body;
    expect((await api.cancelDeal(cookie, draft.id)).body.status).toBe("cancelled");

    const live = await liveDeal(cookie, { quantity_total: 3 });
    const { token } = await newCustomer();
    const r = await reserveOk(token, live.id, 1);
    const cancelled = await api.cancelDeal(cookie, live.id);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect((await api.getReservation(token, r.id)).body.status).toBe("cancelled");

    const soldOut = await liveDeal(cookie, { quantity_total: 1 });
    await reserveOk(token, soldOut.id, 1);
    expect((await api.cancelDeal(cookie, soldOut.id)).body.status).toBe("cancelled");
  });

  it("cancelling a cancelled or expired deal is 409 DEAL_NOT_LIVE", async () => {
    const { cookie } = await newMerchant();
    const a = await liveDeal(cookie);
    await api.cancelDeal(cookie, a.id);
    expectError(await api.cancelDeal(cookie, a.id), 409, "DEAL_NOT_LIVE");
    const b = await liveDeal(cookie);
    setNow("2026-10-11T18:00:00-04:00");
    expectError(await api.cancelDeal(cookie, b.id), 409, "DEAL_NOT_LIVE");
  });

  it("a cancelled deal keeps its picked-up reservations", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 3 });
    const { token } = await newCustomer();
    const picked = await reserveOk(token, deal.id, 1);
    setNow("2026-10-11T17:10:00-04:00");
    await api.redeem(cookie, { pickup_code: picked.pickup_code });
    await api.cancelDeal(cookie, deal.id);
    expect((await api.getReservation(token, picked.id)).body.status).toBe("picked_up");
  });
});

describe("POST /deals/{id}/mark-donated", () => {
  it("only when expired with units left", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    expectError(await api.markDonated(cookie, deal.id), 422, "VALIDATION");
    setNow("2026-10-11T18:00:00-04:00");
    const res = await api.markDonated(cookie, deal.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "expired", unsold_action: "donated" });
    // Repeating it changes nothing.
    expect((await api.markDonated(cookie, deal.id)).body.unsold_action).toBe("donated");
  });

  it("counts no-shows as units left", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 1 });
    const { token } = await newCustomer();
    await reserveOk(token, deal.id, 1);
    setNow("2026-10-11T18:20:00-04:00");
    expect((await api.markDonated(cookie, deal.id)).body.unsold_action).toBe("donated");
  });

  it("is rejected when every unit was picked up", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 1 });
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id, 1);
    setNow("2026-10-11T17:30:00-04:00");
    await api.redeem(cookie, { pickup_code: r.pickup_code });
    setNow("2026-10-11T18:30:00-04:00");
    expectError(await api.markDonated(cookie, deal.id), 422, "VALIDATION");
  });

  it("is rejected for drafts and cancelled deals", async () => {
    const { cookie } = await newMerchant();
    const draft = (await api.createDeal(cookie, dealBody())).body;
    expectError(await api.markDonated(cookie, draft.id), 422, "VALIDATION");
    await api.cancelDeal(cookie, draft.id);
    setNow("2026-10-11T18:30:00-04:00");
    expectError(await api.markDonated(cookie, draft.id), 422, "VALIDATION");
  });
});

describe("GET /deals (consumer)", () => {
  it("lists live and sold_out deals only, soonest pickup_end first", async () => {
    const { cookie } = await newMerchant();
    const later = await liveDeal(cookie, { pickup_end: "2026-10-11T19:00:00-04:00" });
    const sooner = await liveDeal(cookie, { pickup_end: "2026-10-11T17:30:00-04:00" });
    const soldOut = await liveDeal(cookie, { quantity_total: 1, pickup_end: "2026-10-11T18:30:00-04:00" });
    const { token } = await newCustomer();
    await reserveOk(token, soldOut.id, 1);
    await api.createDeal(cookie, dealBody()); // draft
    const cancelled = await liveDeal(cookie);
    await api.cancelDeal(cookie, cancelled.id);

    const res = await api.listDeals();
    expect(res.status).toBe(200);
    expect(res.body.deals.map((d: { id: string }) => d.id)).toEqual([sooner.id, soldOut.id, later.id]);
    expect(res.body.deals.map((d: { status: string }) => d.status)).toEqual(["live", "sold_out", "live"]);
    expect(res.body.deals.every((d: { distance_m: unknown }) => d.distance_m === null)).toBe(true);
  });

  it("filters by category and kind; empty values are ignored; bad values are 422", async () => {
    const bakery = await newMerchant({ category: "bakery" });
    const cafe = await newMerchant({ category: "cafe" });
    const b = await liveDeal(bakery.cookie, { kind: "surplus" });
    const c = await liveDeal(cafe.cookie, { kind: "timed" });
    const ids = async (q: Record<string, string>) =>
      (await api.listDeals(q)).body.deals.map((d: { id: string }) => d.id).sort();
    expect(await ids({ category: "cafe" })).toEqual([c.id]);
    expect(await ids({ kind: "surplus" })).toEqual([b.id]);
    expect(await ids({ category: "bakery", kind: "timed" })).toEqual([]);
    expect(await ids({ category: "", kind: "", lat: "", lng: "", sort: "" })).toEqual([b.id, c.id].sort());
    expectError(await api.listDeals({ category: "bar" }), 422, "VALIDATION");
    expectError(await api.listDeals({ kind: "flash" }), 422, "VALIDATION");
    expectError(await api.listDeals({ sort: "price" }), 422, "VALIDATION");
  });

  it("sets distance_m with lat/lng and sorts by distance with unlocated merchants last", async () => {
    // Customer at Old Main, State College.
    const here = { lat: "40.7962", lng: "-77.8627" };
    const near = await newMerchant({ lat: 40.7934, lng: -77.86 });
    const far = await newMerchant({ lat: 40.8148, lng: -77.8564 });
    const unlocated = await newMerchant({ lat: undefined, lng: undefined });
    const dNear = await liveDeal(near.cookie, { pickup_end: "2026-10-11T19:00:00-04:00" });
    const dFar = await liveDeal(far.cookie, { pickup_end: "2026-10-11T17:30:00-04:00" });
    const dNone = await liveDeal(unlocated.cookie, { pickup_end: "2026-10-11T17:15:00-04:00" });

    const byDistance = (await api.listDeals({ ...here, sort: "distance" })).body.deals;
    expect(byDistance.map((d: { id: string }) => d.id)).toEqual([dNear.id, dFar.id, dNone.id]);
    expect(byDistance[0].distance_m).toBe(385);
    expect(Number.isInteger(byDistance[1].distance_m)).toBe(true);
    expect(byDistance[1].distance_m).toBeGreaterThan(2000);
    expect(byDistance[2].distance_m).toBeNull();

    // lat/lng with the default sort still sets distance_m.
    const byEnding = (await api.listDeals(here)).body.deals;
    expect(byEnding.map((d: { id: string }) => d.id)).toEqual([dNone.id, dFar.id, dNear.id]);
    expect(byEnding[2].distance_m).toBe(385);
  });

  it("sort=discount lists the biggest discount first, then soonest pickup_end", async () => {
    const { cookie } = await newMerchant();
    const forty = await liveDeal(cookie, { original_price_cents: 1000, deal_price_cents: 600, pickup_end: "2026-10-11T17:30:00-04:00" });
    const sixty = await liveDeal(cookie, { original_price_cents: 1000, deal_price_cents: 400, pickup_end: "2026-10-11T19:00:00-04:00" });
    const fiftyLate = await liveDeal(cookie, { original_price_cents: 800, deal_price_cents: 400, pickup_end: "2026-10-11T19:30:00-04:00" });
    const fiftySoon = await liveDeal(cookie, { original_price_cents: 600, deal_price_cents: 300, pickup_end: "2026-10-11T18:00:00-04:00" });
    const ids = (await api.listDeals({ sort: "discount" })).body.deals.map((d: { id: string }) => d.id);
    expect(ids).toEqual([sixty.id, fiftySoon.id, fiftyLate.id, forty.id]);
  });

  it("sort=distance needs lat and lng; lat/lng come together and in range", async () => {
    expectError(await api.listDeals({ sort: "distance" }), 422, "VALIDATION");
    expectError(await api.listDeals({ lat: "40.79" }), 422, "VALIDATION");
    expectError(await api.listDeals({ lat: "abc", lng: "-77.86" }), 422, "VALIDATION");
    expectError(await api.listDeals({ lat: "95", lng: "-77.86" }), 422, "VALIDATION");
  });
});

describe("GET /deals/{id}", () => {
  it("hides drafts from everyone but the owning merchant", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const draft = (await api.createDeal(a.cookie, dealBody())).body;
    expectError(await api.getDeal(draft.id), 404, "NOT_FOUND");
    expectError(await api.getDeal(draft.id, b.cookie), 404, "NOT_FOUND");
    expect((await api.getDeal(draft.id, a.cookie)).body.status).toBe("draft");
    expectError(await api.getDeal("d_unknown"), 404, "NOT_FOUND");
  });

  it("keeps a discarded draft (cancelled, never published) hidden from everyone but its merchant", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const draft = (await api.createDeal(a.cookie, dealBody({ title: "Secret draft" }))).body;
    expect((await api.cancelDeal(a.cookie, draft.id)).status).toBe(200);
    expectError(await api.getDeal(draft.id), 404, "NOT_FOUND");
    expectError(await api.getDeal(draft.id, b.cookie), 404, "NOT_FOUND");
    expect((await api.getDeal(draft.id, a.cookie)).body).toMatchObject({ status: "cancelled", published_at: null });
    const { token } = await newCustomer();
    expectError(await api.reserve(token, { deal_id: draft.id, quantity: 1 }), 404, "NOT_FOUND");
  });

  it("shows published deals in every status, distance_m null", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    await api.cancelDeal(cookie, deal.id);
    const res = await api.getDeal(deal.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "cancelled", distance_m: null });
  });
});

describe("GET /merchants/{id}/deals?date=", () => {
  it("lists every status for the business date, today by default", async () => {
    const { cookie, merchant } = await newMerchant();
    const draft = (await api.createDeal(cookie, dealBody())).body;
    const live = await liveDeal(cookie);
    const res = await api.merchantDeals(cookie, merchant.id);
    expect(res.status).toBe(200);
    expect(res.body.deals.map((d: { id: string }) => d.id).sort()).toEqual([draft.id, live.id].sort());

    setNow("2026-10-12T09:00:00-04:00");
    const tomorrow = (await api.createDeal(cookie, dealBody({
      pickup_start: "2026-10-12T10:00:00-04:00",
      pickup_end: "2026-10-12T11:00:00-04:00",
    }))).body;
    expect((await api.merchantDeals(cookie, merchant.id)).body.deals.map((d: { id: string }) => d.id)).toEqual([tomorrow.id]);
    const yesterday = (await api.merchantDeals(cookie, merchant.id, { date: DATE })).body.deals;
    expect(yesterday.map((d: { status: string }) => d.status).sort()).toEqual(["draft", "expired"]);
  });
});
