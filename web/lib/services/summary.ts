/**
 * GET /merchants/{id}/summary?date= (contract "Summary").
 *
 * Over the merchant's published deals of that business date (local_date),
 * cancelled-after-publish included:
 * - units_listed    = sum of quantity_total
 * - units_picked_up = units of picked_up reservations
 * - units_no_show   = units of reservations that read as no_show now
 * - units_unsold    = units_listed - picked_up - no_show - units still reserved
 *                     (open reservations are neither sold nor unsold until
 *                     they are picked up or become no-shows)
 * - recovered_cents = sum of total_cents of picked_up reservations (paid in store)
 * - platform_fee_cents = PLATFORM_FEE_CENTS_PER_PICKUP x number of picked_up
 *                     reservations (only picked_up counts)
 * - if_discarded_cents = 0 (nothing is recovered from discarded food)
 */
import type { Summary } from "@/lib/contract";
import { deriveReservationStatus, type MerchantRecord } from "@/lib/store";
import { db } from "./db";

/** Proposed plan: $0.99 per pickup (docs/build-notes.md, not final). One fee per picked_up reservation. */
export const PLATFORM_FEE_CENTS_PER_PICKUP = 99;

export async function getSummary(merchant: MerchantRecord, date: string, at: Date): Promise<Summary> {
  const store = await db();
  const deals = (await store.listDealsByMerchantDate(merchant.id, date)).filter((d) => d.published_at !== null);
  const dealsById = new Map(deals.map((d) => [d.id, d]));
  const reservations = await store.listReservationsByMerchantDate(merchant.id, date);

  let unitsListed = 0;
  for (const deal of deals) unitsListed += deal.quantity_total ?? 0;

  let unitsPickedUp = 0;
  let unitsNoShow = 0;
  let unitsOpen = 0;
  let recovered = 0;
  let pickups = 0;
  for (const r of reservations) {
    const deal = dealsById.get(r.deal_id);
    if (!deal) continue;
    const status = deriveReservationStatus(r, deal, at);
    if (status === "picked_up") {
      unitsPickedUp += r.quantity;
      recovered += r.total_cents;
      pickups += 1;
    } else if (status === "no_show") {
      unitsNoShow += r.quantity;
    } else if (status === "reserved") {
      unitsOpen += r.quantity;
    }
  }

  return {
    date,
    units_listed: unitsListed,
    units_picked_up: unitsPickedUp,
    units_no_show: unitsNoShow,
    units_unsold: Math.max(0, unitsListed - unitsPickedUp - unitsNoShow - unitsOpen),
    recovered_cents: recovered,
    platform_fee_cents: pickups * PLATFORM_FEE_CENTS_PER_PICKUP,
    if_discarded_cents: 0,
  };
}
