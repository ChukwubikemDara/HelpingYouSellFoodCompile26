import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Store } from "../lib/db/store";
import { Marketplace } from "../lib/services/marketplace";
import { Accounts } from "../lib/auth/accounts";
import { createApi } from "../lib/services/http";
const endpoint = process.env.DYNAMODB_TEST_ENDPOINT;
test("v0.6 HTTP flow: accounts, same-origin merchant auth, reserve, pickup, summary, cancellation", { skip: !endpoint, timeout: 60000 }, async () => {
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(endpoint!).hostname));
  const raw = new DynamoDBClient({ region: "us-east-1", endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } });
  const db = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
  const prefix = `http-${randomUUID()}`;
  const tables = { merchants: `${prefix}-Merchants`, deals: `${prefix}-Deals`, reservations: `${prefix}-Reservations`, customers: `${prefix}-Customers` };
  const created: string[] = []; const store = new Store(db); const market = new Marketplace(store, tables); const handle = createApi(market, new Accounts(store, tables));
  let cookie = "", token = "";
  async function call(method: string, path: string, body?: unknown, kind: "merchant" | "customer" | "anonymous" = "anonymous") {
    const headers: Record<string, string> = { Origin: "http://localhost:3000" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (kind === "merchant" && cookie) headers.Cookie = cookie;
    if (kind === "customer" && token) headers.Authorization = `Bearer ${token}`;
    const response = await handle(new Request(`http://localhost:3000/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: response.status, headers: response.headers, json: await response.json() };
  }
  try {
    for (const [TableName, fields] of [[tables.merchants, []], [tables.customers, []], [tables.deals, ["merchant_id"]], [tables.reservations, ["deal_id", "customer_id", "merchant_id"]]] as [string, string[]][]) {
      await raw.send(new CreateTableCommand({ TableName, BillingMode: "PAY_PER_REQUEST", AttributeDefinitions: ["id", ...fields].map(AttributeName => ({ AttributeName, AttributeType: "S" })), KeySchema: [{ AttributeName: "id", KeyType: "HASH" }], ...(fields.length ? { GlobalSecondaryIndexes: fields.map(field => ({ IndexName: `${field}-index`, KeySchema: [{ AttributeName: field, KeyType: "HASH" }], Projection: { ProjectionType: "ALL" } })) } : {}) })); created.push(TableName);
    }
    const account = { email: "owner@example.test", password: "Password26!" };
    const signup = await call("POST", "/auth/merchant/signup", account); assert.equal(signup.status, 200);
    cookie = signup.headers.get("set-cookie")!.split(";")[0]; assert.match(signup.headers.get("set-cookie")!, /HttpOnly/);
    assert.equal((await call("POST", "/auth/merchant/signup", account)).json.error.code, "ACCOUNT_EXISTS");
    assert.equal((await call("POST", "/auth/merchant/signin", { ...account, password: "incorrect" })).json.error.code, "BAD_CREDENTIALS");
    assert.equal((await call("GET", "/me", undefined, "merchant")).json.merchant, null);
    const onboard = await call("POST", "/merchants", { name: "Test Bakery", category: "bakery", address: "College Ave", phone: "+18145550100", closes_at: "23:00", default_discount_pct: 50, menu: [] }, "merchant");
    assert.equal(onboard.status, 201); const merchant = onboard.json; assert.equal(merchant.lat, null); assert.equal(merchant.lng, null);
    assert.equal((await call("GET", "/me", undefined, "merchant")).json.merchant.id, merchant.id);
    assert.equal((await call("GET", `/merchants/m_other/summary`, undefined, "merchant")).status, 404);
    const now = new Date().toISOString(), end = new Date(Date.now() + 3600000).toISOString();
    const draft = await call("POST", "/deals", { title: "Croissant", items: [{ name: "Croissant", qty: 1 }], original_price_cents: 800, deal_price_cents: 400, kind: "surplus", quantity_total: 4, pickup_start: now, pickup_end: end, allergens: [] }, "merchant");
    assert.equal(draft.status, 201); assert.equal(draft.json.status, "draft"); assert.equal(draft.json.published_at, null);
    assert.equal((await call("GET", `/deals/${draft.json.id}`)).status, 401);
    const published = await call("POST", `/deals/${draft.json.id}/publish`, {}, "merchant"); assert.equal(published.status, 200); assert.equal(published.json.status, "live");
    assert.equal((await call("GET", "/deals")).json.deals.length, 1);
    const customer = await call("POST", "/auth/customer/signup", { name: "Sam", phone: "+18145550123", password: "Password26!" });
    assert.equal(customer.status, 201); token = customer.json.token; assert.equal("password_hash" in customer.json.customer, false);
    const me = await call("GET", "/customers/me", undefined, "customer"); assert.equal(me.json.id, customer.json.customer.id);
    assert.equal((await call("POST", "/reservations", { deal_id: draft.json.id, quantity: 1 })).status, 401);
    assert.equal((await call("POST", "/reservations", { deal_id: draft.json.id, quantity: 1, customer_phone: "+18145550123" }, "customer")).status, 422);
    const reserve = await call("POST", "/reservations", { deal_id: draft.json.id, quantity: 1 }, "customer"); assert.equal(reserve.status, 201); const r = reserve.json;
    assert.equal(r.unit_price_cents, 400); assert.equal(r.deal.quantity_left, 3); assert.equal(r.customer_id, customer.json.customer.id);
    assert.equal((await call("GET", "/reservations", undefined, "customer")).json.reservations.length, 1);
    assert.equal((await call("PATCH", `/deals/${draft.json.id}`, { deal_price_cents: 300 }, "merchant")).status, 200);
    assert.equal((await call("POST", "/reservations/redeem", { pickup_code: r.pickup_code }, "merchant")).json.status, "picked_up");
    assert.equal((await call("POST", "/reservations/redeem", { pickup_code: r.pickup_code }, "merchant")).json.error.code, "CODE_ALREADY_USED");
    const summary = await call("GET", `/merchants/${merchant.id}/summary`, undefined, "merchant"); assert.equal(summary.json.recovered_cents, 400); assert.equal(summary.json.units_picked_up, 1);
    const second = await call("POST", "/reservations", { deal_id: draft.json.id, quantity: 1 }, "customer"); assert.equal(second.status, 201);
    const cancelled = await call("POST", `/deals/${draft.json.id}/cancel`, {}, "merchant"); assert.equal(cancelled.status, 200);
    const cancelledReservation = await call("GET", `/reservations/${second.json.id}`, undefined, "customer"); assert.equal(cancelledReservation.json.status, "cancelled");
    assert.equal((await call("GET", "/deals")).json.deals.length, 0);
    const unauthorizedHeader = await handle(new Request("http://localhost:3000/api/me", { headers: { "X-Merchant-Id": merchant.id } })); assert.equal(unauthorizedHeader.status, 401);
    const csrf = await handle(new Request("http://localhost:3000/api/auth/merchant/signout", { method: "POST", headers: { Origin: "https://evil.test", Cookie: cookie } })); assert.equal(csrf.status, 401);
    await call("POST", "/auth/merchant/signout", {}, "merchant"); assert.equal((await call("GET", "/me", undefined, "merchant")).status, 401);
    await call("POST", "/auth/customer/signout", {}, "customer"); assert.equal((await call("GET", "/customers/me", undefined, "customer")).status, 401);
  } finally { for (const TableName of created) await raw.send(new DeleteTableCommand({ TableName })); raw.destroy(); }
});
