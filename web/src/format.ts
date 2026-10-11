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
