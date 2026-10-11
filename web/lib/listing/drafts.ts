/**
 * The drafts service behind POST /api/merchants/{id}/drafts
 * (docs/agent-spec.md "Shape"):
 *
 *   request {text?, photo?}
 *     -> load merchant (with menu) + recent deals for history
 *     -> EXTRACT (lib/extract; schema check and one retry live there)
 *     -> BUILD (lib/listing/build): one draft per product
 *     -> save deals with status "draft"
 *     -> { drafts }
 *
 * Failure handling (agent-spec "Failure handling"):
 * - neither text nor photo: 422 VALIDATION
 * - output invalid after the retry, model error, over 15 s, or no products: { drafts: [] }
 * Nothing is published here.
 */
import { RULES, type Draft, type DraftsResponse } from "@/lib/contract";
import { localDateOf, localTimeOf, now as clockNow, toIso } from "@/lib/clock";
import { extract as defaultExtract, type ExtractInput, type ExtractResult } from "@/lib/extract";
import { ApiError } from "@/lib/http";
import { ID_PREFIX, newId } from "@/lib/ids";
import { decodePhotoBase64, putPhoto as defaultPutPhoto, type DecodedPhoto } from "@/lib/photos";
import { getStore } from "@/lib/store";
import type { DealRecord, MerchantRecord, NewDealRecord, Store } from "@/lib/store/types";
import { buildDrafts, type DraftPlan } from "./build";
import { dealFromRecord } from "./serialize";

export const DRAFT_LIMITS = {
  /** Longest message accepted, in characters. */
  maxTextLength: 2000,
  /** How many of the merchant's latest deals are searched for history. */
  historyLimit: 100,
} as const;

/** POST /merchants/{id}/drafts body after JSON parsing. */
export interface DraftsRequestBody {
  text?: string | null;
  photo_base64?: string | null;
}

export interface DraftsDeps {
  store?: Store;
  extract?: (input: ExtractInput) => Promise<ExtractResult>;
  putPhoto?: (bytes: Uint8Array, contentType: string) => Promise<string>;
  now?: () => Date;
}

/** The message, trimmed; null when absent or blank. 422 when too long. */
export function normalizeDraftText(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed.length > DRAFT_LIMITS.maxTextLength) {
    throw new ApiError(
      "VALIDATION",
      `text: Keep the message under ${DRAFT_LIMITS.maxTextLength} characters.`,
    );
  }
  return trimmed;
}

/** Check the request: at least one of text or photo. Throws 422 VALIDATION otherwise. */
export function parseDraftsRequest(body: DraftsRequestBody): { text: string | null; photo: DecodedPhoto | null } {
  const text = normalizeDraftText(body.text);
  const photo = typeof body.photo_base64 === "string" ? decodePhotoBase64(body.photo_base64) : null;
  if (text === null && photo === null) {
    throw new ApiError("VALIDATION", "Add a message or a photo.");
  }
  return { text, photo };
}

/** A saved draft deal record from a plan. */
export function draftRecordOf(plan: DraftPlan, merchantId: string, createdAt: string): NewDealRecord {
  return {
    id: newId(ID_PREFIX.deal),
    merchant_id: merchantId,
    title: plan.deal.title,
    items: plan.deal.items,
    original_price_cents: plan.deal.original_price_cents,
    deal_price_cents: plan.deal.deal_price_cents,
    kind: plan.deal.kind,
    quantity_total: plan.deal.quantity_total,
    // While draft, quantity_left mirrors quantity_total.
    quantity_left: plan.deal.quantity_total,
    max_per_customer: plan.deal.max_per_customer ?? RULES.DEFAULT_MAX_PER_CUSTOMER,
    unsold_action: "none",
    pickup_start: plan.deal.pickup_start,
    pickup_end: plan.deal.pickup_end,
    allergens: plan.deal.allergens,
    note: plan.deal.note,
    photo_url: plan.deal.photo_url,
    status: "draft",
    created_at: createdAt,
    published_at: null,
    cancelled_at: null,
    local_date: localDateOf(createdAt),
    price_lowered_by_suggestion: false,
  };
}

async function uploadPhoto(
  photo: DecodedPhoto | null,
  put: NonNullable<DraftsDeps["putPhoto"]>,
  merchantId: string,
): Promise<string | null> {
  if (!photo) return null;
  try {
    return await put(photo.bytes, photo.contentType);
  } catch (error) {
    // The drafts are still useful without the photo; the merchant can list.
    console.error(`[listing.drafts] photo upload failed for merchant ${merchantId}; drafts get photo_url null`, error);
    return null;
  }
}

/**
 * Run the listing agent for a merchant. The caller has checked that the
 * merchant is the signed-in one. Returns one draft per product (may be empty).
 */
export async function createDrafts(
  merchant: MerchantRecord,
  body: DraftsRequestBody,
  deps: DraftsDeps = {},
): Promise<DraftsResponse> {
  const { text, photo } = parseDraftsRequest(body);
  const store = deps.store ?? getStore();
  const runExtract = deps.extract ?? defaultExtract;
  const put = deps.putPhoto ?? defaultPutPhoto;
  const now = (deps.now ?? clockNow)();

  const input: ExtractInput = {
    now_local: localTimeOf(now),
    closes_at: merchant.closes_at,
    category: merchant.category,
    text,
    photo: photo ? { bytes: photo.bytes, content_type: photo.contentType } : null,
    menu_item_names: merchant.menu.map((item) => item.name),
  };

  const [history, result, photoUrl] = await Promise.all([
    store.listDealsByMerchant(merchant.id, { limit: DRAFT_LIMITS.historyLimit }),
    runExtract(input),
    uploadPhoto(photo, put, merchant.id),
  ]);

  if (!result.ok || result.output.products.length === 0) return { drafts: [] };

  const plans = buildDrafts(result.output, { now, merchant, history, photoUrl });
  const createdAt = toIso(now);
  const saved: DealRecord[] = await Promise.all(
    plans.map((plan) => store.createDeal(draftRecordOf(plan, merchant.id, createdAt))),
  );

  const drafts: Draft[] = plans.map((plan, i) => ({
    deal: dealFromRecord(saved[i], merchant, now),
    missing_fields: plan.missing_fields,
    price_source: plan.price_source,
    agent_notes: plan.agent_notes,
    estimate: plan.estimate,
  }));
  return { drafts };
}
