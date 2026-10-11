/**
 * Merchant suggestions (contract "Suggestions"). Fixed rules on live data,
 * computed on request. Only dismissals and acceptances are stored.
 *
 * | type        | shown when                                                                 |
 * | list_now    | within 2 h before closes_at and the merchant has created no deal today     |
 * | lower_price | deal is live, at least half the time from published_at to pickup_end has   |
 * |             | passed, fewer than half the units are reserved, and its price has not been |
 * |             | lowered by a suggestion before                                             |
 *
 * Proposed price = current x 0.8, rounded down to a multiple of 25 cents,
 * minimum 25 cents. Dismissed suggestions do not come back for that deal
 * (lower_price) or that day (list_now).
 *
 * Ids are deterministic so state can be remembered:
 * - lower_price: "s_lp_<deal id>"
 * - list_now:    "s_ln_<YYYY-MM-DD>_<merchant id>"
 */
import { RULES, type Deal, type LowerPriceSuggestion, type ListNowSuggestion, type Suggestion } from "@/lib/contract";
import { formatTime12, isLocalDate, localDateOf, minutesBetween, toIso, toMs, zonedDateTime } from "@/lib/clock";
import { ApiError } from "@/lib/http";
import { deriveDealStatus, type DealRecord, type MerchantRecord, type Store, type SuggestionStateRecord } from "@/lib/store";
import { db } from "./db";
import { loadOwnDeal, updateDealWithRetry } from "./deals";
import { formatCents, plural } from "./format";
import { dealView } from "./views";

const LOWER_PRICE_PREFIX = "s_lp_";
const LIST_NOW_PREFIX = "s_ln_";
const NOT_FOUND_MESSAGE = "This suggestion no longer applies.";

export function lowerPriceSuggestionId(dealId: string): string {
  return `${LOWER_PRICE_PREFIX}${dealId}`;
}

export function listNowSuggestionId(merchantId: string, date: string): string {
  return `${LIST_NOW_PREFIX}${date}_${merchantId}`;
}

type ParsedId =
  | { type: "lower_price"; dealId: string }
  | { type: "list_now"; date: string; merchantId: string };

function parseSuggestionId(id: string): ParsedId | null {
  if (id.startsWith(LOWER_PRICE_PREFIX) && id.length > LOWER_PRICE_PREFIX.length) {
    return { type: "lower_price", dealId: id.slice(LOWER_PRICE_PREFIX.length) };
  }
  if (id.startsWith(LIST_NOW_PREFIX)) {
    const rest = id.slice(LIST_NOW_PREFIX.length);
    const date = rest.slice(0, 10);
    if (rest[10] === "_" && isLocalDate(date) && rest.length > 11) {
      return { type: "list_now", date, merchantId: rest.slice(11) };
    }
  }
  return null;
}

/** current x 0.8, down to a multiple of 25 cents, at least 25 cents. Integer math (x 4/5 / 25 = x 4/125). */
export function proposedLowerPrice(currentCents: number): number {
  const stepped = Math.floor((currentCents * 4) / 125) * RULES.PRICE_STEP_CENTS;
  return Math.max(RULES.MIN_PROPOSED_PRICE_CENTS, stepped);
}

/** The lower_price suggestion for a deal at `at`, or null when the rule does not hold. */
export function lowerPriceFor(deal: DealRecord, at: Date, states: ReadonlyMap<string, SuggestionStateRecord>): LowerPriceSuggestion | null {
  if (deriveDealStatus(deal, at) !== "live") return null;
  if (deal.price_lowered_by_suggestion) return null;
  if (deal.published_at === null || deal.pickup_end === null) return null;
  if (deal.deal_price_cents === null || deal.quantity_total === null || deal.quantity_left === null) return null;
  const id = lowerPriceSuggestionId(deal.id);
  if (states.has(id)) return null; // dismissed (or accepted)

  const publishedMs = toMs(deal.published_at);
  const endMs = toMs(deal.pickup_end);
  const nowMs = at.getTime();
  // At least half of the time from published_at to pickup_end has passed.
  if ((nowMs - publishedMs) * 2 < endMs - publishedMs) return null;
  const total = deal.quantity_total;
  const reserved = total - deal.quantity_left;
  // Fewer than half the units are reserved.
  if (reserved * 2 >= total) return null;
  const proposed = proposedLowerPrice(deal.deal_price_cents);
  // Nothing to propose when the price is already at the minimum.
  if (proposed >= deal.deal_price_cents) return null;

  const minutesLeft = Math.ceil(minutesBetween(at, deal.pickup_end));
  return {
    id,
    type: "lower_price",
    deal_id: deal.id,
    message: `${reserved} of ${total} reserved, ${plural(minutesLeft, "minute")} left. Lower ${deal.title} to ${formatCents(proposed)}?`,
    proposed: { deal_price_cents: proposed },
    basis: { reserved, total, minutes_left: minutesLeft },
  };
}

