import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { consumerMethods, middleware } from "@/middleware";

const request = (method: string, path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, { method, headers: { origin: "http://localhost:8081", ...headers } });

const preflight = (path: string, method: string) =>
  middleware(
    request("OPTIONS", path, {
      "access-control-request-method": method,
      "access-control-request-headers": "authorization, content-type",
    }),
  );

describe("CORS middleware", () => {
  it.each([
    ["/api/health", "GET"],
    ["/api/auth/customer/signup", "POST"],
    ["/api/auth/customer/signin", "POST"],
    ["/api/customers/me", "GET"],
    ["/api/customers/me/push-token", "POST"],
    ["/api/deals", "GET"],
    ["/api/deals/d_1", "GET"],
    ["/api/reservations", "GET"],
    ["/api/reservations", "POST"],
    ["/api/reservations/r_1", "GET"],
    ["/api/reservations/r_1/cancel", "POST"],
    ["/api/reservations/r_1/confirm-pickup", "POST"],
    ["/api/follows", "GET"],
    ["/api/follows", "POST"],
    ["/api/follows/m_1", "DELETE"],
    ["/api/notifications", "GET"],
    ["/api/notifications/n_1/read", "POST"],
  ])("answers the preflight for %s %s and allows Authorization and Content-Type", async (path, method) => {
    const res = preflight(path, method);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain(method);
    expect(res.headers.get("access-control-allow-headers")).toBe("Authorization, Content-Type");
    const actual = middleware(request(method, path));
    expect(actual.headers.get("access-control-allow-origin")).toBe("*");
  });

  it.each([
    ["/api/deals", "POST"],
    ["/api/deals/d_1", "PATCH"],
    ["/api/deals/d_1/publish", "POST"],
    ["/api/deals/d_1/cancel", "POST"],
    ["/api/reservations/redeem", "POST"],
    ["/api/me", "GET"],
    ["/api/merchants", "POST"],
    ["/api/merchants/m_1", "GET"],
    ["/api/merchants/m_1/drafts", "POST"],
    ["/api/merchants/m_1/summary", "GET"],
    ["/api/suggestions/s_1/accept", "POST"],
    ["/api/auth/merchant/signin", "POST"],
    ["/api/auth/merchant/signout", "POST"],
    ["/api/billing/links", "GET"],
  ])("keeps merchant endpoint %s %s same-origin (no CORS headers)", (path, method) => {
    expect(preflight(path, method).headers.get("access-control-allow-origin")).toBeNull();
    expect(middleware(request(method, path)).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("maps paths to consumer methods", () => {
    expect(consumerMethods("/api/reservations/redeem")).toBeNull();
    expect(consumerMethods("/api/deals/d_1")).toEqual(["GET"]);
    expect(consumerMethods("/api/merchants/m_1")).toBeNull();
  });
});
