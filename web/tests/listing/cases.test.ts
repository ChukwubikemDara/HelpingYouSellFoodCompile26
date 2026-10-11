/**
 * The agent spec's text test cases 1-9 through the build step, with
 * hand-written extract outputs (what a correct model returns) and the spec's
 * fixed context: now 16:00, closes 18:00, default 50%, menu Croissant 400,
 * no history. scripts/agent-cases.ts runs the same checks against the real model.
 */
import { describe, expect, it } from "vitest";
import { fakeExtract } from "@/lib/extract";
import { buildDrafts } from "@/lib/listing";
import { SPEC_CASES, SPEC_CONTEXT, specBuildContext } from "@/lib/listing/spec-cases";

const DATE = "2026-10-11";

describe("spec text cases with ideal extract outputs", () => {
  for (const c of SPEC_CASES) {
    it(`#${c.id} ${c.text}`, () => {
      const drafts = buildDrafts(c.idealOutput, specBuildContext(DATE));
      expect(c.check(drafts, c.idealOutput)).toEqual([]);
    });
  }

  it("#1 croissant draft in full", () => {
    const [croissant, baguette] = buildDrafts(SPEC_CASES[0].idealOutput, specBuildContext(DATE));
    expect(croissant.deal).toMatchObject({
      title: "Croissant",
      quantity_total: 6,
      original_price_cents: 400,
      deal_price_cents: 200,
      pickup_start: "2026-10-11T16:00:00-04:00",
      pickup_end: "2026-10-11T18:00:00-04:00",
      kind: "surplus",
      allergens: null,
    });
    expect(croissant.agent_notes).toBe("Regular price from your menu. Used your default 50% discount.");
    expect(croissant.estimate?.expected_recovered_cents).toBe(720);
    expect(baguette.missing_fields).toEqual(["original_price_cents", "deal_price_cents", "allergens"]);
    expect(baguette.estimate).toBeNull();
  });

  it("#7 with now 16:00 the start stays 15:00; kind follows the table (17:00 is within 2 h of 18:00)", () => {
    const [latte] = buildDrafts(SPEC_CASES[6].idealOutput, specBuildContext(DATE));
    expect(latte.deal.pickup_start).toBe("2026-10-11T15:00:00-04:00");
    expect(latte.deal.kind).toBe("surplus");
  });

  it("#9 a model that answers price 0 still never produces price 0", () => {
    const output = {
      products: [
        {
          name: "steak",
          quantity: 100,
          unit_size: 1,
          original_price_cents: 0,
          deal_price_cents: 0,
          discount_pct: null,
          allergens: null,
        },
      ],
      pickup_start: null,
      pickup_end: null,
    };
    const drafts = buildDrafts(output, specBuildContext(DATE));
    expect(SPEC_CASES[8].check(drafts, output)).toEqual([]);
    expect(SPEC_CASES[8].check(buildDrafts({ products: [], pickup_start: null, pickup_end: null }, specBuildContext(DATE)), null)).toEqual([]);
  });

  it("a check fails when the result is wrong", () => {
    const wrong = buildDrafts(SPEC_CASES[1].idealOutput, specBuildContext(DATE));
    expect(SPEC_CASES[0].check(wrong, null).length).toBeGreaterThan(0);
  });
});

describe("fake provider on the spec text cases", () => {
  for (const c of SPEC_CASES) {
    it(`#${c.id} ${c.text}`, () => {
      const output = fakeExtract({
        text: c.text,
        now_local: SPEC_CONTEXT.now_local,
        menu_item_names: SPEC_CONTEXT.menu.map((item) => item.name),
      });
      const drafts = buildDrafts(output, specBuildContext(DATE));
      expect(c.check(drafts, output)).toEqual([]);
    });
  }
});
