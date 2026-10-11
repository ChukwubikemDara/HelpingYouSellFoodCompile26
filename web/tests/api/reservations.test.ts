import { afterEach, describe, expect, it, vi } from "vitest";
import { setNow } from "@/lib/clock";
import * as billing from "@/lib/services/billing";
import {
  api,
  dealBody,
  expectError,
  liveDeal,
  newCustomer,
  newMerchant,
  reserveOk,
  withFreshApi,
} from "./helpers";

withFreshApi();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /reservations", () => {
  it("reserves (201): price snapshot, total, 4-digit code, name and phone from the account", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 3 });
    const { token, customer } = await newCustomer("Sam");
    const res = await api.reserve(token, { deal_id: deal.id, quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^r_/),
      deal_id: deal.id,
      deal: expect.objectContaining({ id: deal.id, quantity_left: 1, status: "live", distance_m: null }),
      customer_id: customer.id,
      customer_name: "Sam",
      customer_phone: customer.phone,
      quantity: 2,
      unit_price_cents: 400,
      total_cents: 800,
      payment_method: "in_store",
      pickup_code: expect.stringMatching(/^\d{4}$/),
      status: "reserved",
      created_at: "2026-10-11T16:00:00-04:00",
    });
    expect((await api.getDeal(deal.id)).body.quantity_left).toBe(1);
  });

  it("validates the body", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const { token } = await newCustomer();
    expectError(await api.reserve(token, { deal_id: deal.id, quantity: 0 }), 422, "VALIDATION");
    expectError(await api.reserve(token, { deal_id: deal.id, quantity: 1.5 }), 422, "VALIDATION");
    expectError(await api.reserve(token, { deal_id: deal.id }), 422, "VALIDATION");
    expectError(await api.reserve(token, { quantity: 1 }), 422, "VALIDATION");
    // name and phone in the body are ignored (they come from the account).
    const r = await api.reserve(token, { deal_id: deal.id, quantity: 1, customer_name: "Mallory" });
    expect(r.body.customer_name).toBe("Sam");
  });

  it("quantity must be <= quantity_left (409 SOLD_OUT) and <= max_per_customer (422)", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 3, max_per_customer: 2 });
    const { token } = await newCustomer();
    expectError(await api.reserve(token, { deal_id: deal.id, quantity: 3 }), 422, "VALIDATION");
    const other = await newCustomer();
    await reserveOk(other.token, deal.id, 2);
    const tooMany = await api.reserve(token, { deal_id: deal.id, quantity: 2 });
    expectError(tooMany, 409, "SOLD_OUT");
    expect(tooMany.body.error.message).toBe("Only 1 left.");
  });

  it("max_per_customer counts reserved and picked-up units across reservations, not cancelled ones", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 10, max_per_customer: 2 });
    const { token } = await newCustomer();
    const first = await reserveOk(token, deal.id, 1);
    await reserveOk(token, deal.id, 1);
    expectError(await api.reserve(token, { deal_id: deal.id, quantity: 1 }), 422, "VALIDATION");
    await api.cancelReservation(token, first.id);
    expect((await api.reserve(token, { deal_id: deal.id, quantity: 1 })).status).toBe(201);
    // Another customer has their own limit.
    const other = await newCustomer();
    expect((await api.reserve(other.token, { deal_id: deal.id, quantity: 2 })).status).toBe(201);
  });

  it("max_per_customer counts picked-up units", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 10, max_per_customer: 2 });
    const { token } = await newCustomer();
    const first = await reserveOk(token, deal.id, 1);
    setNow("2026-10-11T17:05:00-04:00");
    expect((await api.confirmPickup(token, first.id)).body.status).toBe("picked_up");
    expectError(await api.reserve(token, { deal_id: deal.id, quantity: 2 }), 422, "VALIDATION");
    expect((await api.reserve(token, { deal_id: deal.id, quantity: 1 })).status).toBe(201);
    expectError(await api.reserve(token, { deal_id: deal.id, quantity: 1 }), 422, "VALIDATION");
  });

  it("sold_out -> 409 SOLD_OUT; cancelled or expired -> 409 DEAL_NOT_LIVE; draft or unknown -> 404", async () => {
    const { cookie } = await newMerchant();
    const { token } = await newCustomer();
    const one = await liveDeal(cookie, { quantity_total: 1 });
    await reserveOk((await newCustomer()).token, one.id, 1);
    const soldOut = await api.reserve(token, { deal_id: one.id, quantity: 1 });
    expectError(soldOut, 409, "SOLD_OUT");
    expect(soldOut.body.error.message).toBe("This deal is sold out.");

    const cancelled = await liveDeal(cookie);
    await api.cancelDeal(cookie, cancelled.id);
    expectError(await api.reserve(token, { deal_id: cancelled.id, quantity: 1 }), 409, "DEAL_NOT_LIVE");

    const draft = (await api.createDeal(cookie, dealBody())).body;
    expectError(await api.reserve(token, { deal_id: draft.id, quantity: 1 }), 404, "NOT_FOUND");
    expectError(await api.reserve(token, { deal_id: "d_unknown", quantity: 1 }), 404, "NOT_FOUND");

    const expiring = await liveDeal(cookie);
    setNow("2026-10-11T18:00:00-04:00");
    expectError(await api.reserve(token, { deal_id: expiring.id, quantity: 1 }), 409, "DEAL_NOT_LIVE");
  });

  it("can reserve from publish until pickup_end, also before pickup_start", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie); // pickup 17:00-18:00, now 16:00
    const { token } = await newCustomer();
    expect((await api.reserve(token, { deal_id: deal.id, quantity: 1 })).status).toBe(201);
    setNow("2026-10-11T17:59:59-04:00");
    expect((await api.reserve(token, { deal_id: deal.id, quantity: 1 })).status).toBe(201);
  });

  it("race for the last unit: exactly one 201 and one 409 SOLD_OUT", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 1 });
    const a = await newCustomer();
    const b = await newCustomer();
    const results = await Promise.all([
      api.reserve(a.token, { deal_id: deal.id, quantity: 1 }),
      api.reserve(b.token, { deal_id: deal.id, quantity: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe("SOLD_OUT");
    expect((await api.getDeal(deal.id)).body).toMatchObject({ quantity_left: 0, status: "sold_out" });
  });

  it("never oversells under many concurrent reserves", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 3, max_per_customer: 1 });
    const customers = await Promise.all(Array.from({ length: 8 }, () => newCustomer()));
    const results = await Promise.all(
      customers.map((c) => api.reserve(c.token, { deal_id: deal.id, quantity: 1 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409 && r.body.error.code === "SOLD_OUT")).toHaveLength(5);
    expect((await api.getDeal(deal.id)).body.quantity_left).toBe(0);
  });

  it("gives every open reservation of a merchant a different code", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 60, max_per_customer: 1 });
    const customers = await Promise.all(Array.from({ length: 40 }, () => newCustomer()));
    const codes = await Promise.all(customers.map(async (c) => (await reserveOk(c.token, deal.id, 1)).pickup_code));
    expect(new Set(codes).size).toBe(40);
  });
});

