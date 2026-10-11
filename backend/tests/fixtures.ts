import type { Customer, DealRecord, Merchant, ReservationRecord } from "../lib/db/models";
export const now = "2026-10-11T19:00:00.000Z";
export const customer: Customer = { id: "c_1", name: "Sam", phone: "+18145550123", no_show_count: 0, blocked: false, created_at: now };
export const merchant: Merchant = { id: "m_1", name: "Bakery", category: "bakery", address: "College Ave", lat: null, lng: null,
  phone: "+18145550100", closes_at: "18:00", default_discount_pct: 50, menu: [], plan_status: "active" };
export const deal: DealRecord = { id: "d_1", merchant_id: merchant.id, title: "Croissant", items: [{ name: "Croissant", qty: 1 }],
  original_price_cents: 800, deal_price_cents: 400, kind: "surplus", quantity_total: 5, quantity_left: 5,
  max_per_customer: 2, unsold_action: "none", pickup_start: "2026-10-11T19:00:00.000Z", pickup_end: "2026-10-11T22:00:00.000Z",
  allergens: [], note: "", photo_url: null, status: "live", created_at: now, published_at: now, version: 1 };
export const record: ReservationRecord = { id: "r_1", deal_id: deal.id, merchant_id: merchant.id, customer_id: customer.id,
  customer_name: customer.name, customer_phone: customer.phone, quantity: 1, unit_price_cents: 400, total_cents: 400,
  payment_method: "in_store", pickup_code: "0123", status: "reserved", created_at: now };
