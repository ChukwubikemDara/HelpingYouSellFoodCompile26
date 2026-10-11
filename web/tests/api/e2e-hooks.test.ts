import { afterEach, describe, expect, it, vi } from "vitest";
import * as noShows from "@/app/api/e2e/no-shows/route";
import { advanceNow } from "@/lib/clock";
import { api, call, expectError, liveDeal, newCustomer, newMerchant, withFreshApi } from "./helpers";

withFreshApi();

afterEach(() => {
  vi.unstubAllEnvs();
});

const createNoShows = (body: unknown) => call(noShows.POST, "POST", "/api/e2e/no-shows", { body });

describe("POST /api/e2e/no-shows (test-only hook)", () => {
  it("is 404 NOT_FOUND unless E2E_HOOKS=1", async () => {
    vi.stubEnv("E2E_HOOKS", "");
    const { customer } = await newCustomer();
    expectError(await createNoShows({ customer_id: customer.id }), 404, "NOT_FOUND");
  });

  it("is 404 NOT_FOUND in production even with E2E_HOOKS=1", async () => {
    vi.stubEnv("E2E_HOOKS", "1");
    vi.stubEnv("NODE_ENV", "production");
    const result = await createNoShows({ customer_id: "c_any" });
    expectError(result, 404, "NOT_FOUND");
  });

  it("answers other methods like an unknown path", async () => {
    vi.stubEnv("E2E_HOOKS", "1");
    expectError(await call(noShows.GET, "GET", "/api/e2e/no-shows"), 404, "NOT_FOUND");
    expectError(await call(noShows.DELETE, "DELETE", "/api/e2e/no-shows"), 404, "NOT_FOUND");
  });

  it("gives the customer two no-shows, which blocks reserving", async () => {
    vi.stubEnv("E2E_HOOKS", "1");
    const { cookie } = await newMerchant();
    const deal = await liveDeal(cookie);
    const { token, customer } = await newCustomer();

    const created = await createNoShows({ customer_id: customer.id });
    expect(created.status).toBe(201);
    expect(created.body.reservation_ids).toHaveLength(2);

    const me = await api.customersMe(token);
    expect(me.body).toMatchObject({ no_show_count: 2, blocked: true });
    const mine = await api.listReservations(token);
    expect(mine.body.reservations.map((r: { status: string }) => r.status)).toEqual(["no_show", "no_show"]);
    expectError(await api.reserve(token, { deal_id: deal.id, quantity: 1 }), 403, "CUSTOMER_BLOCKED");

    // The test store's deal is never listed to customers.
    const listed = await api.listDeals();
    expect(listed.body.deals.map((d: { id: string }) => d.id)).toEqual([deal.id]);
  });

  it("checks the body and the customer", async () => {
    vi.stubEnv("E2E_HOOKS", "1");
    expectError(await createNoShows({}), 422, "VALIDATION");
    expectError(await createNoShows({ customer_id: "c_x", count: 9 }), 422, "VALIDATION");
    expectError(await createNoShows({ customer_id: "c_missing" }), 404, "NOT_FOUND");
  });

  it("one no-show is not enough to block", async () => {
    vi.stubEnv("E2E_HOOKS", "1");
    const { token, customer } = await newCustomer();
    await createNoShows({ customer_id: customer.id, count: 1 });
    advanceNow(1);
    const me = await api.customersMe(token);
    expect(me.body).toMatchObject({ no_show_count: 1, blocked: false });
  });
});
