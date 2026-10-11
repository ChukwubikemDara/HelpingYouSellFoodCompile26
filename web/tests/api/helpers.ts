/**
 * Calls route handlers directly with real Request objects, on a fresh
 * in-memory store and a pinned clock.
 */
import { afterEach, beforeEach } from "vitest";
import { resetNow, setNow } from "@/lib/clock";
import { createMemoryStore, resetStore, setStore, type Store } from "@/lib/store";

import * as customerSignup from "@/app/api/auth/customer/signup/route";
import * as customerSignin from "@/app/api/auth/customer/signin/route";
import * as merchantSignup from "@/app/api/auth/merchant/signup/route";
import * as merchantSignin from "@/app/api/auth/merchant/signin/route";
import * as merchantSignout from "@/app/api/auth/merchant/signout/route";
import * as customersMe from "@/app/api/customers/me/route";
import * as pushToken from "@/app/api/customers/me/push-token/route";
import * as deals from "@/app/api/deals/route";
import * as dealById from "@/app/api/deals/[id]/route";
import * as dealPublish from "@/app/api/deals/[id]/publish/route";
import * as dealCancel from "@/app/api/deals/[id]/cancel/route";
import * as dealDonated from "@/app/api/deals/[id]/mark-donated/route";
import * as reservations from "@/app/api/reservations/route";
import * as reservationById from "@/app/api/reservations/[id]/route";
import * as reservationCancel from "@/app/api/reservations/[id]/cancel/route";
import * as reservationConfirm from "@/app/api/reservations/[id]/confirm-pickup/route";
import * as redeem from "@/app/api/reservations/redeem/route";
import * as follows from "@/app/api/follows/route";
import * as followById from "@/app/api/follows/[merchant_id]/route";
import * as notifications from "@/app/api/notifications/route";
import * as notificationRead from "@/app/api/notifications/[id]/read/route";
import * as me from "@/app/api/me/route";
import * as merchants from "@/app/api/merchants/route";
import * as merchantById from "@/app/api/merchants/[id]/route";
import * as merchantDeals from "@/app/api/merchants/[id]/deals/route";
import * as merchantReservations from "@/app/api/merchants/[id]/reservations/route";
import * as merchantSummary from "@/app/api/merchants/[id]/summary/route";
import * as merchantSuggestions from "@/app/api/merchants/[id]/suggestions/route";
import * as suggestionAccept from "@/app/api/suggestions/[id]/accept/route";
import * as suggestionDismiss from "@/app/api/suggestions/[id]/dismiss/route";
import * as billingLinks from "@/app/api/billing/links/route";
import * as catchAll from "@/app/api/[...path]/route";

/** 2026-10-11 16:00 New York (EDT), a Sunday. */
export const T0 = "2026-10-11T16:00:00-04:00";
export const DATE = "2026-10-11";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, context: any) => Promise<Response>;

export interface CallOptions {
  body?: unknown;
  cookie?: string | null;
  token?: string | null;
  params?: Record<string, string | string[]>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface CallResult<T = any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  status: number;
  body: T;
  headers: Headers;
}

