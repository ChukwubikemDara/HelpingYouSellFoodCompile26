/**
 * Notifications (contract "Notifications"). Stored rows, fetched by polling.
 *
 * | type            | created when                       | goes to                                   |
 * | new_deal        | a deal goes live (publish)         | customers who follow that merchant        |
 * | deal_cancelled  | a merchant cancels a deal          | customers with an open reservation on it  |
 * | pickup_reminder | 30 min before pickup_end           | customers with a reserved reservation     |
 *
 * There is no scheduler: pickup reminders are derived when the customer asks
 * for notifications. Every notification has a dedupe key, so a reminder (or a
 * retried publish/cancel) is never stored twice.
 *
 * Remote push (expo_push_token) is off: the token is stored, nothing is sent.
 */
import type { Notification, NotificationType } from "@/lib/contract";
import { RULES } from "@/lib/contract";
import { formatTime12, toIso, toMs, type Instant } from "@/lib/clock";
import { ApiError } from "@/lib/http";
import { newId } from "@/lib/ids";
import type { DealRecord, MerchantRecord, ReservationRecord, Store } from "@/lib/store";
import { formatCents } from "./format";
import { notificationView } from "./views";

interface NewNotification {
  customerId: string;
  type: NotificationType;
  title: string;
  body: string;
  dealId: string | null;
  reservationId: string | null;
  dedupeKey: string;
  at: Instant;
}

async function createOnce(store: Store, n: NewNotification): Promise<boolean> {
  const { created } = await store.createNotification({
    id: newId("n"),
    customer_id: n.customerId,
    type: n.type,
    title: n.title,
    body: n.body,
    deal_id: n.dealId,
    reservation_id: n.reservationId,
    read: false,
    created_at: toIso(n.at),
    dedupe_key: n.dedupeKey,
  });
  return created;
}

/** "Croissants (2-pack) for $4.00, pickup until 6:00 PM" */
export function newDealBody(deal: DealRecord): string {
  const price = deal.deal_price_cents === null ? "" : ` for ${formatCents(deal.deal_price_cents)}`;
  const until = deal.pickup_end === null ? "" : `, pickup until ${formatTime12(deal.pickup_end)}`;
  return `${deal.title}${price}${until}`;
}

export function dealCancelledBody(deal: DealRecord): string {
  return `${deal.title} was cancelled by the store. Your reservation is cancelled.`;
}

export function pickupReminderBody(deal: DealRecord): string {
  const until = deal.pickup_end === null ? "" : ` until ${formatTime12(deal.pickup_end)}`;
  return `Pick up ${deal.title}${until}.`;
}

/** new_deal to every follower of the merchant. Called once a deal is live. */
export async function notifyNewDeal(
  store: Store,
  deal: DealRecord,
  merchant: MerchantRecord,
  at: Instant,
): Promise<void> {
  const followers = await store.listFollowerIds(merchant.id);
  await Promise.all(
    followers.map((customerId) =>
      createOnce(store, {
        customerId,
        type: "new_deal",
        title: merchant.name,
        body: newDealBody(deal),
        dealId: deal.id,
        reservationId: null,
        dedupeKey: `new_deal:${deal.id}`,
        at,
      }),
    ),
  );
}

/**
 * deal_cancelled to each customer whose open reservation the cancel closed.
 * One notification per customer per deal; reservation_id is that customer's
 * most recent cancelled reservation on the deal.
 */
export async function notifyDealCancelled(
  store: Store,
  deal: DealRecord,
  merchant: MerchantRecord,
  cancelledReservations: readonly ReservationRecord[],
  at: Instant,
): Promise<void> {
  const newestByCustomer = new Map<string, ReservationRecord>();
  for (const r of cancelledReservations) {
    const current = newestByCustomer.get(r.customer_id);
    if (!current || toMs(r.created_at) > toMs(current.created_at)) newestByCustomer.set(r.customer_id, r);
  }
  await Promise.all(
    [...newestByCustomer.values()].map((r) =>
      createOnce(store, {
        customerId: r.customer_id,
        type: "deal_cancelled",
        title: merchant.name,
        body: dealCancelledBody(deal),
        dealId: deal.id,
        reservationId: r.id,
        dedupeKey: `deal_cancelled:${deal.id}`,
        at,
      }),
    ),
  );
}

/**
 * Create the pickup reminders that are due for a customer at `at`.
 * A reminder is due for a reservation when, at `at`:
 * - its stored status is reserved (not picked up, not cancelled),
 * - pickup_end - 30 min <= at < pickup_end (so never for a no_show),
 * - it already existed at pickup_end - 30 min (created_at <= that moment).
 * Idempotent: dedupe key "pickup_reminder:<reservation_id>".
 */
export async function createDuePickupReminders(store: Store, customerId: string, at: Instant): Promise<void> {
  const nowMs = toMs(at);
  const open = (await store.listReservationsByCustomer(customerId)).filter((r) => r.status === "reserved");
  if (open.length === 0) return;
  const deals = new Map((await store.getDealsByIds(open.map((r) => r.deal_id))).map((d) => [d.id, d]));
  const due: { reservation: ReservationRecord; deal: DealRecord }[] = [];
  for (const reservation of open) {
    const deal = deals.get(reservation.deal_id);
    if (!deal || deal.pickup_end === null) continue;
    const endMs = toMs(deal.pickup_end);
    const remindMs = endMs - RULES.PICKUP_REMINDER_MINUTES * 60_000;
    if (nowMs < remindMs || nowMs >= endMs) continue;
    if (toMs(reservation.created_at) > remindMs) continue;
    due.push({ reservation, deal });
  }
  if (due.length === 0) return;
  const merchants = new Map(
    (await store.getMerchantsByIds(due.map((d) => d.deal.merchant_id))).map((m) => [m.id, m]),
  );
  for (const { reservation, deal } of due) {
    const merchant = merchants.get(deal.merchant_id);
    if (!merchant) continue;
    await createOnce(store, {
      customerId,
      type: "pickup_reminder",
      title: merchant.name,
      body: pickupReminderBody(deal),
      dealId: deal.id,
      reservationId: reservation.id,
      dedupeKey: `pickup_reminder:${reservation.id}`,
      at,
    });
  }
}

/**
 * GET /notifications: due reminders are created first; newest first. `since`
 * keeps those created at or after it: created_at has seconds precision, so a
 * client polling with the newest created_at it has seen must still get one
 * created later in that same second. Clients drop the repeats by id.
 */
export async function listNotifications(
  store: Store,
  customerId: string,
  since: string | undefined,
  at: Instant,
): Promise<Notification[]> {
  await createDuePickupReminders(store, customerId, at);
  const rows = await store.listNotificationsByCustomer(customerId, since === undefined ? undefined : { since });
  return rows.map(notificationView);
}

/** POST /notifications/{id}/read. 404 unless the notification is the customer's. */
export async function markNotificationRead(store: Store, customerId: string, id: string): Promise<void> {
  const row = await store.getNotification(id);
  if (!row || row.customer_id !== customerId) throw new ApiError("NOT_FOUND", "Notification not found.");
  await store.markNotificationRead(id);
}
