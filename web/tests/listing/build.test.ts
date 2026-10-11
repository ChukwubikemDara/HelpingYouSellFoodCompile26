import { describe, expect, it } from "vitest";
import { localTimeOf, toIso, zonedDateTime } from "@/lib/clock";
import type { ExtractOutput, ExtractedProduct } from "@/lib/extract";

type Times = Pick<ExtractOutput, "pickup_start" | "pickup_end">;
import {
  buildDraft,
  buildDrafts,
  buildEstimate,
  computeDealPrice,
  normalizeProductName,
  titleCase,
  type BuildContext,
} from "@/lib/listing/build";
import type { DealRecord } from "@/lib/store/types";

const DATE = "2026-10-11"; // EDT, -04:00
const at = (hhmm: string) => zonedDateTime(DATE, hhmm);

const MERCHANT: BuildContext["merchant"] = {
  closes_at: "18:00",
  default_discount_pct: 50,
  menu: [{ name: "Croissant", price_cents: 400 }],
};

function ctx(over: Partial<BuildContext> = {}): BuildContext {
  return { now: at("16:00"), merchant: MERCHANT, history: [], photoUrl: null, ...over };
}

function product(name: string, fields: Partial<ExtractedProduct> = {}): ExtractedProduct {
  return {
    name,
    quantity: null,
    unit_size: 1,
    original_price_cents: null,
    deal_price_cents: null,
    discount_pct: null,
    allergens: null,
    ...fields,
  };
}

const NO_TIMES: Times = { pickup_start: null, pickup_end: null };

let seq = 0;
function historyDeal(name: string, fields: Partial<DealRecord> = {}): DealRecord {
  seq += 1;
  return {
    id: `d_hist${seq}`,
    merchant_id: "m_1",
    title: name,
    items: [{ name, qty: 1 }],
    original_price_cents: 300,
    deal_price_cents: 150,
    kind: "surplus",
    quantity_total: 4,
    quantity_left: 0,
    max_per_customer: 2,
    unsold_action: "none",
    pickup_start: toIso(zonedDateTime("2026-10-10", "16:00")),
    pickup_end: toIso(zonedDateTime("2026-10-10", "18:00")),
    allergens: [],
    note: null,
    photo_url: null,
    status: "live",
    created_at: toIso(zonedDateTime("2026-10-10", "15:00")),
    published_at: toIso(zonedDateTime("2026-10-10", "15:05")),
    cancelled_at: null,
    local_date: "2026-10-10",
    price_lowered_by_suggestion: false,
    version: 2,
    ...fields,
  };
}

const build = (p: ExtractedProduct, c: BuildContext = ctx(), times: Times = NO_TIMES) => buildDraft(p, times, c);

describe("name matching", () => {
  it("lowercases, trims and removes one trailing s", () => {
    expect(normalizeProductName("  Croissants ")).toBe("croissant");
    expect(normalizeProductName("CROISSANT")).toBe("croissant");
    expect(normalizeProductName("glass")).toBe("glas");
  });

  it("matches the menu exactly after normalizing, nothing fuzzier", () => {
    expect(build(product("croissants")).price_source).toBe("menu");
    expect(build(product(" CROISSANT ")).price_source).toBe("menu");
    expect(build(product("butter croissant")).price_source).toBeNull();
    expect(build(product("croisant")).price_source).toBeNull();
  });
});

describe("title", () => {
  it("is the name in title case", () => {
    expect(build(product("everything bagel")).deal.title).toBe("Everything Bagel");
    expect(titleCase("slice of pepperoni pizza")).toBe("Slice of Pepperoni Pizza");
    expect(titleCase("BLT sandwich")).toBe("BLT Sandwich");
  });

  it('appends " (N-pack)" when unit_size > 1', () => {
    expect(build(product("donut", { unit_size: 6 })).deal.title).toBe("Donut (6-pack)");
    expect(build(product("donut", { unit_size: 1 })).deal.title).toBe("Donut");
  });
});

describe("items and quantity_total", () => {
  it("items is [{ name, qty: unit_size }]", () => {
    expect(build(product(" Croissant ")).deal.items).toEqual([{ name: "Croissant", qty: 1 }]);
    expect(build(product("donut", { unit_size: 6 })).deal.items).toEqual([{ name: "donut", qty: 6 }]);
  });

  it("quantity_total is the extracted quantity, else null", () => {
    expect(build(product("soup", { quantity: 6 })).deal.quantity_total).toBe(6);
    expect(build(product("soup")).deal.quantity_total).toBeNull();
  });
});

