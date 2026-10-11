/**
 * Billing hooks. NO billing code lives here (CLAUDE.md hard rule): the
 * /monetize tool generates checkout, metering and the billing portal later as
 * a pull request and wires into these hooks.
 */
import type { BillingLinks } from "@/lib/contract";
import type { ReservationRecord } from "@/lib/store";

/**
 * Called exactly once each time a reservation becomes picked_up (merchant
 * redeem or customer confirm-pickup; only the winner of a race calls it).
 * No-op today: the /monetize tool wires usage metering here (one usage event
 * per picked_up reservation).
 */
export async function recordPickupUsage(reservation: ReservationRecord): Promise<void> {
  void reservation;
}

/** PLAN_GATE=1 turns on PLAN_REQUIRED at publish for merchants with plan_status "none". Off by default. */
export function planGateEnabled(): boolean {
  return process.env.PLAN_GATE === "1";
}

/**
 * GET /api/billing/links stub. Empty strings mean "no page yet": the pricing
 * page and billing portal do not exist until /monetize generates them, and
 * the portal shows no "Choose a plan" link for an empty URL instead of a
 * link to a 404. /monetize replaces these with the real URLs.
 */
export function billingLinks(): BillingLinks {
  return { pricing_url: "", portal_url: "" };
}
