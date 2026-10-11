import { describe, expect, it } from "vitest";
import { advanceNow } from "@/lib/clock";
import * as merchantSignin from "@/app/api/auth/merchant/signin/route";
import * as merchantSignup from "@/app/api/auth/merchant/signup/route";
import { api, cookieFrom, expectError, newCustomer, newMerchant, withFreshApi } from "./helpers";

const store = withFreshApi();

describe("customer auth", () => {
  it("signs up with 201, returns a token and the customer, never the password", async () => {
    const res = await api.customerSignup({ name: " Sam ", phone: "+18145550123", password: "password123" });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(20);
    expect(res.body.customer).toEqual({
      id: expect.stringMatching(/^c_/),
      name: "Sam",
      phone: "+18145550123",
      no_show_count: 0,
      blocked: false,
      created_at: "2026-10-11T16:00:00-04:00",
    });
    expect(JSON.stringify(res.body)).not.toContain("password");
    const stored = await store().getCustomerByPhone("+18145550123");
    expect(stored?.password_hash).toMatch(/^scrypt\$/);
    expect(stored?.password_hash).not.toContain("password123");
  });

  it("rejects a duplicate phone with 409 ACCOUNT_EXISTS", async () => {
    await api.customerSignup({ name: "Sam", phone: "+18145550123", password: "password123" });
    expectError(await api.customerSignup({ name: "Alex", phone: "+18145550123", password: "other-pass1" }), 409, "ACCOUNT_EXISTS");
  });

  it("validates name, phone (E.164) and password length", async () => {
    expectError(await api.customerSignup({ name: "Sam", phone: "+18145550123", password: "1234567" }), 422, "VALIDATION");
    expectError(await api.customerSignup({ name: "Sam", phone: "8145550123", password: "password123" }), 422, "VALIDATION");
    expectError(await api.customerSignup({ name: "  ", phone: "+18145550123", password: "password123" }), 422, "VALIDATION");
    expectError(await api.customerSignup({ phone: "+18145550123", password: "password123" }), 422, "VALIDATION");
    expectError(await api.customerSignup("not json"), 422, "VALIDATION");
    // Exactly 8 characters is enough.
    expect((await api.customerSignup({ name: "Sam", phone: "+18145550124", password: "12345678" })).status).toBe(201);
  });

  it("signs in with phone and password; wrong password or unknown phone is 401 BAD_CREDENTIALS", async () => {
    const { phone, password } = await newCustomer();
    const ok = await api.customerSignin({ phone, password });
    expect(ok.status).toBe(200);
    expect(ok.body.customer.phone).toBe(phone);
    expect(typeof ok.body.token).toBe("string");
    expectError(await api.customerSignin({ phone, password: "wrong-password" }), 401, "BAD_CREDENTIALS");
    expectError(await api.customerSignin({ phone: "+18145559999", password }), 401, "BAD_CREDENTIALS");
  });

  it("uses the bearer token for customer endpoints; no or bad token is 401", async () => {
    const { token, customer } = await newCustomer();
    const me = await api.customersMe(token);
    expect(me.status).toBe(200);
    expect(me.body).toEqual(customer);
    expectError(await api.customersMe(null), 401, "UNAUTHORIZED");
    expectError(await api.customersMe("not-a-token"), 401, "UNAUTHORIZED");
    expectError(await api.listReservations(null), 401, "UNAUTHORIZED");
    expectError(await api.listFollows(null), 401, "UNAUTHORIZED");
    expectError(await api.notifications(null), 401, "UNAUTHORIZED");
    expectError(await api.reserve(null, { deal_id: "d_x", quantity: 1 }), 401, "UNAUTHORIZED");
  });

  it("tokens do not expire", async () => {
    const { token } = await newCustomer();
    advanceNow(60 * 24 * 365);
    expect((await api.customersMe(token)).status).toBe(200);
  });

  it("stores only a hash of the token", async () => {
    const { token } = await newCustomer();
    expect(await store().getCustomerToken(token)).toBeNull();
  });

  it("stores the push token", async () => {
    const { token, customer } = await newCustomer();
    expect((await api.pushToken(token, { expo_push_token: "ExponentPushToken[abc]" })).status).toBe(200);
    expect((await store().getCustomer(customer.id))?.expo_push_token).toBe("ExponentPushToken[abc]");
    expectError(await api.pushToken(token, {}), 422, "VALIDATION");
    expectError(await api.pushToken(null, { expo_push_token: "x" }), 401, "UNAUTHORIZED");
  });
});

