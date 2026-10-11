import { randomUUID } from "node:crypto";
import type { DealRecord, Merchant } from "../db/models";
import { cents, nonEmptyString, positiveQuantity, utc } from "../validation/primitives";
import { validation } from "./errors";
export type ManualDealInput = Pick<DealRecord, "title" | "items" | "original_price_cents" | "deal_price_cents" |
  "kind" | "quantity_total" | "pickup_start" | "pickup_end" | "allergens"> &
  Partial<Pick<DealRecord, "max_per_customer" | "note" | "photo_url">>;
/** Merchant identity comes from the verified session, never the request body. */
export function createDraft(merchant: Merchant, input: ManualDealInput, now: string): DealRecord {
  nonEmptyString(input.title, "title");
  if (!Array.isArray(input.items) || input.items.length === 0) validation("Add at least one item.");
  for (const item of input.items) { if (!item || typeof item !== "object") validation("Invalid item."); nonEmptyString(item.name, "item name"); positiveQuantity(item.qty); }
  if (input.kind !== "surplus" && input.kind !== "timed") validation("Invalid deal kind.");
  if (input.original_price_cents !== null) cents(input.original_price_cents);
  if (input.deal_price_cents !== null) cents(input.deal_price_cents);
  if (input.quantity_total !== null) positiveQuantity(input.quantity_total);
  const limit = input.max_per_customer ?? 2;
  if (!Number.isInteger(limit) || limit < 1 || limit > 2) validation("max_per_customer must be 1 or 2.");
  if (input.allergens !== null) {
    if (!Array.isArray(input.allergens)) validation("Allergens must be a list or null.");
    for (const allergen of input.allergens) nonEmptyString(allergen, "allergen");
  }
  if (input.note !== undefined && typeof input.note !== "string") validation("Note must be text.");
  if (input.photo_url !== undefined && input.photo_url !== null && typeof input.photo_url !== "string") validation("Photo URL must be text or null.");
  return { id: `d_${randomUUID()}`, merchant_id: merchant.id, title: input.title, items: input.items,
    original_price_cents: input.original_price_cents, deal_price_cents: input.deal_price_cents, kind: input.kind,
    quantity_total: input.quantity_total, quantity_left: input.quantity_total, max_per_customer: limit,
    unsold_action: "none", pickup_start: utc(input.pickup_start), pickup_end: input.pickup_end === null ? null : utc(input.pickup_end),
    allergens: input.allergens, note: input.note ?? "", photo_url: input.photo_url ?? null,
    status: "draft", created_at: utc(now), published_at: null, version: 1 };
}
