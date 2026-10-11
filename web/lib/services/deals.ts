/**
 * Deals (contract "Deal status" and "Rules the backend enforces").
 *
 * Stored status is draft | live | cancelled; sold_out and expired are derived
 * on read (deriveDealStatus). Transitions:
 * - draft -> live on publish (sets published_at, quantity_left = quantity_total)
 * - live <-> sold_out follows quantity_left (reserve / cancel)
 * - live / sold_out -> expired at pickup_end (derived)
 * - draft / live / sold_out -> cancelled by the merchant (open reservations cancelled)
 * - expired with units left -> unsold_action "donated" (mark-donated)
 *
 * Every read-check-write on a deal goes through updateDealWithRetry
 * (optimistic concurrency on DealRecord.version), so a concurrent reserve or
 * cancel can never be overwritten.
 */
import { z } from "zod";
import {
  DEAL_KINDS,
  DEAL_SORTS,
  MERCHANT_CATEGORIES,
  MISSING_FIELDS,
  RULES,
  type Deal,
  type DealKind,
  type DealSort,
  type MerchantCategory,
  type MissingField,
} from "@/lib/contract";
import {
  formatTime12,
  localDateOf,
  minutesBetween,
  toIso,
  toMs,
  zonedDateTime,
  type Instant,
} from "@/lib/clock";
import { ApiError, parseWith } from "@/lib/http";
import { newId } from "@/lib/ids";
import {
  deriveDealStatus,
  type DealPatch,
  type DealRecord,
  type MerchantRecord,
  type Store,
} from "@/lib/store";
import { planGateEnabled } from "./billing";
import { db } from "./db";
import { haversineMeters } from "./geo";
import { notifyDealCancelled, notifyNewDeal } from "./notifications";
import { cents, instant, parseQueryNumber, positiveInt, text } from "./validation";
import { dealView, loadDealView } from "./views";

/* ------------------------------------------------------------------ */
/* Request schemas                                                     */
/* ------------------------------------------------------------------ */

const dealItem = z.object({ name: text(100), qty: positiveInt(100) });

const allergenList = z
  .array(text(50), { error: "Must be a list, or null if not answered yet." })
  .max(30, "At most 30 allergens.");

const noteText = z
  .string({ error: "Must be text or null." })
  .max(1000, "Must be at most 1000 characters.")
  .transform((value) => (value.trim() === "" ? null : value.trim()));

/** Fields the merchant can set while a deal is a draft (contract PATCH /deals/{id}). */
const draftFields = {
  title: text(200),
  items: z.array(dealItem, { error: "Must be a list." }).min(1, "Add at least one item.").max(20, "At most 20 items."),
  original_price_cents: cents.nullable(),
  deal_price_cents: cents.nullable(),
  kind: z.enum(DEAL_KINDS, { error: `Must be one of: ${DEAL_KINDS.join(", ")}.` }),
  quantity_total: positiveInt(1000).nullable(),
  max_per_customer: positiveInt(100),
  pickup_start: instant,
  pickup_end: instant.nullable(),
  allergens: allergenList.nullable(),
  note: noteText.nullable(),
};

/**
 * POST /deals: "Deal fields without id/status". title is required; the other
 * editable fields are optional. Server-owned fields a client may echo back
 * (merchant_id, merchant, quantity_left, unsold_action, photo_url,
 * created_at, published_at, distance_m) are ignored.
 */
export const createDealSchema = z.object({
  title: draftFields.title,
  items: draftFields.items.optional(),
  original_price_cents: draftFields.original_price_cents.optional(),
  deal_price_cents: draftFields.deal_price_cents.optional(),
  kind: draftFields.kind.optional(),
  quantity_total: draftFields.quantity_total.optional(),
  max_per_customer: draftFields.max_per_customer.optional(),
  pickup_start: draftFields.pickup_start.optional(),
  pickup_end: draftFields.pickup_end.optional(),
  allergens: draftFields.allergens.optional(),
  note: draftFields.note.optional(),
});

/** PATCH /deals/{id}: any draft field. Which ones are accepted depends on the deal's status. */
export const patchDealSchema = z.object(draftFields).partial();
type DealInput = z.infer<typeof patchDealSchema>;

/** Fields that may change while a deal is live (contract PATCH /deals/{id}). */
const LIVE_FIELDS = new Set(["quantity_total", "pickup_end", "note", "deal_price_cents"]);

