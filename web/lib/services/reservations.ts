/**
 * Reservations (contract "Reservation status", "Timing" and the reserve rules).
 *
 * Stored status is reserved | picked_up | cancelled; no_show is derived on
 * read (deriveReservationStatus: reserved and now >= pickup_end + 15 min).
 * Transitions:
 * - reserved -> picked_up by merchant redeem OR customer confirm-pickup, only
 *   inside the pickup window (pickup_start <= now <= pickup_end)
 * - reserved -> cancelled by the customer, only before pickup_end; units go back
 * - reserved -> no_show at pickup_end + 15 min (derived)
 *
 * Reserving goes through the store's atomic reserve (quantity_left decrement,
 * max_per_customer, pickup code lock and price snapshot in one step).
 * recordPickupUsage runs once per transition to picked_up.
 */
import { randomInt } from "node:crypto";
import { z } from "zod";
import { RULES, type Reservation } from "@/lib/contract";
import { formatTime12, toIso, toMs } from "@/lib/clock";
import { ApiError, parseWith } from "@/lib/http";
import { newId } from "@/lib/ids";
import {
  deriveDealStatus,
  isBlocked,
  type CustomerRecord,
  type DealRecord,
  type MerchantRecord,
  type ReservationRecord,
  type Store,
} from "@/lib/store";
import { recordPickupUsage } from "./billing";
import { db } from "./db";
import { plural } from "./format";
import { positiveInt } from "./validation";
import { customerNoShowCount, loadReservationView, loadReservationViews } from "./views";

export const createReservationSchema = z.object({
  deal_id: z.string({ error: "Required." }).trim().min(1, "Required."),
  quantity: positiveInt(100),
});

export const redeemSchema = z.object({
  pickup_code: z.string({ error: "Must be the 4-digit code as text." }).trim(),
});

const RESERVATION_NOT_FOUND = "Reservation not found.";
const DEAL_NOT_FOUND = "Deal not found.";
const PICKUP_CODE_ATTEMPTS = 25;

/** A random 4-digit pickup code, "0000" to "9999". */
export function randomPickupCode(): string {
  return String(randomInt(0, 10 ** RULES.PICKUP_CODE_LENGTH)).padStart(RULES.PICKUP_CODE_LENGTH, "0");
}

async function soldOutError(store: Store, dealId: string): Promise<ApiError> {
  const deal = await store.getDeal(dealId);
  const left = deal?.quantity_left ?? 0;
  return new ApiError("SOLD_OUT", left <= 0 ? "This deal is sold out." : `Only ${left} left.`);
}

/** POST /reservations. 201 Reservation, or SOLD_OUT, DEAL_NOT_LIVE, CUSTOMER_BLOCKED. */
export async function reserve(customer: CustomerRecord, body: unknown, at: Date): Promise<Reservation> {
  const input = parseWith(createReservationSchema, body);
  const store = await db();

  const noShows = await customerNoShowCount(store, customer.id, at);
  if (isBlocked(noShows)) {
    throw new ApiError(
      "CUSTOMER_BLOCKED",
      `You can't reserve right now because of ${plural(noShows, "missed pickup")}.`,
    );
  }

  const deal = await store.getDeal(input.deal_id);
  // Deals that were never published (drafts, discarded drafts) are invisible to customers.
  if (!deal || deal.published_at === null) throw new ApiError("NOT_FOUND", DEAL_NOT_FOUND);
  const status = deriveDealStatus(deal, at);
  if (status === "cancelled" || status === "expired") {
    throw new ApiError("DEAL_NOT_LIVE", "This deal is no longer available.");
  }
  if (status === "sold_out") throw new ApiError("SOLD_OUT", "This deal is sold out.");
  if (input.quantity > deal.max_per_customer) {
    throw new ApiError("VALIDATION", `quantity: You can reserve up to ${deal.max_per_customer} of this deal.`);
  }

  for (let attempt = 0; attempt < PICKUP_CODE_ATTEMPTS; attempt++) {
    const result = await store.reserve({
      id: newId("r"),
      deal_id: deal.id,
      customer_id: customer.id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      quantity: input.quantity,
      pickup_code: randomPickupCode(),
      payment_method: "in_store",
      at: toIso(at),
    });
    if (result.ok) return loadReservationView(store, result.value.reservation, at);
    switch (result.reason) {
      case "PICKUP_CODE_TAKEN":
        continue;
      case "DEAL_NOT_FOUND":
        throw new ApiError("NOT_FOUND", DEAL_NOT_FOUND);
      case "DEAL_NOT_LIVE":
        throw new ApiError("DEAL_NOT_LIVE", "This deal is no longer available.");
      case "SOLD_OUT":
        throw await soldOutError(store, deal.id);
      case "MAX_PER_CUSTOMER":
        throw new ApiError(
          "VALIDATION",
          `quantity: You can reserve up to ${deal.max_per_customer} of this deal, including what you already reserved.`,
        );
    }
  }
  throw new Error(`reserve: no free pickup code for merchant ${deal.merchant_id} after ${PICKUP_CODE_ATTEMPTS} tries`);
}

/** The customer's own reservation, or 404 (also for other customers' reservations). */
async function loadOwnReservation(store: Store, customer: CustomerRecord, id: string): Promise<ReservationRecord> {
  const reservation = await store.getReservation(id);
  if (!reservation || reservation.customer_id !== customer.id) {
    throw new ApiError("NOT_FOUND", RESERVATION_NOT_FOUND);
  }
  return reservation;
}

