import { describe, expect, it } from "vitest";
import { setNow } from "@/lib/clock";
import { api, dealBody, expectError, liveDeal, newCustomer, newMerchant, reserveOk, withFreshApi } from "./helpers";

withFreshApi();

type N = { type: string; deal_id: string | null; reservation_id: string | null; created_at: string };
const ofType = (list: N[], type: string) => list.filter((n) => n.type === type);

describe("follows", () => {
  it("follow, list, unfollow; unknown merchant is 404; both are idempotent", async () => {
    const { merchant } = await newMerchant();
    const second = await newMerchant();
    const { token } = await newCustomer();
    expect((await api.listFollows(token)).body).toEqual({ merchant_ids: [] });
    expect((await api.follow(token, { merchant_id: merchant.id })).body).toEqual({ ok: true });
    expect((await api.follow(token, { merchant_id: merchant.id })).status).toBe(200);
    setNow("2026-10-11T16:01:00-04:00");
    await api.follow(token, { merchant_id: second.merchant.id });
    expect((await api.listFollows(token)).body).toEqual({ merchant_ids: [second.merchant.id, merchant.id] });
    expectError(await api.follow(token, { merchant_id: "m_unknown" }), 404, "NOT_FOUND");
    expectError(await api.follow(token, {}), 422, "VALIDATION");
    expect((await api.unfollow(token, merchant.id)).body).toEqual({ ok: true });
    expect((await api.unfollow(token, merchant.id)).status).toBe(200);
    expect((await api.listFollows(token)).body).toEqual({ merchant_ids: [second.merchant.id] });
  });
});

describe("new_deal", () => {
  it("goes to followers when a deal goes live, with the contract's wording", async () => {
    const { cookie, merchant } = await newMerchant();
    const follower = await newCustomer();
    const stranger = await newCustomer();
    await api.follow(follower.token, { merchant_id: merchant.id });
    const draft = (await api.createDeal(cookie, dealBody())).body;
    // Creating a draft notifies nobody.
    expect((await api.notifications(follower.token)).body.notifications).toEqual([]);
    setNow("2026-10-11T16:04:00-04:00");
    await api.publishDeal(cookie, draft.id);

    const res = await api.notifications(follower.token);
    expect(res.status).toBe(200);
    expect(res.body.notifications).toEqual([
      {
        id: expect.stringMatching(/^n_/),
        type: "new_deal",
        title: "Example Bakery",
        body: "Croissants (2-pack) for $4.00, pickup until 6:00 PM",
        deal_id: draft.id,
        reservation_id: null,
        read: false,
        created_at: "2026-10-11T16:04:00-04:00",
      },
    ]);
    expect((await api.notifications(stranger.token)).body.notifications).toEqual([]);
  });

  it("does not go to former followers or followers of other merchants", async () => {
    const a = await newMerchant();
    const b = await newMerchant({ name: "Other Cafe" });
    const { token } = await newCustomer();
    await api.follow(token, { merchant_id: a.merchant.id });
    await api.follow(token, { merchant_id: b.merchant.id });
    await api.unfollow(token, a.merchant.id);
    await liveDeal(a.cookie);
    const fromB = await liveDeal(b.cookie);
    const list = (await api.notifications(token)).body.notifications;
    expect(list.map((n: N) => n.deal_id)).toEqual([fromB.id]);
  });

  it("is not sent when a sold-out deal comes back to live", async () => {
    const { cookie, merchant } = await newMerchant();
    const follower = await newCustomer();
    await api.follow(follower.token, { merchant_id: merchant.id });
    const deal = await liveDeal(cookie, { quantity_total: 1 });
    const r = await reserveOk(follower.token, deal.id);
    await api.cancelReservation(follower.token, r.id);
    expect(ofType((await api.notifications(follower.token)).body.notifications, "new_deal")).toHaveLength(1);
  });
});