const FIELD_LABELS: Record<MissingField, string> = {
  original_price_cents: "regular price",
  deal_price_cents: "deal price",
  quantity_total: "quantity",
  pickup_end: "pickup end time",
  allergens: "allergens",
};

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

const invalid = (message: string) => new ApiError("VALIDATION", message);

/** deal_price_cents < original_price_cents (when both are set). */
function checkPrices(original: number | null, deal: number | null): void {
  if (original !== null && deal !== null && deal >= original) {
    throw invalid("deal_price_cents: The deal price must be lower than the regular price.");
  }
}

/** pickup_end > now and > pickup_start. */
function checkPickupEnd(pickupStart: string, pickupEnd: string, at: Instant): void {
  if (toMs(pickupEnd) <= toMs(at)) throw invalid("pickup_end: The pickup end time must be in the future.");
  if (toMs(pickupEnd) <= toMs(pickupStart)) {
    throw invalid("pickup_end: The pickup end time must be after the pickup start time.");
  }
}

/** Default kind for a manual deal: the agent's rule (surplus if pickup_end is within 2 h of closes_at). */
function defaultKind(merchant: MerchantRecord, pickupEnd: string | null): DealKind {
  if (pickupEnd === null) return "surplus";
  const closesAt = zonedDateTime(localDateOf(pickupEnd), merchant.closes_at);
  return Math.abs(minutesBetween(closesAt, pickupEnd)) <= RULES.LIST_NOW_WINDOW_MINUTES ? "surplus" : "timed";
}

/** JSON with object keys sorted, so equal values compare equal whatever their key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}

function sameValue(field: keyof DealInput, a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  if (field === "pickup_start" || field === "pickup_end") return toMs(a as string) === toMs(b as string);
  return canonical(a) === canonical(b);
}

/* ------------------------------------------------------------------ */
/* Loading and concurrency                                             */
/* ------------------------------------------------------------------ */

const DEAL_NOT_FOUND = "Deal not found.";

/** The deal if it belongs to the merchant; 404 otherwise. */
export async function loadOwnDeal(store: Store, merchant: MerchantRecord, id: string): Promise<DealRecord> {
  const deal = await store.getDeal(id);
  if (!deal || deal.merchant_id !== merchant.id) throw new ApiError("NOT_FOUND", DEAL_NOT_FOUND);
  return deal;
}

const MAX_ATTEMPTS = 8;

/**
 * Read the deal, let `build` validate it and return a patch (or null for "no
 * change"), and write with ifVersion. On VERSION_CONFLICT (a concurrent write
 * such as a reserve), read again and rebuild.
 */
export async function updateDealWithRetry(
  store: Store,
  id: string,
  build: (current: DealRecord) => DealPatch | null | Promise<DealPatch | null>,
): Promise<DealRecord> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await store.getDeal(id);
    if (!current) throw new ApiError("NOT_FOUND", DEAL_NOT_FOUND);
    const patch = await build(current);
    if (patch === null || Object.keys(patch).length === 0) return current;
    const result = await store.updateDeal(id, patch, { ifVersion: current.version });
    if (result.ok) return result.value;
    if (result.reason === "NOT_FOUND") throw new ApiError("NOT_FOUND", DEAL_NOT_FOUND);
  }
  throw new Error(`deal ${id}: update kept conflicting after ${MAX_ATTEMPTS} attempts`);
}

/** DEAL_NOT_LIVE for a deal that has ended (cancelled or expired), with a message for the action. */
function endedError(status: "cancelled" | "expired", action: string): ApiError {
  return new ApiError(
    "DEAL_NOT_LIVE",
    status === "cancelled" ? `This deal was cancelled and can't be ${action}.` : `This deal has ended and can't be ${action}.`,
  );
}

/* ------------------------------------------------------------------ */
/* Merchant: create, edit, publish, cancel, mark donated               */
/* ------------------------------------------------------------------ */

