// Display formatting only. Money stays integer cents everywhere else.

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "6:00 PM" in the device's local time. */
export function formatTime(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return '';
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "" for today, otherwise "Oct 12" (device local date). */
export function formatDayIfNotToday(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d || sameDay(d, new Date())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "until 6:00 PM", or "Oct 12, until 6:00 PM" when not today. */
export function formatUntil(iso: string | null | undefined): string {
  const t = formatTime(iso);
  if (!t) return '';
  const day = formatDayIfNotToday(iso);
  return day ? `${day}, until ${t}` : `until ${t}`;
}

/** "5:00 PM until 6:00 PM" (with the day in front when not today). */
export function formatWindow(startIso: string | null | undefined, endIso: string | null | undefined): string {
  const s = formatTime(startIso);
  const e = formatTime(endIso);
  const day = formatDayIfNotToday(endIso ?? startIso);
  const prefix = day ? `${day}, ` : '';
  if (s && e) return `${prefix}${s} until ${e}`;
  if (e) return `${prefix}until ${e}`;
  if (s) return `${prefix}from ${s}`;
  return '';
}

/** "Oct 11, 3:04 PM" or "3:04 PM" for today. */
export function formatStamp(iso: string | null | undefined): string {
  const t = formatTime(iso);
  if (!t) return '';
  const day = formatDayIfNotToday(iso);
  return day ? `${day}, ${t}` : t;
}

/** "0.3 mi" from meters; "" when null so the caller can hide it. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '';
  const miles = meters / 1609.344;
  if (miles >= 10) return `${Math.round(miles)} mi`;
  return `${Math.max(miles, 0.1).toFixed(1)} mi`;
}

/** 10-digit US input (any punctuation, optional leading 1) to E.164, or null if it is not one. */
export function toE164(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return `+1${digits}`;
}

/** "+18145550123" -> "(814) 555-0123"; other numbers are shown as sent. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Whole percent off, or null when either price is missing. */
export function percentOff(original: number | null | undefined, deal: number | null | undefined): number | null {
  if (!original || deal === null || deal === undefined || original <= 0) return null;
  const pct = Math.round((1 - deal / original) * 100);
  return pct > 0 ? pct : null;
}

/** "42 min left", "1h 12m left"; "" when the time is missing or already past. */
export function timeLeft(now: number, endIso: string | null | undefined): string {
  const end = parse(endIso);
  if (!end) return '';
  const minutes = Math.floor((end.getTime() - now) / 60000);
  if (minutes <= 0) return '';
  if (minutes < 60) return `${minutes} min left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24) return '';
  return m ? `${h}h ${m}m left` : `${h}h left`;
}

export function greeting(now: number): string {
  const hour = new Date(now).getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
