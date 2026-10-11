/**
 * Records -> contract objects. Derived fields are computed here at read time:
 * Deal.status (sold_out, expired), Reservation.status (no_show),
 * Customer.no_show_count and blocked, Deal.merchant, Reservation.deal.
 * Every timestamp goes out through toIso (New York offset).
 */
import type {
  Customer,
  Deal,
  DealMerchant,
  Merchant,
  Notification,
  Reservation,
} from "@/lib/contract";
import { toIso, type Instant } from "@/lib/clock";
import {
  countNoShows,
  deriveDealStatus,
  deriveReservationStatus,
  isBlocked,
  type CustomerRecord,
  type DealRecord,
  type MerchantRecord,
  type NotificationRecord,
  type ReservationRecord,
  type Store,
} from "@/lib/store";

const isoOrNull = (value: string | null): string | null => (value === null ? null : toIso(value));

export function merchantView(record: MerchantRecord): Merchant {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    address: record.address,
    lat: record.lat,
    lng: record.lng,
    phone: record.phone,
    closes_at: record.closes_at,
    default_discount_pct: record.default_discount_pct,
    menu: record.menu.map((item) => ({ name: item.name, price_cents: item.price_cents })),
    plan_status: record.plan_status,
  };
}

export function dealMerchantView(record: MerchantRecord): DealMerchant {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    address: record.address,
    lat: record.lat,
    lng: record.lng,
  };
}

/** A deal as the API returns it. distance_m is only set by GET /deals. */
export function dealView(
  record: DealRecord,
  merchant: MerchantRecord,
  at: Instant,
  distanceM: number | null = null,
): Deal {
  return {
    id: record.id,
    merchant_id: record.merchant_id,
    merchant: dealMerchantView(merchant),
    title: record.title,
    items: record.items.map((item) => ({ name: item.name, qty: item.qty })),
    original_price_cents: record.original_price_cents,
    deal_price_cents: record.deal_price_cents,
    kind: record.kind,
    quantity_total: record.quantity_total,
    quantity_left: record.quantity_left,
    max_per_customer: record.max_per_customer,
    unsold_action: record.unsold_action,
    pickup_start: toIso(record.pickup_start),
    pickup_end: isoOrNull(record.pickup_end),
    allergens: record.allergens === null ? null : [...record.allergens],
    note: record.note,
    photo_url: record.photo_url,
    status: deriveDealStatus(record, at),
    created_at: toIso(record.created_at),
    published_at: isoOrNull(record.published_at),
    distance_m: distanceM,
  };
}

export function reservationView(
  record: ReservationRecord,
  deal: DealRecord,
  merchant: MerchantRecord,
  at: Instant,
): Reservation {
  return {
    id: record.id,
    deal_id: record.deal_id,
    deal: dealView(deal, merchant, at),
    customer_id: record.customer_id,
    customer_name: record.customer_name,
    customer_phone: record.customer_phone,
    quantity: record.quantity,
    unit_price_cents: record.unit_price_cents,
    total_cents: record.total_cents,
    payment_method: record.payment_method,
    pickup_code: record.pickup_code,
    status: deriveReservationStatus(record, deal, at),
    created_at: toIso(record.created_at),
  };
}

export function notificationView(record: NotificationRecord): Notification {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    body: record.body,
    deal_id: record.deal_id,
    reservation_id: record.reservation_id,
    read: record.read,
    created_at: toIso(record.created_at),
  };
}

/* ------------------------------------------------------------------ */
/* Loaders: batch-fetch related records, then build views              */
/* ------------------------------------------------------------------ */

async function merchantsById(store: Store, ids: Iterable<string>): Promise<Map<string, MerchantRecord>> {
  const rows = await store.getMerchantsByIds([...new Set(ids)]);
  return new Map(rows.map((row) => [row.id, row]));
}

async function dealsById(store: Store, ids: Iterable<string>): Promise<Map<string, DealRecord>> {
  const rows = await store.getDealsByIds([...new Set(ids)]);
  return new Map(rows.map((row) => [row.id, row]));
}

function required<T>(map: Map<string, T>, id: string, what: string): T {
  const value = map.get(id);
  if (value === undefined) throw new Error(`${what} ${id} is missing`);
  return value;
}

/** Views for deal records, in the given order. `distance` gives distance_m per deal (GET /deals only). */
export async function loadDealViews(
  store: Store,
  records: readonly DealRecord[],
  at: Instant,
  distance?: (deal: DealRecord, merchant: MerchantRecord) => number | null,
): Promise<Deal[]> {
  const merchants = await merchantsById(store, records.map((d) => d.merchant_id));
  return records.map((deal) => {
    const merchant = required(merchants, deal.merchant_id, "merchant");
    return dealView(deal, merchant, at, distance ? distance(deal, merchant) : null);
  });
}

export async function loadDealView(store: Store, record: DealRecord, at: Instant): Promise<Deal> {
  const [view] = await loadDealViews(store, [record], at);
  return view;
}

/** Views for reservation records, in the given order. */
export async function loadReservationViews(
  store: Store,
  records: readonly ReservationRecord[],
  at: Instant,
): Promise<Reservation[]> {
  const deals = await dealsById(store, records.map((r) => r.deal_id));
  const merchants = await merchantsById(store, [...deals.values()].map((d) => d.merchant_id));
  return records.map((reservation) => {
    const deal = required(deals, reservation.deal_id, "deal");
    return reservationView(reservation, deal, required(merchants, deal.merchant_id, "merchant"), at);
  });
}

export async function loadReservationView(
  store: Store,
  record: ReservationRecord,
  at: Instant,
): Promise<Reservation> {
  const [view] = await loadReservationViews(store, [record], at);
  return view;
}

/** A customer's no_show_count at `at`, derived from their reservations (no scheduler). */
export async function customerNoShowCount(store: Store, customerId: string, at: Instant): Promise<number> {
  const reservations = (await store.listReservationsByCustomer(customerId)).filter(
    (r) => r.status === "reserved",
  );
  if (reservations.length === 0) return 0;
  const deals = await dealsById(store, reservations.map((r) => r.deal_id));
  return countNoShows(reservations, deals, at);
}

/** The Customer object, with no_show_count and blocked derived at `at`. Never includes the password hash. */
export async function loadCustomerView(store: Store, record: CustomerRecord, at: Instant): Promise<Customer> {
  const noShowCount = await customerNoShowCount(store, record.id, at);
  return {
    id: record.id,
    name: record.name,
    phone: record.phone,
    no_show_count: noShowCount,
    blocked: isBlocked(noShowCount),
    created_at: toIso(record.created_at),
  };
}
