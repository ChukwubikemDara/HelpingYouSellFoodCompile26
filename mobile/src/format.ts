export function money(cents: number | null) {
  return cents === null ? '—' : `$${(cents / 100).toFixed(2)}`
}

export function percentOff(original: number | null, deal: number | null) {
  if (!original || deal === null) return 0
  return Math.round((1 - deal / original) * 100)
}

export function clock(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function pickupWindow(start: string, end: string | null) {
  return `${clock(start)} – ${clock(end)}`
}

// "42 min left", "1h 12m left". Drives the urgency line on deal cards.
export function timeLeft(now: number, endIso: string | null) {
  const minutes = Math.floor((Date.parse(endIso ?? '') - now) / 60_000)
  if (minutes <= 0) return 'Ended'
  if (minutes < 60) return `${minutes} min left`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m left` : `${h}h left`
}

export function greeting(now: number) {
  const hour = new Date(now).getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
