import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetNow, setNow, toMs } from "@/lib/clock";
import { verifyPassword } from "@/lib/auth/password";
import { db, resetSeedOnStart } from "@/lib/services/db";
import { SEED_CUSTOMER, SEED_MERCHANT, seedStore } from "@/lib/services/seed";
import { createMemoryStore, deriveDealStatus, resetStore, setStore } from "@/lib/store";

const T = "2026-10-11T14:07:00-04:00";

describe("seedStore", () => {
  beforeEach(() => setNow(T));
  afterEach(() => resetNow());

  it("creates a merchant with a five-item menu downtown, two live deals open now, and a customer", async () => {
    const store = createMemoryStore();
    const result = await seedStore(store);
    const account = await store.getMerchantAccountByEmail(SEED_MERCHANT.email);
    expect(account).not.toBeNull();
    expect(await verifyPassword(SEED_MERCHANT.password, account!.password_hash)).toBe(true);
    const merchant = await store.getMerchantByOwner(account!.id);
    expect(merchant?.menu).toHaveLength(5);
    expect(merchant?.lat).toBeCloseTo(40.794, 2);
    expect(merchant?.lng).toBeCloseTo(-77.86, 2);

    const deals = await store.listDealsByMerchant(merchant!.id);
    expect(deals).toHaveLength(2);
    const now = toMs(T);
    for (const deal of deals) {
      expect(deriveDealStatus(deal, T)).toBe("live");
      expect(toMs(deal.pickup_start)).toBeLessThanOrEqual(now);
      expect(toMs(deal.pickup_end!)).toBeGreaterThan(now);
      expect(deal.allergens?.length).toBeGreaterThan(0);
      expect(deal.deal_price_cents!).toBeLessThan(deal.original_price_cents!);
      expect(deal.published_at).not.toBeNull();
    }

    const customer = await store.getCustomerByPhone(SEED_CUSTOMER.phone);
    expect(customer?.id).toBe(result.customer.id);
    expect(await verifyPassword(SEED_CUSTOMER.password, customer!.password_hash)).toBe(true);
  });

  it("is safe to run twice", async () => {
    const store = createMemoryStore();
    const first = await seedStore(store);
    const second = await seedStore(store);
    expect(second.merchant.id).toBe(first.merchant.id);
    expect(second.customer.id).toBe(first.customer.id);
    expect(second.deals.every((d) => !d.created)).toBe(true);
    expect(await store.listDealsByMerchant(first.merchant.id)).toHaveLength(2);
  });

  it("adds fresh live deals when the earlier ones have ended", async () => {
    const store = createMemoryStore();
    const first = await seedStore(store);
    setNow("2026-10-12T10:00:00-04:00");
    const second = await seedStore(store);
    expect(second.deals.every((d) => d.created)).toBe(true);
    expect(await store.listDealsByMerchant(first.merchant.id)).toHaveLength(4);
  });
});

describe("SEED_ON_START", () => {
  afterEach(() => {
    delete process.env.SEED_ON_START;
    resetSeedOnStart();
    resetStore();
    resetNow();
  });

  it("seeds the in-memory store on first use, once", async () => {
    process.env.SEED_ON_START = "1";
    const store = createMemoryStore();
    setStore(store);
    await Promise.all([db(), db(), db()]);
    await db();
    expect(await store.getMerchantAccountByEmail(SEED_MERCHANT.email)).not.toBeNull();
    const account = await store.getMerchantAccountByEmail(SEED_MERCHANT.email);
    const merchant = await store.getMerchantByOwner(account!.id);
    expect(await store.listDealsByMerchant(merchant!.id)).toHaveLength(2);
  });

  it("does nothing without SEED_ON_START", async () => {
    const store = createMemoryStore();
    setStore(store);
    await db();
    expect(await store.getMerchantAccountByEmail(SEED_MERCHANT.email)).toBeNull();
  });
});
