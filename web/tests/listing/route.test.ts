/**
 * POST /api/merchants/{id}/drafts through the route handler. lib/auth is
 * mocked at its interface (getCurrentMerchant) so this test does not depend
 * on the session implementation.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetNow, setNow, toIso, zonedDateTime } from "@/lib/clock";
import type { DraftsResponse } from "@/lib/contract";
import { createMemoryStore, resetStore, setStore } from "@/lib/store";
import type { MerchantRecord, Store } from "@/lib/store/types";

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth", () => ({
  getCurrentMerchant: vi.fn(async () => auth.current),
}));

const { POST } = await import("@/app/api/merchants/[id]/drafts/route");

const DATE = "2026-10-11";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const merchant: MerchantRecord = {
  id: "m_route1",
  owner_account_id: "ma_route1",
  name: "Example Bakery",
  category: "bakery",
  address: "123 College Ave, State College, PA",
  lat: null,
  lng: null,
  phone: "+18145550100",
  closes_at: "18:00",
  default_discount_pct: 50,
  menu: [{ name: "Croissant", price_cents: 400 }],
  plan_status: "none",
  created_at: toIso(zonedDateTime(DATE, "09:00")),
};

const account = { id: "ma_route1", email: "owner@example.com", created_at: merchant.created_at };

function post(id: string, body: unknown, raw = false) {
  const request = new Request(`http://localhost/api/merchants/${id}/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

let store: Store;
let photoDir: string;

beforeAll(async () => {
  photoDir = await mkdtemp(path.join(tmpdir(), "drafts-route-"));
});
afterAll(async () => {
  await rm(photoDir, { recursive: true, force: true });
});
beforeEach(async () => {
  store = createMemoryStore();
  await store.createMerchant(merchant);
  setStore(store);
  setNow(zonedDateTime(DATE, "16:00"));
  auth.current = { account, merchant };
  vi.stubEnv("PHOTOS_DRIVER", "local");
  vi.stubEnv("PHOTOS_LOCAL_DIR", photoDir);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  resetNow();
  resetStore();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/merchants/{id}/drafts", () => {
  it("401 without a session", async () => {
    auth.current = null;
    const response = await post(merchant.id, { text: "6 croissants" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Sign in to continue." } });
  });

  it("404 for another merchant's id or before onboarding", async () => {
    let response = await post("m_other", { text: "6 croissants" });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
    auth.current = { account, merchant: null };
    response = await post(merchant.id, { text: "6 croissants" });
    expect(response.status).toBe(404);
  });

  it("422 VALIDATION for neither text nor photo, a bad body, or wrong types", async () => {
    for (const [body, raw] of [
      [{}, false],
      [{ text: "  " }, false],
      ["", true],
      ["{not json", true],
      [{ text: 6 }, false],
      [{ photo_base64: ["x"] }, false],
    ] as const) {
      const response = await post(merchant.id, body, raw);
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("VALIDATION");
    }
    expect(await store.listDealsByMerchant(merchant.id)).toEqual([]);
  });

  it("200 with one draft per product (fake provider), saved as drafts", async () => {
    const response = await post(merchant.id, { text: "6 croissants, 3 baguettes, closing at 6" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as DraftsResponse;
    expect(body.drafts.map((d) => [d.deal.title, d.deal.quantity_total, d.deal.status])).toEqual([
      ["Croissant", 6, "draft"],
      ["Baguette", 3, "draft"],
    ]);
    expect(Object.keys(body.drafts[0]).sort()).toEqual(["agent_notes", "deal", "estimate", "missing_fields", "price_source"]);
    expect(await store.listDealsByMerchant(merchant.id)).toHaveLength(2);
  });

  it("200 with { drafts: [] } when there is nothing to list", async () => {
    const response = await post(merchant.id, { text: "nothing today" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ drafts: [] });
  });

  it("a photo is stored and its URL set on the drafts", async () => {
    const response = await post(merchant.id, {
      text: "6 croissants",
      photo_base64: Buffer.from(JPEG).toString("base64"),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as DraftsResponse;
    expect(body.drafts[0].deal.photo_url).toMatch(/^\/api\/photos\/[A-Za-z0-9_-]+\.jpg$/);
  });
});
