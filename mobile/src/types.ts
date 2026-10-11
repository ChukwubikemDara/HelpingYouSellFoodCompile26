// Public DTOs share the backend's authoritative API Contract v0.6 types.
export type { Category, Customer, Deal, DealStatus, Draft, Merchant, Reservation, ReservationStatus, Summary, Notification, Suggestion } from '../../backend/lib/db/models'
import type { Merchant } from '../../backend/lib/db/models'
export type MerchantSummary = Pick<Merchant, 'id' | 'name' | 'category' | 'address' | 'lat' | 'lng'>
export interface MenuItem { name: string; price_cents: number }
export interface DealItem { name: string; qty: number }
export type ErrorCode = 'NOT_FOUND' | 'VALIDATION' | 'SOLD_OUT' | 'DEAL_NOT_LIVE' | 'CODE_INVALID' | 'CODE_ALREADY_USED' | 'PLAN_REQUIRED' | 'UNAUTHORIZED' | 'BAD_CREDENTIALS' | 'CUSTOMER_BLOCKED' | 'ACCOUNT_EXISTS' | 'UNKNOWN'