describe("deal_cancelled", () => {
  it("goes to customers with an open reservation when the merchant cancels", async () => {
    const { cookie, merchant } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 6 });
    const holder = await newCustomer();
    const twice = await newCustomer();
    const cancelledEarlier = await newCustomer();
    const pickedUp = await newCustomer();
    const follower = await newCustomer();
    await api.follow(follower.token, { merchant_id: merchant.id });
    const r = await reserveOk(holder.token, deal.id);
    await reserveOk(twice.token, deal.id);
    await reserveOk(twice.token, deal.id);
    const c = await reserveOk(cancelledEarlier.token, deal.id);
    await api.cancelReservation(cancelledEarlier.token, c.id);
    const p = await reserveOk(pickedUp.token, deal.id);
    setNow("2026-10-11T17:05:00-04:00");
    await api.confirmPickup(pickedUp.token, p.id);

    await api.cancelDeal(cookie, deal.id);

    const holderList = ofType((await api.notifications(holder.token)).body.notifications, "deal_cancelled");
    expect(holderList).toEqual([
      {
        id: expect.any(String),
        type: "deal_cancelled",
        title: "Example Bakery",
        body: "Croissants (2-pack) was cancelled by the store. Your reservation is cancelled.",
        deal_id: deal.id,
        reservation_id: r.id,
        read: false,
        created_at: "2026-10-11T17:05:00-04:00",
      },
    ]);
    // One per customer, even with two reservations.
    expect(ofType((await api.notifications(twice.token)).body.notifications, "deal_cancelled")).toHaveLength(1);
    expect(ofType((await api.notifications(cancelledEarlier.token)).body.notifications, "deal_cancelled")).toEqual([]);
    expect(ofType((await api.notifications(pickedUp.token)).body.notifications, "deal_cancelled")).toEqual([]);
    expect(ofType((await api.notifications(follower.token)).body.notifications, "deal_cancelled")).toEqual([]);
  });

  it("cancelling a draft notifies nobody", async () => {
    const { cookie, merchant } = await newMerchant();
    const follower = await newCustomer();
    await api.follow(follower.token, { merchant_id: merchant.id });
    const draft = (await api.createDeal(cookie, dealBody())).body;
    await api.cancelDeal(cookie, draft.id);
    expect((await api.notifications(follower.token)).body.notifications).toEqual([]);
  });
});

describe("pickup_reminder", () => {
  it("is created once, 30 min before pickup_end, for a reserved reservation", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie); // pickup_end 18:00
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id);
    setNow("2026-10-11T17:29:59-04:00");
    expect(ofType((await api.notifications(token)).body.notifications, "pickup_reminder")).toEqual([]);
    setNow("2026-10-11T17:30:00-04:00");
    const first = ofType((await api.notifications(token)).body.notifications, "pickup_reminder");
    expect(first).toEqual([
      {
        id: expect.any(String),
        type: "pickup_reminder",
        title: "Example Bakery",
        body: "Pick up Croissants (2-pack) until 6:00 PM.",
        deal_id: deal.id,
        reservation_id: r.id,
        read: false,
        created_at: "2026-10-11T17:30:00-04:00",
      },
    ]);
    setNow("2026-10-11T17:45:00-04:00");
    const again = ofType((await api.notifications(token)).body.notifications, "pickup_reminder");
    expect(again).toEqual(first);
  });

  it("concurrent polls never duplicate it", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const { token } = await newCustomer();
    await reserveOk(token, deal.id);
    setNow("2026-10-11T17:40:00-04:00");
    await Promise.all(Array.from({ length: 5 }, () => api.notifications(token)));
    expect(ofType((await api.notifications(token)).body.notifications, "pickup_reminder")).toHaveLength(1);
  });

  it("is not created for cancelled or picked-up reservations, after pickup_end, or for other customers", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 6 });
    const cancelled = await newCustomer();
    const picked = await newCustomer();
    const missed = await newCustomer();
    const bystander = await newCustomer();
    const c = await reserveOk(cancelled.token, deal.id);
    await api.cancelReservation(cancelled.token, c.id);
    const p = await reserveOk(picked.token, deal.id);
    setNow("2026-10-11T17:10:00-04:00");
    await api.confirmPickup(picked.token, p.id);
    await reserveOk(missed.token, deal.id);
    setNow("2026-10-11T17:35:00-04:00");
    expect(ofType((await api.notifications(cancelled.token)).body.notifications, "pickup_reminder")).toEqual([]);
    expect(ofType((await api.notifications(picked.token)).body.notifications, "pickup_reminder")).toEqual([]);
    expect(ofType((await api.notifications(bystander.token)).body.notifications, "pickup_reminder")).toEqual([]);
    // First poll only after pickup_end: too late for a reminder.
    setNow("2026-10-11T18:00:00-04:00");
    expect(ofType((await api.notifications(missed.token)).body.notifications, "pickup_reminder")).toEqual([]);
  });

  it("is not created for a reservation made after the reminder time", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const { token } = await newCustomer();
    setNow("2026-10-11T17:31:00-04:00");
    await reserveOk(token, deal.id);
    setNow("2026-10-11T17:40:00-04:00");
    expect(ofType((await api.notifications(token)).body.notifications, "pickup_reminder")).toEqual([]);
  });
});

