/**
 * In-memory Store driver for tests and local development.
 *
 * - `createMemoryStore()` returns a fresh, empty store (tests).
 * - `getMemoryStore()` returns one shared instance kept on globalThis, so it
 *   survives Next.js hot reload and is shared by every route bundle in the
 *   same process. Data is lost when the process exits, and separate server
 *   instances (e.g. serverless) do not share it: never use it in production.
 * - Every method does all its checks and writes synchronously, without an
 *   await in between, so each call is atomic with respect to other calls.
 * - Records are deep-copied on the way in and out.
 */
import { toMs } from "@/lib/clock";
import type {
  CustomerRecord,
  CustomerTokenRecord,
  DealPatch,
  DealRecord,
  MerchantAccountRecord,
  MerchantRecord,
  MerchantSessionRecord,
  NewDealRecord,
  NotificationRecord,
  ReservationRecord,
  ReserveFailure,
  ReserveInput,
  Store,
  SuggestionStateRecord,
  UpdateDealOptions,
} from "./types";

const clone = <T>(value: T): T => structuredClone(value);

function fail<R extends string>(reason: R): { ok: false; reason: R } {
  return { ok: false, reason };
}

function okResult<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

const key = (...parts: string[]) => parts.join("\u0000");

interface MemoryState {
  merchantAccounts: Map<string, MerchantAccountRecord>;
  merchantAccountIdByEmail: Map<string, string>;
  merchantSessions: Map<string, MerchantSessionRecord>;
  customers: Map<string, CustomerRecord>;
  customerIdByPhone: Map<string, string>;
  customerTokens: Map<string, CustomerTokenRecord>;
  merchants: Map<string, MerchantRecord>;
  merchantIdByOwner: Map<string, string>;
  deals: Map<string, DealRecord>;
  reservations: Map<string, ReservationRecord>;
  /** merchantId + pickup code -> id of the reservation holding it (stored status reserved). */
  openPickupCodes: Map<string, string>;
  /** customerId -> (merchantId -> followed at). */
  follows: Map<string, Map<string, string>>;
  notifications: Map<string, NotificationRecord>;
  /** customerId + dedupe_key -> notification id. */
  notificationIdByDedupe: Map<string, string>;
  /** merchantId + suggestion id -> state. */
  suggestionStates: Map<string, SuggestionStateRecord>;
  /** Insertion order, to keep newest-first order stable for equal timestamps. */
  insertionSeq: Map<string, number>;
  nextSeq: number;
}

function emptyState(): MemoryState {
  return {
    merchantAccounts: new Map(),
    merchantAccountIdByEmail: new Map(),
    merchantSessions: new Map(),
    customers: new Map(),
    customerIdByPhone: new Map(),
    customerTokens: new Map(),
    merchants: new Map(),
    merchantIdByOwner: new Map(),
    deals: new Map(),
    reservations: new Map(),
    openPickupCodes: new Map(),
    follows: new Map(),
    notifications: new Map(),
    notificationIdByDedupe: new Map(),
    suggestionStates: new Map(),
    insertionSeq: new Map(),
    nextSeq: 0,
  };
}

