/**
 * Database-agnostic data access for everything in contract v0.6.
 *
 * Records are what is stored, not what the API returns. The API objects in
 * lib/contract.ts are built from records by the services (lib/services):
 * derived fields (Deal.status sold_out/expired, Reservation.status no_show,
 * Customer.no_show_count/blocked, Deal.merchant, Deal.distance_m,
 * Reservation.deal) are computed at read time. See lib/store/derive.ts.
 *
 * Guarantees every driver must give (tests/store/conformance.ts checks them):
 * - Reads return copies. Mutating a returned record, or an input record after
 *   a write, never changes stored state.
 * - Lookups by a unique key (email, phone, session id, token id, owner
 *   account) return at most one record. Uniqueness holds under concurrent
 *   writes: of two concurrent creates with the same key, exactly one succeeds.
 * - `reserve`, `cancelReservation`, `markReservationPickedUp`, `cancelDeal`
 *   and `updateDeal(..., { ifVersion })` are atomic.
 * - No request-path operation needs a full table scan. Every list below maps
 *   to a key or index query in a DynamoDB single-table design.
 * - Timestamps in records are ISO 8601 strings with offset (lib/clock toIso).
 *   Drivers compare instants by parsed time, never by string; DynamoDB sort
 *   keys use lib/clock utcKey().
 * - Emails, phones and other keys are compared exactly as given. Callers
 *   (lib/auth) normalize them first (email: trimmed, lowercase; phone: E.164).
 * - List methods return newest first (created_at descending) unless the
 *   method says otherwise. Order between records with equal timestamps is
 *   unspecified.
 *
 * Expected failures are returned as `{ ok: false, reason }`, never thrown.
 * Drivers throw only on infrastructure errors or programmer errors (for
 * example a non-positive quantity).
 */
import type {
  DealItem,
  DealKind,
  MenuItem,
  MerchantCategory,
  NotificationType,
  PaymentMethod,
  PlanStatus,
  SuggestionType,
  UnsoldAction,
} from "@/lib/contract";

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

export type StoreResult<T, R extends string> = { ok: true; value: T } | { ok: false; reason: R };

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface MerchantAccountRecord {
  id: string;
  /** Unique. Normalized by the caller (trimmed, lowercase). */
  email: string;
  /** Password hash only (lib/auth format). Never the password. */
  password_hash: string;
  created_at: string;
}

export interface MerchantSessionRecord {
  /** Opaque lookup key chosen by lib/auth (recommended: SHA-256 of the cookie value, never the raw value). */
  id: string;
  account_id: string;
  created_at: string;
  /** null = no expiry. lib/auth decides; the store only keeps it. */
  expires_at: string | null;
}

export interface CustomerRecord {
  id: string;
  name: string;
  /** Unique, E.164. */
  phone: string;
  password_hash: string;
  /** Optional Expo push token (POST /customers/me/push-token). */
  expo_push_token: string | null;
  created_at: string;
}

export interface CustomerTokenRecord {
  /** Opaque lookup key chosen by lib/auth (recommended: SHA-256 of the bearer token, never the raw token). */
  id: string;
  customer_id: string;
  created_at: string;
}

export interface MerchantRecord {
  id: string;
  /** The merchant account that owns this merchant. One merchant per account. */
  owner_account_id: string;
  name: string;
  category: MerchantCategory;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  /** "HH:MM" local. */
  closes_at: string;
  default_discount_pct: number;
  menu: MenuItem[];
  plan_status: PlanStatus;
  created_at: string;
}

/**
 * Stored deal status. `sold_out` and `expired` are never stored: they are
 * derived on read (deriveDealStatus). A stored `live` deal with
 * quantity_left 0 reads as `sold_out`; one past pickup_end reads as `expired`.
 */
export type StoredDealStatus = "draft" | "live" | "cancelled";

export interface DealRecord {
  id: string;
  merchant_id: string;
  title: string;
  items: DealItem[];
  original_price_cents: number | null;
  deal_price_cents: number | null;
  kind: DealKind;
  quantity_total: number | null;
  /** While draft, mirrors quantity_total. From publish on, units not held by reserved or picked_up reservations. */
  quantity_left: number | null;
  max_per_customer: number;
  unsold_action: UnsoldAction;
  pickup_start: string;
  pickup_end: string | null;
  allergens: string[] | null;
  note: string | null;
  photo_url: string | null;
  status: StoredDealStatus;
  created_at: string;
  published_at: string | null;
  cancelled_at: string | null;
  /**
   * Business date (America/New_York, "YYYY-MM-DD") the deal belongs to, used by
   * the ?date= merchant lists, the summary and list_now. Set by the creator to
   * localDateOf(created_at) and never changed.
   */
  local_date: string;
  /** true once a lower_price suggestion was accepted for this deal. */
  price_lowered_by_suggestion: boolean;
  /** Optimistic-concurrency counter. 1 on create; every successful write adds 1. Set by the store. */
  version: number;
}

