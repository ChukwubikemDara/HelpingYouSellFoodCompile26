/**
 * Merchant onboarding and profile (POST /merchants, PATCH/GET /merchants/{id}).
 *
 * Location: lat/lng come from the portal's "Use my current location" button.
 * When they are not sent they stay null: there is no geocoding today.
 */
import { z } from "zod";
import { MERCHANT_CATEGORIES, RULES, type Merchant } from "@/lib/contract";
import { now, toIso } from "@/lib/clock";
import { ApiError, parseWith } from "@/lib/http";
import { newId } from "@/lib/ids";
import type { MerchantRecord } from "@/lib/store";
import { db } from "./db";
import { cents, latitude, localTime, longitude, phone, text } from "./validation";
import { merchantView } from "./views";

const menuItem = z.object({
  name: text(100),
  price_cents: cents,
});

const merchantFields = {
  name: text(200),
  category: z.enum(MERCHANT_CATEGORIES, { error: `Must be one of: ${MERCHANT_CATEGORIES.join(", ")}.` }),
  address: text(300),
  phone,
  closes_at: localTime,
  default_discount_pct: z
    .number({ error: "Must be a whole number." })
    .int("Must be a whole number.")
    .min(RULES.DEFAULT_DISCOUNT_PCT_MIN, `Must be between ${RULES.DEFAULT_DISCOUNT_PCT_MIN} and ${RULES.DEFAULT_DISCOUNT_PCT_MAX}.`)
    .max(RULES.DEFAULT_DISCOUNT_PCT_MAX, `Must be between ${RULES.DEFAULT_DISCOUNT_PCT_MIN} and ${RULES.DEFAULT_DISCOUNT_PCT_MAX}.`),
  menu: z.array(menuItem, { error: "Must be a list." }).max(50, "At most 50 items."),
  lat: latitude.nullable().optional(),
  lng: longitude.nullable().optional(),
};

export const createMerchantSchema = z.object(merchantFields);
export const updateMerchantSchema = z.object(merchantFields).partial();

const LAT_LNG_TOGETHER = "lat and lng: Send both, or neither.";

/** lat/lng are both numbers or both null/absent ("both null if not located"). */
function checkLatLng(input: { lat?: number | null; lng?: number | null }): void {
  const hasLat = input.lat !== undefined;
  const hasLng = input.lng !== undefined;
  if (hasLat !== hasLng) throw new ApiError("VALIDATION", LAT_LNG_TOGETHER);
  if (hasLat && (input.lat === null) !== (input.lng === null)) throw new ApiError("VALIDATION", LAT_LNG_TOGETHER);
}

export async function createMerchant(accountId: string, body: unknown): Promise<Merchant> {
  const input = parseWith(createMerchantSchema, body);
  checkLatLng(input);
  const store = await db();
  const record: MerchantRecord = {
    id: newId("m"),
    owner_account_id: accountId,
    name: input.name,
    category: input.category,
    address: input.address,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    phone: input.phone,
    closes_at: input.closes_at,
    default_discount_pct: input.default_discount_pct,
    menu: input.menu,
    plan_status: "none",
    created_at: toIso(now()),
  };
  const created = await store.createMerchant(record);
  if (!created.ok) throw new ApiError("ACCOUNT_EXISTS", "This account already has a store.");
  return merchantView(created.value);
}

export async function updateMerchant(merchant: MerchantRecord, body: unknown): Promise<Merchant> {
  const input = parseWith(updateMerchantSchema, body);
  checkLatLng(input);
  const store = await db();
  const updated = await store.updateMerchant(merchant.id, input);
  if (!updated) throw new ApiError("NOT_FOUND", "Store not found.");
  return merchantView(updated);
}
