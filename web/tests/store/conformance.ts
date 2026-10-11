/**
 * Store conformance suite. Every Store driver must pass it.
 *
 *   runStoreConformance("memory", () => createMemoryStore());
 *
 * The factory is called before each test. Tests never assume an empty store:
 * every test uses fresh random ids, emails and phones, and filters list
 * results to its own records, so a driver may hand back one shared store
 * (e.g. one DynamoDB table) for the whole run.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { addMinutes, toIso } from "@/lib/clock";
import { newId } from "@/lib/ids";
import type {
  CustomerRecord,
  DealPatch,
  DealRecord,
  MerchantAccountRecord,
  MerchantRecord,
  NewDealRecord,
  NotificationRecord,
  ReserveInput,
  Store,
} from "@/lib/store/types";

export type StoreFactory = () => Store | Promise<Store>;

/** 2026-10-11 16:00 New York (EDT). */
const T0 = "2026-10-11T16:00:00-04:00";
const DATE = "2026-10-11";
/** ISO time `minutes` after T0. */
const at = (minutes: number) => toIso(addMinutes(T0, minutes));

const randomDigits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

export function runStoreConformance(name: string, factory: StoreFactory): void {
  describe(`Store conformance: ${name}`, () => {
    let store: Store;

    beforeEach(async () => {
      store = await factory();
    });

    /* ---------------------------------------------------------------- */
    /* Fixtures                                                         */
    /* ---------------------------------------------------------------- */

    const accountRecord = (overrides: Partial<MerchantAccountRecord> = {}): MerchantAccountRecord => {
      const id = newId("ma");
      return {
        id,
        email: `${id.toLowerCase()}@example.com`,
        password_hash: "scrypt$test$hash",
        created_at: at(0),
        ...overrides,
      };
    };

    const customerRecord = (overrides: Partial<CustomerRecord> = {}): CustomerRecord => ({
      id: newId("c"),
      name: "Sam",
      phone: `+1814${randomDigits(7)}`,
      password_hash: "scrypt$test$hash",
      expo_push_token: null,
      created_at: at(0),
      ...overrides,
    });

    const merchantRecord = (overrides: Partial<MerchantRecord> = {}): MerchantRecord => ({
      id: newId("m"),
      owner_account_id: newId("ma"),
      name: "Example Bakery",
      category: "bakery",
      address: "123 College Ave, State College, PA",
      lat: 40.7934,
      lng: -77.86,
      phone: "+18145550100",
      closes_at: "18:00",
      default_discount_pct: 50,
      menu: [{ name: "Butter croissant", price_cents: 400 }],
      plan_status: "active",
      created_at: at(0),
      ...overrides,
    });

    /** A live deal: 3 units at 400 (regular 800), pickup 17:00-18:00, published at 16:00. */
    const dealRecord = (merchantId: string, overrides: Partial<NewDealRecord> = {}): NewDealRecord => ({
      id: newId("d"),
      merchant_id: merchantId,
      title: "Croissants (2-pack)",
      items: [{ name: "Butter croissant", qty: 2 }],
      original_price_cents: 800,
      deal_price_cents: 400,
      kind: "surplus",
      quantity_total: 3,
      quantity_left: 3,
      max_per_customer: 2,
      unsold_action: "none",
      pickup_start: at(60),
      pickup_end: at(120),
      allergens: ["wheat", "milk", "egg"],
      note: "Baked this morning.",
      photo_url: null,
      status: "live",
      created_at: at(0),
      published_at: at(0),
      cancelled_at: null,
      local_date: DATE,
      price_lowered_by_suggestion: false,
      ...overrides,
    });

    let codeCounter = 0;
    const nextCode = () => String(1000 + (codeCounter++ % 9000));

    const reserveInput = (
      deal: Pick<DealRecord, "id">,
      customer: Pick<CustomerRecord, "id" | "name" | "phone">,
      overrides: Partial<ReserveInput> = {},
    ): ReserveInput => ({
      id: newId("r"),
      deal_id: deal.id,
      customer_id: customer.id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      quantity: 1,
      pickup_code: nextCode(),
      payment_method: "in_store",
      at: at(10),
      ...overrides,
    });

    const notificationRecord = (
      customerId: string,
      overrides: Partial<NotificationRecord> = {},
    ): NotificationRecord => ({
      id: newId("n"),
      customer_id: customerId,
      type: "new_deal",
      title: "Example Bakery",
      body: "Croissants (2-pack) for $4.00, pickup until 6:00 PM",
      deal_id: null,
      reservation_id: null,
      read: false,
      created_at: at(0),
      dedupe_key: null,
      ...overrides,
    });

    /** A merchant with one live deal and one customer. */
    async function liveDealSetup(dealOverrides: Partial<NewDealRecord> = {}) {
      const merchant = merchantRecord();
      await store.createMerchant(merchant);
      const deal = await store.createDeal(dealRecord(merchant.id, dealOverrides));
      const customer = customerRecord();
      await store.createCustomer(customer);
      return { merchant, deal, customer };
    }

    async function newCustomer() {
      const customer = customerRecord();
      const created = await store.createCustomer(customer);
      expect(created.ok).toBe(true);
      return customer;
    }

    /* ---------------------------------------------------------------- */
    /* Merchant accounts and sessions                                   */
    /* ---------------------------------------------------------------- */

    describe("merchant accounts", () => {
      it("creates and reads an account by id and by email", async () => {
        const account = accountRecord();
        const created = await store.createMerchantAccount(account);
        expect(created).toEqual({ ok: true, value: account });
        expect(await store.getMerchantAccount(account.id)).toEqual(account);
        expect(await store.getMerchantAccountByEmail(account.email)).toEqual(account);
        expect(await store.getMerchantAccount(newId("ma"))).toBeNull();
        expect(await store.getMerchantAccountByEmail(`missing-${newId("ma")}@example.com`)).toBeNull();
      });

      it("rejects a second account with the same email", async () => {
        const first = accountRecord();
        await store.createMerchantAccount(first);
        const second = await store.createMerchantAccount(accountRecord({ email: first.email }));
        expect(second).toEqual({ ok: false, reason: "EMAIL_TAKEN" });
        expect((await store.getMerchantAccountByEmail(first.email))?.id).toBe(first.id);
      });

      it("lets exactly one of two concurrent signups with the same email win", async () => {
        const email = `race-${newId("ma").toLowerCase()}@example.com`;
        const a = accountRecord({ email });
        const b = accountRecord({ email });
        const results = await Promise.all([store.createMerchantAccount(a), store.createMerchantAccount(b)]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok && r.reason === "EMAIL_TAKEN")).toHaveLength(1);
        const stored = await store.getMerchantAccountByEmail(email);
        const winner = results[0].ok ? a : b;
        expect(stored?.id).toBe(winner.id);
      });
    });

    describe("merchant sessions", () => {
      it("creates, reads and deletes a session; delete is idempotent", async () => {
        const session = { id: `sess-${newId("ma")}`, account_id: newId("ma"), created_at: at(0), expires_at: null };
        await store.createMerchantSession(session);
        expect(await store.getMerchantSession(session.id)).toEqual(session);
        await store.deleteMerchantSession(session.id);
        expect(await store.getMerchantSession(session.id)).toBeNull();
        await expect(store.deleteMerchantSession(session.id)).resolves.toBeUndefined();
      });

      it("keeps expires_at", async () => {
        const session = { id: `sess-${newId("ma")}`, account_id: newId("ma"), created_at: at(0), expires_at: at(60 * 24) };
        await store.createMerchantSession(session);
        expect((await store.getMerchantSession(session.id))?.expires_at).toBe(session.expires_at);
      });
    });

    /* ---------------------------------------------------------------- */
    /* Customers and tokens                                             */
    /* ---------------------------------------------------------------- */

    describe("customers", () => {
      it("creates and reads a customer by id, phone and id list", async () => {
        const customer = customerRecord();
        expect(await store.createCustomer(customer)).toEqual({ ok: true, value: customer });
        expect(await store.getCustomer(customer.id)).toEqual(customer);
        expect(await store.getCustomerByPhone(customer.phone)).toEqual(customer);
        const other = await newCustomer();
        const many = await store.getCustomersByIds([customer.id, other.id, newId("c")]);
        expect(many.map((c) => c.id).sort()).toEqual([customer.id, other.id].sort());
        expect(await store.getCustomer(newId("c"))).toBeNull();
      });

      it("rejects a second customer with the same phone", async () => {
        const first = await newCustomer();
        const second = await store.createCustomer(customerRecord({ phone: first.phone }));
        expect(second).toEqual({ ok: false, reason: "PHONE_TAKEN" });
      });

      it("lets exactly one of two concurrent signups with the same phone win", async () => {
        const phone = `+1814${randomDigits(7)}`;
        const results = await Promise.all([
          store.createCustomer(customerRecord({ phone })),
          store.createCustomer(customerRecord({ phone })),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok && r.reason === "PHONE_TAKEN")).toHaveLength(1);
      });

      it("updates the push token and name, and returns null for an unknown id", async () => {
        const customer = await newCustomer();
        const updated = await store.updateCustomer(customer.id, { expo_push_token: "ExponentPushToken[x]" });
        expect(updated?.expo_push_token).toBe("ExponentPushToken[x]");
        expect(updated?.phone).toBe(customer.phone);
        const renamed = await store.updateCustomer(customer.id, { name: "Alex" });
        expect(renamed?.name).toBe("Alex");
        expect(renamed?.expo_push_token).toBe("ExponentPushToken[x]");
        const cleared = await store.updateCustomer(customer.id, { expo_push_token: null });
        expect(cleared?.expo_push_token).toBeNull();
        expect(await store.updateCustomer(newId("c"), { name: "x" })).toBeNull();
      });
    });

    describe("customer tokens", () => {
      it("creates, reads and deletes a token; delete is idempotent", async () => {
        const token = { id: `tok-${newId("c")}`, customer_id: newId("c"), created_at: at(0) };
        await store.createCustomerToken(token);
        expect(await store.getCustomerToken(token.id)).toEqual(token);
        await store.deleteCustomerToken(token.id);
        expect(await store.getCustomerToken(token.id)).toBeNull();
        await expect(store.deleteCustomerToken(token.id)).resolves.toBeUndefined();
      });
    });

    /* ---------------------------------------------------------------- */
    /* Merchants                                                        */
    /* ---------------------------------------------------------------- */

    describe("merchants", () => {
      it("creates and reads a merchant by id, owner and id list", async () => {
        const merchant = merchantRecord({ lat: null, lng: null, menu: [] });
        expect(await store.createMerchant(merchant)).toEqual({ ok: true, value: merchant });
        expect(await store.getMerchant(merchant.id)).toEqual(merchant);
        expect(await store.getMerchantByOwner(merchant.owner_account_id)).toEqual(merchant);
        expect(await store.getMerchantByOwner(newId("ma"))).toBeNull();
        const many = await store.getMerchantsByIds([merchant.id, newId("m")]);
        expect(many).toEqual([merchant]);
      });

      it("allows one merchant per owner account", async () => {
        const first = merchantRecord();
        await store.createMerchant(first);
        const second = await store.createMerchant(merchantRecord({ owner_account_id: first.owner_account_id }));
        expect(second).toEqual({ ok: false, reason: "OWNER_HAS_MERCHANT" });
      });

      it("lets exactly one of two concurrent onboardings for one owner win", async () => {
        const owner = newId("ma");
        const results = await Promise.all([
          store.createMerchant(merchantRecord({ owner_account_id: owner })),
          store.createMerchant(merchantRecord({ owner_account_id: owner })),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
      });

      it("patches fields, keeps the rest, and can set lat/lng to null", async () => {
        const merchant = merchantRecord();
        await store.createMerchant(merchant);
        const updated = await store.updateMerchant(merchant.id, {
          name: "New Name",
          menu: [{ name: "Bagel", price_cents: 250 }],
          lat: null,
          lng: null,
        });
        expect(updated).toEqual({
          ...merchant,
          name: "New Name",
          menu: [{ name: "Bagel", price_cents: 250 }],
          lat: null,
          lng: null,
        });
        expect(await store.getMerchant(merchant.id)).toEqual(updated);
        expect(await store.updateMerchant(newId("m"), { name: "x" })).toBeNull();
      });
    });

    /* ---------------------------------------------------------------- */
    /* Deals                                                            */
    /* ---------------------------------------------------------------- */

    describe("deals", () => {
      it("creates a deal with version 1 and reads it back", async () => {
        const merchantId = newId("m");
        const input = dealRecord(merchantId);
        const created = await store.createDeal(input);
        expect(created).toEqual({ ...input, version: 1 });
        expect(await store.getDeal(input.id)).toEqual(created);
        expect(await store.getDeal(newId("d"))).toBeNull();
      });

      it("keeps null fields of a draft as null", async () => {
        const merchantId = newId("m");
        const draft = dealRecord(merchantId, {
          status: "draft",
          published_at: null,
          original_price_cents: null,
          deal_price_cents: null,
          quantity_total: null,
          quantity_left: null,
          pickup_end: null,
          allergens: null,
          note: null,
        });
        const created = await store.createDeal(draft);
        expect(await store.getDeal(draft.id)).toEqual(created);
        expect(created.allergens).toBeNull();
        expect(created.pickup_end).toBeNull();
      });

      it("returns copies: mutating results or inputs does not change stored state", async () => {
        const input = dealRecord(newId("m"));
        const created = await store.createDeal(input);
        input.items[0].name = "changed input";
        input.allergens?.push("changed");
        created.items[0].name = "changed output";
        const read = await store.getDeal(input.id);
        expect(read?.items[0].name).toBe("Butter croissant");
        expect(read?.allergens).toEqual(["wheat", "milk", "egg"]);
        read!.title = "changed read";
        expect((await store.getDeal(input.id))?.title).toBe("Croissants (2-pack)");
      });

      it("gets deals by id list, skipping unknown ids", async () => {
        const merchantId = newId("m");
        const a = await store.createDeal(dealRecord(merchantId));
        const b = await store.createDeal(dealRecord(merchantId));
        const many = await store.getDealsByIds([a.id, b.id, newId("d")]);
        expect(many.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
      });

      it("lists a merchant's deals newest first, with a limit", async () => {
        const merchantId = newId("m");
        const older = await store.createDeal(dealRecord(merchantId, { created_at: at(0) }));
        const newer = await store.createDeal(dealRecord(merchantId, { created_at: at(5), status: "draft", published_at: null }));
        const cancelled = await store.createDeal(dealRecord(merchantId, { created_at: at(3), status: "cancelled", cancelled_at: at(4) }));
        await store.createDeal(dealRecord(newId("m")));
        const all = await store.listDealsByMerchant(merchantId);
        expect(all.map((d) => d.id)).toEqual([newer.id, cancelled.id, older.id]);
        const limited = await store.listDealsByMerchant(merchantId, { limit: 2 });
        expect(limited.map((d) => d.id)).toEqual([newer.id, cancelled.id]);
      });

      it("lists a merchant's deals for one local date", async () => {
        const merchantId = newId("m");
        const today = await store.createDeal(dealRecord(merchantId));
        const draftToday = await store.createDeal(dealRecord(merchantId, { status: "draft", published_at: null, created_at: at(1) }));
        await store.createDeal(dealRecord(merchantId, { local_date: "2026-10-10", created_at: at(-24 * 60) }));
        const rows = await store.listDealsByMerchantDate(merchantId, DATE);
        expect(rows.map((d) => d.id)).toEqual([draftToday.id, today.id]);
        expect(await store.listDealsByMerchantDate(merchantId, "2026-10-12")).toEqual([]);
      });

      it("lists open deals: stored live, ending after the given time, soonest ending first", async () => {
        const merchantId = newId("m");
        const endsLater = await store.createDeal(dealRecord(merchantId, { pickup_end: at(180) }));
        const endsSooner = await store.createDeal(dealRecord(merchantId, { pickup_end: at(90) }));
        const soldOut = await store.createDeal(dealRecord(merchantId, { quantity_left: 0, pickup_end: at(150) }));
        const ended = await store.createDeal(dealRecord(merchantId, { pickup_start: at(-120), pickup_end: at(-30) }));
        const draft = await store.createDeal(dealRecord(merchantId, { status: "draft", published_at: null }));
        const cancelled = await store.createDeal(dealRecord(merchantId, { status: "cancelled", cancelled_at: at(1) }));
        const endsExactlyNow = await store.createDeal(dealRecord(merchantId, { pickup_start: at(-60), pickup_end: at(0) }));

        const mine = new Set([endsLater.id, endsSooner.id, soldOut.id, ended.id, draft.id, cancelled.id, endsExactlyNow.id]);
        const rows = (await store.listOpenDeals({ pickupEndAfter: at(0) })).filter((d) => mine.has(d.id));
        expect(rows.map((d) => d.id)).toEqual([endsSooner.id, soldOut.id, endsLater.id]);
      });

      it("orders open deals by instant even when offsets differ", async () => {
        const merchantId = newId("m");
        // 21:30Z written with -05:00 vs 21:00Z written with Z.
        const a = await store.createDeal(dealRecord(merchantId, { pickup_end: "2026-10-11T16:30:00-05:00" }));
        const b = await store.createDeal(dealRecord(merchantId, { pickup_end: "2026-10-11T21:00:00Z" }));
        const rows = (await store.listOpenDeals({ pickupEndAfter: at(0) })).filter((d) => d.id === a.id || d.id === b.id);
        expect(rows.map((d) => d.id)).toEqual([b.id, a.id]);
      });

      it("patches a deal, bumps the version and can set fields to null", async () => {
        const deal = await store.createDeal(dealRecord(newId("m"), { status: "draft", published_at: null }));
        const result = await store.updateDeal(deal.id, { title: "Plain croissant", note: null, allergens: [] });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual({ ...deal, title: "Plain croissant", note: null, allergens: [], version: 2 });
        expect(await store.getDeal(deal.id)).toEqual(result.value);

        const again = await store.updateDeal(deal.id, { allergens: null, pickup_end: null });
        expect(again.ok && again.value.allergens).toBeNull();
        expect(again.ok && again.value.pickup_end).toBeNull();
        expect(again.ok && again.value.version).toBe(3);
      });

      it("ignores fixed fields in a patch", async () => {
        const deal = await store.createDeal(dealRecord(newId("m")));
        const sneaky = { id: "other", merchant_id: "other", created_at: at(99), local_date: "1999-01-01", version: 42, note: "ok" } as unknown as DealPatch;
        const result = await store.updateDeal(deal.id, sneaky);
        expect(result.ok).toBe(true);
        const read = await store.getDeal(deal.id);
        expect(read).toEqual({ ...deal, note: "ok", version: 2 });
      });

      it("updates only at the expected version (optimistic concurrency)", async () => {
        const deal = await store.createDeal(dealRecord(newId("m")));
        const first = await store.updateDeal(deal.id, { deal_price_cents: 300 }, { ifVersion: 1 });
        expect(first.ok).toBe(true);
        const stale = await store.updateDeal(deal.id, { deal_price_cents: 350 }, { ifVersion: 1 });
        expect(stale).toEqual({ ok: false, reason: "VERSION_CONFLICT" });
        expect((await store.getDeal(deal.id))?.deal_price_cents).toBe(300);
        expect(await store.updateDeal(newId("d"), { note: "x" })).toEqual({ ok: false, reason: "NOT_FOUND" });
      });

      it("lets exactly one of two concurrent versioned updates win", async () => {
        const deal = await store.createDeal(dealRecord(newId("m")));
        const results = await Promise.all([
          store.updateDeal(deal.id, { deal_price_cents: 300 }, { ifVersion: deal.version }),
          store.updateDeal(deal.id, { deal_price_cents: 325 }, { ifVersion: deal.version }),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok && r.reason === "VERSION_CONFLICT")).toHaveLength(1);
        expect((await store.getDeal(deal.id))?.version).toBe(2);
      });
    });

    /* ---------------------------------------------------------------- */
    /* Reserve                                                          */
    /* ---------------------------------------------------------------- */

    describe("reserve", () => {
      it("creates a reservation, decrements quantity_left and bumps the deal version", async () => {
        const { merchant, deal, customer } = await liveDealSetup();
        const input = reserveInput(deal, customer, { quantity: 2, pickup_code: "4821" });
        const result = await store.reserve(input);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.reservation).toEqual({
          id: input.id,
          deal_id: deal.id,
          merchant_id: merchant.id,
          local_date: deal.local_date,
          customer_id: customer.id,
          customer_name: customer.name,
          customer_phone: customer.phone,
          quantity: 2,
          unit_price_cents: 400,
          total_cents: 800,
          payment_method: "in_store",
          pickup_code: "4821",
          status: "reserved",
          created_at: input.at,
          picked_up_at: null,
          cancelled_at: null,
        });
        expect(result.value.deal.quantity_left).toBe(1);
        expect(result.value.deal.version).toBe(deal.version + 1);
        expect(await store.getDeal(deal.id)).toEqual(result.value.deal);
        expect(await store.getReservation(input.id)).toEqual(result.value.reservation);
      });

      it("takes the unit price from the deal at the moment of reserving", async () => {
        const { deal, customer } = await liveDealSetup();
        const first = await store.reserve(reserveInput(deal, customer));
        await store.updateDeal(deal.id, { deal_price_cents: 300 });
        const other = await newCustomer();
        const second = await store.reserve(reserveInput(deal, other));
        expect(first.ok && first.value.reservation.unit_price_cents).toBe(400);
        expect(second.ok && second.value.reservation.unit_price_cents).toBe(300);
        expect(second.ok && second.value.reservation.total_cents).toBe(300);
        expect((await store.getReservation(first.ok ? first.value.reservation.id : ""))?.unit_price_cents).toBe(400);
      });

      it("fails with DEAL_NOT_FOUND for an unknown deal", async () => {
        const customer = await newCustomer();
        const result = await store.reserve(reserveInput({ id: newId("d") }, customer));
        expect(result).toEqual({ ok: false, reason: "DEAL_NOT_FOUND" });
      });

      it("fails with DEAL_NOT_LIVE for a draft or cancelled deal", async () => {
        const { deal: draft, customer } = await liveDealSetup({ status: "draft", published_at: null });
        expect(await store.reserve(reserveInput(draft, customer))).toEqual({ ok: false, reason: "DEAL_NOT_LIVE" });
        const { deal: cancelled, customer: c2 } = await liveDealSetup({ status: "cancelled", cancelled_at: at(1) });
        expect(await store.reserve(reserveInput(cancelled, c2))).toEqual({ ok: false, reason: "DEAL_NOT_LIVE" });
      });

      it("fails with DEAL_NOT_LIVE from pickup_end on, and works just before it", async () => {
        const { deal, customer } = await liveDealSetup();
        expect(await store.reserve(reserveInput(deal, customer, { at: deal.pickup_end! }))).toEqual({
          ok: false,
          reason: "DEAL_NOT_LIVE",
        });
        expect(await store.reserve(reserveInput(deal, customer, { at: at(130) }))).toEqual({
          ok: false,
          reason: "DEAL_NOT_LIVE",
        });
        const justBefore = await store.reserve(reserveInput(deal, customer, { at: at(119) }));
        expect(justBefore.ok).toBe(true);
        expect((await store.getDeal(deal.id))?.quantity_left).toBe(2);
      });

      it("allows reserving before pickup_start (from the moment it is live)", async () => {
        const { deal, customer } = await liveDealSetup();
        const result = await store.reserve(reserveInput(deal, customer, { at: at(1) }));
        expect(result.ok).toBe(true);
      });

      it("fails with SOLD_OUT when quantity exceeds quantity_left, without changing anything", async () => {
        const { deal, customer } = await liveDealSetup({ quantity_total: 3, quantity_left: 1, max_per_customer: 5 });
        const result = await store.reserve(reserveInput(deal, customer, { quantity: 2 }));
        expect(result).toEqual({ ok: false, reason: "SOLD_OUT" });
        expect(await store.getDeal(deal.id)).toEqual(deal);
        expect(await store.listReservationsByDeal(deal.id)).toEqual([]);
      });

      it("fails with SOLD_OUT when nothing is left", async () => {
        const { deal, customer } = await liveDealSetup({ quantity_left: 0 });
        expect(await store.reserve(reserveInput(deal, customer))).toEqual({ ok: false, reason: "SOLD_OUT" });
      });

      it("enforces max_per_customer across a customer's reserved and picked-up reservations", async () => {
        const { deal, customer } = await liveDealSetup({ quantity_total: 10, quantity_left: 10, max_per_customer: 2 });
        expect(await store.reserve(reserveInput(deal, customer, { quantity: 3 }))).toEqual({
          ok: false,
          reason: "MAX_PER_CUSTOMER",
        });
        const first = await store.reserve(reserveInput(deal, customer, { quantity: 1 }));
        expect(first.ok).toBe(true);
        const second = await store.reserve(reserveInput(deal, customer, { quantity: 1 }));
        expect(second.ok).toBe(true);
        if (second.ok) await store.markReservationPickedUp(second.value.reservation.id, { at: at(70) });
        expect(await store.reserve(reserveInput(deal, customer, { quantity: 1 }))).toEqual({
          ok: false,
          reason: "MAX_PER_CUSTOMER",
        });
        // Another customer is not affected.
        const other = await newCustomer();
        expect((await store.reserve(reserveInput(deal, other, { quantity: 2 }))).ok).toBe(true);
        // Cancelling frees the customer's allowance.
        if (first.ok) await store.cancelReservation(first.value.reservation.id, { at: at(20) });
        expect((await store.reserve(reserveInput(deal, customer, { quantity: 1 }))).ok).toBe(true);
      });

      it("keeps pickup codes unique among a merchant's open reservations", async () => {
        const { merchant, deal, customer } = await liveDealSetup({ quantity_total: 10, quantity_left: 10 });
        const other = await newCustomer();
        const first = await store.reserve(reserveInput(deal, customer, { pickup_code: "1234" }));
        expect(first.ok).toBe(true);
        expect(await store.reserve(reserveInput(deal, other, { pickup_code: "1234" }))).toEqual({
          ok: false,
          reason: "PICKUP_CODE_TAKEN",
        });
        // Same merchant, another deal: still taken.
        const secondDeal = await store.createDeal(dealRecord(merchant.id));
        expect(await store.reserve(reserveInput(secondDeal, other, { pickup_code: "1234" }))).toEqual({
          ok: false,
          reason: "PICKUP_CODE_TAKEN",
        });
        // Another merchant may use the same code.
        const { deal: elsewhere, customer: c3 } = await liveDealSetup();
        expect((await store.reserve(reserveInput(elsewhere, c3, { pickup_code: "1234" }))).ok).toBe(true);
        // A failed reserve does not hold units.
        expect((await store.getDeal(deal.id))?.quantity_left).toBe(9);
      });

      it("frees a pickup code when the reservation is picked up or cancelled", async () => {
        const { deal, customer } = await liveDealSetup({ quantity_total: 10, quantity_left: 10, max_per_customer: 10 });
        const first = await store.reserve(reserveInput(deal, customer, { pickup_code: "5555" }));
        expect(first.ok).toBe(true);
        if (first.ok) await store.markReservationPickedUp(first.value.reservation.id, { at: at(70) });
        const second = await store.reserve(reserveInput(deal, customer, { pickup_code: "5555" }));
        expect(second.ok).toBe(true);
        if (second.ok) await store.cancelReservation(second.value.reservation.id, { at: at(20) });
        const third = await store.reserve(reserveInput(deal, customer, { pickup_code: "5555" }));
        expect(third.ok).toBe(true);
      });

      it("lets exactly one of two concurrent reserves for the last unit succeed", async () => {
        const { deal, customer } = await liveDealSetup({ quantity_total: 3, quantity_left: 1 });
        const other = await newCustomer();
        const results = await Promise.all([
          store.reserve(reserveInput(deal, customer)),
          store.reserve(reserveInput(deal, other)),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok && r.reason === "SOLD_OUT")).toHaveLength(1);
        expect((await store.getDeal(deal.id))?.quantity_left).toBe(0);
        expect(await store.listReservationsByDeal(deal.id)).toHaveLength(1);
      });

      it("never oversells under many concurrent reserves", async () => {
        const { deal } = await liveDealSetup({ quantity_total: 3, quantity_left: 3 });
        const customers = await Promise.all(Array.from({ length: 8 }, () => newCustomer()));
        const results = await Promise.all(customers.map((c) => store.reserve(reserveInput(deal, c))));
        expect(results.filter((r) => r.ok)).toHaveLength(3);
        expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "SOLD_OUT")).toBe(true);
        expect((await store.getDeal(deal.id))?.quantity_left).toBe(0);
        const reservations = await store.listReservationsByDeal(deal.id);
        expect(reservations).toHaveLength(3);
        expect(new Set(reservations.map((r) => r.pickup_code)).size).toBe(3);
      });

      it("lets exactly one of two concurrent reserves with the same pickup code succeed", async () => {
        const { deal, customer } = await liveDealSetup({ quantity_total: 5, quantity_left: 5 });
        const other = await newCustomer();
        const results = await Promise.all([
          store.reserve(reserveInput(deal, customer, { pickup_code: "7777" })),
          store.reserve(reserveInput(deal, other, { pickup_code: "7777" })),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok && r.reason === "PICKUP_CODE_TAKEN")).toHaveLength(1);
        expect((await store.getDeal(deal.id))?.quantity_left).toBe(4);
      });
    });

    /* ---------------------------------------------------------------- */
    /* Reservation transitions and lists                                */
    /* ---------------------------------------------------------------- */

    describe("reservation transitions", () => {
      it("cancel returns units to the deal and is allowed once", async () => {
        const { deal, customer } = await liveDealSetup({ quantity_left: 2 });
        const reserved = await store.reserve(reserveInput(deal, customer, { quantity: 2 }));
        expect(reserved.ok && reserved.value.deal.quantity_left).toBe(0);
        if (!reserved.ok) return;
        const id = reserved.value.reservation.id;
        const cancelled = await store.cancelReservation(id, { at: at(30) });
        expect(cancelled.ok).toBe(true);
        if (!cancelled.ok) return;
        expect(cancelled.value.reservation.status).toBe("cancelled");
        expect(cancelled.value.reservation.cancelled_at).toBe(at(30));
        expect(cancelled.value.deal.quantity_left).toBe(2);
        expect(cancelled.value.deal.version).toBe(reserved.value.deal.version + 1);
        expect(await store.getReservation(id)).toEqual(cancelled.value.reservation);
        expect(await store.cancelReservation(id, { at: at(31) })).toEqual({ ok: false, reason: "NOT_OPEN" });
        expect((await store.getDeal(deal.id))?.quantity_left).toBe(2);
        expect(await store.cancelReservation(newId("r"), { at: at(31) })).toEqual({ ok: false, reason: "NOT_FOUND" });
      });

      it("pickup keeps units taken and is allowed once", async () => {
        const { deal, customer } = await liveDealSetup();
        const reserved = await store.reserve(reserveInput(deal, customer));
        if (!reserved.ok) throw new Error("reserve failed");
        const id = reserved.value.reservation.id;
        const picked = await store.markReservationPickedUp(id, { at: at(65) });
        expect(picked.ok).toBe(true);
        if (!picked.ok) return;
        expect(picked.value.status).toBe("picked_up");
        expect(picked.value.picked_up_at).toBe(at(65));
        expect((await store.getDeal(deal.id))?.quantity_left).toBe(2);
        expect(await store.markReservationPickedUp(id, { at: at(66) })).toEqual({ ok: false, reason: "NOT_OPEN" });
        expect(await store.cancelReservation(id, { at: at(66) })).toEqual({ ok: false, reason: "NOT_OPEN" });
        expect(await store.markReservationPickedUp(newId("r"), { at: at(66) })).toEqual({ ok: false, reason: "NOT_FOUND" });
      });

      it("lets exactly one of a concurrent redeem and confirm-pickup succeed", async () => {
        const { deal, customer } = await liveDealSetup();
        const reserved = await store.reserve(reserveInput(deal, customer));
        if (!reserved.ok) throw new Error("reserve failed");
        const id = reserved.value.reservation.id;
        const results = await Promise.all([
          store.markReservationPickedUp(id, { at: at(65) }),
          store.markReservationPickedUp(id, { at: at(65) }),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
      });

      it("lets exactly one of a concurrent cancel and pickup succeed, keeping units consistent", async () => {
        const { deal, customer } = await liveDealSetup();
        const reserved = await store.reserve(reserveInput(deal, customer));
        if (!reserved.ok) throw new Error("reserve failed");
        const id = reserved.value.reservation.id;
        const [cancel, pickup] = await Promise.all([
          store.cancelReservation(id, { at: at(65) }),
          store.markReservationPickedUp(id, { at: at(65) }),
        ]);
        expect([cancel.ok, pickup.ok].filter(Boolean)).toHaveLength(1);
        const left = (await store.getDeal(deal.id))?.quantity_left;
        expect(left).toBe(cancel.ok ? 3 : 2);
      });

      it("lists reservations by customer, deal, merchant date and pickup code", async () => {
        const { merchant, deal, customer } = await liveDealSetup({ quantity_total: 10, quantity_left: 10, max_per_customer: 10 });
        const other = await newCustomer();
        const r1 = await store.reserve(reserveInput(deal, customer, { at: at(10), pickup_code: "1111" }));
        const r2 = await store.reserve(reserveInput(deal, other, { at: at(20), pickup_code: "2222" }));
        const r3 = await store.reserve(reserveInput(deal, customer, { at: at(30), pickup_code: "3333" }));
        if (!r1.ok || !r2.ok || !r3.ok) throw new Error("reserve failed");
        const [id1, id2, id3] = [r1, r2, r3].map((r) => (r.ok ? r.value.reservation.id : ""));

        expect((await store.listReservationsByCustomer(customer.id)).map((r) => r.id)).toEqual([id3, id1]);
        expect((await store.listReservationsByDeal(deal.id)).map((r) => r.id)).toEqual([id3, id2, id1]);
        expect((await store.listReservationsByMerchantDate(merchant.id, DATE)).map((r) => r.id)).toEqual([id3, id2, id1]);
        expect(await store.listReservationsByMerchantDate(merchant.id, "2026-10-12")).toEqual([]);
        expect(await store.listReservationsByCustomer(newId("c"))).toEqual([]);

        expect((await store.findReservationsByPickupCode(merchant.id, "2222")).map((r) => r.id)).toEqual([id2]);
        expect(await store.findReservationsByPickupCode(merchant.id, "9999")).toEqual([]);
        expect(await store.findReservationsByPickupCode(newId("m"), "2222")).toEqual([]);
      });

      it("finds every reservation that ever used a code, newest first, with at most one open", async () => {
        const { merchant, deal, customer } = await liveDealSetup({ quantity_total: 10, quantity_left: 10, max_per_customer: 10 });
        const first = await store.reserve(reserveInput(deal, customer, { pickup_code: "4242", at: at(10) }));
        if (!first.ok) throw new Error("reserve failed");
        await store.markReservationPickedUp(first.value.reservation.id, { at: at(61) });
        const second = await store.reserve(reserveInput(deal, customer, { pickup_code: "4242", at: at(62) }));
        if (!second.ok) throw new Error("reserve failed");
        const rows = await store.findReservationsByPickupCode(merchant.id, "4242");
        expect(rows.map((r) => [r.id, r.status])).toEqual([
          [second.value.reservation.id, "reserved"],
          [first.value.reservation.id, "picked_up"],
        ]);
      });
    });

    /* ---------------------------------------------------------------- */
    /* Cancel deal                                                      */
    /* ---------------------------------------------------------------- */

    describe("cancelDeal", () => {
      it("cancels the deal and its open reservations, not picked-up ones", async () => {
        const { deal, customer } = await liveDealSetup({ quantity_total: 5, quantity_left: 5, max_per_customer: 5 });
        const other = await newCustomer();
        const open1 = await store.reserve(reserveInput(deal, customer, { pickup_code: "1010" }));
        const open2 = await store.reserve(reserveInput(deal, other, { pickup_code: "2020" }));
        const picked = await store.reserve(reserveInput(deal, customer, { pickup_code: "3030" }));
        if (!open1.ok || !open2.ok || !picked.ok) throw new Error("reserve failed");
        await store.markReservationPickedUp(picked.value.reservation.id, { at: at(61) });

        const result = await store.cancelDeal(deal.id, { at: at(62) });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.deal.status).toBe("cancelled");
        expect(result.value.deal.cancelled_at).toBe(at(62));
        expect(result.value.cancelled_reservations.map((r) => r.id).sort()).toEqual(
          [open1.value.reservation.id, open2.value.reservation.id].sort(),
        );
        expect(result.value.cancelled_reservations.every((r) => r.status === "cancelled" && r.cancelled_at === at(62))).toBe(true);
        expect((await store.getReservation(open1.value.reservation.id))?.status).toBe("cancelled");
        expect((await store.getReservation(picked.value.reservation.id))?.status).toBe("picked_up");
        expect(await store.getDeal(deal.id)).toEqual(result.value.deal);
        expect(await store.reserve(reserveInput(deal, other))).toEqual({ ok: false, reason: "DEAL_NOT_LIVE" });
      });

      it("frees the pickup codes of cancelled reservations", async () => {
        const { merchant, deal, customer } = await liveDealSetup();
        const r = await store.reserve(reserveInput(deal, customer, { pickup_code: "8080" }));
        expect(r.ok).toBe(true);
        await store.cancelDeal(deal.id, { at: at(20) });
        const another = await store.createDeal(dealRecord(merchant.id));
        expect((await store.reserve(reserveInput(another, customer, { pickup_code: "8080" }))).ok).toBe(true);
      });

      it("cancels a draft", async () => {
        const { deal } = await liveDealSetup({ status: "draft", published_at: null });
        const result = await store.cancelDeal(deal.id, { at: at(5) });
        expect(result.ok && result.value.deal.status).toBe("cancelled");
        expect(result.ok && result.value.cancelled_reservations).toEqual([]);
      });

      it("refuses an already cancelled deal, a live deal past pickup_end and an unknown deal", async () => {
        const { deal } = await liveDealSetup();
        expect((await store.cancelDeal(deal.id, { at: at(5) })).ok).toBe(true);
        expect(await store.cancelDeal(deal.id, { at: at(6) })).toEqual({ ok: false, reason: "NOT_CANCELLABLE" });
        const { deal: ended } = await liveDealSetup();
        expect(await store.cancelDeal(ended.id, { at: ended.pickup_end! })).toEqual({ ok: false, reason: "NOT_CANCELLABLE" });
        expect((await store.getDeal(ended.id))?.status).toBe("live");
        expect(await store.cancelDeal(newId("d"), { at: at(5) })).toEqual({ ok: false, reason: "NOT_FOUND" });
      });
    });

    /* ---------------------------------------------------------------- */
    /* Follows                                                          */
    /* ---------------------------------------------------------------- */

    describe("follows", () => {
      it("adds and removes follows idempotently and lists both directions", async () => {
        const customer = newId("c");
        const other = newId("c");
        const m1 = newId("m");
        const m2 = newId("m");
        await store.addFollow(customer, m1, at(0));
        await store.addFollow(customer, m1, at(1));
        await store.addFollow(customer, m2, at(2));
        await store.addFollow(other, m1, at(3));
        expect(await store.listFollowedMerchantIds(customer)).toEqual([m2, m1]);
        expect((await store.listFollowerIds(m1)).sort()).toEqual([customer, other].sort());
        await store.removeFollow(customer, m1);
        await store.removeFollow(customer, m1);
        expect(await store.listFollowedMerchantIds(customer)).toEqual([m2]);
        expect(await store.listFollowerIds(m1)).toEqual([other]);
        expect(await store.listFollowedMerchantIds(newId("c"))).toEqual([]);
        expect(await store.listFollowerIds(newId("m"))).toEqual([]);
      });
    });

    /* ---------------------------------------------------------------- */
    /* Notifications                                                    */
    /* ---------------------------------------------------------------- */

    describe("notifications", () => {
      it("creates and lists a customer's notifications newest first", async () => {
        const customer = newId("c");
        const n1 = notificationRecord(customer, { created_at: at(0) });
        const n2 = notificationRecord(customer, { created_at: at(10), type: "deal_cancelled", deal_id: newId("d") });
        const elsewhere = notificationRecord(newId("c"));
        expect(await store.createNotification(n1)).toEqual({ notification: n1, created: true });
        await store.createNotification(n2);
        await store.createNotification(elsewhere);
        expect(await store.listNotificationsByCustomer(customer)).toEqual([n2, n1]);
        expect(await store.getNotification(n1.id)).toEqual(n1);
        expect(await store.getNotification(newId("n"))).toBeNull();
      });

      it("filters by since (created at or after it)", async () => {
        const customer = newId("c");
        const n1 = notificationRecord(customer, { created_at: at(0) });
        const n2 = notificationRecord(customer, { created_at: at(10) });
        const n3 = notificationRecord(customer, { created_at: at(20) });
        const n3b = notificationRecord(customer, { created_at: at(20) });
        for (const n of [n1, n2, n3, n3b]) await store.createNotification(n);
        // Ties (n3, n3b) may come in either order, so compare sorted ids.
        const ids = async (since: string) =>
          (await store.listNotificationsByCustomer(customer, { since })).map((n) => n.id).sort();
        const sorted = (...list: NotificationRecord[]) => list.map((n) => n.id).sort();
        expect(await ids(at(10))).toEqual(sorted(n3, n3b, n2));
        expect(await ids(at(20))).toEqual(sorted(n3, n3b));
        expect(await ids(at(21))).toEqual([]);
        expect(await ids(at(-1))).toEqual(sorted(n1, n2, n3, n3b));
        // Same instants written with another offset, and with milliseconds.
        expect(await ids("2026-10-11T20:05:00Z")).toEqual(sorted(n3, n3b, n2));
        expect(await ids(new Date(Date.parse(at(10)) + 1).toISOString())).toEqual(sorted(n3, n3b));
        expect(await ids(new Date(Date.parse(at(20))).toISOString())).toEqual(sorted(n3, n3b));
      });

      it("deduplicates by customer and dedupe_key", async () => {
        const customer = newId("c");
        const key = `pickup_reminder:${newId("r")}`;
        const first = notificationRecord(customer, { type: "pickup_reminder", dedupe_key: key });
        const second = notificationRecord(customer, { type: "pickup_reminder", dedupe_key: key, created_at: at(5) });
        expect(await store.createNotification(first)).toEqual({ notification: first, created: true });
        expect(await store.createNotification(second)).toEqual({ notification: first, created: false });
        expect(await store.getNotification(second.id)).toBeNull();
        // The same key for another customer is a different notification.
        const otherCustomer = notificationRecord(newId("c"), { dedupe_key: key });
        expect((await store.createNotification(otherCustomer)).created).toBe(true);
        // null keys never deduplicate.
        const a = notificationRecord(customer);
        const b = notificationRecord(customer);
        expect((await store.createNotification(a)).created).toBe(true);
        expect((await store.createNotification(b)).created).toBe(true);
        expect(await store.listNotificationsByCustomer(customer)).toHaveLength(3);
      });

      it("creates one notification under concurrent creates with the same dedupe_key", async () => {
        const customer = newId("c");
        const key = `pickup_reminder:${newId("r")}`;
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            store.createNotification(notificationRecord(customer, { type: "pickup_reminder", dedupe_key: key })),
          ),
        );
        expect(results.filter((r) => r.created)).toHaveLength(1);
        const winner = results.find((r) => r.created)!.notification;
        expect(results.every((r) => r.notification.id === winner.id)).toBe(true);
        expect(await store.listNotificationsByCustomer(customer)).toHaveLength(1);
      });

      it("marks a notification read, idempotently", async () => {
        const n = notificationRecord(newId("c"));
        await store.createNotification(n);
        expect(await store.markNotificationRead(n.id)).toEqual({ ...n, read: true });
        expect(await store.markNotificationRead(n.id)).toEqual({ ...n, read: true });
        expect((await store.getNotification(n.id))?.read).toBe(true);
        expect(await store.markNotificationRead(newId("n"))).toBeNull();
      });
    });

    /* ---------------------------------------------------------------- */
    /* Suggestion state                                                 */
    /* ---------------------------------------------------------------- */

    describe("suggestion state", () => {
      it("puts, replaces, reads and lists states per merchant", async () => {
        const merchantId = newId("m");
        const dealId = newId("d");
        const lowerPrice = {
          id: `s_lower_price_${dealId}`,
          merchant_id: merchantId,
          type: "lower_price" as const,
          deal_id: dealId,
          local_date: null,
          state: "dismissed" as const,
          updated_at: at(0),
        };
        const listNow = {
          id: `s_list_now_${DATE}`,
          merchant_id: merchantId,
          type: "list_now" as const,
          deal_id: null,
          local_date: DATE,
          state: "dismissed" as const,
          updated_at: at(1),
        };
        await store.putSuggestionState(lowerPrice);
        await store.putSuggestionState(listNow);
        await store.putSuggestionState({ ...listNow, merchant_id: newId("m") });
        expect(await store.getSuggestionState(merchantId, lowerPrice.id)).toEqual(lowerPrice);
        expect(await store.getSuggestionState(merchantId, "missing")).toBeNull();
        const listed = await store.listSuggestionStates(merchantId);
        expect(listed.map((s) => s.id).sort()).toEqual([lowerPrice.id, listNow.id].sort());

        const accepted = { ...lowerPrice, state: "accepted" as const, updated_at: at(5) };
        await store.putSuggestionState(accepted);
        expect(await store.getSuggestionState(merchantId, lowerPrice.id)).toEqual(accepted);
        expect(await store.listSuggestionStates(merchantId)).toHaveLength(2);
        expect(await store.listSuggestionStates(newId("m"))).toEqual([]);
      });
    });
  });
}