/** POST /deals: a manual draft. */
export async function createDeal(merchant: MerchantRecord, body: unknown, at: Date): Promise<Deal> {
  const input = parseWith(createDealSchema, body);
  const pickupStart = input.pickup_start ?? toIso(at);
  const pickupEnd = input.pickup_end ?? null;
  const original = input.original_price_cents ?? null;
  const price = input.deal_price_cents ?? null;
  checkPrices(original, price);
  if (pickupEnd !== null) checkPickupEnd(pickupStart, pickupEnd, at);
  const quantity = input.quantity_total ?? null;
  const store = await db();
  const created = await store.createDeal({
    id: newId("d"),
    merchant_id: merchant.id,
    title: input.title,
    items: input.items ?? [{ name: input.title, qty: 1 }],
    original_price_cents: original,
    deal_price_cents: price,
    kind: input.kind ?? defaultKind(merchant, pickupEnd),
    quantity_total: quantity,
    quantity_left: quantity,
    max_per_customer: input.max_per_customer ?? RULES.DEFAULT_MAX_PER_CUSTOMER,
    unsold_action: "none",
    pickup_start: pickupStart,
    pickup_end: pickupEnd,
    allergens: input.allergens ?? null,
    note: input.note ?? null,
    photo_url: null,
    status: "draft",
    created_at: toIso(at),
    published_at: null,
    cancelled_at: null,
    local_date: localDateOf(at),
    price_lowered_by_suggestion: false,
  });
  return dealView(created, merchant, at);
}