/** A fresh, empty in-memory store. */
export function createMemoryStore(): Store {
  const s = emptyState();

  const remember = (kind: string, id: string) => {
    s.insertionSeq.set(key(kind, id), s.nextSeq++);
  };

  /** Newest first by created_at, then by insertion order. */
  const newestFirst = <T extends { id: string; created_at: string }>(kind: string, rows: T[]): T[] =>
    rows.sort((a, b) => {
      const byTime = toMs(b.created_at) - toMs(a.created_at);
      if (byTime !== 0) return byTime;
      return (s.insertionSeq.get(key(kind, b.id)) ?? 0) - (s.insertionSeq.get(key(kind, a.id)) ?? 0);
    });

  const assertNew = (map: Map<string, unknown>, id: string, what: string) => {
    if (map.has(id)) throw new Error(`memory store: ${what} ${id} already exists`);
  };

  const pickupCodeKey = (merchantId: string, code: string) => key(merchantId, code);

  const customerQuantityOnDeal = (dealId: string, customerId: string): number => {
    let total = 0;
    for (const r of s.reservations.values()) {
      if (r.deal_id === dealId && r.customer_id === customerId && r.status !== "cancelled") {
        total += r.quantity;
      }
    }
    return total;
  };

  const store: Store = {
    /* Merchant accounts ---------------------------------------------- */

    async createMerchantAccount(record) {
      if (s.merchantAccountIdByEmail.has(record.email)) return fail("EMAIL_TAKEN");
      assertNew(s.merchantAccounts, record.id, "merchant account");
      s.merchantAccounts.set(record.id, clone(record));
      s.merchantAccountIdByEmail.set(record.email, record.id);
      return okResult(clone(record));
    },

    async getMerchantAccount(id) {
      const row = s.merchantAccounts.get(id);
      return row ? clone(row) : null;
    },

    async getMerchantAccountByEmail(email) {
      const id = s.merchantAccountIdByEmail.get(email);
      const row = id === undefined ? undefined : s.merchantAccounts.get(id);
      return row ? clone(row) : null;
    },

    /* Merchant sessions ---------------------------------------------- */

    async createMerchantSession(record) {
      assertNew(s.merchantSessions, record.id, "merchant session");
      s.merchantSessions.set(record.id, clone(record));
    },

    async getMerchantSession(id) {
      const row = s.merchantSessions.get(id);
      return row ? clone(row) : null;
    },

    async deleteMerchantSession(id) {
      s.merchantSessions.delete(id);
    },

    /* Customers ------------------------------------------------------ */

    async createCustomer(record) {
      if (s.customerIdByPhone.has(record.phone)) return fail("PHONE_TAKEN");
      assertNew(s.customers, record.id, "customer");
      s.customers.set(record.id, clone(record));
      s.customerIdByPhone.set(record.phone, record.id);
      return okResult(clone(record));
    },

    async getCustomer(id) {
      const row = s.customers.get(id);
      return row ? clone(row) : null;
    },

    async getCustomerByPhone(phone) {
      const id = s.customerIdByPhone.get(phone);
      const row = id === undefined ? undefined : s.customers.get(id);
      return row ? clone(row) : null;
    },

    async getCustomersByIds(ids) {
      const out: CustomerRecord[] = [];
      for (const id of new Set(ids)) {
        const row = s.customers.get(id);
        if (row) out.push(clone(row));
      }
      return out;
    },

    async updateCustomer(id, patch) {
      const row = s.customers.get(id);
      if (!row) return null;
      const next: CustomerRecord = { ...row };
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.expo_push_token !== undefined) next.expo_push_token = patch.expo_push_token;
      s.customers.set(id, clone(next));
      return clone(next);
    },

    /* Customer tokens ------------------------------------------------ */

    async createCustomerToken(record) {
      assertNew(s.customerTokens, record.id, "customer token");
      s.customerTokens.set(record.id, clone(record));
    },

    async getCustomerToken(id) {
      const row = s.customerTokens.get(id);
      return row ? clone(row) : null;
    },

    async deleteCustomerToken(id) {
      s.customerTokens.delete(id);
    },

    /* Merchants ------------------------------------------------------ */

    async createMerchant(record) {
      if (s.merchantIdByOwner.has(record.owner_account_id)) return fail("OWNER_HAS_MERCHANT");
      assertNew(s.merchants, record.id, "merchant");
      s.merchants.set(record.id, clone(record));
      s.merchantIdByOwner.set(record.owner_account_id, record.id);
      return okResult(clone(record));
    },

    async getMerchant(id) {
      const row = s.merchants.get(id);
      return row ? clone(row) : null;
    },

    async getMerchantByOwner(accountId) {
      const id = s.merchantIdByOwner.get(accountId);
      const row = id === undefined ? undefined : s.merchants.get(id);
      return row ? clone(row) : null;
    },

    async getMerchantsByIds(ids) {
      const out: MerchantRecord[] = [];
      for (const id of new Set(ids)) {
        const row = s.merchants.get(id);
        if (row) out.push(clone(row));
      }
      return out;
    },

    async updateMerchant(id, patch) {
      const row = s.merchants.get(id);
      if (!row) return null;
      const allowed = definedFields(patch, ["id", "owner_account_id", "created_at"]);
      const next: MerchantRecord = { ...row, ...clone(allowed) };
      s.merchants.set(id, clone(next));
      return clone(next);
    },

    /* Deals ---------------------------------------------------------- */

    async createDeal(record: NewDealRecord) {
      assertNew(s.deals, record.id, "deal");
      const stored: DealRecord = { ...clone(record), version: 1 };
      s.deals.set(stored.id, stored);
      remember("deal", stored.id);
      return clone(stored);
    },

    async getDeal(id) {
      const row = s.deals.get(id);
      return row ? clone(row) : null;
    },

    async getDealsByIds(ids) {
      const out: DealRecord[] = [];
      for (const id of new Set(ids)) {
        const row = s.deals.get(id);
        if (row) out.push(clone(row));
      }
      return out;
    },

    async listDealsByMerchant(merchantId, options) {
      const rows = newestFirst(
        "deal",
        [...s.deals.values()].filter((d) => d.merchant_id === merchantId),
      );
      const limited = options?.limit !== undefined ? rows.slice(0, Math.max(0, options.limit)) : rows;
      return limited.map(clone);
    },

    async listDealsByMerchantDate(merchantId, localDate) {
      return newestFirst(
        "deal",
        [...s.deals.values()].filter((d) => d.merchant_id === merchantId && d.local_date === localDate),
      ).map(clone);
    },

    async listOpenDeals({ pickupEndAfter }) {
      const after = toMs(pickupEndAfter);
      return [...s.deals.values()]
        .filter((d) => d.status === "live" && d.pickup_end !== null && toMs(d.pickup_end) > after)
        .sort((a, b) => toMs(a.pickup_end as string) - toMs(b.pickup_end as string))
        .map(clone);
    },

    async updateDeal(id, patch: DealPatch, options?: UpdateDealOptions) {
      const row = s.deals.get(id);
      if (!row) return fail("NOT_FOUND");
      if (options?.ifVersion !== undefined && row.version !== options.ifVersion) {
        return fail("VERSION_CONFLICT");
      }
      const allowed = definedFields(patch, ["id", "merchant_id", "created_at", "local_date", "version"]);
      const next: DealRecord = { ...row, ...clone(allowed), version: row.version + 1 };
      s.deals.set(id, next);
      return okResult(clone(next));
    },

    async cancelDeal(id, { at }) {
      const deal = s.deals.get(id);
      if (!deal) return fail("NOT_FOUND");
      const cancellable =
        deal.status === "draft" ||
        (deal.status === "live" && (deal.pickup_end === null || toMs(at) < toMs(deal.pickup_end)));
      if (!cancellable) return fail("NOT_CANCELLABLE");

      const cancelled: ReservationRecord[] = [];
      for (const r of s.reservations.values()) {
        if (r.deal_id !== id || r.status !== "reserved") continue;
        const next: ReservationRecord = { ...r, status: "cancelled", cancelled_at: at };
        s.reservations.set(r.id, next);
        s.openPickupCodes.delete(pickupCodeKey(r.merchant_id, r.pickup_code));
        cancelled.push(next);
      }
      const nextDeal: DealRecord = {
        ...deal,
        status: "cancelled",
        cancelled_at: at,
        version: deal.version + 1,
      };
      s.deals.set(id, nextDeal);
      return okResult({
        deal: clone(nextDeal),
        cancelled_reservations: newestFirst("reservation", cancelled).map(clone),
      });
    },

    /* Reservations --------------------------------------------------- */

    async reserve(input: ReserveInput) {
      if (!Number.isInteger(input.quantity) || input.quantity < 1) {
        throw new Error(`memory store: reserve quantity must be an integer >= 1, got ${input.quantity}`);
      }
      assertNew(s.reservations, input.id, "reservation");
      const deal = s.deals.get(input.deal_id);
      if (!deal) return fail<ReserveFailure>("DEAL_NOT_FOUND");
      if (
        deal.status !== "live" ||
        deal.pickup_end === null ||
        deal.deal_price_cents === null ||
        toMs(input.at) >= toMs(deal.pickup_end)
      ) {
        return fail<ReserveFailure>("DEAL_NOT_LIVE");
      }
      if ((deal.quantity_left ?? 0) < input.quantity) return fail<ReserveFailure>("SOLD_OUT");
      if (customerQuantityOnDeal(deal.id, input.customer_id) + input.quantity > deal.max_per_customer) {
        return fail<ReserveFailure>("MAX_PER_CUSTOMER");
      }
      const codeKey = pickupCodeKey(deal.merchant_id, input.pickup_code);
      if (s.openPickupCodes.has(codeKey)) return fail<ReserveFailure>("PICKUP_CODE_TAKEN");

      const nextDeal: DealRecord = {
        ...deal,
        quantity_left: (deal.quantity_left ?? 0) - input.quantity,
        version: deal.version + 1,
      };
      const reservation: ReservationRecord = {
        id: input.id,
        deal_id: deal.id,
        merchant_id: deal.merchant_id,
        local_date: deal.local_date,
        customer_id: input.customer_id,
        customer_name: input.customer_name,
        customer_phone: input.customer_phone,
        quantity: input.quantity,
        unit_price_cents: deal.deal_price_cents,
        total_cents: input.quantity * deal.deal_price_cents,
        payment_method: input.payment_method,
        pickup_code: input.pickup_code,
        status: "reserved",
        created_at: input.at,
        picked_up_at: null,
        cancelled_at: null,
      };
      s.deals.set(deal.id, nextDeal);
      s.reservations.set(reservation.id, reservation);
      s.openPickupCodes.set(codeKey, reservation.id);
      remember("reservation", reservation.id);
      return okResult({ reservation: clone(reservation), deal: clone(nextDeal) });
    },

    async getReservation(id) {
      const row = s.reservations.get(id);
      return row ? clone(row) : null;
    },

    async listReservationsByCustomer(customerId) {
      return newestFirst(
        "reservation",
        [...s.reservations.values()].filter((r) => r.customer_id === customerId),
      ).map(clone);
    },

    async listReservationsByDeal(dealId) {
      return newestFirst(
        "reservation",
        [...s.reservations.values()].filter((r) => r.deal_id === dealId),
      ).map(clone);
    },

    async listReservationsByMerchantDate(merchantId, localDate) {
      return newestFirst(
        "reservation",
        [...s.reservations.values()].filter(
          (r) => r.merchant_id === merchantId && r.local_date === localDate,
        ),
      ).map(clone);
    },

    async findReservationsByPickupCode(merchantId, pickupCode) {
      return newestFirst(
        "reservation",
        [...s.reservations.values()].filter(
          (r) => r.merchant_id === merchantId && r.pickup_code === pickupCode,
        ),
      ).map(clone);
    },

    async cancelReservation(id, { at }) {
      const r = s.reservations.get(id);
      if (!r) return fail("NOT_FOUND");
      if (r.status !== "reserved") return fail("NOT_OPEN");
      const deal = s.deals.get(r.deal_id);
      if (!deal) throw new Error(`memory store: deal ${r.deal_id} of reservation ${id} is missing`);
      const nextReservation: ReservationRecord = { ...r, status: "cancelled", cancelled_at: at };
      const nextDeal: DealRecord = {
        ...deal,
        quantity_left: (deal.quantity_left ?? 0) + r.quantity,
        version: deal.version + 1,
      };
      s.reservations.set(id, nextReservation);
      s.deals.set(deal.id, nextDeal);
      s.openPickupCodes.delete(pickupCodeKey(r.merchant_id, r.pickup_code));
      return okResult({ reservation: clone(nextReservation), deal: clone(nextDeal) });
    },

    async markReservationPickedUp(id, { at }) {
      const r = s.reservations.get(id);
      if (!r) return fail("NOT_FOUND");
      if (r.status !== "reserved") return fail("NOT_OPEN");
      const next: ReservationRecord = { ...r, status: "picked_up", picked_up_at: at };
      s.reservations.set(id, next);
      s.openPickupCodes.delete(pickupCodeKey(r.merchant_id, r.pickup_code));
      return okResult(clone(next));
    },

    /* Follows -------------------------------------------------------- */

    async addFollow(customerId, merchantId, at) {
      let followed = s.follows.get(customerId);
      if (!followed) {
        followed = new Map();
        s.follows.set(customerId, followed);
      }
      if (!followed.has(merchantId)) followed.set(merchantId, at);
    },

    async removeFollow(customerId, merchantId) {
      s.follows.get(customerId)?.delete(merchantId);
    },

    async listFollowedMerchantIds(customerId) {
      const followed = s.follows.get(customerId);
      if (!followed) return [];
      return [...followed.entries()]
        .map(([merchantId, at], index) => ({ merchantId, at: toMs(at), index }))
        .sort((a, b) => b.at - a.at || b.index - a.index)
        .map((row) => row.merchantId);
    },

    async listFollowerIds(merchantId) {
      const out: string[] = [];
      for (const [customerId, followed] of s.follows) {
        if (followed.has(merchantId)) out.push(customerId);
      }
      return out;
    },

    /* Notifications -------------------------------------------------- */

    async createNotification(record) {
      const dedupe = record.dedupe_key === null ? null : key(record.customer_id, record.dedupe_key);
      if (dedupe !== null) {
        const existingId = s.notificationIdByDedupe.get(dedupe);
        const existing = existingId === undefined ? undefined : s.notifications.get(existingId);
        if (existing) return { notification: clone(existing), created: false };
      }
      assertNew(s.notifications, record.id, "notification");
      if (dedupe !== null) s.notificationIdByDedupe.set(dedupe, record.id);
      s.notifications.set(record.id, clone(record));
      remember("notification", record.id);
      return { notification: clone(record), created: true };
    },

    async getNotification(id) {
      const row = s.notifications.get(id);
      return row ? clone(row) : null;
    },

    async listNotificationsByCustomer(customerId, options) {
      const since = options?.since !== undefined ? toMs(options.since) : null;
      return newestFirst(
        "notification",
        [...s.notifications.values()].filter(
          (n) => n.customer_id === customerId && (since === null || toMs(n.created_at) >= since),
        ),
      ).map(clone);
    },

    async markNotificationRead(id) {
      const row = s.notifications.get(id);
      if (!row) return null;
      const next: NotificationRecord = { ...row, read: true };
      s.notifications.set(id, next);
      return clone(next);
    },

    /* Suggestion state ----------------------------------------------- */

    async putSuggestionState(record) {
      s.suggestionStates.set(key(record.merchant_id, record.id), clone(record));
    },

    async getSuggestionState(merchantId, id) {
      const row = s.suggestionStates.get(key(merchantId, id));
      return row ? clone(row) : null;
    },

    async listSuggestionStates(merchantId) {
      return [...s.suggestionStates.values()].filter((r) => r.merchant_id === merchantId).map(clone);
    },
  };

  return store;
}

/** The patch's own fields that are not undefined and not in `fixed`. */
function definedFields<T extends object>(patch: T, fixed: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && !fixed.includes(k)) out[k] = v;
  }
  return out as Partial<T>;
}

const holder = globalThis as typeof globalThis & { __appMemoryStore?: Store };

/** The process-wide in-memory store (kept on globalThis across hot reloads and route bundles). */
export function getMemoryStore(): Store {
  if (!holder.__appMemoryStore) holder.__appMemoryStore = createMemoryStore();
  return holder.__appMemoryStore;
}

/** Drop the process-wide in-memory store so the next getMemoryStore() starts empty. Test and dev use only. */
export function resetMemoryStore(): void {
  delete holder.__appMemoryStore;
}