describe("no-shows and blocked customers", () => {
  it("reserved -> no_show at pickup_end + 15 min, counted on the customer", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id);
    setNow("2026-10-11T18:14:59-04:00");
    expect((await api.getReservation(token, r.id)).body.status).toBe("reserved");
    expect((await api.customersMe(token)).body).toMatchObject({ no_show_count: 0, blocked: false });
    setNow("2026-10-11T18:15:00-04:00");
    expect((await api.getReservation(token, r.id)).body.status).toBe("no_show");
    expect((await api.customersMe(token)).body).toMatchObject({ no_show_count: 1, blocked: false });
  });

  it("blocked once no_show_count reaches 2: 403 CUSTOMER_BLOCKED on reserve", async () => {
    const { cookie } = await newMerchant();
    const a = await liveDeal(cookie);
    const b = await liveDeal(cookie);
    const { token, phone, password } = await newCustomer();
    await reserveOk(token, a.id);
    await reserveOk(token, b.id);
    setNow("2026-10-11T18:20:00-04:00");
    expect((await api.customersMe(token)).body).toMatchObject({ no_show_count: 2, blocked: true });
    expect((await api.customerSignin({ phone, password })).body.customer.blocked).toBe(true);
    const later = await liveDeal(cookie, {
      pickup_start: "2026-10-11T19:00:00-04:00",
      pickup_end: "2026-10-11T20:00:00-04:00",
    });
    expectError(await api.reserve(token, { deal_id: later.id, quantity: 1 }), 403, "CUSTOMER_BLOCKED");
    // Another customer can still reserve.
    expect((await api.reserve((await newCustomer()).token, { deal_id: later.id, quantity: 1 })).status).toBe(201);
  });

  it("one no-show does not block; picked-up and cancelled reservations never count", async () => {
    const { cookie } = await newMerchant();
    const a = await liveDeal(cookie);
    const b = await liveDeal(cookie);
    const c = await liveDeal(cookie);
    const { token } = await newCustomer();
    await reserveOk(token, a.id);
    const cancelled = await reserveOk(token, b.id);
    await api.cancelReservation(token, cancelled.id);
    const picked = await reserveOk(token, c.id);
    setNow("2026-10-11T17:30:00-04:00");
    await api.confirmPickup(token, picked.id);
    setNow("2026-10-11T18:30:00-04:00");
    expect((await api.customersMe(token)).body).toMatchObject({ no_show_count: 1, blocked: false });
  });
});