function draftPatch(current: DealRecord, input: DealInput, at: Instant): DealPatch | null {
  const patch: DealPatch = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
  }
  // While draft, quantity_left mirrors quantity_total.
  if (input.quantity_total !== undefined) patch.quantity_left = input.quantity_total;
  const merged = { ...current, ...patch };
  if (input.original_price_cents !== undefined || input.deal_price_cents !== undefined) {
    checkPrices(merged.original_price_cents, merged.deal_price_cents);
  }
  if (merged.pickup_end !== null) {
    if (input.pickup_end !== undefined) checkPickupEnd(merged.pickup_start, merged.pickup_end, at);
    else if (input.pickup_start !== undefined && toMs(merged.pickup_end) <= toMs(merged.pickup_start)) {
      throw invalid("pickup_start: The pickup start time must be before the pickup end time.");
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function livePatch(current: DealRecord, input: DealInput, at: Instant): DealPatch | null {
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || LIVE_FIELDS.has(key)) continue;
    const field = key as keyof DealInput;
    // Echoing an unchanged value is fine; changing it is not.
    if (!sameValue(field, value, current[field])) {
      throw invalid(`${key}: Can't be changed after the deal is published.`);
    }
  }
  const patch: DealPatch = {};
  if (input.quantity_total !== undefined) {
    if (input.quantity_total === null) throw invalid("quantity_total: Can't be empty on a published deal.");
    const total = current.quantity_total ?? 0;
    const left = current.quantity_left ?? 0;
    const taken = total - left;
    if (input.quantity_total < taken) {
      throw invalid(`quantity_total: ${taken} already reserved. The quantity can't go below that.`);
    }
    if (input.quantity_total !== total) {
      patch.quantity_total = input.quantity_total;
      patch.quantity_left = left + (input.quantity_total - total);
    }
  }
  if (input.pickup_end !== undefined) {
    if (input.pickup_end === null) throw invalid("pickup_end: Can't be empty on a published deal.");
    if (current.pickup_end === null || toMs(input.pickup_end) !== toMs(current.pickup_end)) {
      checkPickupEnd(current.pickup_start, input.pickup_end, at);
      patch.pickup_end = input.pickup_end;
    }
  }
  if (input.note !== undefined && input.note !== current.note) patch.note = input.note;
  if (input.deal_price_cents !== undefined) {
    if (input.deal_price_cents === null) throw invalid("deal_price_cents: Can't be empty on a published deal.");
    const currentPrice = current.deal_price_cents ?? 0;
    if (input.deal_price_cents > currentPrice) {
      throw invalid("deal_price_cents: The price of a published deal can only go down.");
    }
    // Existing reservations keep their unit_price_cents: only the deal changes.
    if (input.deal_price_cents < currentPrice) patch.deal_price_cents = input.deal_price_cents;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** PATCH /deals/{id}: draft fields while draft; quantity_total, pickup_end, note, lower deal_price_cents while live. */
export async function updateDeal(merchant: MerchantRecord, id: string, body: unknown, at: Date): Promise<Deal> {
  const store = await db();
  await loadOwnDeal(store, merchant, id);
  const input = parseWith(patchDealSchema, body);
  const updated = await updateDealWithRetry(store, id, (current) => {
    const status = deriveDealStatus(current, at);
    if (status === "cancelled" || status === "expired") throw endedError(status, "changed");
    return status === "draft" ? draftPatch(current, input, at) : livePatch(current, input, at);
  });
  return dealView(updated, merchant, at);
}

/** POST /deals/{id}/publish: draft -> live. */
export async function publishDeal(merchant: MerchantRecord, id: string, at: Date): Promise<Deal> {
  const store = await db();
  await loadOwnDeal(store, merchant, id);
  const published = await updateDealWithRetry(store, id, (current) => {
    const status = deriveDealStatus(current, at);
    if (status === "cancelled") throw invalid("This deal was cancelled. Create a new one to publish.");
    if (status !== "draft") throw invalid("This deal is already published.");
    const missing = MISSING_FIELDS.filter((field) => current[field] === null);
    if (missing.length > 0) {
      throw invalid(`Fill in before publishing: ${missing.map((f) => FIELD_LABELS[f]).join(", ")}.`);
    }
    checkPrices(current.original_price_cents, current.deal_price_cents);
    checkPickupEnd(current.pickup_start, current.pickup_end as string, at);
    if (planGateEnabled() && merchant.plan_status === "none") {
      throw new ApiError("PLAN_REQUIRED", "Choose a plan to publish deals.");
    }
    return { status: "live", published_at: toIso(at), quantity_left: current.quantity_total };
  });
  await notifyNewDeal(store, published, merchant, at);
  return dealView(published, merchant, at);
}

/** POST /deals/{id}/cancel: draft / live / sold_out -> cancelled; open reservations are cancelled too. */
export async function cancelDeal(merchant: MerchantRecord, id: string, at: Date): Promise<Deal> {
  const store = await db();
  const current = await loadOwnDeal(store, merchant, id);
  const status = deriveDealStatus(current, at);
  if (status === "cancelled") throw new ApiError("DEAL_NOT_LIVE", "This deal is already cancelled.");
  if (status === "expired") throw new ApiError("DEAL_NOT_LIVE", "This deal has already ended.");
  const result = await store.cancelDeal(id, { at: toIso(at) });
  if (!result.ok) {
    if (result.reason === "NOT_FOUND") throw new ApiError("NOT_FOUND", DEAL_NOT_FOUND);
    const latest = await store.getDeal(id);
    const latestStatus = latest ? deriveDealStatus(latest, at) : "cancelled";
    throw new ApiError(
      "DEAL_NOT_LIVE",
      latestStatus === "cancelled" ? "This deal is already cancelled." : "This deal has already ended.",
    );
  }
  await notifyDealCancelled(store, result.value.deal, merchant, result.value.cancelled_reservations, at);
  return dealView(result.value.deal, merchant, at);
}

/** Units of a deal not picked up (unreserved, reserved but not collected, no-shows). */
async function unitsNotPickedUp(store: Store, deal: DealRecord): Promise<number> {
  const pickedUp = (await store.listReservationsByDeal(deal.id))
    .filter((r) => r.status === "picked_up")
    .reduce((sum, r) => sum + r.quantity, 0);
  return (deal.quantity_total ?? 0) - pickedUp;
}

/** POST /deals/{id}/mark-donated: only when expired with units left. Repeating it is a no-op. */
export async function markDealDonated(merchant: MerchantRecord, id: string, at: Date): Promise<Deal> {
  const store = await db();
  await loadOwnDeal(store, merchant, id);
  const updated = await updateDealWithRetry(store, id, async (current) => {
    const status = deriveDealStatus(current, at);
    if (status === "cancelled") throw invalid("A cancelled deal can't be marked as donated.");
    if (status !== "expired") {
      const until = current.pickup_end === null ? "" : ` (${formatTime12(current.pickup_end)})`;
      throw invalid(`You can mark a deal as donated after its pickup time ends${until}.`);
    }
    if (current.unsold_action === "donated") return null;
    if ((await unitsNotPickedUp(store, current)) <= 0) {
      throw invalid("Every unit was picked up, so there is nothing to mark as donated.");
    }
    return { unsold_action: "donated" };
  });
  return dealView(updated, merchant, at);
}

/** GET /merchants/{id}/deals?date=: every deal of that business date, all statuses, newest first. */
export async function listMerchantDeals(merchant: MerchantRecord, date: string, at: Date): Promise<Deal[]> {
  const store = await db();
  const records = await store.listDealsByMerchantDate(merchant.id, date);
  return records.map((record) => dealView(record, merchant, at));
}

/* ------------------------------------------------------------------ */
/* Consumer: browse                                                    */
/* ------------------------------------------------------------------ */

export interface PublicDealsQuery {
  category: MerchantCategory | null;
  kind: DealKind | null;
  lat: number | null;
  lng: number | null;
  sort: DealSort;
}

function oneOf<T extends string>(name: string, allowed: readonly T[], value: string | undefined): T | null {
  if (value === undefined || value.trim() === "") return null;
  const v = value.trim();
  if (!(allowed as readonly string[]).includes(v)) {
    throw invalid(`${name}: Must be one of: ${allowed.join(", ")}.`);
  }
  return v as T;
}

/** Parse GET /deals query. Empty values count as absent. */
export function parsePublicDealsQuery(query: Record<string, string>): PublicDealsQuery {
  const category = oneOf("category", MERCHANT_CATEGORIES, query.category);
  const kind = oneOf("kind", DEAL_KINDS, query.kind);
  const sort = oneOf("sort", DEAL_SORTS, query.sort) ?? "ending";
  const lat = parseQueryNumber("lat", query.lat) ?? null;
  const lng = parseQueryNumber("lng", query.lng) ?? null;
  if ((lat === null) !== (lng === null)) throw invalid("lat and lng: Send both, or neither.");
  if (lat !== null && (lat < -90 || lat > 90)) throw invalid("lat: Must be between -90 and 90.");
  if (lng !== null && (lng < -180 || lng > 180)) throw invalid("lng: Must be between -180 and 180.");
  if (sort === "distance" && lat === null) throw invalid("sort: Sorting by distance needs lat and lng.");
  return { category, kind, lat, lng, sort };
}

/**
 * GET /deals: live and sold_out deals only. distance_m is set when lat/lng
 * were sent and the merchant has a location. sort=ending: soonest pickup_end
 * first. sort=distance: nearest first, deals without a location last.
 * sort=discount: biggest discount first (additive extension), then ending.
 */
export async function listPublicDeals(query: PublicDealsQuery, at: Date): Promise<Deal[]> {
  const store = await db();
  const open = (await store.listOpenDeals({ pickupEndAfter: toIso(at) })).filter((deal) => {
    const status = deriveDealStatus(deal, at);
    return (status === "live" || status === "sold_out") && (query.kind === null || deal.kind === query.kind);
  });
  const merchants = new Map(
    (await store.getMerchantsByIds([...new Set(open.map((d) => d.merchant_id))])).map((m) => [m.id, m]),
  );
  const rows: { deal: Deal; endMs: number; discount: number }[] = [];
  for (const record of open) {
    const merchant = merchants.get(record.merchant_id);
    if (!merchant) continue;
    if (query.category !== null && merchant.category !== query.category) continue;
    const distance =
      query.lat !== null && query.lng !== null && merchant.lat !== null && merchant.lng !== null
        ? haversineMeters(query.lat, query.lng, merchant.lat, merchant.lng)
        : null;
    const original = record.original_price_cents;
    const price = record.deal_price_cents;
    const discount = original && price !== null && original > 0 ? 1 - price / original : 0;
    rows.push({ deal: dealView(record, merchant, at, distance), endMs: toMs(record.pickup_end as string), discount });
  }
  const byEnding = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    a.endMs - b.endMs || (a.deal.id < b.deal.id ? -1 : a.deal.id > b.deal.id ? 1 : 0);
  rows.sort((a, b) => {
    if (query.sort === "discount" && a.discount !== b.discount) return b.discount - a.discount;
    if (query.sort === "distance") {
      const da = a.deal.distance_m;
      const dbm = b.deal.distance_m;
      if (da !== null && dbm !== null && da !== dbm) return da - dbm;
      if (da === null && dbm !== null) return 1;
      if (da !== null && dbm === null) return -1;
    }
    return byEnding(a, b);
  });
  return rows.map((row) => row.deal);
}

/**
 * GET /deals/{id}: any published deal (all statuses, so a reservation or a
 * deal_cancelled notification can link to it). A deal that was never
 * published (a draft, or a draft the merchant discarded) is visible only to
 * the merchant who owns it; everyone else gets 404.
 */
export async function getPublicDeal(
  id: string,
  at: Date,
  viewerMerchantId: () => Promise<string | null>,
): Promise<Deal> {
  const store = await db();
  const deal = await store.getDeal(id);
  if (!deal) throw new ApiError("NOT_FOUND", DEAL_NOT_FOUND);
  if (deal.published_at === null && (await viewerMerchantId()) !== deal.merchant_id) {
    throw new ApiError("NOT_FOUND", DEAL_NOT_FOUND);
  }
  return loadDealView(store, deal, at);
}

