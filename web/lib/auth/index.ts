/**
 * Sign-in for merchants (email + password, httpOnly session cookie) and
 * customers (phone + password, opaque bearer token that does not expire).
 *
 * Route handlers and server components only use the functions below, so an
 * external provider can replace this module without touching them.
 *
 * - Passwords: node:crypto scrypt with a per-user random salt, compared with
 *   timingSafeEqual (./password.ts). Only the hash is stored.
 * - Session ids and tokens: lib/ids newSecret() (crypto.randomBytes). The
 *   store keeps SHA-256(secret) as the record id, never the raw value.
 * - Merchant cookie: httpOnly, SameSite=Lax, Path=/, Secure in production,
 *   30 days.
 * - Emails are trimmed and lowercased before any store call.
 */
import { addMinutes, now, toIso, toMs } from "@/lib/clock";
import { isProduction } from "@/lib/env";
import { newSecret } from "@/lib/ids";
import { db } from "@/lib/services/db";
import type { CustomerRecord, MerchantAccountRecord, MerchantRecord } from "@/lib/store/types";
import { hashPassword as hashPasswordImpl, secretLookupKey, verifyPassword as verifyPasswordImpl } from "./password";

/** Anything with request headers: a Request, or `{ headers: await headers() }` in a server component. */
export interface RequestLike {
  headers: { get(name: string): string | null };
}

/** A merchant account without its password hash. */
export type MerchantAccount = Omit<MerchantAccountRecord, "password_hash">;

export interface SignedInMerchant {
  account: MerchantAccount;
  /** null = signed in but not onboarded yet (GET /me returns { merchant: null }). */
  merchant: MerchantRecord | null;
}

/** Name of the merchant session cookie. */
export const MERCHANT_SESSION_COOKIE = "merchant_session";
/** Merchant sessions last 30 days (the contract sets no expiry). */
export const MERCHANT_SESSION_DAYS = 30;

/** Email as stored and looked up: trimmed, lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function readCookie(request: RequestLike, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    if (raw === "") return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function bearerToken(request: RequestLike): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

function cookieAttributes(maxAgeSeconds: number): string {
  const parts = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSeconds}`];
  if (isProduction()) parts.push("Secure");
  return parts.join("; ");
}

/** The signed-in merchant account and its merchant, or null without a valid session cookie. */
export async function getCurrentMerchant(request: RequestLike): Promise<SignedInMerchant | null> {
  const sessionId = readCookie(request, MERCHANT_SESSION_COOKIE);
  if (!sessionId) return null;
  const store = await db();
  const session = await store.getMerchantSession(secretLookupKey(sessionId));
  if (!session) return null;
  if (session.expires_at !== null && toMs(session.expires_at) <= now().getTime()) return null;
  const account = await store.getMerchantAccount(session.account_id);
  if (!account) return null;
  const merchant = await store.getMerchantByOwner(account.id);
  const { password_hash: _hash, ...publicAccount } = account;
  void _hash;
  return { account: publicAccount, merchant };
}

/** The customer for the `Authorization: Bearer <token>` header, or null. */
export async function getCurrentCustomer(request: RequestLike): Promise<CustomerRecord | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const store = await db();
  const record = await store.getCustomerToken(secretLookupKey(token));
  if (!record) return null;
  return store.getCustomer(record.customer_id);
}

/** A self-describing password hash (algorithm, parameters, salt, hash). */
export async function hashPassword(password: string): Promise<string> {
  return hashPasswordImpl(password);
}

/** true if `password` matches `storedHash`. Constant-time comparison. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return verifyPasswordImpl(password, storedHash);
}

/** Start a merchant session. Returns the Set-Cookie header value to send. */
export async function createMerchantSession(accountId: string): Promise<{ setCookie: string }> {
  const sessionId = newSecret();
  const createdAt = now();
  const store = await db();
  await store.createMerchantSession({
    id: secretLookupKey(sessionId),
    account_id: accountId,
    created_at: toIso(createdAt),
    expires_at: toIso(addMinutes(createdAt, MERCHANT_SESSION_DAYS * 24 * 60)),
  });
  const maxAge = MERCHANT_SESSION_DAYS * 24 * 60 * 60;
  return { setCookie: `${MERCHANT_SESSION_COOKIE}=${sessionId}; ${cookieAttributes(maxAge)}` };
}

/** End the request's merchant session (if any). Returns a Set-Cookie header value that clears the cookie. */
export async function destroyMerchantSession(request: RequestLike): Promise<{ setCookie: string }> {
  const sessionId = readCookie(request, MERCHANT_SESSION_COOKIE);
  if (sessionId) {
    const store = await db();
    await store.deleteMerchantSession(secretLookupKey(sessionId));
  }
  return { setCookie: `${MERCHANT_SESSION_COOKIE}=; ${cookieAttributes(0)}` };
}

/** Issue a new bearer token for a customer. Returns the raw token (sent to the client once). */
export async function createCustomerToken(customerId: string): Promise<string> {
  const token = newSecret();
  const store = await db();
  await store.createCustomerToken({
    id: secretLookupKey(token),
    customer_id: customerId,
    created_at: toIso(now()),
  });
  return token;
}

/** Revoke the request's bearer token, if any. The contract has no customer sign-out endpoint today. */
export async function revokeCustomerToken(request: RequestLike): Promise<void> {
  const token = bearerToken(request);
  if (!token) return;
  const store = await db();
  await store.deleteCustomerToken(secretLookupKey(token));
}
