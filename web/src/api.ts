import type { Customer, Deal, Draft, ErrorCode, Merchant, Reservation, Summary } from './types'
import { storage } from './storage'
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '') + '/api'
export class ApiError extends Error {
  code: ErrorCode
  constructor(code: ErrorCode, message: string) { super(message); this.code = code }
}
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = storage.token()
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try { res = await fetch(BASE + path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) }) }
  catch { throw new ApiError('UNKNOWN', 'Cannot reach the server. Please try again.') }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? `Request failed (${res.status})`)
  return json as T
}
function query(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  return q.size ? `?${q}` : ''
}
export type NewReservation = { deal_id: string; quantity: number }
export type NewMerchant = Omit<Merchant, 'id' | 'plan_status' | 'lat' | 'lng'> & { lat?: number | null; lng?: number | null }
export const api = {
  customerSignup: (body: { name: string; phone: string; password: string }) => req<{ token: string; customer: Customer }>('POST', '/auth/customer/signup', body),
  customerSignin: (body: { phone: string; password: string }) => req<{ token: string; customer: Customer }>('POST', '/auth/customer/signin', body),
  customerMe: () => req<Customer>('GET', '/customers/me'),
  customerSignout: () => req<{ ok: true }>('POST', '/auth/customer/signout'),
  merchantSignup: (body: { email: string; password: string }) => req<{ ok: true }>('POST', '/auth/merchant/signup', body),
  merchantSignin: (body: { email: string; password: string }) => req<{ ok: true }>('POST', '/auth/merchant/signin', body),
  merchantSignout: () => req<{ ok: true }>('POST', '/auth/merchant/signout'),
  me: () => req<{ merchant: Merchant | null }>('GET', '/me'),
  deals: (params: { category?: string; kind?: string; lat?: number; lng?: number; sort?: 'ending' | 'distance' } = {}) => req<{ deals: Deal[] }>('GET', '/deals' + query(params)).then(r => r.deals),
  deal: (id: string) => req<Deal>('GET', `/deals/${id}`),
  reserve: (body: NewReservation) => req<Reservation>('POST', '/reservations', body),
  reservation: (id: string) => req<Reservation>('GET', `/reservations/${id}`),
  cancelReservation: (id: string) => req<Reservation>('POST', `/reservations/${id}/cancel`),
  confirmPickup: (id: string) => req<Reservation>('POST', `/reservations/${id}/confirm-pickup`),
  myReservations: () => req<{ reservations: Reservation[] }>('GET', '/reservations').then(r => r.reservations),
  follow: (merchant_id: string) => req<{ ok: true }>('POST', '/follows', { merchant_id }),
  createMerchant: (body: NewMerchant) => req<Merchant>('POST', '/merchants', body),
  merchant: (id: string) => req<Merchant>('GET', `/merchants/${id}`),
  createDrafts: (merchantId: string, body: { text?: string; photo_base64?: string }) => req<{ drafts: Draft[] }>('POST', `/merchants/${merchantId}/drafts`, body).then(r => r.drafts),
  createBlankDraft: () => req<Deal>('POST', '/deals', { title: 'New listing', items: [{ name: 'Item', qty: 1 }], original_price_cents: null,
    deal_price_cents: null, kind: 'surplus', quantity_total: 1, max_per_customer: 2, pickup_start: new Date().toISOString(), pickup_end: new Date(Date.now() + 3600000).toISOString(), allergens: null, note: '' }),
  updateDeal: (id: string, body: Partial<Deal>) => req<Deal>('PATCH', `/deals/${id}`, body),
  publishDeal: (id: string) => req<Deal>('POST', `/deals/${id}/publish`),
  cancelDeal: (id: string) => req<Deal>('POST', `/deals/${id}/cancel`),
  markDonated: (id: string) => req<Deal>('POST', `/deals/${id}/mark-donated`),
  merchantDeals: (merchantId: string, date?: string) => req<{ deals: Deal[] }>('GET', `/merchants/${merchantId}/deals` + query({ date })).then(r => r.deals),
  merchantReservations: (merchantId: string, date?: string) => req<{ reservations: Reservation[] }>('GET', `/merchants/${merchantId}/reservations` + query({ date })).then(r => r.reservations),
  redeem: (pickup_code: string) => req<Reservation>('POST', '/reservations/redeem', { pickup_code }),
  summary: (merchantId: string, date?: string) => req<Summary>('GET', `/merchants/${merchantId}/summary` + query({ date })),
  billingLinks: () => req<{ pricing_url: string; portal_url: string }>('GET', '/billing/links'),
}
