import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetNow, setNow, toIso, zonedDateTime } from "@/lib/clock";
import { fakeExtract, type ExtractInput, type ExtractOutput, type ExtractResult } from "@/lib/extract";
import { ApiError } from "@/lib/http";
import { DRAFT_LIMITS, createDrafts } from "@/lib/listing";
import { createMemoryStore } from "@/lib/store";
import type { DealRecord, MerchantRecord, Store } from "@/lib/store/types";

const DATE = "2026-10-11";
const NOW = zonedDateTime(DATE, "16:00");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const JPEG_B64 = Buffer.from(JPEG).toString("base64");

let seq = 0;
function merchantRecord(over: Partial<MerchantRecord> = {}): MerchantRecord {
  seq += 1;
  return {
    id: `m_test${seq}`,
    owner_account_id: `ma_test${seq}`,
    name: "Example Bakery",
    category: "bakery",
    address: "123 College Ave, State College, PA",
    lat: 40.7934,
    lng: -77.86,
    phone: "+18145550100",
    closes_at: "18:00",
    default_discount_pct: 50,
    menu: [{ name: "Croissant", price_cents: 400 }],
    plan_status: "none",
    created_at: toIso(zonedDateTime(DATE, "09:00")),
    ...over,
  };
}

const LOG = {
  provider: "test",
  model_id: null,
  input_text: null,
  photo_sent: false,
  raw_output: null,
  validation_error: null,
  attempts: 1,
  latency_ms: 1,
  outcome: "ok" as const,
  error: null,
  attempt_details: [],
};

/** An extract stand-in: the fake rule-based parser, or a fixed result. Records its inputs. */
function extractor(result?: ExtractResult | ((input: ExtractInput) => ExtractResult)) {
  const inputs: ExtractInput[] = [];
  const fn = vi.fn(async (input: ExtractInput): Promise<ExtractResult> => {
    inputs.push(input);
    if (typeof result === "function") return result(input);
    if (result) return result;
    return { ok: true, output: fakeExtract(input), log: LOG };
  });
  return { fn, inputs };
}

const okOutput = (output: ExtractOutput): ExtractResult => ({ ok: true, output, log: LOG });

let store: Store;
let merchant: MerchantRecord;
const noPhoto = vi.fn(async () => "unused");

beforeEach(async () => {
  store = createMemoryStore();
  merchant = merchantRecord();
  await store.createMerchant(merchant);
  setNow(NOW);
});
afterEach(() => {
  resetNow();
});

async function expectValidation(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe("VALIDATION");
  return error as ApiError;
}

