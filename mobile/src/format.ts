export function money(cents: number | null) {
  return cents === null ? '—' : `$${(cents / 100).toFixed(2)}`
}

export function percentOff(original: number | null, deal: number | null) {
  if (!original || deal === null) return 0
  return Math.round((1 - deal / original) * 100)
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function pickupWindow(start: string, end: string) {
  return `${clock(start)} – ${clock(end)}`
}
