/**
 * Read-time derivations from stored records (no scheduler; see CLAUDE.md).
 * Pure functions of a record and the current instant.
 */
import { RULES, type DealStatus, type ReservationStatus } from "@/lib/contract";
import { toMs, type Instant } from "@/lib/clock";
import type { DealRecord, ReservationRecord } from "./types";

type DealTimes = Pick<DealRecord, "status" | "quantity_left" | "pickup_end">;

/**
 * The contract status of a deal at `now`:
 * cancelled and draft as stored; a stored live deal is `expired` from
 * pickup_end on, else `sold_out` when quantity_left is 0, else `live`.
 */
export function deriveDealStatus(deal: DealTimes, now: Instant): DealStatus {
  if (deal.status === "cancelled" || deal.status === "draft") return deal.status;
  if (deal.pickup_end !== null && toMs(now) >= toMs(deal.pickup_end)) return "expired";
  if ((deal.quantity_left ?? 0) <= 0) return "sold_out";
  return "live";
}

/** The instant a reserved reservation becomes a no-show: pickup_end + 15 min. null if the deal has no pickup_end. */
export function noShowAt(deal: Pick<DealRecord, "pickup_end">): number | null {
  if (deal.pickup_end === null) return null;
  return toMs(deal.pickup_end) + RULES.NO_SHOW_AFTER_MINUTES * 60_000;
}

/**
 * The contract status of a reservation at `now`: stored picked_up and
 * cancelled as is; a stored reserved reservation is `no_show` from the deal's
 * pickup_end + 15 min on, else `reserved`.
 */
export function deriveReservationStatus(
  reservation: Pick<ReservationRecord, "status">,
  deal: Pick<DealRecord, "pickup_end">,
  now: Instant,
): ReservationStatus {
  if (reservation.status !== "reserved") return reservation.status;
  const cutoff = noShowAt(deal);
  if (cutoff !== null && toMs(now) >= cutoff) return "no_show";
  return "reserved";
}

/**
 * A customer's no_show_count at `now`, from their reservations and the deals
 * those reservations belong to. Reservations whose deal is missing from
 * `dealsById` are not counted.
 */
export function countNoShows(
  reservations: readonly Pick<ReservationRecord, "status" | "deal_id">[],
  dealsById: ReadonlyMap<string, Pick<DealRecord, "pickup_end">>,
  now: Instant,
): number {
  let count = 0;
  for (const reservation of reservations) {
    const deal = dealsById.get(reservation.deal_id);
    if (deal && deriveReservationStatus(reservation, deal, now) === "no_show") count += 1;
  }
  return count;
}

/** Customer.blocked: true once no_show_count reaches 2. */
export function isBlocked(noShowCount: number): boolean {
  return noShowCount >= RULES.NO_SHOW_BLOCK_THRESHOLD;
}
