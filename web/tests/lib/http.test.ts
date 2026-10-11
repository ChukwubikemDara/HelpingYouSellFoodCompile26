import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ERROR_CODES, ERROR_STATUS } from "@/lib/contract";
import {
  ApiError,
  errorResponse,
  handle,
  json,
  parseJsonBody,
  parseWith,
  queryObject,
  readJson,
  toErrorResponse,
} from "@/lib/http";

const post = (body: string) =>
  new Request("http://localhost/api/x", { method: "POST", body, headers: { "content-type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("error envelope", () => {
  it("maps every contract code to its status", async () => {
    for (const code of ERROR_CODES) {
      const res = errorResponse(code, "Message.");
      expect(res.status).toBe(ERROR_STATUS[code]);
      expect(await res.json()).toEqual({ error: { code, message: "Message." } });
    }
  });

  it("uses the contract statuses", () => {
    expect(ERROR_STATUS).toEqual({
      UNAUTHORIZED: 401,
      BAD_CREDENTIALS: 401,
      PLAN_REQUIRED: 402,
      CUSTOMER_BLOCKED: 403,
      NOT_FOUND: 404,
      CODE_INVALID: 404,
      SOLD_OUT: 409,
      DEAL_NOT_LIVE: 409,
      CODE_ALREADY_USED: 409,
      ACCOUNT_EXISTS: 409,
      VALIDATION: 422,
    });
  });

  it("ApiError carries code and status", () => {
    const err = new ApiError("SOLD_OUT", "Sold out.");
    expect(err.status).toBe(409);
    expect(err.code).toBe("SOLD_OUT");
    expect(err.message).toBe("Sold out.");
  });
});

describe("json", () => {
  it("sends JSON with no-store and an optional status", async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("keeps caller headers such as Set-Cookie", () => {
    const res = json({ ok: true }, { headers: { "set-cookie": "a=b; HttpOnly" } });
    expect(res.headers.get("set-cookie")).toBe("a=b; HttpOnly");
    expect(res.status).toBe(200);
  });
});

describe("body parsing", () => {
  it("parses valid JSON", async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
  });

  it("turns malformed JSON into 422 VALIDATION", async () => {
    await expect(readJson(post("{not json"))).rejects.toMatchObject({ code: "VALIDATION", status: 422 });
  });

  it("turns an empty body into 422 VALIDATION", async () => {
    await expect(readJson(post(""))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("validates with zod and names the failing field", async () => {
    const schema = z.object({ deal_id: z.string(), quantity: z.number().int().min(1) });
    expect(await parseJsonBody(post('{"deal_id":"d_1","quantity":2}'), schema)).toEqual({ deal_id: "d_1", quantity: 2 });
    const err = await parseJsonBody(post('{"deal_id":"d_1","quantity":0}'), schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("VALIDATION");
    expect((err as ApiError).message).toMatch(/^quantity: /);
  });

  it("names nested paths", () => {
    const schema = z.object({ menu: z.array(z.object({ price_cents: z.number().int() })) });
    try {
      parseWith(schema, { menu: [{ price_cents: 1 }, { price_cents: "x" }] });
      throw new Error("expected a validation error");
    } catch (e) {
      expect((e as ApiError).message).toMatch(/^menu\[1\]\.price_cents: /);
    }
  });

  it("reads query parameters", () => {
    const req = new Request("http://localhost/api/deals?sort=distance&lat=40.79&lng=-77.86");
    expect(queryObject(req)).toEqual({ sort: "distance", lat: "40.79", lng: "-77.86" });
  });
});

describe("handle", () => {
  it("passes successful responses through", async () => {
    const route = handle(async () => json({ ok: true }));
    const res = await route(new Request("http://localhost/api/x"), undefined);
    expect(res.status).toBe(200);
  });

  it("passes the route context through", async () => {
    const route = handle(async (_req, ctx: { params: Promise<{ id: string }> }) => {
      const { id } = await ctx.params;
      return json({ id });
    });
    const res = await route(new Request("http://localhost/api/x"), { params: Promise.resolve({ id: "d_1" }) });
    expect(await res.json()).toEqual({ id: "d_1" });
  });

  it("turns a thrown ApiError into its envelope", async () => {
    const route = handle(async () => {
      throw new ApiError("DEAL_NOT_LIVE", "This deal is not available.");
    });
    const res = await route(new Request("http://localhost/api/x"), undefined);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "DEAL_NOT_LIVE", message: "This deal is not available." } });
  });

  it("turns malformed JSON into 422 VALIDATION", async () => {
    const route = handle(async (req) => json(await readJson(req)));
    const res = await route(post("{"), undefined);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION");
  });

  it("turns a thrown ZodError into 422 VALIDATION", async () => {
    const route = handle(async () => {
      z.object({ a: z.string() }).parse({});
      return json({});
    });
    const res = await route(new Request("http://localhost/api/x"), undefined);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/^a: /);
  });

  it("turns unknown errors into 500 with a safe message and logs them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const route = handle(async () => {
      throw new Error("secret detail: connection string xyz");
    });
    const res = await route(new Request("http://localhost/api/x"), undefined);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "INTERNAL", message: "Something went wrong. Try again." } });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(log).toHaveBeenCalled();
  });

  it("toErrorResponse handles non-Error throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = toErrorResponse("boom");
    expect(res.status).toBe(500);
  });
});
