/** Customer profile, push token and follows. */
import { z } from "zod";
import type { Customer } from "@/lib/contract";
import { now, toIso } from "@/lib/clock";
import { ApiError, parseWith } from "@/lib/http";
import type { CustomerRecord } from "@/lib/store";
import { db } from "./db";
import { text } from "./validation";
import { loadCustomerView } from "./views";

/** GET /customers/me: no_show_count and blocked derived now. */
export async function getMe(customer: CustomerRecord, at: Date): Promise<Customer> {
  return loadCustomerView(await db(), customer, at);
}

export const pushTokenSchema = z.object({ expo_push_token: text(512) });

/**
 * POST /customers/me/push-token. The token is stored; remote push is off
 * today, so nothing is sent to it. The polling path works without it.
 */
export async function savePushToken(customer: CustomerRecord, body: unknown): Promise<void> {
  const input = parseWith(pushTokenSchema, body);
  const store = await db();
  await store.updateCustomer(customer.id, { expo_push_token: input.expo_push_token });
}

export const followSchema = z.object({ merchant_id: text(200) });

/** GET /follows. */
export async function listFollows(customer: CustomerRecord): Promise<string[]> {
  return (await db()).listFollowedMerchantIds(customer.id);
}

/** POST /follows: 404 for an unknown merchant. Idempotent. */
export async function follow(customer: CustomerRecord, body: unknown): Promise<void> {
  const input = parseWith(followSchema, body);
  const store = await db();
  if (!(await store.getMerchant(input.merchant_id))) throw new ApiError("NOT_FOUND", "Store not found.");
  await store.addFollow(customer.id, input.merchant_id, toIso(now()));
}

/** DELETE /follows/{merchant_id}. Idempotent. */
export async function unfollow(customer: CustomerRecord, merchantId: string): Promise<void> {
  await (await db()).removeFollow(customer.id, merchantId);
}
