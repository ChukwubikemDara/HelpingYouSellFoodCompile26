/**
 * Display formatting and form parsing for the portal.
 *
 * Money stays integer cents everywhere; it is turned into "$4.00" only here,
 * for display. Times are shown in America/New_York ("until 6:00 PM") and form
 * times are sent as ISO 8601 with the New York offset (lib/clock).
 */
import { formatTime12, localDateOf, localTimeOf, toIso, zonedDateTime, isLocalTime } from "@/lib/clock";
import type { DealStatus, ReservationStatus } from "@/lib/contract";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 400 -> "$4.00". Integer math, so no float rounding. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${pad2(abs % 100)}`;
}

/** 400 -> "4.00", for prefilling a price input. */
export function centsToInput(cents: number | null): string {
  if (cents === null) return "";
  const abs = Math.abs(Math.trunc(cents));
  return `${Math.floor(abs / 100)}.${pad2(abs % 100)}`;
}

/**
 * Price input to integer cents. Accepts "4", "4.5", "4.50", "$4.50".
 * Returns null for an empty input and NaN for anything that is not a price.
 */
export function parseCents(input: string): number | null {
  const s = input.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  if (s === "") return null;
  const m = /^(\d{1,6})(?:\.(\d{0,2}))?$/.exec(s) ?? /^\.(\d{1,2})$/.exec(s);
  if (!m) return Number.NaN;
  if (s.startsWith(".")) return Number((m[1] ?? "").padEnd(2, "0"));
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0"));
  return whole * 100 + frac;
}

/** Whole number input. null when empty, NaN when not a whole number. */
export function parseWhole(input: string): number | null {
  const s = input.trim();
  if (s === "") return null;
  if (!/^\d{1,6}$/.test(s)) return Number.NaN;
  return Number(s);
}

/** "until 6:00 PM" for an ISO instant. */
export function untilTime(iso: string | null): string {
  return iso ? `until ${formatTime12(iso)}` : "no end time yet";
}

/** "6:00 PM" for an ISO instant. */
export function time12(iso: string): string {
  return formatTime12(iso);
}

/** "18:00" closes_at -> "6:00 PM". */
export function localTime12(hhmm: string): string {
  if (!isLocalTime(hhmm)) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(m)} ${suffix}`;
}

/** ISO instant -> "HH:MM" New York time, for a time input. */
export function isoToTimeInput(iso: string | null): string {
  return iso ? localTimeOf(iso) : "";
}

/** New York local date of an ISO instant. */
export function isoToLocalDate(iso: string): string {
  return localDateOf(iso);
}

/** A time input ("HH:MM") on a New York local date -> ISO 8601 with offset. null when empty or invalid. */
export function timeInputToIso(date: string, hhmm: string): string | null {
  if (!isLocalTime(hhmm)) return null;
  return toIso(zonedDateTime(date, hhmm));
}

/** "2026-10-11" -> "Sunday, Oct 11". */
export function formatLocalDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  // Noon UTC keeps the calendar day the same when formatted in UTC.
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * 10-digit US input to E.164 (the contract has the client convert it).
 * Accepts "(814) 555-0100", "814-555-0100", "18145550100", "+18145550100".
 * Returns null when it is not a US number.
 */
export function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** "+18145550123" -> "(814) 555-0123". Anything else is returned as is. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  draft: "Draft",
  live: "Live",
  sold_out: "Sold out",
  expired: "Pickup ended",
  cancelled: "Cancelled",
};

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  reserved: "Waiting for pickup",
  picked_up: "Picked up",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/** How the customer pays, from Reservation.payment_method. Not hardcoded to in_store. */
export function paymentLine(method: string, totalCents: number): string {
  if (method === "in_store") return `${formatCents(totalCents)}, paid in store`;
  return formatCents(totalCents);
}