async function dealOf(store: Store, reservation: ReservationRecord): Promise<DealRecord> {
  const deal = await store.getDeal(reservation.deal_id);
  if (!deal) throw new Error(`deal ${reservation.deal_id} of reservation ${reservation.id} is missing`);
  return deal;
}

/** GET /reservations: the customer's reservations, newest first. */
export async function listCustomerReservations(customer: CustomerRecord, at: Date): Promise<Reservation[]> {
  const store = await db();
  return loadReservationViews(store, await store.listReservationsByCustomer(customer.id), at);
}

/** GET /reservations/{id}. */
export async function getCustomerReservation(customer: CustomerRecord, id: string, at: Date): Promise<Reservation> {
  const store = await db();
  return loadReservationView(store, await loadOwnReservation(store, customer, id), at);
}

/** POST /reservations/{id}/cancel: reserved -> cancelled, only before pickup_end. */
export async function cancelReservation(customer: CustomerRecord, id: string, at: Date): Promise<Reservation> {
  const store = await db();
  const reservation = await loadOwnReservation(store, customer, id);
  const deal = await dealOf(store, reservation);
  const notOpen = (r: ReservationRecord) =>
    new ApiError(
      "VALIDATION",
      r.status === "cancelled" ? "This reservation is already cancelled." : "This reservation was already picked up.",
    );
  if (reservation.status !== "reserved") throw notOpen(reservation);
  if (deal.pickup_end !== null && toMs(at) >= toMs(deal.pickup_end)) {
    throw new ApiError("VALIDATION", "Pickup time has ended, so this reservation can't be cancelled.");
  }
  const result = await store.cancelReservation(id, { at: toIso(at) });
  if (!result.ok) {
    if (result.reason === "NOT_FOUND") throw new ApiError("NOT_FOUND", RESERVATION_NOT_FOUND);
    throw notOpen((await store.getReservation(id)) ?? reservation);
  }
  return loadReservationView(store, result.value.reservation, at);
}

/** VALIDATION unless pickup_start <= at <= pickup_end. */
function checkPickupWindow(deal: DealRecord, at: Date): void {
  if (toMs(at) < toMs(deal.pickup_start)) {
    throw new ApiError("VALIDATION", `Pickup starts at ${formatTime12(deal.pickup_start)}.`);
  }
  if (deal.pickup_end !== null && toMs(at) > toMs(deal.pickup_end)) {
    throw new ApiError("VALIDATION", `Pickup ended at ${formatTime12(deal.pickup_end)}.`);
  }
}

/**
 * reserved -> picked_up for an open reservation inside the pickup window.
 * Only the winner of a concurrent redeem / confirm-pickup records usage.
 */
async function pickUp(store: Store, reservation: ReservationRecord, at: Date): Promise<ReservationRecord> {
  checkPickupWindow(await dealOf(store, reservation), at);
  const result = await store.markReservationPickedUp(reservation.id, { at: toIso(at) });
  if (!result.ok) {
    const latest = await store.getReservation(reservation.id);
    if (latest?.status === "picked_up") {
      throw new ApiError("CODE_ALREADY_USED", "This reservation was already picked up.");
    }
    throw new ApiError("VALIDATION", "This reservation was cancelled.");
  }
  await recordPickupUsage(result.value);
  return result.value;
}

/** POST /reservations/{id}/confirm-pickup (customer). */
export async function confirmPickup(customer: CustomerRecord, id: string, at: Date): Promise<Reservation> {
  const store = await db();
  const reservation = await loadOwnReservation(store, customer, id);
  if (reservation.status === "picked_up") {
    throw new ApiError("CODE_ALREADY_USED", "This reservation was already picked up.");
  }
  if (reservation.status === "cancelled") throw new ApiError("VALIDATION", "This reservation was cancelled.");
  const updated = await pickUp(store, reservation, at);
  return loadReservationView(store, updated, at);
}

/**
 * POST /reservations/redeem (merchant). Scoped to the signed-in merchant.
 * CODE_INVALID when no reservation of this merchant has the code (or only
 * cancelled ones); CODE_ALREADY_USED when it was picked up already.
 */
export async function redeem(merchant: MerchantRecord, body: unknown, at: Date): Promise<Reservation> {
  const input = parseWith(redeemSchema, body);
  const code = input.pickup_code;
  if (!/^\d{4}$/.test(code)) throw new ApiError("CODE_INVALID", "No reservation has this code.");
  const store = await db();
  const matches = await store.findReservationsByPickupCode(merchant.id, code);
  const open = matches.find((r) => r.status === "reserved");
  if (open) {
    const updated = await pickUp(store, open, at);
    return loadReservationView(store, updated, at);
  }
  if (matches.some((r) => r.status === "picked_up")) {
    throw new ApiError("CODE_ALREADY_USED", "This code was already used.");
  }
  throw new ApiError("CODE_INVALID", "No reservation has this code.");
}

/** GET /merchants/{id}/reservations?date=: reservations on deals of that business date, newest first. */
export async function listMerchantReservations(
  merchant: MerchantRecord,
  date: string,
  at: Date,
): Promise<Reservation[]> {
  const store = await db();
  return loadReservationViews(store, await store.listReservationsByMerchantDate(merchant.id, date), at);
}
