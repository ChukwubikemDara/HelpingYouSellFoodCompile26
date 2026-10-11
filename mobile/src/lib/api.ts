// The one module that talks to the API (contract v0.6, docs/api-contract.md).
// Consumer and customer-auth endpoints only; merchant endpoints are not called from this app.
//
// Config:
// - EXPO_PUBLIC_API_URL: API base URL including the `/api` prefix, e.g. https://example.com/api
// - EXPO_PUBLIC_USE_FIXTURES=1: serve the contract's example objects from an in-memory store.
// Fixture mode is on when EXPO_PUBLIC_USE_FIXTURES is "1" OR EXPO_PUBLIC_API_URL is unset or empty.

import { fixtureRequest } from './fixtures';

// ---------- Types (field names exactly as in the contract) ----------

export type MerchantCategory = 'bakery' | 'cafe' | 'restaurant';
export type DealKind = 'surplus' | 'timed';
export type DealStatus = 'draft' | 'live' | 'sold_out' | 'expired' | 'cancelled';
export type UnsoldAction = 'none' | 'donated';
export type ReservationStatus = 'reserved' | 'picked_up' | 'cancelled' | 'no_show';
export type NotificationType = 'new_deal' | 'deal_cancelled' | 'pickup_reminder';
// `discount` (biggest percent off first) is an additive extension to contract v0.6, already deployed.
export type DealSort = 'ending' | 'distance' | 'discount';

export type Customer = {
  id: string;
  name: string;
  phone: string;
  no_show_count: number;
  blocked: boolean;
  created_at: string;
};

/** The merchant summary embedded in a Deal. */
export type DealMerchant = {
  id: string;
  name: string;
  category: MerchantCategory;
  address: string;
  lat: number | null;
  lng: number | null;
};

export type DealItem = { name: string; qty: number };

export type Deal = {
  id: string;
  merchant_id: string;
  merchant: DealMerchant;
  title: string;
  items: DealItem[];
  // The next five can be null only while a deal is a draft (see Draft.missing_fields).
  original_price_cents: number | null;
  deal_price_cents: number | null;
  kind: DealKind;
  quantity_total: number | null;
  quantity_left: number;
  max_per_customer: number;
  unsold_action: UnsoldAction;
  pickup_start: string;
  pickup_end: string | null;
  allergens: string[] | null;
  note: string | null;
  photo_url: string | null;
  status: DealStatus;
  created_at: string;
  published_at: string | null;
  distance_m: number | null;
};

export type Reservation = {
  id: string;
  deal_id: string;
  deal: Deal;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  /** "in_store" for now; the UI must not assume it. */
  payment_method: string;
  pickup_code: string;
  status: ReservationStatus;
  created_at: string;
};

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  deal_id: string | null;
  reservation_id: string | null;
  read: boolean;
  created_at: string;
};

export type AuthResult = { token: string; customer: Customer };
export type Ok = { ok: true };

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'BAD_CREDENTIALS'
  | 'PLAN_REQUIRED'
  | 'CUSTOMER_BLOCKED'
  | 'NOT_FOUND'
  | 'CODE_INVALID'
  | 'SOLD_OUT'
  | 'DEAL_NOT_LIVE'
  | 'CODE_ALREADY_USED'
  | 'ACCOUNT_EXISTS'
  | 'VALIDATION';

// ---------- Config ----------

const RAW_API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
const API_URL = RAW_API_URL.replace(/\/+$/, '');

export const USE_FIXTURES = process.env.EXPO_PUBLIC_USE_FIXTURES === '1' || API_URL === '';

const REQUEST_TIMEOUT_MS = 15000;

// ---------- Errors ----------

/**
 * Thrown for every failed call. `message` is safe to show as is:
 * it is the API's `error.message` when the response carried the error envelope.
 */
export class ApiError extends Error {
  /** HTTP status; 0 when the server could not be reached. */
  readonly status: number;
  /** Contract error code, or NETWORK / HTTP_ERROR when there was no envelope. */
  readonly code: ErrorCode | 'NETWORK' | 'HTTP_ERROR';

  constructor(status: number, code: ApiError['code'], message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Something went wrong. Try again.';
}

// ---------- Session token ----------

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Set by the auth provider; sent as `Authorization: Bearer <token>`. */
export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Called when a request that carried a token gets 401 UNAUTHORIZED. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

// ---------- Transport ----------

type Method = 'GET' | 'POST' | 'DELETE';
type Query = Record<string, string | number | undefined | null>;

export type RawResponse = { status: number; body: unknown };

function buildQuery(query?: Query): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

async function liveRequest(
  method: Method,
  pathWithQuery: string,
  body: unknown,
  token: string | null
): Promise<RawResponse> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${pathWithQuery}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => '');
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { status: res.status, body: parsed };
}

function isErrorEnvelope(b: unknown): b is { error: { code: string; message: string } } {
  if (typeof b !== 'object' || b === null) return false;
  const err = (b as { error?: unknown }).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { message?: unknown }).message === 'string' &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