/** What `createDeal` takes: everything except `version`, which the store sets to 1. */
export type NewDealRecord = Omit<DealRecord, "version">;

/** Fields `updateDeal` may change. id, merchant_id, created_at, local_date and version are fixed. */
export type DealPatch = Partial<
  Omit<DealRecord, "id" | "merchant_id" | "created_at" | "local_date" | "version">
>;

/**
 * Stored reservation status. `no_show` is never stored: a stored `reserved`
 * reservation reads as `no_show` from pickup_end + 15 min (deriveReservationStatus).
 */
export type StoredReservationStatus = "reserved" | "picked_up" | "cancelled";

export interface ReservationRecord {
  id: string;
  deal_id: string;
  /** Copied from the deal by `reserve`. */
  merchant_id: string;
  /** Copied from the deal (deal.local_date) by `reserve`. */
  local_date: string;
  customer_id: string;
  /** Snapshot of the customer's name and phone at reserve time. */
  customer_name: string;
  customer_phone: string;
  quantity: number;
  /** Set by `reserve` from the deal's deal_price_cents at the atomic step. */
  unit_price_cents: number;
  /** quantity x unit_price_cents, set by `reserve`. */
  total_cents: number;
  payment_method: PaymentMethod;
  /** 4 digits, unique among the merchant's reservations with stored status `reserved`. */
  pickup_code: string;
  status: StoredReservationStatus;
  created_at: string;
  picked_up_at: string | null;
  cancelled_at: string | null;
}

export interface NotificationRecord {
  id: string;
  customer_id: string;
  type: NotificationType;
  title: string;
  body: string;
  deal_id: string | null;
  reservation_id: string | null;
  read: boolean;
  created_at: string;
  /**
   * Idempotency key, unique per customer, e.g. "pickup_reminder:r_1". A second
   * create with the same customer_id + dedupe_key returns the first record.
   * null = no deduplication.
   */
  dedupe_key: string | null;
}

/**
 * Remembered state of a suggestion. Suggestions themselves are computed on
 * read; only dismissals and acceptances are stored.
 * `id` is the suggestion id the API exposes (deterministic, chosen by
 * lib/services, e.g. one per deal for lower_price and one per merchant-day for
 * list_now). Unique per merchant; a second put with the same merchant_id + id
 * replaces the first.
 */
