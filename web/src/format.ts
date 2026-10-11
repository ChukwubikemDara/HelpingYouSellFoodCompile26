export function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export function percentOff(original: number, deal: number) {
  return Math.round((1 - deal / original) * 100)
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function pickupWindow(start: string, end: string) {
  return `${clock(start)} – ${clock(end)}`
}

// local YYYY-MM-DD, for the ?date= params
export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ISO string -> value for <input type="datetime-local">
export function toLocalInput(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// datetime-local value -> ISO 8601 with the local offset, as the contract wants
export function fromLocalInput(value: string) {
  const d = new Date(value)
  const off = -d.getTimezoneOffset()
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return `${value}:00${off >= 0 ? '+' : '-'}${p(off / 60)}:${p(off % 60)}`
}

export function dollarsToCents(input: string) {
  const n = Number(input)
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}
