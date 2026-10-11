import { describe, expect, it } from "vitest";
import { api, cookieFrom, expectError, MERCHANT_PROFILE, newMerchant, withFreshApi } from "./helpers";

withFreshApi();

async function signedInAccount() {
  const signup = await api.merchantSignup({ email: `x-${Math.random()}@example.com`, password: "correct horse" });
  return cookieFrom(signup);
}

describe("onboarding: POST /merchants", () => {
  it("creates the merchant (201) and GET /me returns it", async () => {
    const cookie = await signedInAccount();
    expect((await api.me(cookie)).body).toEqual({ merchant: null });
    const res = await api.createMerchant(cookie, MERCHANT_PROFILE);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^m_/),
      name: "Example Bakery",
      category: "bakery",
      address: "123 College Ave, State College, PA",
      lat: 40.7934,
      lng: -77.86,
      phone: "+18145550100",
      closes_at: "18:00",
      default_discount_pct: 50,
      menu: [{ name: "Butter croissant", price_cents: 400 }],
      plan_status: "none",
    });
    expect((await api.me(cookie)).body).toEqual({ merchant: res.body });
  });

  it("leaves lat/lng null when they are not sent (no geocoding)", async () => {
    const cookie = await signedInAccount();
    const { lat: _lat, lng: _lng, ...withoutLocation } = MERCHANT_PROFILE;
    void _lat;
    void _lng;
    const res = await api.createMerchant(cookie, withoutLocation);
    expect(res.status).toBe(201);
    expect(res.body.lat).toBeNull();
    expect(res.body.lng).toBeNull();
  });

  it("accepts an empty menu", async () => {
    const cookie = await signedInAccount();
    expect((await api.createMerchant(cookie, { ...MERCHANT_PROFILE, menu: [] })).status).toBe(201);
  });

  it("a second POST /merchants for the same account is 409 ACCOUNT_EXISTS", async () => {
    const { cookie } = await newMerchant();
    expectError(await api.createMerchant(cookie, MERCHANT_PROFILE), 409, "ACCOUNT_EXISTS");
  });

  it.each([
    ["missing name", { name: undefined }],
    ["unknown category", { category: "bar" }],
    ["empty address", { address: "" }],
    ["phone not E.164", { phone: "814-555-0100" }],
    ["closes_at not HH:MM", { closes_at: "6pm" }],
    ["closes_at 24:00", { closes_at: "24:00" }],
    ["discount below 10", { default_discount_pct: 9 }],
    ["discount above 90", { default_discount_pct: 91 }],
    ["discount not an integer", { default_discount_pct: 50.5 }],
    ["menu missing", { menu: undefined }],
    ["menu price not integer cents", { menu: [{ name: "Croissant", price_cents: 4.5 }] }],
    ["menu item without a name", { menu: [{ name: "", price_cents: 400 }] }],
    ["lat without lng", { lng: undefined }],
    ["lat out of range", { lat: 91 }],
    ["lat number with lng null", { lng: null }],
  ])("rejects %s with 422 VALIDATION", async (_label, override) => {
    const cookie = await signedInAccount();
    const body: Record<string, unknown> = { ...MERCHANT_PROFILE, ...override };
    for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
    expectError(await api.createMerchant(cookie, body), 422, "VALIDATION");
  });

  it("accepts the boundary discounts 10 and 90", async () => {
    expect((await api.createMerchant(await signedInAccount(), { ...MERCHANT_PROFILE, default_discount_pct: 10 })).status).toBe(201);
    expect((await api.createMerchant(await signedInAccount(), { ...MERCHANT_PROFILE, default_discount_pct: 90 })).status).toBe(201);
  });
});

describe("GET / PATCH /merchants/{id}", () => {
  it("reads and patches the signed-in merchant", async () => {
    const { cookie, merchant } = await newMerchant();
    expect((await api.getMerchant(cookie, merchant.id)).body).toEqual(merchant);
    const patched = await api.patchMerchant(cookie, merchant.id, {
      name: "Example Cafe",
      closes_at: "19:30",
      menu: [{ name: "Latte", price_cents: 550 }],
      lat: null,
      lng: null,
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      name: "Example Cafe",
      closes_at: "19:30",
      menu: [{ name: "Latte", price_cents: 550 }],
      lat: null,
      lng: null,
      category: "bakery",
    });
    expect((await api.getMerchant(cookie, merchant.id)).body).toEqual(patched.body);
  });

  it("does not let the merchant set plan_status or its id", async () => {
    const { cookie, merchant } = await newMerchant();
    const res = await api.patchMerchant(cookie, merchant.id, { plan_status: "active", id: "m_other" });
    expect(res.status).toBe(200);
    expect(res.body.plan_status).toBe("none");
    expect(res.body.id).toBe(merchant.id);
  });

  it("validates patched fields", async () => {
    const { cookie, merchant } = await newMerchant();
    expectError(await api.patchMerchant(cookie, merchant.id, { default_discount_pct: 95 }), 422, "VALIDATION");
    expectError(await api.patchMerchant(cookie, merchant.id, { lat: 40.1 }), 422, "VALIDATION");
    expectError(await api.patchMerchant(cookie, merchant.id, { phone: "12345" }), 422, "VALIDATION");
  });

  it("returns 404 for any id other than the signed-in merchant's", async () => {
    const a = await newMerchant();
    const b = await newMerchant();
    expectError(await api.getMerchant(a.cookie, b.merchant.id), 404, "NOT_FOUND");
    expectError(await api.patchMerchant(a.cookie, b.merchant.id, { name: "Hijack" }), 404, "NOT_FOUND");
    expectError(await api.merchantDeals(a.cookie, b.merchant.id), 404, "NOT_FOUND");
    expectError(await api.merchantReservations(a.cookie, b.merchant.id), 404, "NOT_FOUND");
    expectError(await api.summary(a.cookie, b.merchant.id), 404, "NOT_FOUND");
    expectError(await api.suggestions(a.cookie, b.merchant.id), 404, "NOT_FOUND");
    expectError(await api.getMerchant(a.cookie, "m_unknown"), 404, "NOT_FOUND");
    expect((await api.getMerchant(b.cookie, b.merchant.id)).body.name).toBe("Example Bakery");
  });

  it("returns 404 for /merchants/{id}/... before onboarding", async () => {
    const cookie = await signedInAccount();
    expectError(await api.getMerchant(cookie, "m_any"), 404, "NOT_FOUND");
    expectError(await api.createDeal(cookie, { title: "x" }), 404, "NOT_FOUND");
  });

  it("validates ?date=", async () => {
    const { cookie, merchant } = await newMerchant();
    expectError(await api.merchantDeals(cookie, merchant.id, { date: "2026-13-01" }), 422, "VALIDATION");
    expectError(await api.summary(cookie, merchant.id, { date: "today" }), 422, "VALIDATION");
    expect((await api.merchantDeals(cookie, merchant.id, { date: "" })).status).toBe(200);
  });
});