describe("request validation", () => {
  it("neither text nor photo: 422 VALIDATION, and the model is not called", async () => {
    const { fn } = extractor();
    for (const body of [{}, { text: "" }, { text: "   " }, { text: null, photo_base64: null }, { photo_base64: "" }]) {
      await expectValidation(createDrafts(merchant, body, { store, extract: fn, putPhoto: noPhoto }));
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("a message over the length limit: 422", async () => {
    const { fn } = extractor();
    const text = "x".repeat(DRAFT_LIMITS.maxTextLength + 1);
    const error = await expectValidation(createDrafts(merchant, { text }, { store, extract: fn, putPhoto: noPhoto }));
    expect(error.message).toMatch(/^text: /);
  });

  it("a photo that is not an image: 422, nothing called", async () => {
    const { fn } = extractor();
    const put = vi.fn(async () => "url");
    await expectValidation(
      createDrafts(merchant, { photo_base64: Buffer.from("plain text").toString("base64") }, { store, extract: fn, putPhoto: put }),
    );
    expect(fn).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

describe("drafts", () => {
  it("e2e text: one saved draft deal per product", async () => {
    const { fn, inputs } = extractor();
    const { drafts } = await createDrafts(
      merchant,
      { text: "6 croissants, 3 baguettes, closing at 6" },
      { store, extract: fn, putPhoto: noPhoto },
    );
    expect(drafts).toHaveLength(2);
    const [croissant, baguette] = drafts;

    expect(croissant.deal).toMatchObject({
      merchant_id: merchant.id,
      merchant: {
        id: merchant.id,
        name: "Example Bakery",
        category: "bakery",
        address: merchant.address,
        lat: merchant.lat,
        lng: merchant.lng,
      },
      title: "Croissant",
      items: [{ name: "Croissant", qty: 1 }],
      original_price_cents: 400,
      deal_price_cents: 200,
      kind: "surplus",
      quantity_total: 6,
      quantity_left: 6,
      max_per_customer: 2,
      unsold_action: "none",
      pickup_start: "2026-10-11T16:00:00-04:00",
      pickup_end: "2026-10-11T18:00:00-04:00",
      allergens: null,
      note: null,
      photo_url: null,
      status: "draft",
      created_at: "2026-10-11T16:00:00-04:00",
      published_at: null,
      distance_m: null,
    });
    expect(croissant.missing_fields).toEqual(["allergens"]);
    expect(croissant.price_source).toBe("menu");
    expect(croissant.agent_notes).toBe("Regular price from your menu. Used your default 50% discount.");
    expect(croissant.estimate).toEqual({
      units: 6,
      deal_price_cents: 200,
      assumed_sell_through: 0.6,
      expected_recovered_cents: 720,
      if_discarded_cents: 0,
    });
    expect(baguette.price_source).toBeNull();
    expect(baguette.estimate).toBeNull();

    // Saved with status draft through the store.
    for (const draft of drafts) {
      const saved = (await store.getDeal(draft.deal.id)) as DealRecord;
      expect(saved).toMatchObject({
        status: "draft",
        merchant_id: merchant.id,
        local_date: DATE,
        version: 1,
        published_at: null,
        cancelled_at: null,
        price_lowered_by_suggestion: false,
      });
      expect(saved.quantity_left).toBe(saved.quantity_total);
    }
    expect(await store.listDealsByMerchantDate(merchant.id, DATE)).toHaveLength(2);

    // The model gets the context and menu names, never prices.
    expect(inputs[0]).toEqual({
      now_local: "16:00",
      closes_at: "18:00",
      category: "bakery",
      text: "6 croissants, 3 baguettes, closing at 6",
      photo: null,
      menu_item_names: ["Croissant"],
    });
  });

  it("model failure: { drafts: [] } and nothing saved", async () => {
    for (const reason of ["invalid_output", "model_error", "timeout"] as const) {
      const { fn } = extractor({ ok: false, reason, log: { ...LOG, outcome: reason } });
      expect(await createDrafts(merchant, { text: "6 croissants" }, { store, extract: fn, putPhoto: noPhoto })).toEqual({
        drafts: [],
      });
    }
    expect(await store.listDealsByMerchant(merchant.id)).toEqual([]);
  });

  it("no products: { drafts: [] }", async () => {
    const { fn } = extractor();
    expect(await createDrafts(merchant, { text: "nothing today" }, { store, extract: fn, putPhoto: noPhoto })).toEqual({
      drafts: [],
    });
    expect(await store.listDealsByMerchant(merchant.id)).toEqual([]);
  });

  it("a photo is uploaded once, sent to the model and set on every draft; photo-only requests work", async () => {
    const { fn, inputs } = extractor(
      okOutput({
        products: [
          { name: "scone", quantity: 8, unit_size: 1, original_price_cents: null, deal_price_cents: null, discount_pct: null, allergens: null },
          { name: "muffin", quantity: null, unit_size: 1, original_price_cents: null, deal_price_cents: null, discount_pct: null, allergens: null },
        ],
        pickup_start: null,
        pickup_end: null,
      }),
    );
    const put = vi.fn(async () => "https://cdn.example.com/photos/abc.jpg");
    const { drafts } = await createDrafts(merchant, { photo_base64: JPEG_B64 }, { store, extract: fn, putPhoto: put });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(JPEG, "image/jpeg");
    expect(inputs[0].text).toBeNull();
    expect(inputs[0].photo).toEqual({ bytes: JPEG, content_type: "image/jpeg" });
    expect(drafts.map((d) => d.deal.photo_url)).toEqual([
      "https://cdn.example.com/photos/abc.jpg",
      "https://cdn.example.com/photos/abc.jpg",
    ]);
    expect(drafts[0].deal.quantity_total).toBe(8);
  });

  it("a failed upload still returns drafts, with photo_url null", async () => {
    const { fn } = extractor();
    const put = vi.fn(async () => {
      throw new Error("S3 down");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { drafts } = await createDrafts(
      merchant,
      { text: "6 croissants", photo_base64: JPEG_B64 },
      { store, extract: fn, putPhoto: put },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].deal.photo_url).toBeNull();
    errors.mockRestore();
  });

  it("history: prices from the merchant's last published listing of the product", async () => {
    await store.createDeal({
      id: "d_lastbaguette",
      merchant_id: merchant.id,
      title: "Baguette",
      items: [{ name: "Baguette", qty: 1 }],
      original_price_cents: 300,
      deal_price_cents: 150,
      kind: "surplus",
      quantity_total: 3,
      quantity_left: 0,
      max_per_customer: 2,
      unsold_action: "none",
      pickup_start: toIso(zonedDateTime("2026-10-10", "16:00")),
      pickup_end: toIso(zonedDateTime("2026-10-10", "18:00")),
      allergens: ["wheat"],
      note: null,
      photo_url: null,
      status: "live",
      created_at: toIso(zonedDateTime("2026-10-10", "15:00")),
      published_at: toIso(zonedDateTime("2026-10-10", "15:01")),
      cancelled_at: null,
      local_date: "2026-10-10",
      price_lowered_by_suggestion: false,
    });
    const { fn } = extractor();
    const { drafts } = await createDrafts(merchant, { text: "3 baguettes" }, { store, extract: fn, putPhoto: noPhoto });
    expect(drafts[0].price_source).toBe("history");
    expect(drafts[0].deal.original_price_cents).toBe(300);
    expect(drafts[0].deal.deal_price_cents).toBe(150);
    expect(drafts[0].agent_notes).toBe("Prices from your last Baguette listing.");
    // Allergens are never carried over from history.
    expect(drafts[0].deal.allergens).toBeNull();
  });

  it("uses the default extract() (fake provider in tests) when none is injected", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { drafts } = await createDrafts(merchant, { text: "6 croissants, 3 baguettes, closing at 6" }, { store, putPhoto: noPhoto });
    expect(drafts.map((d) => d.deal.title)).toEqual(["Croissant", "Baguette"]);
    info.mockRestore();
  });
});