describe("original_price_cents and price_source", () => {
  it("stated wins over menu", () => {
    const d = build(product("Croissant", { original_price_cents: 500 }));
    expect(d.deal.original_price_cents).toBe(500);
    expect(d.price_source).toBe("stated");
  });

  it("menu item with the same name, per sale unit", () => {
    expect(build(product("Croissant")).deal.original_price_cents).toBe(400);
    expect(build(product("Croissant")).price_source).toBe("menu");
    expect(build(product("Croissant", { unit_size: 2 })).deal.original_price_cents).toBe(800);
  });

  it("menu wins over history", () => {
    const d = build(product("Croissant"), ctx({ history: [historyDeal("Croissant", { original_price_cents: 450 })] }));
    expect(d.deal.original_price_cents).toBe(400);
    expect(d.price_source).toBe("menu");
  });

  it("last published deal with the same product name and pack size", () => {
    const history = [
      historyDeal("Baguette", { original_price_cents: 350, deal_price_cents: 175 }),
      historyDeal("Baguette", { original_price_cents: 300, deal_price_cents: 150 }),
    ];
    const d = build(product("baguettes"), ctx({ history }));
    expect(d.deal.original_price_cents).toBe(350);
    expect(d.price_source).toBe("history");
  });

  it("history skips unpublished drafts, other pack sizes and multi-item deals", () => {
    const history = [
      historyDeal("Baguette", { status: "draft", published_at: null, original_price_cents: 999 }),
      historyDeal("Baguette", { items: [{ name: "Baguette", qty: 2 }], original_price_cents: 600 }),
      historyDeal("Baguette", { items: [{ name: "Baguette", qty: 1 }, { name: "Jam", qty: 1 }] }),
    ];
    const d = build(product("Baguette"), ctx({ history }));
    expect(d.deal.original_price_cents).toBeNull();
    expect(d.price_source).toBeNull();
  });

  it("null when nothing supplies it", () => {
    const d = build(product("Baguette"));
    expect(d.deal.original_price_cents).toBeNull();
    expect(d.price_source).toBeNull();
  });

  it("a stated price of 0 or below is not a price", () => {
    const d = build(product("Croissant", { original_price_cents: 0, deal_price_cents: 0 }));
    expect(d.deal.original_price_cents).toBe(400);
    expect(d.price_source).toBe("menu");
    expect(d.deal.deal_price_cents).toBe(200);
    const steak = build(product("steak", { quantity: 100, deal_price_cents: 0 }));
    expect(steak.deal.deal_price_cents).toBeNull();
    expect(steak.deal.original_price_cents).toBeNull();
  });
});

describe("deal_price_cents", () => {
  it("stated price wins over a stated discount and the default", () => {
    const d = build(product("Croissant", { deal_price_cents: 350, discount_pct: 50 }));
    expect(d.deal.deal_price_cents).toBe(350);
  });

  it("stated price stands even when the regular price is unknown", () => {
    const d = build(product("pizza slice", { deal_price_cents: 200 }));
    expect(d.deal.deal_price_cents).toBe(200);
    expect(d.deal.original_price_cents).toBeNull();
  });

  it("stated discount applied to original, rounded down to 25 cents", () => {
    expect(build(product("Croissant", { discount_pct: 30 })).deal.deal_price_cents).toBe(275); // 280 -> 275
    expect(build(product("Croissant", { discount_pct: 50 })).deal.deal_price_cents).toBe(200);
  });

  it("last deal's discount ratio applied to original", () => {
    // Original from the menu (400), ratio from the last Croissant listing (300/400).
    const history = [historyDeal("Croissant", { original_price_cents: 400, deal_price_cents: 300 })];
    const d = build(product("Croissant"), ctx({ history }));
    expect(d.deal.original_price_cents).toBe(400);
    expect(d.price_source).toBe("menu");
    expect(d.deal.deal_price_cents).toBe(300);
    expect(d.agent_notes).toBe("Regular price from your menu. Couldn't count these. Enter the quantity.");
  });

  it("history supplies both prices for a product not on the menu", () => {
    const history = [historyDeal("Baguette", { original_price_cents: 300, deal_price_cents: 150 })];
    const d = build(product("Baguette", { quantity: 3 }), ctx({ history }));
    expect(d.deal.original_price_cents).toBe(300);
    expect(d.deal.deal_price_cents).toBe(150);
    expect(d.agent_notes).toBe("Prices from your last Baguette listing.");
  });

  it("default_discount_pct applied to original", () => {
    expect(build(product("Croissant")).deal.deal_price_cents).toBe(200);
    const c = ctx({ merchant: { ...MERCHANT, default_discount_pct: 30 } });
    expect(build(product("Croissant"), c).deal.deal_price_cents).toBe(275);
  });

  it("null if original is null, even with a stated discount", () => {
    expect(build(product("muffin", { quantity: 12, discount_pct: 50 })).deal.deal_price_cents).toBeNull();
  });

  it("rounds down to a multiple of 25 and stays below the original", () => {
    expect(computeDealPrice(333, 50, 100)).toBe(150); // 166.5 -> 150
    expect(computeDealPrice(550, 50, 100)).toBe(275);
    expect(computeDealPrice(400, 400, 400)).toBe(375); // ratio 1: original - 25
    expect(computeDealPrice(400, 500, 400)).toBe(375); // ratio above 1
  });

  it("never computes a price of 0", () => {
    expect(computeDealPrice(40, 50, 100)).toBe(25); // 20 -> 0 -> 25, still below 40
    expect(computeDealPrice(25, 50, 100)).toBeNull(); // no positive multiple of 25 below 25
    const c = ctx({ merchant: { ...MERCHANT, menu: [{ name: "Cookie", price_cents: 25 }] } });
    const d = build(product("cookie"), c);
    expect(d.deal.deal_price_cents).toBeNull();
    expect(d.missing_fields).toContain("deal_price_cents");
    expect(d.agent_notes).not.toContain("default");
  });
});

