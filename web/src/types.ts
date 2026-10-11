// Shapes from API contract v0.1. Money is integer cents, times are ISO 8601 with offset.

export type Category = 'bakery' | 'cafe' | 'restaurant'
export type DealStatus = 'draft' | 'live' | 'sold_out' | 'expired' | 'cancelled'
export type ReservationStatus = 'reserved' | 'picked_up' | 'cancelled' | 'no_show'

export interface Merchant {
  id: string
  name: string
  category: Category
  address: string
  lat: number
  lng: number
  phone: string
  closes_at: string // "18:00", local time
  plan_status: 'none' | 'active'
}

export type MerchantSummary = Pick<Merchant, 'id' | 'name' | 'category' | 'address' | 'lat' | 'lng'>

export interface DealItem {
  name: string
  qty: number
}

export interface Deal {
  id: string
  merchant_id: string
  merchant: MerchantSummary
  title: string
  items: DealItem[] // contents of ONE unit
  original_price_cents: number
  deal_price_cents: number
  kind: 'surplus' | 'timed'
  quantity_total: number
  quantity_left: number
  max_per_customer: number
  unsold_action: 'none' | 'donated'
  pickup_start: string
  pickup_end: string
  allergens: string[] | null // null = not answered (blocks publish), [] = none
  note: string | null
  photo_url: string | null
  status: DealStatus
  created_at: string
}

export interface Draft {
  deal: Deal
  missing_fields: string[]
  agent_notes: string
  estimate: {
    units: number
    deal_price_cents: number
    assumed_sell_through: number // an assumption, label it as such
    expected_recovered_cents: number
    if_discarded_cents: number
  }
}

export interface Reservation {
  id: string
  deal_id: string
  deal: Deal
  quantity: number
  customer_name: string
  customer_phone: string
  total_cents: number
  payment_method: string // "in_store" for now, don't switch on it
  pickup_code: string
  status: ReservationStatus
  created_at: string
}

export interface Summary {
  date: string
  units_listed: number
  units_picked_up: number
  units_unsold: number
  recovered_cents: number
  platform_fee_cents: number
  if_discarded_cents: number
}

export type ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'SOLD_OUT'
  | 'DEAL_NOT_LIVE'
  | 'CODE_INVALID'
  | 'CODE_ALREADY_USED'
  | 'PLAN_REQUIRED'
  | 'UNKNOWN'
