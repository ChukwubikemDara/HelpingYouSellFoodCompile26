/**
 * Test-only hooks for scripts/e2e.ts. They write state the public API cannot
 * create in a test run (a pickup window that already ended), so the e2e script
 * can check the CUSTOMER_BLOCKED rule without waiting for real time to pass.
 *
 * Reachable only when e2eHooksEnabled() (lib/config.ts): E2E_HOOKS=1 and
 * NODE_ENV is not production. In production the routes answer exactly like an
 * unknown /api path (404 NOT_FOUND), whatever E2E_HOOKS says.
 */
import { z } from "zod";
import { addMinutes, localDateOf, now, toIso } from "@/lib/clock";
import { e2eHooksEnabled } from "@/lib/config";
import { RULES } from "@/lib/contract";
import { ApiError, parseWith } from "@/lib/http";
import { ID_PREFIX, newId } from "@/lib/ids";
import type { MerchantRecord, NewDealRecord } from "@/lib/store";
import { db } from "./db";
import { randomPickupCode } from "./reservations";

/** Throws the same 404 as an unknown /api path unless the hooks are on. */
export function requireE2eHooks(): void {
  if (!e2eHooksEnabled()) throw new ApiError("NOT_FOUND", "Not found.");
}

const noShowsSchema = z.object({
  customer_id: z.string({ error: "Must be text." }).min(1, "Can't be empty."),
  count: z
    .number({ error: "Must be a whole number." })
    .int("Must be a whole number.")
    .min(1, "Must be at least 1.")
    .max(5, "Must be at most 5.")
    .optional(),
});

export interface NoShowsResult {
  ok: true;
  merchant_id: string;
  deal_id: string;
  reservation_ids: string[];
}

/** Pickup ended this long ago, so pickup_end + 15 min (no_show) is already past. */
const ENDED_MINUTES_AGO = RULES.NO_SHOW_AFTER_MINUTES + 5;

/**
 * Give a customer `count` (default 2) no-shows: a separate test store with one
 * deal whose pickup window ended 20 minutes ago, and `count` one-unit
 * reservations by the customer made while it was open. They read as no_show,
 * so the customer's no_show_count goes up by `count`.
 */
export async function createNoShows(body: unknown): Promise<NoShowsResult> {
  requireE2eHooks();
  const input = parseWith(noShowsSchema, body);
  const count = input.count ?? RULES.NO_SHOW_BLOCK_THRESHOLD;
  const store = await db();
  const customer = await store.getCustomer(input.customer_id);
  if (!customer) throw new ApiError("NOT_FOUND", "Customer not found.");

  const at = now();
  const opened = addMinutes(at, -180);
  const merchant: MerchantRecord = {
    id: newId(ID_PREFIX.merchant),
    // A test store has no account: nobody can sign in as it.
    owner_account_id: newId(ID_PREFIX.merchantAccount),
    name: "E2E test store",
    category: "bakery",
    address: "Test only",
    lat: null,
    lng: null,
    phone: "+18145550199",
    closes_at: "18:00",
    default_discount_pct: 50,
    menu: [],
    plan_status: "none",
    created_at: toIso(opened),
  };
  const createdMerchant = await store.createMerchant(merchant);
  if (!createdMerchant.ok) throw new Error(`e2e hook: could not create the test store (${createdMerchant.reason})`);

  const deal: NewDealRecord = {
    id: newId(ID_PREFIX.deal),
    merchant_id: merchant.id,
    title: "Test item (pickup ended)",
    items: [{ name: "Test item", qty: 1 }],
    original_price_cents: 400,
    deal_price_cents: 200,
    kind: "timed",
    quantity_total: count,
    quantity_left: count,
    max_per_customer: count,
    unsold_action: "none",
    pickup_start: toIso(opened),
    pickup_end: toIso(addMinutes(at, -ENDED_MINUTES_AGO)),
    allergens: [],
    note: null,
    photo_url: null,
    status: "live",
    created_at: toIso(opened),
    published_at: toIso(opened),
    cancelled_at: null,
    local_date: localDateOf(opened),
    price_lowered_by_suggestion: false,
  };
  await store.createDeal(deal);

  const reservationIds: string[] = [];
  const reservedAt = toIso(addMinutes(at, -120));
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; ; attempt++) {
      const result = await store.reserve({
        id: newId(ID_PREFIX.reservation),
        deal_id: deal.id,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.phone,
        quantity: 1,
        pickup_code: randomPickupCode(),
        payment_method: "in_store",
        at: reservedAt,
      });
      if (result.ok) {
        reservationIds.push(result.value.reservation.id);
        break;
      }
      if (result.reason !== "PICKUP_CODE_TAKEN" || attempt >= 20) {
        throw new Error(`e2e hook: reserve failed (${result.reason})`);
      }
    }
  }
  return { ok: true, merchant_id: merchant.id, deal_id: deal.id, reservation_ids: reservationIds };
}