describe("merchant auth", () => {
  it("signs up with an httpOnly SameSite=Lax session cookie", async () => {
    const res = await api.merchantSignup({ email: " Owner@Example.com ", password: "correct horse" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^merchant_session=[A-Za-z0-9_-]{20,};/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    // Not production in tests, so no Secure flag (it is added when NODE_ENV=production).
    expect(setCookie).not.toContain("Secure");
    const account = await store().getMerchantAccountByEmail("owner@example.com");
    expect(account?.password_hash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(account)).not.toContain("correct horse");
  });

  it("rejects a duplicate email (case-insensitive) with 409 ACCOUNT_EXISTS", async () => {
    await api.merchantSignup({ email: "owner@example.com", password: "correct horse" });
    expectError(await api.merchantSignup({ email: "OWNER@example.com", password: "another pass" }), 409, "ACCOUNT_EXISTS");
  });

  it("validates email and password length", async () => {
    expectError(await api.merchantSignup({ email: "nope", password: "correct horse" }), 422, "VALIDATION");
    expectError(await api.merchantSignup({ email: "a@b.co", password: "short" }), 422, "VALIDATION");
  });

  it("signs in; bad credentials are 401 BAD_CREDENTIALS", async () => {
    await api.merchantSignup({ email: "owner@example.com", password: "correct horse" });
    const ok = await api.merchantSignin({ email: "Owner@Example.com", password: "correct horse" });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    const cookie = cookieFrom(ok);
    expect((await api.me(cookie)).body).toEqual({ merchant: null });
    expectError(await api.merchantSignin({ email: "owner@example.com", password: "wrong horse" }), 401, "BAD_CREDENTIALS");
    expectError(await api.merchantSignin({ email: "nobody@example.com", password: "correct horse" }), 401, "BAD_CREDENTIALS");
  });

  it("merchant endpoints return 401 without a session", async () => {
    expectError(await api.me(null), 401, "UNAUTHORIZED");
    expectError(await api.me("merchant_session=forged"), 401, "UNAUTHORIZED");
    expectError(await api.createMerchant(null, {}), 401, "UNAUTHORIZED");
    expectError(await api.createDeal(null, { title: "x" }), 401, "UNAUTHORIZED");
    expectError(await api.patchDeal(null, "d_x", {}), 401, "UNAUTHORIZED");
    expectError(await api.publishDeal(null, "d_x"), 401, "UNAUTHORIZED");
    expectError(await api.cancelDeal(null, "d_x"), 401, "UNAUTHORIZED");
    expectError(await api.markDonated(null, "d_x"), 401, "UNAUTHORIZED");
    expectError(await api.redeem(null, { pickup_code: "1234" }), 401, "UNAUTHORIZED");
    expectError(await api.getMerchant(null, "m_x"), 401, "UNAUTHORIZED");
    expectError(await api.merchantDeals(null, "m_x"), 401, "UNAUTHORIZED");
    expectError(await api.merchantReservations(null, "m_x"), 401, "UNAUTHORIZED");
    expectError(await api.summary(null, "m_x"), 401, "UNAUTHORIZED");
    expectError(await api.suggestions(null, "m_x"), 401, "UNAUTHORIZED");
    expectError(await api.acceptSuggestion(null, "s_x"), 401, "UNAUTHORIZED");
    expectError(await api.dismissSuggestion(null, "s_x"), 401, "UNAUTHORIZED");
    expectError(await api.billingLinks(null), 401, "UNAUTHORIZED");
  });

  it("a customer token is not a merchant session", async () => {
    const { token } = await newCustomer();
    expectError(await api.me(`merchant_session=${token}`), 401, "UNAUTHORIZED");
  });

  it("signout ends the session and clears the cookie", async () => {
    const { cookie } = await newMerchant();
    expect((await api.me(cookie)).status).toBe(200);
    const out = await api.merchantSignout(cookie);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    expect(out.headers.get("set-cookie")).toMatch(/^merchant_session=;.*Max-Age=0/);
    expectError(await api.me(cookie), 401, "UNAUTHORIZED");
    // Signing out again (or without a session) is fine.
    expect((await api.merchantSignout(cookie)).status).toBe(200);
    expect((await api.merchantSignout(null)).status).toBe(200);
  });

  it("sessions expire after 30 days", async () => {
    const { cookie } = await newMerchant();
    advanceNow(60 * 24 * 30 - 1);
    expect((await api.me(cookie)).status).toBe(200);
    advanceNow(2);
    expectError(await api.me(cookie), 401, "UNAUTHORIZED");
  });
});

describe("merchant sign-in and sign-up need a JSON body (no login through a cross-site form)", () => {
  const post = (handler: (r: Request, c: unknown) => Promise<Response>, path: string, body: string, type?: string) =>
    handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: type === undefined ? {} : { "content-type": type },
        body,
      }),
      { params: Promise.resolve({}) },
    );

  it.each([
    ["text/plain", "text/plain"],
    ["a form encoding", "application/x-www-form-urlencoded"],
    ["multipart", "multipart/form-data; boundary=x"],
    ["no content type", undefined],
  ])("rejects %s with 422 and sets no cookie", async (_label, type) => {
    const { email, password } = await newMerchant();
    const body = JSON.stringify({ email, password });
    for (const [handler, path] of [
      [merchantSignin.POST, "/api/auth/merchant/signin"],
      [merchantSignup.POST, "/api/auth/merchant/signup"],
    ] as const) {
      const res = await post(handler, path, body, type);
      expect(res.status, path).toBe(422);
      expect((await res.json()).error.code).toBe("VALIDATION");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("accepts application/json with a charset", async () => {
    const { email, password } = await newMerchant();
    const res = await post(
      merchantSignin.POST,
      "/api/auth/merchant/signin",
      JSON.stringify({ email, password }),
      "application/json; charset=utf-8",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^merchant_session=/);
  });
});

describe("billing links stub", () => {
  it("returns the two links for a signed-in merchant", async () => {
    const { cookie } = await newMerchant();
    const res = await api.billingLinks(cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pricing_url: expect.any(String), portal_url: expect.any(String) });
  });

  it("links to no page until /monetize adds one (an empty link means none), so the portal shows no dead link", async () => {
    const { cookie } = await newMerchant();
    expect((await api.billingLinks(cookie)).body).toEqual({ pricing_url: "", portal_url: "" });
  });
});

describe("unknown API paths", () => {
  it("return the JSON error envelope with 404 NOT_FOUND", async () => {
    expectError(await api.unknown("GET", "/api/nope"), 404, "NOT_FOUND");
    expectError(await api.unknown("POST", "/api/deals/d_1/unknown"), 404, "NOT_FOUND");
  });
});
