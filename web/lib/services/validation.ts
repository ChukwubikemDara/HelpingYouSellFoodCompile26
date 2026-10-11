/**
 * Shared request validation. Messages are shown to users as is; lib/http
 * prefixes them with the field path ("quantity_total: ...").
 */
import { z } from "zod";
import { RULES } from "@/lib/contract";
import { INSTANT_RANGE, isInstantInRange, isIsoInstant, isLocalDate, isLocalTime, today, toIso } from "@/lib/clock";
import { ApiError } from "@/lib/http";

/** E.164: "+" then 8 to 15 digits, no leading zero. */
export const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const typeMessage = (what: string) => (issue: { input: unknown }) =>
  issue.input === undefined ? "Required." : `Must be ${what}.`;

export const text = (max: number) =>
  z
    .string({ error: typeMessage("text") })
    .trim()
    .min(1, "Can't be empty.")
    .max(max, `Must be at most ${max} characters.`);

/** Integer cents >= 1. */
export const cents = z
  .number({ error: typeMessage("a whole number of cents") })
  .int("Must be a whole number of cents.")
  .min(1, "Must be at least 1 cent.")
  .max(100_000_00, "Must be at most $100,000.00.");

export const positiveInt = (max: number) =>
  z
    .number({ error: typeMessage("a whole number") })
    .int("Must be a whole number.")
    .min(1, "Must be at least 1.")
    .max(max, `Must be at most ${max}.`);

export const phone = z
  .string({ error: typeMessage("text") })
  .trim()
  .regex(E164, "Enter the phone number in E.164 format, like +18145550123.");

export const email = z
  .string({ error: typeMessage("text") })
  .trim()
  .toLowerCase()
  .max(254, "Must be at most 254 characters.")
  .regex(EMAIL, "Enter a valid email address.");

/** Passwords: at least 8 characters (contract). Capped so hashing stays cheap. */
export const newPassword = z
  .string({ error: typeMessage("text") })
  .refine((value) => [...value].length >= RULES.PASSWORD_MIN_LENGTH, {
    error: `Must be at least ${RULES.PASSWORD_MIN_LENGTH} characters.`,
  })
  .refine((value) => value.length <= 1024, { error: "Must be at most 1024 characters." });

/** Any password string on sign-in (the length rule is not applied there). */
export const anyPassword = z.string({ error: typeMessage("text") }).max(1024, "Must be at most 1024 characters.");

/** "HH:MM" 24-hour local time. */
export const localTime = z
  .string({ error: typeMessage("text") })
  .refine(isLocalTime, { error: "Must be a 24-hour time like 18:00." });

/**
 * ISO 8601 instant with an offset, in INSTANT_RANGE (2000-2099); normalized to
 * the New York offset at seconds precision.
 */
export const instant = z
  .string({ error: typeMessage("text") })
  .refine(isIsoInstant, { error: "Must be an ISO 8601 time with offset, like 2026-10-11T18:00:00-04:00.", abort: true })
  .refine(isInstantInRange, { error: INSTANT_RANGE.message })
  .transform((value) => toIso(value));

export const latitude = z
  .number({ error: typeMessage("a number") })
  .min(-90, "Must be between -90 and 90.")
  .max(90, "Must be between -90 and 90.");

export const longitude = z
  .number({ error: typeMessage("a number") })
  .min(-180, "Must be between -180 and 180.")
  .max(180, "Must be between -180 and 180.");

/** `?date=` on merchant lists: a local date, default today (America/New_York). */
export function parseDateQuery(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return today();
  const trimmed = value.trim();
  if (!isLocalDate(trimmed)) throw new ApiError("VALIDATION", "date: Must be a date like 2026-10-11.");
  return trimmed;
}

/** Parse a query-string number; "" or missing is undefined. */
export function parseQueryNumber(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value.trim());
  if (!Number.isFinite(n)) throw new ApiError("VALIDATION", `${name}: Must be a number.`);
  return n;
}