export async function call(
  handler: Handler,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<CallResult> {
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
  const headers = new Headers(options.headers);
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const request = new Request(url, { method, headers, body });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

/** Typed shortcuts for every endpoint. */
export const api = {
  customerSignup: (body: unknown) => call(customerSignup.POST, "POST", "/api/auth/customer/signup", { body }),
  customerSignin: (body: unknown) => call(customerSignin.POST, "POST", "/api/auth/customer/signin", { body }),
  merchantSignup: (body: unknown) => call(merchantSignup.POST, "POST", "/api/auth/merchant/signup", { body }),
  merchantSignin: (body: unknown) => call(merchantSignin.POST, "POST", "/api/auth/merchant/signin", { body }),
  merchantSignout: (cookie?: string | null) => call(merchantSignout.POST, "POST", "/api/auth/merchant/signout", { cookie }),
  customersMe: (token?: string | null) => call(customersMe.GET, "GET", "/api/customers/me", { token }),
  pushToken: (token: string | null, body: unknown) =>
    call(pushToken.POST, "POST", "/api/customers/me/push-token", { token, body }),

  listDeals: (query: Record<string, string> = {}) => call(deals.GET, "GET", "/api/deals", { query }),
  getDeal: (id: string, cookie?: string | null) => call(dealById.GET, "GET", `/api/deals/${id}`, { params: { id }, cookie }),
  createDeal: (cookie: string | null, body: unknown) => call(deals.POST, "POST", "/api/deals", { cookie, body }),
  patchDeal: (cookie: string | null, id: string, body: unknown) =>
    call(dealById.PATCH, "PATCH", `/api/deals/${id}`, { cookie, body, params: { id } }),
  publishDeal: (cookie: string | null, id: string) =>
    call(dealPublish.POST, "POST", `/api/deals/${id}/publish`, { cookie, params: { id } }),
  cancelDeal: (cookie: string | null, id: string) =>
    call(dealCancel.POST, "POST", `/api/deals/${id}/cancel`, { cookie, params: { id } }),
  markDonated: (cookie: string | null, id: string) =>
    call(dealDonated.POST, "POST", `/api/deals/${id}/mark-donated`, { cookie, params: { id } }),

  reserve: (token: string | null, body: unknown) => call(reservations.POST, "POST", "/api/reservations", { token, body }),
  listReservations: (token: string | null) => call(reservations.GET, "GET", "/api/reservations", { token }),
  getReservation: (token: string | null, id: string) =>
    call(reservationById.GET, "GET", `/api/reservations/${id}`, { token, params: { id } }),
  cancelReservation: (token: string | null, id: string) =>
    call(reservationCancel.POST, "POST", `/api/reservations/${id}/cancel`, { token, params: { id } }),
  confirmPickup: (token: string | null, id: string) =>
    call(reservationConfirm.POST, "POST", `/api/reservations/${id}/confirm-pickup`, { token, params: { id } }),
  redeem: (cookie: string | null, body: unknown) => call(redeem.POST, "POST", "/api/reservations/redeem", { cookie, body }),

  listFollows: (token: string | null) => call(follows.GET, "GET", "/api/follows", { token }),
  follow: (token: string | null, body: unknown) => call(follows.POST, "POST", "/api/follows", { token, body }),
  unfollow: (token: string | null, merchantId: string) =>
    call(followById.DELETE, "DELETE", `/api/follows/${merchantId}`, { token, params: { merchant_id: merchantId } }),

  notifications: (token: string | null, query: Record<string, string> = {}) =>
    call(notifications.GET, "GET", "/api/notifications", { token, query }),
  readNotification: (token: string | null, id: string) =>
    call(notificationRead.POST, "POST", `/api/notifications/${id}/read`, { token, params: { id } }),

  me: (cookie?: string | null) => call(me.GET, "GET", "/api/me", { cookie }),
  createMerchant: (cookie: string | null, body: unknown) => call(merchants.POST, "POST", "/api/merchants", { cookie, body }),
  getMerchant: (cookie: string | null, id: string) =>
    call(merchantById.GET, "GET", `/api/merchants/${id}`, { cookie, params: { id } }),
  patchMerchant: (cookie: string | null, id: string, body: unknown) =>
    call(merchantById.PATCH, "PATCH", `/api/merchants/${id}`, { cookie, body, params: { id } }),
  merchantDeals: (cookie: string | null, id: string, query: Record<string, string> = {}) =>
    call(merchantDeals.GET, "GET", `/api/merchants/${id}/deals`, { cookie, params: { id }, query }),
  merchantReservations: (cookie: string | null, id: string, query: Record<string, string> = {}) =>
    call(merchantReservations.GET, "GET", `/api/merchants/${id}/reservations`, { cookie, params: { id }, query }),
  summary: (cookie: string | null, id: string, query: Record<string, string> = {}) =>
    call(merchantSummary.GET, "GET", `/api/merchants/${id}/summary`, { cookie, params: { id }, query }),
  suggestions: (cookie: string | null, id: string) =>
    call(merchantSuggestions.GET, "GET", `/api/merchants/${id}/suggestions`, { cookie, params: { id } }),
  acceptSuggestion: (cookie: string | null, id: string) =>
    call(suggestionAccept.POST, "POST", `/api/suggestions/${id}/accept`, { cookie, params: { id } }),
  dismissSuggestion: (cookie: string | null, id: string) =>
    call(suggestionDismiss.POST, "POST", `/api/suggestions/${id}/dismiss`, { cookie, params: { id } }),
  billingLinks: (cookie?: string | null) => call(billingLinks.GET, "GET", "/api/billing/links", { cookie }),
  unknown: (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string) =>
    call(catchAll[method], method, path, { params: { path: path.split("/").slice(2) } }),
};

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/** Fresh store and the clock pinned to T0 for every test in the file. Returns a getter for the store. */
export function withFreshApi(start: string = T0): () => Store {
  let store: Store;
  beforeEach(() => {
    store = createMemoryStore();
    setStore(store);
    setNow(start);
  });
  afterEach(() => {
    resetNow();
    resetStore();
  });
  return () => store;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export function cookieFrom(result: CallResult): string {
  const header = result.headers.get("set-cookie");
  if (!header) throw new Error("no set-cookie header");
  return header.split(";")[0];
}

export const MERCHANT_PROFILE = {
  name: "Example Bakery",
  category: "bakery",
  address: "123 College Ave, State College, PA",
  phone: "+18145550100",
  closes_at: "18:00",
  default_discount_pct: 50,
  menu: [{ name: "Butter croissant", price_cents: 400 }],
  lat: 40.7934,
  lng: -77.86,
};

/** Signs up a merchant account and onboards it. */
export async function newMerchant(profile: Partial<typeof MERCHANT_PROFILE> & Record<string, unknown> = {}) {
  const email = `m-${unique()}@example.com`;
  const password = "correct horse";
  const signup = await api.merchantSignup({ email, password });
  if (signup.status !== 200) throw new Error(`merchant signup failed: ${JSON.stringify(signup.body)}`);
  const cookie = cookieFrom(signup);
  const created = await api.createMerchant(cookie, { ...MERCHANT_PROFILE, ...profile });
  if (created.status !== 201) throw new Error(`onboarding failed: ${JSON.stringify(created.body)}`);
  return { cookie, email, password, merchant: created.body };
}

let phoneCounter = 1000000;
export function newPhone(): string {
  phoneCounter += 1;
  return `+1814${String(phoneCounter).slice(-7)}`;
}

export async function newCustomer(name = "Sam") {
  const phone = newPhone();
  const password = "password123";
  const signup = await api.customerSignup({ name, phone, password });
  if (signup.status !== 201) throw new Error(`customer signup failed: ${JSON.stringify(signup.body)}`);
  return { token: signup.body.token as string, customer: signup.body.customer, phone, password };
}

/** A complete manual deal body: 3 units at $4.00 (regular $8.00), pickup 17:00-18:00 on DATE. */
export function dealBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Croissants (2-pack)",
    items: [{ name: "Butter croissant", qty: 2 }],
    original_price_cents: 800,
    deal_price_cents: 400,
    kind: "surplus",
    quantity_total: 3,
    max_per_customer: 2,
    pickup_start: "2026-10-11T17:00:00-04:00",
    pickup_end: "2026-10-11T18:00:00-04:00",
    allergens: ["wheat", "milk", "egg"],
    note: "Baked this morning.",
    ...overrides,
  };
}

/** Create and publish a deal; returns the live Deal. */
export async function liveDeal(cookie: string, overrides: Record<string, unknown> = {}) {
  const created = await api.createDeal(cookie, dealBody(overrides));
  if (created.status !== 200) throw new Error(`create deal failed: ${JSON.stringify(created.body)}`);
  const published = await api.publishDeal(cookie, created.body.id);
  if (published.status !== 200) throw new Error(`publish failed: ${JSON.stringify(published.body)}`);
  return published.body;
}

export async function reserveOk(token: string, dealId: string, quantity = 1) {
  const result = await api.reserve(token, { deal_id: dealId, quantity });
  if (result.status !== 201) throw new Error(`reserve failed: ${JSON.stringify(result.body)}`);
  return result.body;
}

export function expectError(result: CallResult, status: number, code: string): void {
  if (result.status !== status || result.body?.error?.code !== code) {
    throw new Error(
      `expected ${status} ${code}, got ${result.status} ${JSON.stringify(result.body)}`,
    );
  }
  if (typeof result.body.error.message !== "string" || result.body.error.message.length === 0) {
    throw new Error("error message missing");
  }
}