describe("customer reservation reads", () => {
  it("lists the customer's reservations newest first, with derived statuses", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 5 });
    const { token } = await newCustomer();
    const first = await reserveOk(token, deal.id);
    setNow("2026-10-11T16:05:00-04:00");
    const second = await reserveOk(token, deal.id);
    await reserveOk((await newCustomer()).token, deal.id);
    const res = await api.listReservations(token);
    expect(res.status).toBe(200);
    expect(res.body.reservations.map((r: { id: string }) => r.id)).toEqual([second.id, first.id]);
  });

  it("returns 404 for another customer's reservation (get, cancel, confirm-pickup)", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const owner = await newCustomer();
    const other = await newCustomer();
    const r = await reserveOk(owner.token, deal.id);
    expectError(await api.getReservation(other.token, r.id), 404, "NOT_FOUND");
    expectError(await api.cancelReservation(other.token, r.id), 404, "NOT_FOUND");
    setNow("2026-10-11T17:10:00-04:00");
    expectError(await api.confirmPickup(other.token, r.id), 404, "NOT_FOUND");
    expectError(await api.getReservation(owner.token, "r_unknown"), 404, "NOT_FOUND");
    expect((await api.getReservation(owner.token, r.id)).body.status).toBe("reserved");
  });
});

describe("POST /reservations/{id}/cancel", () => {
  it("reserved -> cancelled before pickup_end; units go back", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 3 });
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id, 2);
    setNow("2026-10-11T17:59:59-04:00");
    const res = await api.cancelReservation(token, r.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect(res.body.deal.quantity_left).toBe(3);
  });

  it("is rejected from pickup_end on, and for cancelled or picked-up reservations", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 5 });
    const { token } = await newCustomer();
    const late = await reserveOk(token, deal.id);
    const twice = await reserveOk(token, deal.id);
    await api.cancelReservation(token, twice.id);
    expectError(await api.cancelReservation(token, twice.id), 422, "VALIDATION");

    const other = await newCustomer();
    const picked = await reserveOk(other.token, deal.id);
    setNow("2026-10-11T17:10:00-04:00");
    await api.confirmPickup(other.token, picked.id);
    expectError(await api.cancelReservation(other.token, picked.id), 422, "VALIDATION");

    setNow("2026-10-11T18:00:00-04:00");
    expectError(await api.cancelReservation(token, late.id), 422, "VALIDATION");
    expect((await api.getReservation(token, late.id)).body.status).toBe("reserved");
  });
});

