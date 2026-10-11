/** Exact public DTOs from API Contract v0.6. Internal records are separate. */
export type Category = "bakery" | "cafe" | "restaurant";
export type DealStatus = "draft" | "live" | "sold_out" | "expired" | "cancelled";
export type ReservationStatus = "reserved" | "picked_up" | "cancelled" | "no_show";
export interface Customer {
  id: string; name: string; phone: string; no_show_count: number; blocked: boolean; created_at: string;
}
export interface Merchant {
  id: string; name: string; category: Category; address: string; lat: number | null; lng: number | null;
  phone: string; closes_at: string; default_discount_pct: number;
  menu: { name: string; price_cents: number }[]; plan_status: "none" | "active";
}
export type MerchantPreview = Pick<Merchant, "id" | "name" | "category" | "address" | "lat" | "lng">;
export interface Deal {
  id: string; merchant_id: string; merchant: MerchantPreview; title: string; items: { name: string; qty: number }[];
  original_price_cents: number | null; deal_price_cents: number | null; kind: "surplus" | "timed";
  quantity_total: number | null; quantity_left: number | null; max_per_customer: number;
  unsold_action: "none" | "donated"; pickup_start: string; pickup_end: string | null;
  allergens: string[] | null; note: string; photo_url: string | null; status: DealStatus;
  created_at: string; published_at: string | null; distance_m: number | null;
}
export interface Reservation {
  id: string; deal_id: string; deal: Deal; customer_id: string; customer_name: string; customer_phone: string;
  quantity: number; unit_price_cents: number; total_cents: number; payment_method: "in_store";
  pickup_code: string; status: ReservationStatus; created_at: string;
}
export type MissingField = "original_price_cents" | "deal_price_cents" | "quantity_total" | "pickup_end" | "allergens";
export interface Draft {
  deal: Deal; missing_fields: MissingField[]; price_source: "stated" | "menu" | "history" | null;
  agent_notes: string;
  estimate: { units: number; deal_price_cents: number; assumed_sell_through: number;
    expected_recovered_cents: number; if_discarded_cents: number } | null;
}
export interface Notification {
  id: string; type: "new_deal" | "deal_cancelled" | "pickup_reminder"; title: string; body: string;
  deal_id: string | null; reservation_id: string | null; read: boolean; created_at: string;
}
export interface Suggestion {
  id: string; type: "list_now" | "lower_price"; deal_id: string | null; message: string;
  proposed: { deal_price_cents: number } | null; basis: { reserved: number; total: number; minutes_left: number };
}
export interface Summary {
  date: string; units_listed: number; units_picked_up: number; units_no_show: number; units_unsold: number;
  recovered_cents: number; platform_fee_cents: number; if_discarded_cents: number;
}
// DynamoDB stores relations as IDs, plus a revision for conditional mutations.
export type DealRecord = Omit<Deal, "merchant" | "distance_m"> & { version: number };
export type ReservationRecord = Omit<Reservation, "deal"> & { merchant_id: string };
