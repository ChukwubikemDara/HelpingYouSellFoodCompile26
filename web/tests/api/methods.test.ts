/**
 * Every /api response carries the contract's error envelope, also for a
 * method a route does not support (Next.js would answer 405 with an empty
 * body), the bare /api path and a malformed percent-encoded path.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { T0, withFreshApi } from "./helpers";

withFreshApi(T0);

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

/** The methods each route supports (contract v0.6 plus the health, photos and test-only routes). */
const SUPPORTED: Record<string, Method[] | "all"> = {
  "": [],
  "[...path]": [],
  "auth/customer/signin": ["POST"],
  "auth/customer/signup": ["POST"],
  "auth/merchant/signin": ["POST"],
  "auth/merchant/signout": ["POST"],
  "auth/merchant/signup": ["POST"],
  "billing/links": ["GET"],
  "customers/me": ["GET"],
  "customers/me/push-token": ["POST"],
  deals: ["GET", "POST"],
  "deals/[id]": ["GET", "PATCH"],
  "deals/[id]/cancel": ["POST"],
  "deals/[id]/mark-donated": ["POST"],
  "deals/[id]/publish": ["POST"],
  "e2e/no-shows": "all", // answers every method like an unknown path unless E2E_HOOKS=1
  follows: ["GET", "POST"],
  "follows/[merchant_id]": ["DELETE"],
  health: ["GET"],
  me: ["GET"],
  merchants: ["POST"],
  "merchants/[id]": ["GET", "PATCH"],
  "merchants/[id]/deals": ["GET"],
  "merchants/[id]/drafts": ["POST"],
  "merchants/[id]/reservations": ["GET"],
  "merchants/[id]/suggestions": ["GET"],
  "merchants/[id]/summary": ["GET"],
  notifications: ["GET"],
  "notifications/[id]/read": ["POST"],
  "photos/[file]": ["GET"],
  reservations: ["GET", "POST"],
  "reservations/[id]": ["GET"],
  "reservations/[id]/cancel": ["POST"],
  "reservations/[id]/confirm-pickup": ["POST"],
  "reservations/redeem": ["POST"],
  "suggestions/[id]/accept": ["POST"],
  "suggestions/[id]/dismiss": ["POST"],
};

const API_DIR = join(process.cwd(), "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const routes = routeFiles(API_DIR).map((file) => ({
  file,
  route: relative(API_DIR, file).split(sep).slice(0, -1).join("/"),
}));

describe("API routes", () => {
  it("the table above lists every route file", () => {
    expect(routes.map((r) => r.route).sort()).toEqual(Object.keys(SUPPORTED).sort());
  });

  describe.each(routes)("/api/$route", ({ file, route }) => {
    it("exports every method, so Next.js never answers 405 with an empty body", async () => {
      const mod = (await import(file)) as Record<string, unknown>;
      for (const method of METHODS) expect(typeof mod[method], method).toBe("function");
    });

    it("answers each method it does not support with 404 NOT_FOUND in the error envelope", async () => {
      const supported = SUPPORTED[route];
      if (supported === "all") return;
      const mod = (await import(file)) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
      for (const method of METHODS.filter((m) => !supported.includes(m))) {
        const path = `/api/${route.replace(/\[\.\.\.(\w+)\]|\[(\w+)\]/g, "x_1")}`;
        const res = await mod[method](new Request(`http://localhost${path}`, { method }), {
          params: Promise.resolve({}),
        });
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(await res.json(), `${method} ${path}`).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
      }
    });
  });
});

describe("middleware", () => {
  it("answers a malformed percent-encoded /api path with the 404 envelope", async () => {
    const res = middleware(new NextRequest("http://localhost/api/deals/%E0%A4%A"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("passes well-formed paths through", () => {
    const res = middleware(new NextRequest("http://localhost/api/deals/d_%C3%A9"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
