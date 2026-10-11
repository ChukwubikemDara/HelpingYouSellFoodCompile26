import { describe, expect, it } from "vitest";
import { setNow } from "@/lib/clock";
import { api, dealBody, liveDeal, newCustomer, newMerchant, reserveOk, withFreshApi } from "./helpers";

withFreshApi();

describe("GET /merchants/{id}/summary", () => {
  it("is all zeros for a day with no deals", async () => {
    const { cookie, merchant } = await newMerchant();
    const res = await api.summary(cookie, merchant.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: "2026-10-11",
      units_listed: 0,
      units_picked_up: 0,
      units_no_show: 0,
      units_unsold: 0,
      recovered_cents: 0,
      platform_fee_cents: 0,
      if_discarded_cents: 0,
    });
  });

  it("matches the contract example: 9 listed, 5 picked up as 5 reservations -> fee 495", async () => {
    const { cookie, merchant } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 9, max_per_customer: 1 });
    const customers = await Promise.all(Array.from({ length: 5 }, () => newCustomer()));
    const reservations = [];
    for (const c of customers) reservations.push(await reserveOk(c.token, deal.id, 1));
    setNow("2026-10-11T17:30:00-04:00");
    for (const r of reservations) await api.redeem(cookie, { pickup_code: r.pickup_code });
    setNow("2026-10-11T20:00:00-04:00");
    expect((await api.summary(cookie, merchant.id)).body).toEqual({
      date: "2026-10-11",
      units_listed: 9,
      units_picked_up: 5,
      units_no_show: 0,
      units_unsold: 4,
      recovered_cents: 2000,
      platform_fee_cents: 495,
      if_discarded_cents: 0,
    });
  });

  it("counts picked-up, no-show, open and unsold units; fee only for picked-up reservations", async () => {
    const { cookie, merchant } = await newMerchant();
    const a = await liveDeal(cookie, { quantity_total: 5 }); // $4.00
    const b = await liveDeal(cookie, { quantity_total: 4, original_price_cents: 500, deal_price_cents: 250 });
    const d = await liveDeal(cookie, { quantity_total: 2 });
    await api.cancelDeal(cookie, d.id); // listed, then withdrawn: its units are unsold
    await api.createDeal(cookie, dealBody({ quantity_total: 10 })); // draft: not listed

    const c1 = await newCustomer();
    const c2 = await newCustomer();
    const c3 = await newCustomer();
    const c4 = await newCustomer();
    const r1 = await reserveOk(c1.token, a.id, 2);
    const r2 = await reserveOk(c2.token, a.id, 1);
    await reserveOk(c3.token, b.id, 1); // will be a no-show
    const r4 = await reserveOk(c4.token, b.id, 1);
    await api.cancelReservation(c4.token, r4.id);

    setNow("2026-10-11T17:30:00-04:00");
    await api.redeem(cookie, { pickup_code: r1.pickup_code });
    await api.confirmPickup(c2.token, r2.id);

    // Before no-show time, c3's unit is still reserved: neither no-show nor unsold.
    setNow("2026-10-11T18:05:00-04:00");
    expect((await api.summary(cookie, merchant.id)).body).toMatchObject({
      units_listed: 11,
      units_picked_up: 3,
      units_no_show: 0,
      units_unsold: 7,
      recovered_cents: 1200,
      platform_fee_cents: 198,
      if_discarded_cents: 0,
    });

    setNow("2026-10-11T18:15:00-04:00");
    expect((await api.summary(cookie, merchant.id)).body).toEqual({
      date: "2026-10-11",
      units_listed: 11,
      units_picked_up: 3,
      units_no_show: 1,
      units_unsold: 7,
      recovered_cents: 1200,
      platform_fee_cents: 198,
      if_discarded_cents: 0,
    });
  });

  it("recovered_cents uses each reservation's own unit price after a price drop", async () => {
    const { cookie, merchant } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 4 });
    const a = await newCustomer();
    const b = await newCustomer();
    const ra = await reserveOk(a.token, deal.id, 1); // 400
    await api.patchDeal(cookie, deal.id, { deal_price_cents: 300 });
    const rb = await reserveOk(b.token, deal.id, 2); // 2 x 300
    setNow("2026-10-11T17:10:00-04:00");
    await api.redeem(cookie, { pickup_code: ra.pickup_code });
    await api.redeem(cookie, { pickup_code: rb.pickup_code });
    const body = (await api.summary(cookie, merchant.id)).body;
    expect(body).toMatchObject({ units_picked_up: 3, recovered_cents: 1000, platform_fee_cents: 198, units_unsold: 1 });
  });

  it("is scoped to the business date", async () => {
    const { cookie, merchant } = await newMerchant();
    await liveDeal(cookie, { quantity_total: 3 });
    expect((await api.summary(cookie, merchant.id, { date: "2026-10-10" })).body.units_listed).toBe(0);
    setNow("2026-10-12T09:00:00-04:00");
    expect((await api.summary(cookie, merchant.id)).body).toMatchObject({ date: "2026-10-12", units_listed: 0 });
    expect((await api.summary(cookie, merchant.id, { date: "2026-10-11" })).body).toMatchObject({
      date: "2026-10-11",
      units_listed: 3,
      units_unsold: 3,
    });
  });
});
