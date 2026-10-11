import { MockError, mockRequest } from './mock'
import type { Deal, ErrorCode, Reservation } from './types'

// A phone can't reach the laptop's "localhost": point this at the backend's
// LAN address or deployed URL, e.g. EXPO_PUBLIC_API_URL=http://192.168.1.20:8000
const BASE = (process.env.EXPO_PUBLIC_API_URL ?? '') + '/api'
const USE_MOCK = process.env.EXPO_PUBLIC_API_MOCK === '1'

export class ApiError extends Error {
  code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (USE_MOCK) {
    try {
      return (await mockRequest(method, path, body, null)) as T
    } catch (e) {
      if (e instanceof MockError) throw new ApiError(e.code, e.message)
      throw e
    }
  }

  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('UNKNOWN', "Can't reach the server. Check your connection and try again.")
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? `Request failed (${res.status})`)
  }
  return json as T
}

export type NewReservation = Pick<Reservation, 'deal_id' | 'quantity' | 'customer_name' | 'customer_phone'>

export const api = {
  deals: (category?: string) =>
    req<{ deals: Deal[] }>('GET', '/deals' + (category ? `?category=${encodeURIComponent(category)}` : '')).then(
      (r) => r.deals,
    ),
  deal: (id: string) => req<Deal>('GET', `/deals/${id}`),
  reserve: (body: NewReservation) => req<Reservation>('POST', '/reservations', body),
  reservation: (id: string) => req<Reservation>('GET', `/reservations/${id}`),
  cancelReservation: (id: string) => req<Reservation>('POST', `/reservations/${id}/cancel`),
  confirmPickup: (id: string) => req<Reservation>('POST', `/reservations/${id}/confirm-pickup`),
  myReservations: (phone: string) =>
    req<{ reservations: Reservation[] }>('GET', `/reservations?phone=${encodeURIComponent(phone)}`).then(
      (r) => r.reservations,
    ),
}
