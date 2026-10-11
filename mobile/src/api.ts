import type { Customer, Deal, ErrorCode, Reservation } from './types'
import { getToken } from './session'
const BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/api'
export class ApiError extends Error { constructor(public code: ErrorCode, message: string) { super(message) } }
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try { res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }) }
  catch { throw new ApiError('UNKNOWN', 'Cannot reach the server. Check the API URL and your connection.') }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? `Request failed (${res.status})`)
  return json as T
}
export const api = {
  signup: (body: { name: string; phone: string; password: string }) => req<{ token: string; customer: Customer }>('POST', '/auth/customer/signup', body),
  signin: (body: { phone: string; password: string }) => req<{ token: string; customer: Customer }>('POST', '/auth/customer/signin', body),
  me: () => req<Customer>('GET', '/customers/me'),
  signout: () => req<{ ok: true }>('POST', '/auth/customer/signout'),
  deals: (category?: string) => req<{ deals: Deal[] }>('GET', '/deals' + (category ? `?category=${encodeURIComponent(category)}` : '')).then(r => r.deals),
  deal: (id: string) => req<Deal>('GET', `/deals/${id}`),
  reserve: (body: { deal_id: string; quantity: number }) => req<Reservation>('POST', '/reservations', body),
  reservation: (id: string) => req<Reservation>('GET', `/reservations/${id}`),
  cancelReservation: (id: string) => req<Reservation>('POST', `/reservations/${id}/cancel`),
  confirmPickup: (id: string) => req<Reservation>('POST', `/reservations/${id}/confirm-pickup`),
  myReservations: () => req<{ reservations: Reservation[] }>('GET', '/reservations').then(r => r.reservations),
}
