/**
 * The listing agent's build step (docs/agent-spec.md "Build step (code)"):
 * plain, pure functions that turn the extract output into one draft per
 * product. No I/O, no clock reads: the caller passes `now`.
 *
 * Rules, first match wins:
 * - title: name in title case; " (N-pack)" when unit_size > 1
 * - items: [{ name, qty: unit_size }]
 * - quantity_total: extracted quantity, else null
 * - original_price_cents: stated -> menu item with the same name -> last deal
 *   with the same product name -> null
 * - deal_price_cents: stated price -> stated discount applied to original ->
 *   last deal's discount ratio applied to original -> default_discount_pct
 *   applied to original -> null if original is null
 * - price_source: where original_price_cents came from
 * - pickup_start: stated -> now, rounded up to 5 min
 * - pickup_end: stated -> closes_at today; null if that is less than 15 min away
 * - kind: surplus if pickup_end is within 2 h of closes_at, else timed
 * - max_per_customer: 2; allergens: stated list, else null; photo_url; note: null
 */
import {
  MISSING_FIELDS,
  RULES,
  type DealItem,
  type DealKind,
  type Estimate,
  type MissingField,
  type PriceSource,
} from "@/lib/contract";
import {
  isLocalTime,
  localDateOf,
  minutesBetween,
  roundUpToMinutes,
  toIso,
  zonedDateTime,
} from "@/lib/clock";
import type { ExtractOutput, ExtractedProduct } from "@/lib/extract/types";
import type { DealRecord, MerchantRecord } from "@/lib/store/types";

export const BUILD_RULES = {
  /** pickup_start defaults to now rounded up to this step. */
  PICKUP_START_STEP_MINUTES: 5,
  /** pickup_end defaults to closes_at unless closing is less than this far away. */
  MIN_MINUTES_BEFORE_CLOSE: 15,
  /** kind is surplus when pickup_end is within this many minutes of closes_at. */
  SURPLUS_WINDOW_MINUTES: 120,
  PRICE_STEP_CENTS: RULES.PRICE_STEP_CENTS,
  MAX_PER_CUSTOMER: RULES.DEFAULT_MAX_PER_CUSTOMER,
  ASSUMED_SELL_THROUGH: RULES.ASSUMED_SELL_THROUGH,
} as const;

/** The fixed agent_notes templates. */
export const NOTE_TEMPLATES = {
  menu: () => "Regular price from your menu.",
  history: (title: string) => `Prices from your last ${title} listing.`,
  defaultDiscount: (pct: number) => `Used your default ${pct}% discount.`,
  originalMissing: () => "Not on your menu. Enter the regular price.",
  quantityMissing: () => "Couldn't count these. Enter the quantity.",
} as const;

/** The deal fields a draft starts with (status, ids and timestamps are added when it is saved). */
export interface DraftDealFields {
  title: string;
  items: DealItem[];
  original_price_cents: number | null;
  deal_price_cents: number | null;
  kind: DealKind;
  quantity_total: number | null;
  max_per_customer: number;
  /** ISO 8601 with offset. */
  pickup_start: string;
  /** ISO 8601 with offset, or null. */
  pickup_end: string | null;
  allergens: string[] | null;
  note: string | null;
  photo_url: string | null;
}

export interface DraftPlan {
  deal: DraftDealFields;
  missing_fields: MissingField[];
  price_source: PriceSource | null;
  agent_notes: string;
  estimate: Estimate | null;
}

export interface BuildContext {
  now: Date;
  merchant: Pick<MerchantRecord, "closes_at" | "default_discount_pct" | "menu">;
  /** The merchant's recent deals, newest first (store.listDealsByMerchant). May be empty. */
  history: readonly DealRecord[];
  /** Public URL of the uploaded photo, or null. Set on every draft. */
  photoUrl: string | null;
}

/** Which rule set deal_price_cents. */
export type DealPriceRule = "stated" | "stated_discount" | "history" | "default" | null;

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/** Name key for menu and history matching: lowercase, trimmed, one trailing "s" removed. */
export function normalizeProductName(name: string): string {
  const value = name.toLowerCase().trim();
  return value.endsWith("s") ? value.slice(0, -1) : value;
}

const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

/**
 * Title case: each word starts with a capital letter, except short joining
 * words after the first ("Slice of Pizza"). The rest of each word is kept, so
 * "BLT" stays "BLT".
 */
