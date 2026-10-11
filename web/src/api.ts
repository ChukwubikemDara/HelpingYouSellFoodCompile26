import { MockError, mockRequest } from './mock'
import type { Deal, Draft, ErrorCode, Merchant, Reservation, Summary } from './types'

const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api'
const USE_MOCK = import.meta.env.VITE_API_MOCK === '1'

export class ApiError extends Error {
  code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const merchantId = localStorage.getItem('merchant_id')

  if (USE_MOCK) {
    try {
      return (await mockRequest(method, path, body, merchantId)) as T
    } catch (e) {
      if (e instanceof MockError) throw new ApiError(e.code, e.message)
      throw e
    }
  }

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (merchantId) headers['X-Merchant-Id'] = merchantId

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? res.statusText)
  }
  return json as T
}

function query(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export type NewReservation = Pick<Reservation, 'deal_id' | 'quantity' | 'customer_name' | 'customer_phone'>
export type NewMerchant = Pick<Merchant, 'name' | 'category' | 'address' | 'phone' | 'closes_at'> &
  Pick<Merchant, 'default_discount_pct' | 'menu_items'>

// The contract returns a single Draft; the feature spec says one draft per product.
// Accept either so the UI works whichever the backend ships.
function toDrafts(res: Draft | Draft[] | { drafts: Draft[] }): Draft[] {
  if (Array.isArray(res)) return res
  if ('drafts' in res) return res.drafts
  return [res]
}

export const api = {
  // consumer
  deals: (params: { category?: string; lat?: number; lng?: number } = {}) =>
    req<{ deals: Deal[] }>('GET', '/deals' + query(params)).then((r) => r.deals),
  deal: (id: string) => req<Deal>('GET', `/deals/${id}`),
  reserve: (body: NewReservation) => req<Reservation>('POST', '/reservations', body),
  reservation: (id: string) => req<Reservation>('GET', `/reservations/${id}`),
  cancelReservation: (id: string) => req<Reservation>('POST', `/reservations/${id}/cancel`),
  confirmPickup: (id: string) => req<Reservation>('POST', `/reservations/${id}/confirm-pickup`),
  myReservations: (phone: string) =>
    req<{ reservations: Reservation[] }>('GET', '/reservations' + query({ phone })).then((r) => r.reservations),
  follow: (merchant_id: string, customer_phone: string) =>
    req<{ ok: boolean }>('POST', '/follows', { merchant_id, customer_phone }),

  // merchant
  createMerchant: (body: NewMerchant) => req<Merchant>('POST', '/merchants', body),
  merchant: (id: string) => req<Merchant>('GET', `/merchants/${id}`),
  createDrafts: (merchantId: string, body: { text?: string; photo_base64?: string }) =>
    req<Draft | Draft[] | { drafts: Draft[] }>('POST', `/merchants/${merchantId}/drafts`, body).then(toDrafts),
  // Manual listing: a blank draft with no assistant. Endpoint is NOT in contract v0.1, confirm with backend.
  createBlankDraft: (merchantId: string) => req<Deal>('POST', `/merchants/${merchantId}/deals`, {}),
  updateDeal: (id: string, body: Partial<Deal>) => req<Deal>('PATCH', `/deals/${id}`, body),
  publishDeal: (id: string) => req<Deal>('POST', `/deals/${id}/publish`),
  cancelDeal: (id: string) => req<Deal>('POST', `/deals/${id}/cancel`),
  markDonated: (id: string) => req<Deal>('POST', `/deals/${id}/mark-donated`),
  merchantDeals: (merchantId: string, date?: string) =>
    req<{ deals: Deal[] }>('GET', `/merchants/${merchantId}/deals` + query({ date })).then((r) => r.deals),
  merchantReservations: (merchantId: string, date?: string) =>
    req<{ reservations: Reservation[] }>('GET', `/merchants/${merchantId}/reservations` + query({ date })).then(
      (r) => r.reservations,
    ),
  redeem: (pickup_code: string) => req<Reservation>('POST', '/reservations/redeem', { pickup_code }),
  summary: (merchantId: string, date?: string) =>
    req<Summary>('GET', `/merchants/${merchantId}/summary` + query({ date })),
  billingLinks: () => req<{ pricing_url: string; portal_url: string }>('GET', '/billing/links'),
}
