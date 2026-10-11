/**
 * Types for every object, enum, error code and endpoint in docs/api-contract.md (v0.6).
 *
 * The contract is the source of truth. Field names here match it exactly.
 * Nullable fields are typed `T | null` and are never optional: the API always
 * sends them, with `null` when there is no value.
 *
 * Request bodies may have optional fields (`?`) where the contract lets the
 * client leave a field out.
 */

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const MERCHANT_CATEGORIES = ["bakery", "cafe", "restaurant"] as const;
export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];

/** Set by billing. */
export const PLAN_STATUSES = ["none", "active"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** `timed` = any-hour, still quantity- and time-limited. */
export const DEAL_KINDS = ["surplus", "timed"] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

export const DEAL_STATUSES = ["draft", "live", "sold_out", "expired", "cancelled"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Set after expiry. */
export const UNSOLD_ACTIONS = ["none", "donated"] as const;
export type UnsoldAction = (typeof UNSOLD_ACTIONS)[number];

export const RESERVATION_STATUSES = ["reserved", "picked_up", "cancelled", "no_show"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** `in_store` for now. Clients must not hardcode it. */
export const PAYMENT_METHODS = ["in_store"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const NOTIFICATION_TYPES = ["new_deal", "deal_cancelled", "pickup_reminder"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const SUGGESTION_TYPES = ["list_now", "lower_price"] as const;
export type SuggestionType = (typeof SUGGESTION_TYPES)[number];

/** Where a draft's regular price came from. `null` when it is unknown. */
export const PRICE_SOURCES = ["stated", "menu", "history"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/** Fields a draft can be missing. Each one listed is `null` in the draft's deal. */
export const MISSING_FIELDS = [
  "original_price_cents",
  "deal_price_cents",
  "quantity_total",
  "pickup_end",
  "allergens",
] as const;
export type MissingField = (typeof MISSING_FIELDS)[number];

/** `GET /deals?sort=`. `ending` is the default; `distance` needs lat/lng. */
// "discount" (biggest discount first) is an additive extension of contract v0.6.
export const DEAL_SORTS = ["ending", "distance", "discount"] as const;
export type DealSort = (typeof DEAL_SORTS)[number];

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Every error code in the contract with its HTTP status. */
export const ERROR_STATUS = {
  UNAUTHORIZED: 401,
  BAD_CREDENTIALS: 401,
  PLAN_REQUIRED: 402,
  CUSTOMER_BLOCKED: 403,
  NOT_FOUND: 404,
  CODE_INVALID: 404,
  SOLD_OUT: 409,
  DEAL_NOT_LIVE: 409,
  CODE_ALREADY_USED: 409,
  ACCOUNT_EXISTS: 409,
  VALIDATION: 422,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

/**
 * Not in the contract's code list. Used only for unexpected server failures
 * (HTTP 500) so the envelope keeps its shape. Clients treat unknown codes as
 * generic errors and show `message`.
 */
export const INTERNAL_ERROR_CODE = "INTERNAL" as const;
export const INTERNAL_ERROR_STATUS = 500 as const;
export type ApiErrorCode = ErrorCode | typeof INTERNAL_ERROR_CODE;

/** `{"error": {"code": "SOLD_OUT", "message": "..."}}`. `message` is safe to show as is. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

/* ------------------------------------------------------------------ */
/* Rules and fixed numbers from the contract and agent spec            */
/* ------------------------------------------------------------------ */

export const RULES = {
  /** Passwords: at least 8 characters. */
  PASSWORD_MIN_LENGTH: 8,
  /** Merchant.default_discount_pct: integer 10-90. */
  DEFAULT_DISCOUNT_PCT_MIN: 10,
  DEFAULT_DISCOUNT_PCT_MAX: 90,
  /** pickup_code is 4 digits. */
  PICKUP_CODE_LENGTH: 4,
  /** Customer.blocked is true once no_show_count reaches this. */
  NO_SHOW_BLOCK_THRESHOLD: 2,
  /** reserved -> no_show at pickup_end + 15 min. */
  NO_SHOW_AFTER_MINUTES: 15,
  /** pickup_reminder: 30 min before pickup_end. */
  PICKUP_REMINDER_MINUTES: 30,
  /** list_now: within 2 h before closes_at. */
  LIST_NOW_WINDOW_MINUTES: 120,
  /** lower_price proposal: current price x 0.8, down to a multiple of 25, min 25. */
  LOWER_PRICE_FACTOR: 0.8,
  PRICE_STEP_CENTS: 25,
  MIN_PROPOSED_PRICE_CENTS: 25,
  /** Agent default for max_per_customer. */
  DEFAULT_MAX_PER_CUSTOMER: 2,
  /** Draft estimate: fixed assumption, label it as such in UI. */
  ASSUMED_SELL_THROUGH: 0.6,
} as const;

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */

export interface Customer {
  id: string;
  name: string;
  /** E.164, e.g. "+18145550123". */
  phone: string;
  no_show_count: number;
  /** true once no_show_count reaches 2. */
  blocked: boolean;
  created_at: string;
}

/** A regular item on the merchant's menu. */
export interface MenuItem {
  name: string;
  price_cents: number;
}

export interface Merchant {
  id: string;
  name: string;
  category: MerchantCategory;
  address: string;
  /** Both null if not located. */
  lat: number | null;
  lng: number | null;
  phone: string;
  /** Local time "HH:MM", today's default. */
  closes_at: string;
  /** Integer 10-90. Starting value only; the price is set per deal. */
  default_discount_pct: number;
  /** May be empty. */
  menu: MenuItem[];
  plan_status: PlanStatus;
}

/** The merchant summary nested in a Deal. */
export interface DealMerchant {
  id: string;
  name: string;
  category: MerchantCategory;
  address: string;
  lat: number | null;
  lng: number | null;
}

/** Contents of ONE sale unit. */
export interface DealItem {
  name: string;
  qty: number;
}

/**
 * A deal. The fields marked "null only while draft" are null in a draft whose
 * value is still missing (see Draft.missing_fields); a deal past `draft` has
 * them set, because publish requires them.
 */
export interface Deal {
  id: string;
  merchant_id: string;
  merchant: DealMerchant;
  title: string;
  items: DealItem[];
  /** null only while draft. */
  original_price_cents: number | null;
  /** null only while draft. */
  deal_price_cents: number | null;
  kind: DealKind;
  /** null only while draft. */
  quantity_total: number | null;
  /** null only while draft and quantity_total is null. */
  quantity_left: number | null;
  max_per_customer: number;
  unsold_action: UnsoldAction;
  pickup_start: string;
  /** null only while draft. */
  pickup_end: string | null;
  /** null = not answered (blocks publish), [] = none. */
  allergens: string[] | null;
  note: string | null;
  /** Set by the backend when the merchant sent a photo. */
  photo_url: string | null;
  status: DealStatus;
  created_at: string;
  /** null while draft. */
  published_at: string | null;
  /** Integer metres. Only set by GET /deals when lat/lng were sent and the merchant has a location. */
  distance_m: number | null;
}

export interface Estimate {
  units: number;
  deal_price_cents: number;
  /** ASSUMPTION. Label it as such in UI. */
  assumed_sell_through: number;
  expected_recovered_cents: number;
  if_discarded_cents: number;
}

/** Listing assistant output, one per product. The deal already exists with status "draft". */
export interface Draft {
  deal: Deal;
  missing_fields: MissingField[];
  price_source: PriceSource | null;
  agent_notes: string;
  /** null when quantity or deal price is missing. */
  estimate: Estimate | null;
}

export interface Reservation {
  id: string;
  deal_id: string;
  deal: Deal;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  quantity: number;
  /** Deal price at the moment of reserving; later price drops do not change it. */
  unit_price_cents: number;
  /** quantity x unit_price_cents, paid in store. */
  total_cents: number;
  payment_method: PaymentMethod;
  /** 4 digits. */
  pickup_code: string;
  status: ReservationStatus;
  created_at: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  deal_id: string | null;
  reservation_id: string | null;
  read: boolean;
  created_at: string;
}

/** The numbers behind a lower_price message. */
export interface LowerPriceBasis {
  reserved: number;
  total: number;
  minutes_left: number;
}

export interface LowerPriceSuggestion {
  id: string;
  type: "lower_price";
  deal_id: string;
  message: string;
  proposed: { deal_price_cents: number };
  basis: LowerPriceBasis;
}

export interface ListNowSuggestion {
  id: string;
  type: "list_now";
  /** null for list_now. */
  deal_id: null;
  message: string;
  /** null for list_now. */
  proposed: null;
  /** The numbers behind the message. The contract gives no fixed keys for list_now. */
  basis: Record<string, number>;
}

export type Suggestion = LowerPriceSuggestion | ListNowSuggestion;

export interface Summary {
  /** Local date "YYYY-MM-DD" (America/New_York). */
  date: string;
  units_listed: number;
  units_picked_up: number;
  units_no_show: number;
  units_unsold: number;
  recovered_cents: number;
  platform_fee_cents: number;
  if_discarded_cents: number;
}

export interface BillingLinks {
  pricing_url: string;
  portal_url: string;
}

/* ------------------------------------------------------------------ */
/* Shared response wrappers                                            */
/* ------------------------------------------------------------------ */

export interface OkResponse {
  ok: true;
}

export interface DealsResponse {
  deals: Deal[];
}

export interface ReservationsResponse {
  reservations: Reservation[];
}

/* ------------------------------------------------------------------ */
/* Auth endpoints                                                      */
/* ------------------------------------------------------------------ */

/** POST /auth/customer/signup -> 201 CustomerAuthResponse, or ACCOUNT_EXISTS */
export interface CustomerSignupRequest {
  name: string;
  phone: string;
  password: string;
}

/** POST /auth/customer/signin -> CustomerAuthResponse, or BAD_CREDENTIALS */
export interface CustomerSigninRequest {
  phone: string;
  password: string;
}

export interface CustomerAuthResponse {
  token: string;
  customer: Customer;
}

/** POST /auth/merchant/signup -> OkResponse + session cookie, or ACCOUNT_EXISTS */
export interface MerchantSignupRequest {
  email: string;
  password: string;
}

/** POST /auth/merchant/signin -> OkResponse + session cookie, or BAD_CREDENTIALS */
export type MerchantSigninRequest = MerchantSignupRequest;

/* ------------------------------------------------------------------ */
/* Consumer endpoints                                                  */
/* ------------------------------------------------------------------ */

/** GET /deals query. All optional. Values arrive as strings in the URL. */
export interface DealsQuery {
  category?: MerchantCategory;
  kind?: DealKind;
  lat?: number;
  lng?: number;
  sort?: DealSort;
}

/** POST /reservations -> 201 Reservation, or SOLD_OUT, DEAL_NOT_LIVE, CUSTOMER_BLOCKED */
export interface CreateReservationRequest {
  deal_id: string;
  quantity: number;
}

/** GET /follows */
export interface FollowsResponse {
  merchant_ids: string[];
}

/** POST /follows */
export interface FollowRequest {
  merchant_id: string;
}

/** GET /notifications?since=<ISO time> */
export interface NotificationsQuery {
  since?: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
}

/** POST /customers/me/push-token (optional feature) */
export interface PushTokenRequest {
  expo_push_token: string;
}

/* ------------------------------------------------------------------ */
/* Merchant endpoints                                                  */
/* ------------------------------------------------------------------ */

/** GET /me. `merchant: null` = signed in but not onboarded yet. */
export interface MeResponse {
  merchant: Merchant | null;
}

/** POST /merchants -> 201 Merchant */
export interface CreateMerchantRequest {
  name: string;
  category: MerchantCategory;
  address: string;
  phone: string;
  closes_at: string;
  default_discount_pct: number;
  menu: MenuItem[];
  lat?: number | null;
  lng?: number | null;
}

/** PATCH /merchants/{id}: any of the fields above. */
export type UpdateMerchantRequest = Partial<CreateMerchantRequest>;

/** POST /merchants/{id}/drafts: at least one of text or photo_base64. */
export interface CreateDraftsRequest {
  text?: string;
  photo_base64?: string;
}

export interface DraftsResponse {
  drafts: Draft[];
}

/** Fields of a deal the merchant can edit while it is a draft. */
export interface DraftEditableFields {
  title: string;
  items: DealItem[];
  original_price_cents: number | null;
  deal_price_cents: number | null;
  kind: DealKind;
  quantity_total: number | null;
  max_per_customer: number;
  pickup_start: string;
  pickup_end: string | null;
  allergens: string[] | null;
  note: string | null;
}

/** Fields of a deal the merchant can edit while it is live. deal_price_cents may only go down. */
export type LiveEditableField = "quantity_total" | "pickup_end" | "note" | "deal_price_cents";

/**
 * POST /deals -> Deal (status "draft"), manual entry.
 * The contract says "Deal fields without id/status". Server-owned fields
 * (merchant_id, merchant, quantity_left, unsold_action, photo_url, created_at,
 * published_at, distance_m) are not taken from the client.
 */
export type CreateDealRequest = Pick<DraftEditableFields, "title"> &
  Partial<Omit<DraftEditableFields, "title">>;

/** PATCH /deals/{id} while draft. */
export type UpdateDraftDealRequest = Partial<DraftEditableFields>;

/** PATCH /deals/{id} while live. */
export type UpdateLiveDealRequest = Partial<Pick<DraftEditableFields, LiveEditableField>>;

/** PATCH /deals/{id}. Which fields are accepted depends on the deal's status. */
export type UpdateDealRequest = UpdateDraftDealRequest;

/** ?date= on merchant list endpoints: local date "YYYY-MM-DD", default today. */
export interface DateQuery {
  date?: string;
}

/** POST /reservations/redeem -> Reservation (picked_up), or CODE_INVALID / CODE_ALREADY_USED */
export interface RedeemRequest {
  pickup_code: string;
}

/** GET /merchants/{id}/suggestions */
export interface SuggestionsResponse {
  suggestions: Suggestion[];
}

/** POST /suggestions/{id}/accept: Deal for lower_price, OkResponse for list_now. */
export type AcceptSuggestionResponse = Deal | OkResponse;

/** GET /health */
export type HealthResponse = OkResponse;

/* ------------------------------------------------------------------ */
/* Endpoint map                                                        */
/* ------------------------------------------------------------------ */

/**
 * Every endpoint, keyed by "METHOD /path" relative to the /api base.
 * `body` is the JSON request body (`never` when there is none), `query` the
 * query string, `response` the success body and `status` the success status.
 */
export interface ApiEndpoints {
  "GET /health": { body: never; query: never; response: HealthResponse; status: 200 };

  "POST /auth/customer/signup": { body: CustomerSignupRequest; query: never; response: CustomerAuthResponse; status: 201 };
  "POST /auth/customer/signin": { body: CustomerSigninRequest; query: never; response: CustomerAuthResponse; status: 200 };
  "GET /customers/me": { body: never; query: never; response: Customer; status: 200 };
  "POST /auth/merchant/signup": { body: MerchantSignupRequest; query: never; response: OkResponse; status: 200 };
  "POST /auth/merchant/signin": { body: MerchantSigninRequest; query: never; response: OkResponse; status: 200 };
  "POST /auth/merchant/signout": { body: never; query: never; response: OkResponse; status: 200 };

  "GET /deals": { body: never; query: DealsQuery; response: DealsResponse; status: 200 };
  "GET /deals/{id}": { body: never; query: never; response: Deal; status: 200 };

  "POST /reservations": { body: CreateReservationRequest; query: never; response: Reservation; status: 201 };
  "GET /reservations": { body: never; query: never; response: ReservationsResponse; status: 200 };
  "GET /reservations/{id}": { body: never; query: never; response: Reservation; status: 200 };
  "POST /reservations/{id}/cancel": { body: never; query: never; response: Reservation; status: 200 };
  "POST /reservations/{id}/confirm-pickup": { body: never; query: never; response: Reservation; status: 200 };
  "GET /follows": { body: never; query: never; response: FollowsResponse; status: 200 };
  "POST /follows": { body: FollowRequest; query: never; response: OkResponse; status: 200 };
  "DELETE /follows/{merchant_id}": { body: never; query: never; response: OkResponse; status: 200 };
  "GET /notifications": { body: never; query: NotificationsQuery; response: NotificationsResponse; status: 200 };
  "POST /notifications/{id}/read": { body: never; query: never; response: OkResponse; status: 200 };
  "POST /customers/me/push-token": { body: PushTokenRequest; query: never; response: OkResponse; status: 200 };

  "GET /me": { body: never; query: never; response: MeResponse; status: 200 };
  "POST /merchants": { body: CreateMerchantRequest; query: never; response: Merchant; status: 201 };
  "PATCH /merchants/{id}": { body: UpdateMerchantRequest; query: never; response: Merchant; status: 200 };
  "GET /merchants/{id}": { body: never; query: never; response: Merchant; status: 200 };
  "POST /merchants/{id}/drafts": { body: CreateDraftsRequest; query: never; response: DraftsResponse; status: 200 };
  "POST /deals": { body: CreateDealRequest; query: never; response: Deal; status: 200 };
  "PATCH /deals/{id}": { body: UpdateDealRequest; query: never; response: Deal; status: 200 };
  "POST /deals/{id}/publish": { body: never; query: never; response: Deal; status: 200 };
  "POST /deals/{id}/cancel": { body: never; query: never; response: Deal; status: 200 };
  "POST /deals/{id}/mark-donated": { body: never; query: never; response: Deal; status: 200 };
  "GET /merchants/{id}/deals": { body: never; query: DateQuery; response: DealsResponse; status: 200 };
  "GET /merchants/{id}/reservations": { body: never; query: DateQuery; response: ReservationsResponse; status: 200 };
  "POST /reservations/redeem": { body: RedeemRequest; query: never; response: Reservation; status: 200 };
  "GET /merchants/{id}/summary": { body: never; query: DateQuery; response: Summary; status: 200 };
  "GET /merchants/{id}/suggestions": { body: never; query: never; response: SuggestionsResponse; status: 200 };
  "POST /suggestions/{id}/accept": { body: never; query: never; response: AcceptSuggestionResponse; status: 200 };
  "POST /suggestions/{id}/dismiss": { body: never; query: never; response: OkResponse; status: 200 };

  "GET /billing/links": { body: never; query: never; response: BillingLinks; status: 200 };
}

export type ApiEndpointKey = keyof ApiEndpoints;