describe("pickup_start", () => {
  it("stated time today", () => {
    expect(build(product("latte"), ctx(), { pickup_start: "15:00", pickup_end: null }).deal.pickup_start).toBe(
      "2026-10-11T15:00:00-04:00",
    );
  });

  it("now, rounded up to 5 minutes", () => {
    expect(build(product("latte"), ctx({ now: at("16:00") })).deal.pickup_start).toBe("2026-10-11T16:00:00-04:00");
    const now = new Date(at("16:02").getTime() + 10_000);
    expect(build(product("latte"), ctx({ now })).deal.pickup_start).toBe("2026-10-11T16:05:00-04:00");
  });
});

describe("pickup_end", () => {
  it("stated time today", () => {
    const d = build(product("latte"), ctx(), { pickup_start: null, pickup_end: "17:00" });
    expect(d.deal.pickup_end).toBe("2026-10-11T17:00:00-04:00");
  });

  it("closes_at today when not stated", () => {
    expect(build(product("latte")).deal.pickup_end).toBe("2026-10-11T18:00:00-04:00");
    expect(build(product("latte"), ctx({ now: at("17:45") })).deal.pickup_end).toBe("2026-10-11T18:00:00-04:00");
  });

  it("null when closing is less than 15 minutes away", () => {
    const d = build(product("latte"), ctx({ now: at("17:46") }));
    expect(d.deal.pickup_end).toBeNull();
    expect(d.missing_fields).toContain("pickup_end");
    expect(build(product("latte"), ctx({ now: at("19:00") })).deal.pickup_end).toBeNull();
  });

  it("a stated time is used even when closing is near", () => {
    const d = build(product("latte"), ctx({ now: at("17:50") }), { pickup_start: null, pickup_end: "18:30" });
    expect(localTimeOf(d.deal.pickup_end as string)).toBe("18:30");
  });
});

describe("kind", () => {
  const kindAt = (end: string) => build(product("latte"), ctx(), { pickup_start: null, pickup_end: end }).deal.kind;

  it("surplus when pickup_end is within 2 h of closes_at", () => {
    expect(kindAt("18:00")).toBe("surplus");
    expect(kindAt("16:00")).toBe("surplus");
    expect(kindAt("20:00")).toBe("surplus");
  });

  it("timed otherwise", () => {
    expect(kindAt("15:59")).toBe("timed");
    expect(kindAt("20:01")).toBe("timed");
    expect(kindAt("12:00")).toBe("timed");
  });

  it("surplus when there is no pickup_end (closing is near or past)", () => {
    expect(build(product("latte"), ctx({ now: at("17:50") })).deal.kind).toBe("surplus");
  });
});

