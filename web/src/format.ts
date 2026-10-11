export function money(cents: number | null) {
  return cents === null ? '—' : `$${(cents / 100).toFixed(2)}`
}

export function percentOff(original: number | null, deal: number | null) {
  if (!original || deal === null) return 0
  return Math.round((1 - deal / original) * 100)
}

export function clock(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function pickupWindow(start: string, end: string | null) {
  return `${clock(start)} – ${clock(end)}`
}

// "18:00" -> "6:00 PM"
export function clockFromHHMM(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return clock(d.toISOString())
}

// local YYYY-MM-DD, for the ?date= params
export function today() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (name: string) => parts.find(p => p.type === name)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// ISO string -> value for <input type="datetime-local">
export function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// datetime-local value -> ISO 8601 with the local offset, as the contract wants
export function fromLocalInput(value: string) {
  if (!value) return null
  const d = new Date(value)
  const off = -d.getTimezoneOffset()
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return `${value}:00${off >= 0 ? '+' : '-'}${p(off / 60)}:${p(off % 60)}`
}

export function dollarsToCents(input: string) {
  const n = Number(input)
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}