async function request<T>(
  method: Method,
  path: string,
  opts: { query?: Query; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const pathWithQuery = `${path}${buildQuery(opts.query)}`;
  const token = opts.auth ? authToken : null;
  if (opts.auth && !token) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  }

  const raw = USE_FIXTURES
    ? await fixtureRequest(method, path, opts.query ?? {}, opts.body, token)
    : await liveRequest(method, pathWithQuery, opts.body, token);

  if (raw.status >= 200 && raw.status < 300) {
    // Round-trip through JSON so callers never share objects with the fixture store.
    return (USE_FIXTURES ? JSON.parse(JSON.stringify(raw.body)) : raw.body) as T;
  }

  if (isErrorEnvelope(raw.body)) {
    const { code, message } = raw.body.error;
    // Only sign out if the rejected token is still the current one (not one replaced meanwhile).
    if (raw.status === 401 && code === 'UNAUTHORIZED' && token && token === authToken && onUnauthorized) {
      onUnauthorized();
    }
    return Promise.reject(new ApiError(raw.status, code as ErrorCode, message));
  }
  throw new ApiError(raw.status, 'HTTP_ERROR', `Something went wrong (HTTP ${raw.status}). Try again.`);
}

// ---------- Customer auth ----------

/** POST /auth/customer/signup -> { token, customer } (201) or ACCOUNT_EXISTS */
export function signUp(input: { name: string; phone: string; password: string }): Promise<AuthResult> {
  return request<AuthResult>('POST', '/auth/customer/signup', { body: input });
}

/** POST /auth/customer/signin -> { token, customer } or BAD_CREDENTIALS */
export function signIn(input: { phone: string; password: string }): Promise<AuthResult> {
  return request<AuthResult>('POST', '/auth/customer/signin', { body: input });
}

/** GET /customers/me -> Customer */
export function getMe(): Promise<Customer> {
  return request<Customer>('GET', '/customers/me', { auth: true });
}

// ---------- Deals (no sign-in) ----------

export type ListDealsParams = {
  category?: MerchantCategory;
  kind?: DealKind;
  lat?: number;
  lng?: number;
  sort?: DealSort;
};

/** GET /deals -> { deals } (live and sold_out only) */
export function listDeals(params: ListDealsParams = {}): Promise<{ deals: Deal[] }> {
  return request<{ deals: Deal[] }>('GET', '/deals', { query: params });
}

/** GET /deals/{id} -> Deal */
export function getDeal(id: string): Promise<Deal> {
  return request<Deal>('GET', `/deals/${encodeURIComponent(id)}`);
}

// ---------- Reservations (signed in) ----------

/** POST /reservations -> Reservation (201), or SOLD_OUT, DEAL_NOT_LIVE, CUSTOMER_BLOCKED */
export function createReservation(input: { deal_id: string; quantity: number }): Promise<Reservation> {
  return request<Reservation>('POST', '/reservations', { body: input, auth: true });
}

/** GET /reservations -> { reservations } newest first */
export function listReservations(): Promise<{ reservations: Reservation[] }> {
  return request<{ reservations: Reservation[] }>('GET', '/reservations', { auth: true });
}

/** GET /reservations/{id} -> Reservation */
export function getReservation(id: string): Promise<Reservation> {
  return request<Reservation>('GET', `/reservations/${encodeURIComponent(id)}`, { auth: true });
}

/** POST /reservations/{id}/cancel -> Reservation */
export function cancelReservation(id: string): Promise<Reservation> {
  return request<Reservation>('POST', `/reservations/${encodeURIComponent(id)}/cancel`, { auth: true });
}

/** POST /reservations/{id}/confirm-pickup -> Reservation (picked_up) */
export function confirmPickup(id: string): Promise<Reservation> {
  return request<Reservation>('POST', `/reservations/${encodeURIComponent(id)}/confirm-pickup`, {
    auth: true,
  });
}

// ---------- Follows (signed in) ----------

/** GET /follows -> { merchant_ids } */
export function listFollows(): Promise<{ merchant_ids: string[] }> {
  return request<{ merchant_ids: string[] }>('GET', '/follows', { auth: true });
}

/** POST /follows { merchant_id } -> { ok: true } */
export function followMerchant(merchant_id: string): Promise<Ok> {
  return request<Ok>('POST', '/follows', { body: { merchant_id }, auth: true });
}

/** DELETE /follows/{merchant_id} -> { ok: true } */
export function unfollowMerchant(merchant_id: string): Promise<Ok> {
  return request<Ok>('DELETE', `/follows/${encodeURIComponent(merchant_id)}`, { auth: true });
}

// ---------- Notifications (signed in) ----------

/** GET /notifications?since= -> { notifications } newest first */
export function listNotifications(since?: string): Promise<{ notifications: AppNotification[] }> {
  return request<{ notifications: AppNotification[] }>('GET', '/notifications', {
    query: { since },
    auth: true,
  });
}

/** POST /notifications/{id}/read -> { ok: true } */
export function markNotificationRead(id: string): Promise<Ok> {
  return request<Ok>('POST', `/notifications/${encodeURIComponent(id)}/read`, { auth: true });
}

/**
 * POST /customers/me/push-token { expo_push_token } -> { ok: true }
 * Optional in the contract and off unless the backend says otherwise. Not called by the app:
 * remote push is unavailable in Expo Go on Android, and polling covers notifications.
 */
export function registerPushToken(expo_push_token: string): Promise<Ok> {
  return request<Ok>('POST', '/customers/me/push-token', { body: { expo_push_token }, auth: true });
}