export interface SuggestionStateRecord {
  id: string;
  merchant_id: string;
  type: SuggestionType;
  /** Set for lower_price. */
  deal_id: string | null;
  /** Set for list_now: the merchant-day it applies to. */
  local_date: string | null;
  state: "dismissed" | "accepted";
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* Operation inputs                                                    */
/* ------------------------------------------------------------------ */

export interface ReserveInput {
  id: string;
  deal_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  /** Integer >= 1. */
  quantity: number;
  /** Candidate 4-digit code. On PICKUP_CODE_TAKEN, retry with another code. */
  pickup_code: string;
  payment_method: PaymentMethod;
  /** The reserve instant (ISO with offset). Also used as created_at. */
  at: string;
}

/**
 * Why a reserve failed, checked in this order:
 * DEAL_NOT_FOUND; DEAL_NOT_LIVE (stored status not `live`, or `at` >= pickup_end);
 * SOLD_OUT (quantity_left < quantity); MAX_PER_CUSTOMER (this customer's
 * reserved + picked_up quantity on the deal + quantity > max_per_customer);
 * PICKUP_CODE_TAKEN (another `reserved` reservation of the same merchant has the code).
 */
export type ReserveFailure =
  | "DEAL_NOT_FOUND"
  | "DEAL_NOT_LIVE"
  | "SOLD_OUT"
  | "MAX_PER_CUSTOMER"
  | "PICKUP_CODE_TAKEN";

export interface UpdateDealOptions {
  /** Write only if the stored version equals this; otherwise VERSION_CONFLICT. */
  ifVersion?: number;
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export interface Store {
  /* Merchant accounts ------------------------------------------------ */

  /** Create an account. EMAIL_TAKEN if another account has the same email (exact match). */
  createMerchantAccount(
    record: MerchantAccountRecord,
  ): Promise<StoreResult<MerchantAccountRecord, "EMAIL_TAKEN">>;
  getMerchantAccount(id: string): Promise<MerchantAccountRecord | null>;
  getMerchantAccountByEmail(email: string): Promise<MerchantAccountRecord | null>;

  /* Merchant sessions ------------------------------------------------ */

  createMerchantSession(record: MerchantSessionRecord): Promise<void>;
  getMerchantSession(id: string): Promise<MerchantSessionRecord | null>;
  /** Idempotent. */
  deleteMerchantSession(id: string): Promise<void>;

  /* Customers -------------------------------------------------------- */

  /** Create a customer. PHONE_TAKEN if another customer has the same phone. */
  createCustomer(record: CustomerRecord): Promise<StoreResult<CustomerRecord, "PHONE_TAKEN">>;
  getCustomer(id: string): Promise<CustomerRecord | null>;
  getCustomerByPhone(phone: string): Promise<CustomerRecord | null>;
  /** Unknown ids are skipped. Order is unspecified. */
  getCustomersByIds(ids: readonly string[]): Promise<CustomerRecord[]>;
  /** Patch name or push token. null if the customer does not exist. Phone and password are not changeable today. */
  updateCustomer(
    id: string,
    patch: Partial<Pick<CustomerRecord, "name" | "expo_push_token">>,
  ): Promise<CustomerRecord | null>;

  /* Customer tokens -------------------------------------------------- */

  createCustomerToken(record: CustomerTokenRecord): Promise<void>;
  getCustomerToken(id: string): Promise<CustomerTokenRecord | null>;
  /** Idempotent. */
  deleteCustomerToken(id: string): Promise<void>;

  /* Merchants -------------------------------------------------------- */

  /** Create a merchant. OWNER_HAS_MERCHANT if the owner account already has one. */
  createMerchant(record: MerchantRecord): Promise<StoreResult<MerchantRecord, "OWNER_HAS_MERCHANT">>;
  getMerchant(id: string): Promise<MerchantRecord | null>;
  getMerchantByOwner(accountId: string): Promise<MerchantRecord | null>;
  /** Unknown ids are skipped. Order is unspecified. */
  getMerchantsByIds(ids: readonly string[]): Promise<MerchantRecord[]>;
  /** Patch fields. id, owner_account_id and created_at are fixed. null if not found. */
  updateMerchant(
    id: string,
    patch: Partial<Omit<MerchantRecord, "id" | "owner_account_id" | "created_at">>,
  ): Promise<MerchantRecord | null>;

  /* Deals ------------------------------------------------------------ */

  /** Create a deal with version 1. Returns the stored record. */
  createDeal(record: NewDealRecord): Promise<DealRecord>;
  getDeal(id: string): Promise<DealRecord | null>;
  /** Unknown ids are skipped. Order is unspecified. */
  getDealsByIds(ids: readonly string[]): Promise<DealRecord[]>;
  /** A merchant's deals, all statuses, newest first. `limit` caps the count (for history lookups). */
  listDealsByMerchant(merchantId: string, options?: { limit?: number }): Promise<DealRecord[]>;
  /** A merchant's deals whose local_date equals `localDate`, all statuses, newest first. */
  listDealsByMerchantDate(merchantId: string, localDate: string): Promise<DealRecord[]>;
  /**
   * Deals any customer may see: stored status `live` (reads as live or
   * sold_out) and pickup_end strictly after `pickupEndAfter`. Sorted by
   * pickup_end ascending (ending soonest first). Drafts and cancelled deals
   * are never returned.
   */
  listOpenDeals(options: { pickupEndAfter: string }): Promise<DealRecord[]>;
  /**
   * Patch a deal and add 1 to its version. With `ifVersion`, the write
   * happens only if the stored version still equals it (read-check-write
   * without races). Use it for publish, live edits, price drops, quantity
   * changes and mark-donated.
   */
  updateDeal(
    id: string,
    patch: DealPatch,
    options?: UpdateDealOptions,
  ): Promise<StoreResult<DealRecord, "NOT_FOUND" | "VERSION_CONFLICT">>;
  /**
   * Cancel a deal and, in the same atomic step, every reservation on it with
   * stored status `reserved` (their pickup codes are freed). Allowed when the
   * stored status is `draft`, or `live` with `at` < pickup_end. Otherwise
   * NOT_CANCELLABLE (already cancelled, or live and past pickup_end).
   * Returns the cancelled deal and the reservations that were cancelled.
   */
  cancelDeal(
    id: string,
    options: { at: string },
  ): Promise<
    StoreResult<
      { deal: DealRecord; cancelled_reservations: ReservationRecord[] },
      "NOT_FOUND" | "NOT_CANCELLABLE"
    >
  >;

  /* Reservations ----------------------------------------------------- */

  /**
   * In one atomic step: check the deal is reservable (see ReserveFailure),
   * decrement quantity_left by quantity, bump the deal's version, reserve the
   * pickup code for this merchant, and create the reservation with status
   * `reserved`, unit_price_cents = the deal's current deal_price_cents,
   * total_cents = quantity x unit_price_cents, merchant_id and local_date
   * copied from the deal, created_at = at. Of concurrent reserves for the last
   * units, only as many succeed as there are units.
   */
  reserve(
    input: ReserveInput,
  ): Promise<StoreResult<{ reservation: ReservationRecord; deal: DealRecord }, ReserveFailure>>;
  getReservation(id: string): Promise<ReservationRecord | null>;
  /** A customer's reservations, all statuses, newest first. */
  listReservationsByCustomer(customerId: string): Promise<ReservationRecord[]>;
  /** A deal's reservations, all statuses, newest first. */
  listReservationsByDeal(dealId: string): Promise<ReservationRecord[]>;
  /** A merchant's reservations whose local_date equals `localDate`, all statuses, newest first. */
  listReservationsByMerchantDate(merchantId: string, localDate: string): Promise<ReservationRecord[]>;
  /**
   * A merchant's reservations with this pickup code, all statuses, newest
   * first. At most one has stored status `reserved`. Redeem uses it to tell
   * CODE_INVALID from CODE_ALREADY_USED.
   */
  findReservationsByPickupCode(merchantId: string, pickupCode: string): Promise<ReservationRecord[]>;
  /**
   * reserved -> cancelled in one atomic step: sets cancelled_at, returns the
   * units to the deal's quantity_left (deal version +1) and frees the pickup
   * code. NOT_OPEN if the stored status is not `reserved`. Time rules (only
   * before pickup_end) are the caller's job.
   */
  cancelReservation(
    id: string,
    options: { at: string },
  ): Promise<
    StoreResult<{ reservation: ReservationRecord; deal: DealRecord }, "NOT_FOUND" | "NOT_OPEN">
  >;
  /**
   * reserved -> picked_up in one atomic step: sets picked_up_at and frees the
   * pickup code. Units stay taken. NOT_OPEN if the stored status is not
   * `reserved`, so of two concurrent calls exactly one succeeds. Time rules
   * (pickup window) are the caller's job.
   */
  markReservationPickedUp(
    id: string,
    options: { at: string },
  ): Promise<StoreResult<ReservationRecord, "NOT_FOUND" | "NOT_OPEN">>;

  /* Follows ---------------------------------------------------------- */

  /** Idempotent. */
  addFollow(customerId: string, merchantId: string, at: string): Promise<void>;
  /** Idempotent. */
  removeFollow(customerId: string, merchantId: string): Promise<void>;
  /** Merchant ids the customer follows, newest follow first. */
  listFollowedMerchantIds(customerId: string): Promise<string[]>;
  /** Customer ids following the merchant. Order is unspecified. */
  listFollowerIds(merchantId: string): Promise<string[]>;

  /* Notifications ---------------------------------------------------- */

  /**
   * Create a notification. With a dedupe_key, a second create for the same
   * customer and key returns the existing record with created: false (also
   * under concurrent calls).
   */
  createNotification(
    record: NotificationRecord,
  ): Promise<{ notification: NotificationRecord; created: boolean }>;
  getNotification(id: string): Promise<NotificationRecord | null>;
  /** A customer's notifications, newest first; with `since`, only those created at or after it. */
  listNotificationsByCustomer(
    customerId: string,
    options?: { since?: string },
  ): Promise<NotificationRecord[]>;
  /** Set read = true. Idempotent. null if not found. Ownership checks are the caller's job. */
  markNotificationRead(id: string): Promise<NotificationRecord | null>;

  /* Suggestion state ------------------------------------------------- */

  /** Insert or replace by merchant_id + id. */
  putSuggestionState(record: SuggestionStateRecord): Promise<void>;
  getSuggestionState(merchantId: string, id: string): Promise<SuggestionStateRecord | null>;
  /** All stored states for a merchant. Order is unspecified. */
  listSuggestionStates(merchantId: string): Promise<SuggestionStateRecord[]>;
}
