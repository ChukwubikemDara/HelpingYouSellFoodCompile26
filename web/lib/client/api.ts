/**
 * Typed fetch wrappers for the merchant portal. One function per endpoint the
 * portal calls, typed from lib/contract.ts (ApiEndpoints).
 *
 * - Same origin, cookie session: every call sends `credentials: "same-origin"`.
 * - Errors: a non-2xx response becomes an `ApiClientError` carrying the
 *   contract's `code` and `message`. `message` is safe to show as is.
 * - A 401 UNAUTHORIZED from a merchant endpoint also fires the
 *   `UNAUTHORIZED_EVENT` window event so the portal shell can send the merchant
 *   to /signin from one place.
 */
import type {
  ApiEndpointKey,
  ApiEndpoints,
  CreateDealRequest,
  CreateDraftsRequest,
  CreateMerchantRequest,
  UpdateDealRequest,
  UpdateMerchantRequest,
} from "@/lib/contract";

/** The API base. The portal is served by the same app, so it is always same origin. */
export const API_BASE = "/api";

/** Fired on window when a merchant endpoint answers 401 UNAUTHORIZED. */
export const UNAUTHORIZED_EVENT = "portal:unauthorized";

/** Codes the client itself can produce, besides the contract's codes. */
export type ClientErrorCode = "NETWORK" | "BAD_RESPONSE";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

const NETWORK_MESSAGE = "Could not reach the server. Check your connection and try again.";
const FALLBACK_MESSAGE = "Something went wrong. Try again.";

/** Turn anything thrown into a message that can be shown to the merchant. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return FALLBACK_MESSAGE;
}

/** The error's contract code, or null when it is not an API error. */
export function errorCode(err: unknown): string | null {
  return err instanceof ApiClientError ? err.code : null;
}

type Endpoint<K extends ApiEndpointKey> = ApiEndpoints[K];

interface CallOptions {
  /** Values for `{name}` segments in the path. Encoded here. */
  params?: Record<string, string>;
  /** Query string values; undefined and empty values are left out. */
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** Do not fire UNAUTHORIZED_EVENT on 401 (sign-in and sign-up forms). */
  quietUnauthorized?: boolean;
}

function buildUrl(key: ApiEndpointKey, opts: CallOptions): { method: string; url: string } {
  const space = key.indexOf(" ");
  const method = key.slice(0, space);
  let path = key.slice(space + 1);
  path = path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = opts.params?.[name];
    if (value === undefined) throw new Error(`Missing path param ${name} for ${key}`);
    return encodeURIComponent(value);
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "") qs.set(k, v);
  }
  const query = qs.toString();
  return { method, url: `${API_BASE}${path}${query ? `?${query}` : ""}` };
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function envelope(body: unknown): { code: string; message: string } | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = (body as { error: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || typeof message !== "string") return null;
  return { code, message };
}

async function call<K extends ApiEndpointKey>(
  key: K,
  opts: CallOptions = {},
): Promise<Endpoint<K>["response"]> {
  const { method, url } = buildUrl(key, opts);
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  };
  if (opts.body !== undefined) {
    init.headers = { accept: "application/json", "content-type": "application/json" };
    init.body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiClientError("NETWORK", NETWORK_MESSAGE, 0);
  }

  const body = await readBody(res);
  if (!res.ok) {
    const env = envelope(body);
    const err = env
      ? new ApiClientError(env.code, env.message, res.status)
      : new ApiClientError(res.status === 401 ? "UNAUTHORIZED" : "BAD_RESPONSE", FALLBACK_MESSAGE, res.status);
    if (err.code === "UNAUTHORIZED" && !opts.quietUnauthorized && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw err;
  }
  if (body === undefined || body === null) {
    throw new ApiClientError("BAD_RESPONSE", FALLBACK_MESSAGE, res.status);
  }
  return body as Endpoint<K>["response"];
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export function merchantSignup(body: Endpoint<"POST /auth/merchant/signup">["body"]) {
  return call("POST /auth/merchant/signup", { body, quietUnauthorized: true });
}

export function merchantSignin(body: Endpoint<"POST /auth/merchant/signin">["body"]) {
  return call("POST /auth/merchant/signin", { body, quietUnauthorized: true });
}

export function merchantSignout() {
  return call("POST /auth/merchant/signout", { quietUnauthorized: true });
}

/* ------------------------------------------------------------------ */
/* Merchant                                                            */
/* ------------------------------------------------------------------ */

/** `{ merchant: null }` = signed in but not onboarded. 401 = signed out. */
export function getMe(opts: { quietUnauthorized?: boolean } = {}) {
  return call("GET /me", opts);
}

export function createMerchant(body: CreateMerchantRequest) {
  return call("POST /merchants", { body });
}

export function updateMerchant(id: string, body: UpdateMerchantRequest) {
  return call("PATCH /merchants/{id}", { params: { id }, body });
}

export function getMerchant(id: string) {
  return call("GET /merchants/{id}", { params: { id } });
}

/** Listing assistant. Takes 2-10 s. `drafts` may be empty. */
export function createDrafts(merchantId: string, body: CreateDraftsRequest) {
  return call("POST /merchants/{id}/drafts", { params: { id: merchantId }, body });
}

/* ------------------------------------------------------------------ */
/* Deals                                                               */
/* ------------------------------------------------------------------ */

/** Manual entry. Returns the deal with status "draft". */
export function createDeal(body: CreateDealRequest) {
  return call("POST /deals", { body });
}

export function updateDeal(id: string, body: UpdateDealRequest) {
  return call("PATCH /deals/{id}", { params: { id }, body });
}

/** VALIDATION or PLAN_REQUIRED on failure. */
export function publishDeal(id: string) {
  return call("POST /deals/{id}/publish", { params: { id } });
}

export function cancelDeal(id: string) {
  return call("POST /deals/{id}/cancel", { params: { id } });
}

export function markDealDonated(id: string) {
  return call("POST /deals/{id}/mark-donated", { params: { id } });
}

/** All statuses. `date` is a New York local date; the server defaults to today. */
export function listMerchantDeals(merchantId: string, date?: string) {
  return call("GET /merchants/{id}/deals", { params: { id: merchantId }, query: { date } });
}

/* ------------------------------------------------------------------ */
/* Reservations                                                        */
/* ------------------------------------------------------------------ */

export function listMerchantReservations(merchantId: string, date?: string) {
  return call("GET /merchants/{id}/reservations", { params: { id: merchantId }, query: { date } });
}

/** CODE_INVALID / CODE_ALREADY_USED / VALIDATION (outside the pickup window). */
export function redeemPickupCode(pickupCode: string) {
  return call("POST /reservations/redeem", { body: { pickup_code: pickupCode } });
}

/* ------------------------------------------------------------------ */
/* Summary, suggestions, billing                                       */
/* ------------------------------------------------------------------ */

export function getSummary(merchantId: string, date?: string) {
  return call("GET /merchants/{id}/summary", { params: { id: merchantId }, query: { date } });
}

export function listSuggestions(merchantId: string) {
  return call("GET /merchants/{id}/suggestions", { params: { id: merchantId } });
}

/** Deal for lower_price; `{ ok: true }` for list_now. */
export function acceptSuggestion(id: string) {
  return call("POST /suggestions/{id}/accept", { params: { id } });
}

export function dismissSuggestion(id: string) {
  return call("POST /suggestions/{id}/dismiss", { params: { id } });
}

export function getBillingLinks() {
  return call("GET /billing/links");
}
