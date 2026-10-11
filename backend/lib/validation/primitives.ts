import { validation } from "../services/errors";
export function nonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) validation(`${name} must be a non-empty string.`);
}
export function positiveQuantity(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) validation("Quantity must be a positive integer.");
}
export function cents(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) validation("Price must be non-negative integer cents.");
}
export function isoTimestamp(value: string): void {
  // Contract permits numeric offsets as well as Z. Persist canonical UTC for comparisons.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    validation("Timestamp must be ISO 8601 with an offset.");
  }
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== day) validation("Timestamp contains an invalid calendar date.");
}
export function utc(value: string): string { isoTimestamp(value); return new Date(value).toISOString(); }
export function phone(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\+[1-9]\d{7,14}$/.test(value)) validation("Phone must use E.164 format.");
}
export function localDate(now: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(utc(now)));
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
