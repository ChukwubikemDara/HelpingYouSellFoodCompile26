import type { DealRecord } from "../db/models";
import { cents, nonEmptyString, positiveQuantity, utc } from "./primitives";
import { validation } from "../services/errors";
export function validatePublish(deal: DealRecord, now: string): void {
  nonEmptyString(deal.title, "title");
  if (!Array.isArray(deal.items) || !deal.items.length) validation("Add at least one item.");
  for (const item of deal.items) { if (!item || typeof item !== "object") validation("Invalid item."); nonEmptyString(item.name, "item name"); positiveQuantity(item.qty); }
  cents(deal.original_price_cents); cents(deal.deal_price_cents);
  if (deal.deal_price_cents >= deal.original_price_cents) validation("Deal price must be below the original price.");
  positiveQuantity(deal.quantity_total);
  if (!Number.isInteger(deal.max_per_customer) || deal.max_per_customer < 1 || deal.max_per_customer > 2) validation("max_per_customer must be 1 or 2.");
  if (!deal.pickup_end || utc(deal.pickup_end) <= utc(now) || utc(deal.pickup_end) <= utc(deal.pickup_start)) validation("Pickup end must be after now and pickup start.");
  if (deal.allergens === null || !Array.isArray(deal.allergens)) validation("Confirm allergens before publishing; use [] for none.");
  for (const allergen of deal.allergens) nonEmptyString(allergen, "allergen");
  if (deal.kind !== "surplus" && deal.kind !== "timed") validation("Invalid deal kind.");
}
