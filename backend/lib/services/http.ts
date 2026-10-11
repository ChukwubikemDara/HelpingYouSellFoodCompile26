import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { getDbClient } from "../db/client";
import { getDbConfig } from "../db/config";
import type { DealRecord, Merchant, ReservationRecord } from "../db/models";
import { Store } from "../db/store";
import { Accounts } from "../auth/accounts";
import { Marketplace } from "./marketplace";
import { DomainError, notFound, validation } from "./errors";
import { localDate, utc } from "../validation/primitives";
export const SESSION_COOKIE = "hysf_session";
function cookieToken(request: Request) {
  return request.headers.get("cookie")?.split(";").map(p => p.trim()).find(p => p.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
}
function bearer(request: Request) { return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1]; }
function cookie(token: string, clear = false) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 86400}${process.env.NODE_ENV === "production" && process.env.LOCAL_DEVELOPMENT !== "1" ? "; Secure" : ""}`;
}
function distance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (n: number) => n * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
export function createApi(market: Marketplace, accounts: Accounts) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const origin = request.headers.get("origin");
    const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:3000").split(",").map(s => s.trim());
    const cors = origin && (origin === url.origin || allowedOrigins.includes(origin)) ? origin : undefined;
    const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
    if (cors) { headers["Access-Control-Allow-Origin"] = cors; headers["Access-Control-Allow-Credentials"] = "true"; headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"; headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"; }
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (origin && !cors) throw new DomainError("UNAUTHORIZED", "This request origin is not allowed.", 401);
      if (request.method !== "GET" && request.method !== "OPTIONS" && request.headers.get("cookie")?.includes(SESSION_COOKIE) && !origin) {
        // Browser clients send Origin for unsafe methods. Non-browser cookie requests must also supply it.
        throw new DomainError("UNAUTHORIZED", "A same-origin request is required.", 401);
      }
      let body: any = {};
      if (["POST", "PATCH"].includes(request.method)) {
        const text = await request.text();
        if (Buffer.byteLength(text) > 1_400_000) validation("Request is too large.");
        try { body = text ? JSON.parse(text) : {}; } catch { validation("Invalid JSON."); }
        if (!body || typeof body !== "object" || Array.isArray(body)) validation("Expected a JSON object.");
      }
      const is = (method: string, route: string) => request.method === method && path.join("/") === route;
      const customer = () => accounts.customer(bearer(request));
      const merchant = () => accounts.merchant(cookieToken(request));
      if (is("POST", "auth/customer/signup")) return json(await accounts.customerSignup(body), 201);
      if (is("POST", "auth/customer/signin")) return json(await accounts.customerSignin(body));
      if (is("POST", "auth/customer/signout")) { await accounts.signout("customer", bearer(request)); return json({ ok: true }); }
      if (is("POST", "auth/merchant/signup") || is("POST", "auth/merchant/signin")) {
        const token = path[2] === "signup" ? await accounts.merchantSignup(body) : await accounts.merchantSignin(body);
        headers["Set-Cookie"] = cookie(token); return json({ ok: true });
      }
      if (is("POST", "auth/merchant/signout")) { await accounts.signout("merchant", cookieToken(request)); headers["Set-Cookie"] = cookie("", true); return json({ ok: true }); }
      await market.maintenance();
      if (is("GET", "customers/me")) return json(await customer());
      if (is("GET", "me")) { const a = await merchant(); return json({ merchant: a.merchant_id ? await market.merchant(a.merchant_id) : null }); }
      if (is("POST", "merchants")) return json(await market.onboard(await merchant(), body), 201);
      if (path[0] === "merchants" && path[1]) {
        const a = await merchant(); market.own(a, path[1]);
        if (path.length === 2 && request.method === "GET") return json(await market.merchant(path[1]));
        if (path.length === 2 && request.method === "PATCH") return json(await market.editMerchant(a, path[1], body));
        const date = url.searchParams.get("date") ?? localDate(market.clock());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) validation("Date must use YYYY-MM-DD.");
        utc(`${date}T00:00:00Z`);
        if (path[2] === "deals" && request.method === "GET") return json({ deals: await Promise.all((await market.deals()).filter(d => d.merchant_id === path[1] && localDate(d.created_at) === date).map(d => market.dto(d))) });
        if (path[2] === "reservations" && request.method === "GET") return json({ reservations: await Promise.all((await market.allReservations()).filter(r => r.merchant_id === path[1] && localDate(r.created_at) === date).map(r => market.reservations.dto(r))) });
        if (path[2] === "summary" && request.method === "GET") return json(await market.summary(a, path[1], date));
        if (path[2] === "drafts" && request.method === "POST") throw new DomainError("UNAVAILABLE", "The listing assistant is not connected yet. Use the manual listing form.", 503);
      }
      if (is("GET", "deals")) {
        const category = url.searchParams.get("category"), kind = url.searchParams.get("kind"), sort = url.searchParams.get("sort") ?? "ending";
        if (category && !["bakery", "cafe", "restaurant"].includes(category)) validation("Invalid category.");
        if (kind && !["surplus", "timed"].includes(kind)) validation("Invalid deal kind.");
        if (!["ending", "distance"].includes(sort)) validation("Invalid sort.");
        const lat = url.searchParams.get("lat"), lng = url.searchParams.get("lng");
        if ((lat === null) !== (lng === null) || sort === "distance" && lat === null) validation("Distance sorting requires latitude and longitude.");
        if (lat !== null && (lat.trim() === "" || lng!.trim() === "" || !Number.isFinite(+lat) || Math.abs(+lat) > 90 || !Number.isFinite(+lng!) || Math.abs(+lng!) > 180)) validation("Invalid location.");
        let deals = await Promise.all((await market.deals()).map(d => market.dto(d)));
        deals = deals.filter(d => ["live", "sold_out"].includes(d.status) && (!category || d.merchant.category === category) && (!kind || d.kind === kind));
        if (lat !== null) deals = deals.map(d => ({ ...d, distance_m: d.merchant.lat !== null && d.merchant.lng !== null ? distance(+lat, +lng!, d.merchant.lat, d.merchant.lng) : null }));
        deals.sort((a, b) => sort === "distance" ? (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity) || Date.parse(a.pickup_end!) - Date.parse(b.pickup_end!) : Date.parse(a.pickup_end!) - Date.parse(b.pickup_end!));
        return json({ deals });
      }
      if (is("POST", "deals")) return json(await market.create(await merchant(), body), 201);
      if (path[0] === "deals" && path[1]) {
        if (path.length === 2 && request.method === "GET") {
          const d = await market.deal(path[1]);
          if (d.status === "draft") market.own(await merchant(), d.merchant_id);
          return json(await market.dto(d));
        }
        const a = await merchant();
        if (path.length === 2 && request.method === "PATCH") return json(await market.edit(a, path[1], body));
        if (request.method === "POST") {
          if (path[2] === "publish") return json(await market.publish(a, path[1]));
          if (path[2] === "cancel") return json(await market.cancelDeal(a, path[1]));
          if (path[2] === "mark-donated") return json(await market.donated(a, path[1]));
        }
      }
      if (is("POST", "reservations/redeem")) {
        const a = await merchant(); if (!a.merchant_id) notFound();
        return json(await market.reservations.redeem({ role: "merchant", merchant_id: a.merchant_id }, body.pickup_code));
      }
      if (path[0] === "reservations") {
        const c = await customer(); const principal = { role: "customer" as const, customer_id: c.id };
        if (is("POST", "reservations")) {
          if (Object.keys(body).some(k => !["deal_id", "quantity"].includes(k))) validation("Send only deal_id and quantity.");
          return json(await market.reservations.reserve(principal, body), 201);
        }
        if (is("GET", "reservations")) {
          const records = (await market.allReservations()).filter(r => r.customer_id === c.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
          return json({ reservations: await Promise.all(records.map(r => market.reservations.dto(r))) });
        }
        const r = await market.store.get<ReservationRecord>(market.tables.reservations, path[1]);
        if (!r || r.customer_id !== c.id) notFound();
        if (path.length === 2 && request.method === "GET") return json(await market.reservations.dto(r));
        if (request.method === "POST" && path[2] === "cancel") return json(await market.reservations.cancel(principal, r.id));
        if (request.method === "POST" && path[2] === "confirm-pickup") return json(await market.reservations.confirmPickup(principal, r.id));
      }
      if (is("GET", "billing/links")) {
        await merchant();
        if (!process.env.BILLING_PRICING_URL || !process.env.BILLING_PORTAL_URL) throw new DomainError("UNAVAILABLE", "Billing is not available yet.", 503);
        return json({ pricing_url: process.env.BILLING_PRICING_URL, portal_url: process.env.BILLING_PORTAL_URL });
      }
      notFound();
    } catch (error) {
      if (error instanceof DomainError) return json({ error: { code: error.code, message: error.message } }, error.httpStatus);
      if (error instanceof ConditionalCheckFailedException || error instanceof TransactionCanceledException && error.CancellationReasons?.some(r => r.Code === "ConditionalCheckFailed"))
        return json({ error: { code: "VALIDATION", message: "The item changed. Refresh and try again." } }, 422);
      // Never expose provider messages, request bodies, tokens or hashes.
      console.error("API failure", error instanceof Error ? error.name : "UnknownError");
      return json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, 500);
    }
  };
}
export async function handleApi(request: Request) {
  const store = new Store(getDbClient()); const { tables } = getDbConfig();
  return createApi(new Marketplace(store, tables), new Accounts(store, tables))(request);
}
