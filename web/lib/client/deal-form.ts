/**
 * Form state and checks shared by draft review and the manual listing form.
 * The checks mirror the backend rules in the contract so the merchant sees the
 * problem before sending; the backend still decides (its VALIDATION message is
 * shown as is).
 */
import { addDays, minutesBetween, now, toMs, zonedDateTime, isLocalTime } from "@/lib/clock";
import type { Deal, DealKind, MissingField } from "@/lib/contract";
import { centsToInput, isoToTimeInput, parseCents, parseWhole, timeInputToIso } from "./format";

export interface DealForm {
  title: string;
  /** Items in one sale unit (manual form only; drafts keep the agent's items). */
  unitSize: string;
  original: string;
  price: string;
  quantity: string;
  maxPerCustomer: string;
  /** "HH:MM" New York time on the deal's date. */
  start: string;
  end: string;
  /** null = not answered yet, [] = none. */
  allergens: string[] | null;
  note: string;
}

export type DealFormField = keyof DealForm;
export type DealFormErrors = Partial<Record<DealFormField, string>>;

/** Values ready for POST /deals or PATCH /deals/{id} while draft. */
export interface DealFormValues {
  title: string;
  original_price_cents: number;
  deal_price_cents: number;
  quantity_total: number;
  max_per_customer: number;
  pickup_start: string;
  pickup_end: string;
  allergens: string[];
  note: string | null;
}

export function formFromDeal(deal: Deal): DealForm {
  return {
    title: deal.title,
    unitSize: String(deal.items[0]?.qty ?? 1),
    original: centsToInput(deal.original_price_cents),
    price: centsToInput(deal.deal_price_cents),
    quantity: deal.quantity_total === null ? "" : String(deal.quantity_total),
    maxPerCustomer: String(deal.max_per_customer),
    start: isoToTimeInput(deal.pickup_start),
    end: isoToTimeInput(deal.pickup_end),
    allergens: deal.allergens === null ? null : [...deal.allergens],
    note: deal.note ?? "",
  };
}

/** Which of the contract's missing fields are still empty in the form. */
export function missingInForm(form: DealForm): MissingField[] {
  const out: MissingField[] = [];
  if (form.original.trim() === "") out.push("original_price_cents");
  if (form.price.trim() === "") out.push("deal_price_cents");
  if (form.quantity.trim() === "") out.push("quantity_total");
  if (form.end.trim() === "") out.push("pickup_end");
  if (form.allergens === null) out.push("allergens");
  return out;
}

/** True when the pickup end time of day is before the start: the window runs past midnight. */
export function endsNextDay(form: Pick<DealForm, "start" | "end">): boolean {
  return isLocalTime(form.start) && isLocalTime(form.end) && form.end < form.start;
}

/**
 * Check the form. `date` is the New York local date the pickup starts on; an
 * end time earlier than the start time is on the next day (a window past
 * midnight, e.g. 23:00 to 00:30). Returns the errors, and the values when
 * there are none.
 */
export function validateDealForm(
  form: DealForm,
  date: string,
  at: Date = now(),
): { errors: DealFormErrors; values: DealFormValues | null } {
  const errors: DealFormErrors = {};

  const title = form.title.trim();
  if (!title) errors.title = "Enter a title.";

  const original = parseCents(form.original);
  if (original === null) errors.original = "Enter the regular price.";
  else if (Number.isNaN(original)) errors.original = "Enter a price like 4.00.";
  else if (original <= 0) errors.original = "Regular price must be more than $0.00.";

  const price = parseCents(form.price);
  if (price === null) errors.price = "Enter the deal price.";
  else if (Number.isNaN(price)) errors.price = "Enter a price like 4.00.";
  else if (original !== null && !Number.isNaN(original) && price >= original) {
    errors.price = "Deal price must be lower than the regular price.";
  }

  const quantity = parseWhole(form.quantity);
  if (quantity === null) errors.quantity = "Enter the quantity.";
  else if (Number.isNaN(quantity) || quantity < 1) errors.quantity = "Quantity must be at least 1.";

  const maxPer = parseWhole(form.maxPerCustomer);
  if (maxPer === null || Number.isNaN(maxPer) || maxPer < 1) {
    errors.maxPerCustomer = "Limit per person must be at least 1.";
  }

  const unitSize = parseWhole(form.unitSize);
  if (unitSize === null || Number.isNaN(unitSize) || unitSize < 1) {
    errors.unitSize = "Items in one unit must be at least 1.";
  }

  const startIso = timeInputToIso(date, form.start);
  if (!startIso) errors.start = "Enter a pickup start time.";

  const endDate = endsNextDay(form) ? addDays(date, 1) : date;
  const endIso = form.end.trim() === "" ? null : timeInputToIso(endDate, form.end);
  if (form.end.trim() === "") errors.end = "Enter a pickup end time.";
  else if (!endIso) errors.end = "Enter a pickup end time.";
  else if (startIso && toMs(endIso) <= toMs(startIso)) errors.end = "Pickup must end after it starts.";
  else if (toMs(endIso) <= at.getTime()) errors.end = "Pickup end must be later than now.";

  if (form.allergens === null) errors.allergens = "Confirm allergens, or choose None.";

  if (Object.keys(errors).length > 0) return { errors, values: null };

  const note = form.note.trim();
  return {
    errors,
    values: {
      title,
      original_price_cents: original as number,
      deal_price_cents: price as number,
      quantity_total: quantity as number,
      max_per_customer: maxPer as number,
      pickup_start: startIso as string,
      pickup_end: endIso as string,
      allergens: form.allergens as string[],
      note: note === "" ? null : note,
    },
  };
}

/**
 * Deal kind by the same rule the listing agent uses (docs/agent-spec.md):
 * `surplus` if pickup ends within 2 h of closing time, else `timed`. The
 * closing time is the occurrence nearest to pickup_end (the day before, of,
 * or after `date`), so a store that closes after midnight is handled.
 */
export function kindFor(pickupEndIso: string, closesAt: string, date: string): DealKind {
  if (!isLocalTime(closesAt)) return "timed";
  const nearest = Math.min(
    ...[-1, 0, 1].map((d) => Math.abs(minutesBetween(pickupEndIso, zonedDateTime(addDays(date, d), closesAt)))),
  );
  return nearest <= 120 ? "surplus" : "timed";
}

/** Expected recovered cents for the draft estimate: units x price x sell-through, rounded to a cent. */
export function estimateCents(units: number, priceCents: number, sellThrough: number): number {
  return Math.round(units * priceCents * sellThrough);
}
