/**
 * Customer and merchant sign-up / sign-in (contract "Auth").
 * Customers get a bearer token; merchants get an httpOnly session cookie.
 */
import { z } from "zod";
import type { CustomerAuthResponse } from "@/lib/contract";
import { now, toIso } from "@/lib/clock";
import { ApiError, parseWith } from "@/lib/http";
import { newId } from "@/lib/ids";
import {
  createCustomerToken,
  createMerchantSession,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from "@/lib/auth";
import { dummyPasswordHash } from "@/lib/auth/password";
import { db } from "./db";
import { anyPassword, email, newPassword, phone, text } from "./validation";
import { loadCustomerView } from "./views";

const BAD_CUSTOMER_CREDENTIALS = "Phone number or password is incorrect.";
const BAD_MERCHANT_CREDENTIALS = "Email or password is incorrect.";

export const customerSignupSchema = z.object({
  name: text(100),
  phone,
  password: newPassword,
});

export const customerSigninSchema = z.object({
  phone: z.string({ error: "Required." }).trim(),
  password: anyPassword,
});

export const merchantSignupSchema = z.object({
  email,
  password: newPassword,
});

export const merchantSigninSchema = z.object({
  email: z.string({ error: "Required." }).max(254, "Must be at most 254 characters."),
  password: anyPassword,
});

export async function signupCustomer(body: unknown): Promise<CustomerAuthResponse> {
  const input = parseWith(customerSignupSchema, body);
  const store = await db();
  const at = now();
  const created = await store.createCustomer({
    id: newId("c"),
    name: input.name,
    phone: input.phone,
    password_hash: await hashPassword(input.password),
    expo_push_token: null,
    created_at: toIso(at),
  });
  if (!created.ok) throw new ApiError("ACCOUNT_EXISTS", "An account with this phone number already exists.");
  const token = await createCustomerToken(created.value.id);
  return { token, customer: await loadCustomerView(store, created.value, at) };
}

export async function signinCustomer(body: unknown): Promise<CustomerAuthResponse> {
  const input = parseWith(customerSigninSchema, body);
  const store = await db();
  const customer = await store.getCustomerByPhone(input.phone);
  // Verify against a dummy hash on a miss so both cases take the same time.
  const matches = await verifyPassword(input.password, customer?.password_hash ?? (await dummyPasswordHash()));
  if (!customer || !matches) throw new ApiError("BAD_CREDENTIALS", BAD_CUSTOMER_CREDENTIALS);
  const token = await createCustomerToken(customer.id);
  return { token, customer: await loadCustomerView(store, customer, now()) };
}

/** Creates the account and a session. Returns the Set-Cookie value. */
export async function signupMerchant(body: unknown): Promise<{ setCookie: string }> {
  const input = parseWith(merchantSignupSchema, body);
  const store = await db();
  const created = await store.createMerchantAccount({
    id: newId("ma"),
    email: input.email,
    password_hash: await hashPassword(input.password),
    created_at: toIso(now()),
  });
  if (!created.ok) throw new ApiError("ACCOUNT_EXISTS", "An account with this email already exists.");
  return createMerchantSession(created.value.id);
}

/** Checks the password and starts a session. Returns the Set-Cookie value. */
export async function signinMerchant(body: unknown): Promise<{ setCookie: string }> {
  const input = parseWith(merchantSigninSchema, body);
  const store = await db();
  const account = await store.getMerchantAccountByEmail(normalizeEmail(input.email));
  const matches = await verifyPassword(input.password, account?.password_hash ?? (await dummyPasswordHash()));
  if (!account || !matches) throw new ApiError("BAD_CREDENTIALS", BAD_MERCHANT_CREDENTIALS);
  return createMerchantSession(account.id);
}