export function titleCase(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word, i) => {
      if (i > 0 && MINOR_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function buildTitle(name: string, unitSize: number): string {
  const base = titleCase(name);
  return unitSize > 1 ? `${base} (${unitSize}-pack)` : base;
}

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

function isPositiveInt(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * A computed deal price: original x numerator / denominator, rounded down to
 * a multiple of 25 cents. It must stay below the original; if rounding breaks
 * that, original - 25. A price below 25 cents becomes 25 when that is still
 * below the original, else null (the merchant enters it): never 0.
 * Integer arithmetic only.
 */
export function computeDealPrice(original: number, numerator: number, denominator: number): number | null {
  const step = BUILD_RULES.PRICE_STEP_CENTS;
  if (!isPositiveInt(original) || denominator <= 0 || numerator < 0) return null;
  let price = Math.floor((original * numerator) / (denominator * step)) * step;
  if (price >= original) price = original - step;
  if (price < step) return step < original ? step : null;
  return price;
}

/** The most recent published deal for this product with the same pack size, or null. */
export function findHistoryDeal(
  history: readonly DealRecord[],
  productName: string,
  unitSize: number,
): DealRecord | null {
  const key = normalizeProductName(productName);
  for (const deal of history) {
    if (deal.published_at === null) continue;
    if (deal.items.length !== 1) continue;
    const [item] = deal.items;
    if (normalizeProductName(item.name) !== key || item.qty !== unitSize) continue;
    if (!isPositiveInt(deal.original_price_cents) || !isPositiveInt(deal.deal_price_cents)) continue;
    return deal;
  }
  return null;
}

export interface PriceResolution {
  original_price_cents: number | null;
  price_source: PriceSource | null;
  deal_price_cents: number | null;
  deal_rule: DealPriceRule;
}

/**
 * Regular and deal price for one product. Stated prices that are not
 * positive integers are treated as not stated (never a price of 0). Menu
 * prices are per item, so they are multiplied by unit_size.
 */
export function resolvePrices(
  product: Pick<ExtractedProduct, "name" | "unit_size" | "original_price_cents" | "deal_price_cents" | "discount_pct">,
  merchant: BuildContext["merchant"],
  historyDeal: DealRecord | null,
): PriceResolution {
  let original: number | null = null;
  let source: PriceSource | null = null;
  if (isPositiveInt(product.original_price_cents)) {
    original = product.original_price_cents;
    source = "stated";
  } else {
    const key = normalizeProductName(product.name);
    const menuItem = merchant.menu.find(
      (item) => normalizeProductName(item.name) === key && isPositiveInt(item.price_cents),
    );
    if (menuItem) {
      original = menuItem.price_cents * product.unit_size;
      source = "menu";
    } else if (historyDeal) {
      original = historyDeal.original_price_cents;
      source = "history";
    }
  }

  if (isPositiveInt(product.deal_price_cents)) {
    return { original_price_cents: original, price_source: source, deal_price_cents: product.deal_price_cents, deal_rule: "stated" };
  }
  if (original === null) {
    return { original_price_cents: null, price_source: null, deal_price_cents: null, deal_rule: null };
  }
  let deal: number | null;
  let rule: DealPriceRule;
  if (isPositiveInt(product.discount_pct) && product.discount_pct < 100) {
    deal = computeDealPrice(original, 100 - product.discount_pct, 100);
    rule = "stated_discount";
  } else if (historyDeal) {
    deal = computeDealPrice(
      original,
      historyDeal.deal_price_cents as number,
      historyDeal.original_price_cents as number,
    );
    rule = "history";
  } else {
    deal = computeDealPrice(original, 100 - merchant.default_discount_pct, 100);
    rule = "default";
  }
  return { original_price_cents: original, price_source: source, deal_price_cents: deal, deal_rule: deal === null ? null : rule };
}

/* ------------------------------------------------------------------ */
/* Times and kind                                                      */
/* ------------------------------------------------------------------ */

/** Today's closing instant, or null if closes_at is not "HH:MM". */
export function closingInstant(now: Date, closesAt: string): Date | null {
  if (!isLocalTime(closesAt)) return null;
  return zonedDateTime(localDateOf(now), closesAt);
}

/** pickup_start: stated time today, else now rounded up to 5 minutes. */
export function resolvePickupStart(now: Date, stated: string | null): Date {
  if (stated !== null && isLocalTime(stated)) return zonedDateTime(localDateOf(now), stated);
  return roundUpToMinutes(now, BUILD_RULES.PICKUP_START_STEP_MINUTES);
}

/** pickup_end: stated time today, else closes_at today; null if closing is less than 15 minutes away. */
export function resolvePickupEnd(now: Date, stated: string | null, closesAt: Date | null): Date | null {
  if (stated !== null && isLocalTime(stated)) return zonedDateTime(localDateOf(now), stated);
  if (closesAt === null) return null;
  return minutesBetween(now, closesAt) < BUILD_RULES.MIN_MINUTES_BEFORE_CLOSE ? null : closesAt;
}

/**
 * kind: surplus if pickup_end is within 2 h (either side) of closes_at, else
 * timed. With no pickup_end (closing is under 15 minutes away or past), surplus.
 */
export function resolveKind(pickupEnd: Date | null, closesAt: Date | null): DealKind {
  if (pickupEnd === null) return "surplus";
  if (closesAt === null) return "timed";
  return Math.abs(minutesBetween(pickupEnd, closesAt)) <= BUILD_RULES.SURPLUS_WINDOW_MINUTES ? "surplus" : "timed";
}

/* ------------------------------------------------------------------ */
/* Allergens, missing fields, notes, estimate                          */
/* ------------------------------------------------------------------ */

/**
 * Stated allergens: trimmed, lowercased, without duplicates. An empty list
 * becomes null, because the agent cannot tell "none" from "not stated" and
 * must never answer the allergen question for the merchant.
 */
export function resolveAllergens(stated: readonly string[] | null): string[] | null {
  if (stated === null) return null;
  const seen = new Set<string>();
  for (const raw of stated) {
    const value = raw.trim().toLowerCase();
    if (value !== "") seen.add(value);
  }
  return seen.size > 0 ? [...seen] : null;
}

export function missingFieldsOf(deal: Pick<DraftDealFields, MissingField>): MissingField[] {
  return MISSING_FIELDS.filter((field) => deal[field] === null);
}

export function buildAgentNotes(input: {
  title: string;
  price_source: PriceSource | null;
  deal_rule: DealPriceRule;
  default_discount_pct: number;
  original_price_cents: number | null;
  quantity_total: number | null;
}): string {
  const notes: string[] = [];
  if (input.price_source === "menu") notes.push(NOTE_TEMPLATES.menu());
  if (input.price_source === "history") notes.push(NOTE_TEMPLATES.history(input.title));
  if (input.deal_rule === "default") notes.push(NOTE_TEMPLATES.defaultDiscount(input.default_discount_pct));
  if (input.original_price_cents === null) notes.push(NOTE_TEMPLATES.originalMissing());
  if (input.quantity_total === null) notes.push(NOTE_TEMPLATES.quantityMissing());
  return notes.join(" ");
}

/**
 * units x deal_price_cents x assumed_sell_through, rounded down to a cent.
 * null when quantity or deal price is null.
 */
export function buildEstimate(units: number | null, dealPriceCents: number | null): Estimate | null {
  if (units === null || dealPriceCents === null) return null;
  const permille = Math.round(BUILD_RULES.ASSUMED_SELL_THROUGH * 1000);
  return {
    units,
    deal_price_cents: dealPriceCents,
    assumed_sell_through: BUILD_RULES.ASSUMED_SELL_THROUGH,
    expected_recovered_cents: Math.floor((units * dealPriceCents * permille) / 1000),
    if_discarded_cents: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

/** One draft for one product. */
export function buildDraft(
  product: ExtractedProduct,
  times: Pick<ExtractOutput, "pickup_start" | "pickup_end">,
  ctx: BuildContext,
): DraftPlan {
  const name = product.name.trim();
  const unitSize = Number.isInteger(product.unit_size) && product.unit_size >= 1 ? product.unit_size : 1;
  const title = buildTitle(name, unitSize);
  const quantity = isPositiveInt(product.quantity) ? product.quantity : null;

  const historyDeal = findHistoryDeal(ctx.history, name, unitSize);
  const prices = resolvePrices({ ...product, name, unit_size: unitSize }, ctx.merchant, historyDeal);

  const closesAt = closingInstant(ctx.now, ctx.merchant.closes_at);
  const pickupStart = resolvePickupStart(ctx.now, times.pickup_start);
  const pickupEnd = resolvePickupEnd(ctx.now, times.pickup_end, closesAt);

  const deal: DraftDealFields = {
    title,
    items: [{ name, qty: unitSize }],
    original_price_cents: prices.original_price_cents,
    deal_price_cents: prices.deal_price_cents,
    kind: resolveKind(pickupEnd, closesAt),
    quantity_total: quantity,
    max_per_customer: BUILD_RULES.MAX_PER_CUSTOMER,
    pickup_start: toIso(pickupStart),
    pickup_end: pickupEnd === null ? null : toIso(pickupEnd),
    allergens: resolveAllergens(product.allergens),
    note: null,
    photo_url: ctx.photoUrl,
  };

  return {
    deal,
    missing_fields: missingFieldsOf(deal),
    price_source: prices.price_source,
    agent_notes: buildAgentNotes({
      title,
      price_source: prices.price_source,
      deal_rule: prices.deal_rule,
      default_discount_pct: ctx.merchant.default_discount_pct,
      original_price_cents: prices.original_price_cents,
      quantity_total: quantity,
    }),
    estimate: buildEstimate(quantity, prices.deal_price_cents),
  };
}

/** One draft per product, in the model's order. Empty when there are no products. */
export function buildDrafts(output: ExtractOutput, ctx: BuildContext): DraftPlan[] {
  return output.products.map((product) => buildDraft(product, output, ctx));
}
