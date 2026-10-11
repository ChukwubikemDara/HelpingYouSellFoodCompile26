import type { Customer } from './types'
export const storage = {
  token: () => sessionStorage.getItem('customer_token'),
  account: (): Customer | null => { try { return JSON.parse(sessionStorage.getItem('customer_account') ?? 'null') } catch { return null } },
  setAccount: (token: string, customer: Customer) => { sessionStorage.setItem('customer_token', token); sessionStorage.setItem('customer_account', JSON.stringify(customer)) },
  clearAccount: () => { sessionStorage.removeItem('customer_token'); sessionStorage.removeItem('customer_account') },
}
export function normalizePhone(input: string) {
  if (/^\+[1-9]\d{7,14}$/.test(input)) return input
  const digits = input.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}