/** The list_now suggestion at `at`, or null when the rule does not hold. */
async function listNowFor(
  store: Store,
  merchant: MerchantRecord,
  at: Date,
  states: ReadonlyMap<string, SuggestionStateRecord>,
): Promise<ListNowSuggestion | null> {
  const date = localDateOf(at);
  const id = listNowSuggestionId(merchant.id, date);
  if (states.get(id)?.state === "dismissed") return null;
  const closesAt = zonedDateTime(date, merchant.closes_at);
  const minutesToClose = minutesBetween(at, closesAt);
  // Within 2 h before closes_at: closes_at - 120 min <= now < closes_at.
  if (minutesToClose <= 0 || minutesToClose > RULES.LIST_NOW_WINDOW_MINUTES) return null;
  // The merchant has created no deal today (any status, drafts included).
  if ((await store.listDealsByMerchantDate(merchant.id, date)).length > 0) return null;
  const minutes = Math.ceil(minutesToClose);
  return {
    id,
    type: "list_now",
    deal_id: null,
    message: `You close at ${formatTime12(closesAt)}, in ${plural(minutes, "minute")}, and have not created a deal today. List what you have now?`,
    proposed: null,
    basis: { minutes_to_close: minutes, deals_today: 0 },
  };
}

async function statesById(store: Store, merchantId: string): Promise<Map<string, SuggestionStateRecord>> {
  return new Map((await store.listSuggestionStates(merchantId)).map((s) => [s.id, s]));
}

/** GET /merchants/{id}/suggestions: list_now first, then lower_price by soonest pickup_end. */
export async function listSuggestions(merchant: MerchantRecord, at: Date): Promise<Suggestion[]> {
  const store = await db();
  const states = await statesById(store, merchant.id);
  const out: Suggestion[] = [];
  const listNow = await listNowFor(store, merchant, at, states);
  if (listNow) out.push(listNow);
  const live = (await store.listOpenDeals({ pickupEndAfter: toIso(at) })).filter(
    (deal) => deal.merchant_id === merchant.id,
  );
  for (const deal of live) {
    const suggestion = lowerPriceFor(deal, at, states);
    if (suggestion) out.push(suggestion);
  }
  return out;
}

/**
 * POST /suggestions/{id}/accept.
 * lower_price: the rule must still hold; sets deal_price_cents to the price
 * proposed now and records that a suggestion lowered it. Returns the Deal.
 * list_now: nothing changes on the server. Returns { ok: true }.
 */
export async function acceptSuggestion(
  merchant: MerchantRecord,
  id: string,
  at: Date,
): Promise<Deal | { ok: true }> {
  const parsed = parseSuggestionId(id);
  if (!parsed) throw new ApiError("NOT_FOUND", NOT_FOUND_MESSAGE);
  const store = await db();
  if (parsed.type === "list_now") {
    if (parsed.merchantId !== merchant.id) throw new ApiError("NOT_FOUND", NOT_FOUND_MESSAGE);
    return { ok: true };
  }
  await loadOwnDeal(store, merchant, parsed.dealId).catch(() => {
    throw new ApiError("NOT_FOUND", NOT_FOUND_MESSAGE);
  });
  const states = await statesById(store, merchant.id);
  const updated = await updateDealWithRetry(store, parsed.dealId, (current) => {
    const suggestion = lowerPriceFor(current, at, states);
    if (!suggestion) throw new ApiError("NOT_FOUND", NOT_FOUND_MESSAGE);
    return { deal_price_cents: suggestion.proposed.deal_price_cents, price_lowered_by_suggestion: true };
  });
  await store.putSuggestionState({
    id,
    merchant_id: merchant.id,
    type: "lower_price",
    deal_id: parsed.dealId,
    local_date: null,
    state: "accepted",
    updated_at: toIso(at),
  });
  return dealView(updated, merchant, at);
}

/** POST /suggestions/{id}/dismiss: remembered so it does not come back for that deal / that day. Idempotent. */
export async function dismissSuggestion(merchant: MerchantRecord, id: string, at: Date): Promise<void> {
  const parsed = parseSuggestionId(id);
  if (!parsed) throw new ApiError("NOT_FOUND", NOT_FOUND_MESSAGE);
  const store = await db();
  if (parsed.type === "list_now") {
    if (parsed.merchantId !== merchant.id) throw new ApiError("NOT_FOUND", NOT_FOUND_MESSAGE);
    await store.putSuggestionState({
      id,
      merchant_id: merchant.id,
      type: "list_now",
      deal_id: null,
      local_date: parsed.date,
      state: "dismissed",
      updated_at: toIso(at),
    });
    return;
  }
  await loadOwnDeal(store, merchant, parsed.dealId).catch(() => {
    throw new ApiError("NOT_FOUND", NOT_FOUND_MESSAGE);
  });
  const existing = await store.getSuggestionState(merchant.id, id);
  if (existing?.state === "accepted") return;
  await store.putSuggestionState({
    id,
    merchant_id: merchant.id,
    type: "lower_price",
    deal_id: parsed.dealId,
    local_date: null,
    state: "dismissed",
    updated_at: toIso(at),
  });
}