describe("fixed fields", () => {
  it("max_per_customer 2, note null", () => {
    const d = build(product("latte"));
    expect(d.deal.max_per_customer).toBe(2);
    expect(d.deal.note).toBeNull();
  });

  it("allergens: stated list (trimmed, lowercased, unique), else null", () => {
    expect(build(product("bagel", { allergens: ["Sesame", " wheat ", "sesame"] })).deal.allergens).toEqual([
      "sesame",
      "wheat",
    ]);
    expect(build(product("bagel")).deal.allergens).toBeNull();
  });

  it("an empty allergen list stays unanswered (null)", () => {
    const d = build(product("bagel", { allergens: [] }));
    expect(d.deal.allergens).toBeNull();
    expect(d.missing_fields).toContain("allergens");
  });

  it("photo_url is the uploaded photo on every draft", () => {
    const c = ctx({ photoUrl: "https://photos.example/photos/a.jpg" });
    const drafts = buildDrafts(
      { products: [product("bagel"), product("soup")], pickup_start: null, pickup_end: null },
      c,
    );
    expect(drafts.map((d) => d.deal.photo_url)).toEqual([
      "https://photos.example/photos/a.jpg",
      "https://photos.example/photos/a.jpg",
    ]);
    expect(build(product("bagel")).deal.photo_url).toBeNull();
  });
});

describe("missing_fields", () => {
  it("lists every null one of the five fields, in contract order", () => {
    const d = build(product("soup"), ctx({ now: at("17:50") }));
    expect(d.missing_fields).toEqual([
      "original_price_cents",
      "deal_price_cents",
      "quantity_total",
      "pickup_end",
      "allergens",
    ]);
  });

  it("is only allergens for a fully known menu item", () => {
    expect(build(product("Croissant", { quantity: 6 })).missing_fields).toEqual(["allergens"]);
  });

  it("is empty when everything is stated", () => {
    const d = build(
      product("latte", { quantity: 10, original_price_cents: 550, deal_price_cents: 300, allergens: ["milk"] }),
      ctx(),
      { pickup_start: "15:00", pickup_end: "17:00" },
    );
    expect(d.missing_fields).toEqual([]);
  });
});

describe("agent_notes", () => {
  it("menu and default discount", () => {
    expect(build(product("Croissant", { quantity: 6 })).agent_notes).toBe(
      "Regular price from your menu. Used your default 50% discount.",
    );
  });

  it("original unknown and quantity unknown", () => {
    expect(build(product("soup")).agent_notes).toBe(
      "Not on your menu. Enter the regular price. Couldn't count these. Enter the quantity.",
    );
  });

  it("stated prices need no note", () => {
    expect(
      build(product("latte", { quantity: 10, original_price_cents: 550, deal_price_cents: 300 })).agent_notes,
    ).toBe("");
  });

  it("stated original with the default discount", () => {
    expect(build(product("donut", { quantity: 2, unit_size: 6, original_price_cents: 1200 })).agent_notes).toBe(
      "Used your default 50% discount.",
    );
  });
});

describe("estimate", () => {
  it("units x deal price x 0.6, labeled as an assumption", () => {
    expect(buildEstimate(3, 400)).toEqual({
      units: 3,
      deal_price_cents: 400,
      assumed_sell_through: 0.6,
      expected_recovered_cents: 720,
      if_discarded_cents: 0,
    });
  });

  it("rounds down to a whole cent", () => {
    expect(buildEstimate(1, 333)?.expected_recovered_cents).toBe(199);
  });

  it("null when quantity or deal price is null", () => {
    expect(buildEstimate(null, 400)).toBeNull();
    expect(buildEstimate(3, null)).toBeNull();
    expect(build(product("soup", { quantity: 3 })).estimate).toBeNull();
    expect(build(product("Croissant")).estimate).toBeNull();
  });
});

describe("contract Draft example", () => {
  it("Butter croissant 2-pack from the menu", () => {
    const c = ctx({ merchant: { ...MERCHANT, menu: [{ name: "Butter croissant", price_cents: 400 }] } });
    const d = build(product("Butter croissant", { quantity: 3, unit_size: 2 }), c);
    expect(d.deal.title).toBe("Butter Croissant (2-pack)");
    expect(d.deal.items).toEqual([{ name: "Butter croissant", qty: 2 }]);
    expect(d.deal.original_price_cents).toBe(800);
    expect(d.deal.deal_price_cents).toBe(400);
    expect(d.missing_fields).toEqual(["allergens"]);
    expect(d.price_source).toBe("menu");
    expect(d.agent_notes).toBe("Regular price from your menu. Used your default 50% discount.");
    expect(d.estimate?.expected_recovered_cents).toBe(720);
  });
});

describe("buildDrafts", () => {
  it("one draft per product, in order; none for no products", () => {
    const drafts = buildDrafts(
      { products: [product("Croissant"), product("baguette")], pickup_start: null, pickup_end: null },
      ctx(),
    );
    expect(drafts.map((d) => d.deal.title)).toEqual(["Croissant", "Baguette"]);
    expect(buildDrafts({ products: [], pickup_start: null, pickup_end: null }, ctx())).toEqual([]);
  });
});