describe("notification rows that must not appear", () => {
  it("a pickup_reminder is not created again when pickup_end moves after it exists", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie); // pickup_end 18:00
    const { token } = await newCustomer();
    await reserveOk(token, deal.id);
    setNow("2026-10-11T17:30:00-04:00");
    expect(ofType((await api.notifications(token)).body.notifications, "pickup_reminder")).toHaveLength(1);
    expect((await api.patchDeal(cookie, deal.id, { pickup_end: "2026-10-11T18:30:00-04:00" })).status).toBe(200);
    setNow("2026-10-11T18:05:00-04:00");
    expect(ofType((await api.notifications(token)).body.notifications, "pickup_reminder")).toHaveLength(1);
  });

  it("no pickup_reminder after the merchant cancels the deal", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const { token } = await newCustomer();
    await reserveOk(token, deal.id);
    setNow("2026-10-11T17:00:00-04:00");
    await api.cancelDeal(cookie, deal.id);
    setNow("2026-10-11T17:35:00-04:00");
    const list = (await api.notifications(token)).body.notifications as N[];
    expect(ofType(list, "pickup_reminder")).toEqual([]);
    expect(ofType(list, "deal_cancelled")).toHaveLength(1);
  });

  it("live edits and an accepted lower_price suggestion send no new_deal", async () => {
    const { cookie, merchant } = await newMerchant();
    const follower = await newCustomer();
    await api.follow(follower.token, { merchant_id: merchant.id });
    const deal = await liveDeal(cookie, { quantity_total: 4 });
    expect((await api.patchDeal(cookie, deal.id, { deal_price_cents: 350, quantity_total: 5, note: "Fresh." })).status).toBe(200);
    setNow("2026-10-11T17:00:00-04:00"); // half of 16:00-18:00 has passed, nothing reserved
    const accepted = await api.acceptSuggestion(cookie, `s_lp_${deal.id}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.deal_price_cents).toBe(275);
    expect(ofType((await api.notifications(follower.token)).body.notifications, "new_deal")).toHaveLength(1);
  });

  it("cancelling a sold-out deal notifies the customers holding it", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie, { quantity_total: 1 });
    const holder = await newCustomer();
    await reserveOk(holder.token, deal.id);
    expect((await api.getDeal(deal.id)).body.status).toBe("sold_out");
    expect((await api.cancelDeal(cookie, deal.id)).body.status).toBe("cancelled");
    expect(ofType((await api.notifications(holder.token)).body.notifications, "deal_cancelled")).toHaveLength(1);
  });

  it("a reservation the merchant's cancel already cancelled cannot be cancelled again by the customer", async () => {
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const { token } = await newCustomer();
    const r = await reserveOk(token, deal.id);
    await api.cancelDeal(cookie, deal.id);
    expect((await api.getReservation(token, r.id)).body.status).toBe("cancelled");
    const before = (await api.getDeal(deal.id)).body;
    expectError(await api.cancelReservation(token, r.id), 422, "VALIDATION");
    // No unit goes back a second time.
    expect((await api.getDeal(deal.id)).body).toEqual(before);
  });
});

describe("GET /notifications and read", () => {
  it("returns newest first and filters with ?since= (created at or after it)", async () => {
    const { cookie, merchant } = await newMerchant();
    const { token } = await newCustomer();
    await api.follow(token, { merchant_id: merchant.id });
    const first = await liveDeal(cookie);
    setNow("2026-10-11T16:10:00-04:00");
    const second = await liveDeal(cookie);
    const all = (await api.notifications(token)).body.notifications;
    expect(all.map((n: N) => n.deal_id)).toEqual([second.id, first.id]);
    const ids = async (since: string) =>
      (await api.notifications(token, { since })).body.notifications.map((n: N) => n.deal_id);
    expect(await ids("2026-10-11T16:00:00-04:00")).toEqual([second.id, first.id]);
    expect(await ids("2026-10-11T16:00:01-04:00")).toEqual([second.id]);
    expect(await ids("2026-10-11T20:05:00Z")).toEqual([second.id]);
    // At the same instant (also written in UTC): included.
    expect(await ids("2026-10-11T16:10:00-04:00")).toEqual([second.id]);
    expect(await ids("2026-10-11T20:10:00Z")).toEqual([second.id]);
    expect(await ids("2026-10-11T16:10:01-04:00")).toEqual([]);
    expect((await api.notifications(token, { since: "" })).body.notifications).toHaveLength(2);
    expectError(await api.notifications(token, { since: "yesterday" }), 422, "VALIDATION");
    expectError(await api.notifications(token, { since: "2026-10-11T16:00:00" }), 422, "VALIDATION");
    expectError(await api.notifications(token, { since: "1800-01-01T00:00:00Z" }), 422, "VALIDATION");
    expectError(await api.notifications(token, { since: "9999-12-31T23:59:59-14:00" }), 422, "VALIDATION");
  });

  it("a poll with since = the newest created_at seen still gets a notification created later in that second", async () => {
    const a = await newMerchant();
    const b = await newMerchant({ name: "Other Cafe" });
    const { token } = await newCustomer();
    await api.follow(token, { merchant_id: a.merchant.id });
    await api.follow(token, { merchant_id: b.merchant.id });
    setNow("2026-10-11T16:10:00.100-04:00");
    const fromA = await liveDeal(a.cookie);
    setNow("2026-10-11T16:10:00.400-04:00");
    const seen = (await api.notifications(token)).body.notifications as N[];
    expect(seen.map((n) => n.deal_id)).toEqual([fromA.id]);
    setNow("2026-10-11T16:10:00.800-04:00");
    const fromB = await liveDeal(b.cookie);
    setNow("2026-10-11T16:10:30-04:00");
    const polled = (await api.notifications(token, { since: seen[0].created_at })).body.notifications as N[];
    expect(polled.map((n) => n.deal_id)).toContain(fromB.id);
  });

  it("marks a notification read; another customer's is 404", async () => {
    const { cookie, merchant } = await newMerchant();
    const owner = await newCustomer();
    const other = await newCustomer();
    await api.follow(owner.token, { merchant_id: merchant.id });
    await liveDeal(cookie);
    const [n] = (await api.notifications(owner.token)).body.notifications;
    expectError(await api.readNotification(other.token, n.id), 404, "NOT_FOUND");
    expectError(await api.readNotification(owner.token, "n_unknown"), 404, "NOT_FOUND");
    expect((await api.readNotification(owner.token, n.id)).body).toEqual({ ok: true });
    expect((await api.readNotification(owner.token, n.id)).status).toBe(200);
    expect((await api.notifications(owner.token)).body.notifications[0].read).toBe(true);
  });
});