describe("pickup: confirm-pickup (customer) and redeem (merchant)", () => {
  it("confirm-pickup works only between pickup_start and pickup_end", async () => {
    const usage = vi.spyOn(billing, "recordPickupUsage");
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 3 });
    const { token } = await newCustomer();
    const early = await reserveOk(token, deal.id);
    setNow("2026-10-11T16:59:59-04:00");
    expectError(await api.confirmPickup(token, early.id), 422, "VALIDATION");
    setNow("2026-10-11T17:00:00-04:00");
    const res = await api.confirmPickup(token, early.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("picked_up");
    expect(usage).toHaveBeenCalledTimes(1);

    const other = await newCustomer();
    const atEnd = await reserveOk(other.token, deal.id);
    setNow("2026-10-11T18:00:00-04:00");
    expect((await api.confirmPickup(other.token, atEnd.id)).body.status).toBe("picked_up");
    expect(usage).toHaveBeenCalledTimes(2);
  });

  it("confirm-pickup after the window (also a no-show) is 422; picked_up again is 409; cancelled is 422", async () => {
    const usage = vi.spyOn(billing, "recordPickupUsage");
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 5 });
    const { token } = await newCustomer();
    const late = await reserveOk(token, deal.id);
    const cancelled = await reserveOk(token, deal.id);
    await api.cancelReservation(token, cancelled.id);
    const other = await newCustomer();
    const picked = await reserveOk(other.token, deal.id);
    setNow("2026-10-11T17:30:00-04:00");
    await api.confirmPickup(other.token, picked.id);
    expectError(await api.confirmPickup(other.token, picked.id), 409, "CODE_ALREADY_USED");
    expectError(await api.confirmPickup(token, cancelled.id), 422, "VALIDATION");
    setNow("2026-10-11T18:00:01-04:00");
    expectError(await api.confirmPickup(token, late.id), 422, "VALIDATION");
    setNow("2026-10-11T18:30:00-04:00");
    expectError(await api.confirmPickup(token, late.id), 422, "VALIDATION");
    expect((await api.getReservation(token, late.id)).body.status).toBe("no_show");
    expect(usage).toHaveBeenCalledTimes(1);
  });

  it("redeem marks the reservation picked up; the same code again is 409 CODE_ALREADY_USED", async () => {
    const usage = vi.spyOn(billing, "recordPickupUsage");
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id, 2);
    setNow("2026-10-11T17:15:00-04:00");
    const res = await api.redeem(cookie, { pickup_code: r.pickup_code });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: r.id, status: "picked_up", quantity: 2, total_cents: 800 });
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage.mock.calls[0][0]).toMatchObject({ id: r.id, status: "picked_up" });
    expectError(await api.redeem(cookie, { pickup_code: r.pickup_code }), 409, "CODE_ALREADY_USED");
    expect((await api.getReservation(token, r.id)).body.status).toBe("picked_up");
    // Either path is enough: the customer's confirm after a redeem is 409 too.
    expectError(await api.confirmPickup(token, r.id), 409, "CODE_ALREADY_USED");
    expect(usage).toHaveBeenCalledTimes(1);
  });

  it("CODE_INVALID for unknown, malformed, cancelled and other merchants' codes", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    const dealA = await liveDeal(a.cookie, { quantity_total: 5 });
    const { token } = await newCustomer();
    const r = await reserveOk(token, dealA.id);
    const cancelled = await reserveOk(token, dealA.id);
    await api.cancelReservation(token, cancelled.id);
    setNow("2026-10-11T17:15:00-04:00");
    const unused = ["0000", "9999"].find((c) => c !== r.pickup_code && c !== cancelled.pickup_code) as string;
    expectError(await api.redeem(a.cookie, { pickup_code: unused }), 404, "CODE_INVALID");
    expectError(await api.redeem(a.cookie, { pickup_code: "12a4" }), 404, "CODE_INVALID");
    expectError(await api.redeem(a.cookie, { pickup_code: "123" }), 404, "CODE_INVALID");
    expectError(await api.redeem(a.cookie, {}), 422, "VALIDATION");
    if (cancelled.pickup_code !== r.pickup_code) {
      expectError(await api.redeem(a.cookie, { pickup_code: cancelled.pickup_code }), 404, "CODE_INVALID");
    }
    // Redeem is scoped to the signed-in merchant.
    expectError(await api.redeem(b.cookie, { pickup_code: r.pickup_code }), 404, "CODE_INVALID");
    expect((await api.redeem(a.cookie, { pickup_code: r.pickup_code })).status).toBe(200);
  });

  it("redeem outside the pickup window is 422 VALIDATION", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id);
    expectError(await api.redeem(cookie, { pickup_code: r.pickup_code }), 422, "VALIDATION"); // 16:00 < 17:00
    setNow("2026-10-11T18:05:00-04:00");
    expectError(await api.redeem(cookie, { pickup_code: r.pickup_code }), 422, "VALIDATION");
    setNow("2026-10-11T18:20:00-04:00"); // no_show
    expectError(await api.redeem(cookie, { pickup_code: r.pickup_code }), 422, "VALIDATION");
  });

  it("a concurrent redeem and confirm-pickup: exactly one wins and usage is recorded once", async () => {
    const usage = vi.spyOn(billing, "recordPickupUsage");
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id);
    setNow("2026-10-11T17:15:00-04:00");
    const results = await Promise.all([
      api.redeem(cookie, { pickup_code: r.pickup_code }),
      api.confirmPickup(token, r.id),
    ]);
    expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    expect(results.filter((x) => x.status === 409 && x.body.error.code === "CODE_ALREADY_USED")).toHaveLength(1);
    expect(usage).toHaveBeenCalledTimes(1);
  });

  it("frees the code after pickup so it can be reused by a later reservation", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 5 });
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id);
    setNow("2026-10-11T17:15:00-04:00");
    await api.redeem(cookie, { pickup_code: r.pickup_code });
    // A redeem with the used code is "already used", not "invalid".
    expectError(await api.redeem(cookie, { pickup_code: r.pickup_code }), 409, "CODE_ALREADY_USED");
  });
});

describe("GET /merchants/{id}/reservations?date=", () => {
  it("lists the day's reservations with customer name, phone and deal", async () => {
    const { cookie, merchant } = await newMerchant();
    const other = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 5 });
    const otherDeal = await liveDeal(other.cookie);
    const { token, customer } = await newCustomer("Riley");
    const r = await reserveOk(token, deal.id, 2);
    await reserveOk(token, otherDeal.id);
    const res = await api.merchantReservations(cookie, merchant.id);
    expect(res.status).toBe(200);
    expect(res.body.reservations).toHaveLength(1);
    expect(res.body.reservations[0]).toMatchObject({
      id: r.id,
      customer_name: "Riley",
      customer_phone: customer.phone,
      quantity: 2,
      deal: { id: deal.id, title: "Croissants (2-pack)" },
    });
    expect((await api.merchantReservations(cookie, merchant.id, { date: "2026-10-10" })).body.reservations).toEqual([]);
    setNow("2026-10-11T18:15:00-04:00");
    expect((await api.merchantReservations(cookie, merchant.id)).body.reservations[0].status).toBe("no_show");
  });
});
