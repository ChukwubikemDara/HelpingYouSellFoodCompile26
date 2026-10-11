import test from "node:test";
import assert from "node:assert/strict";
import { cancelCommand, noShowCommand, pickupCommand, reserveCommand } from "../lib/db/reservation-transactions";
import { liveEditCommand, publishCommand } from "../lib/db/deal-transactions";
import { getDbConfig } from "../lib/db/config";
import { cents, localDate, utc } from "../lib/validation/primitives";
import { generatePickupCode } from "../lib/services/pickup-code";
import { customer, deal, merchant, now, record } from "./fixtures";
const tables = { deals: "Deals", reservations: "Reservations", customers: "Customers" };
test("reservation claims stock, code and cumulative limit in the same transaction", () => {
  const items = reserveCommand(tables, deal, customer, record, now).input.TransactItems!;
  assert.equal(items.length, 5);
  assert.match(items[0].Update!.ConditionExpression!, /#version = :version AND quantity_left = :left/);
  assert.match(items[4].Update!.ConditionExpression!, /units <= :available/);
  assert.equal(items[4].Update!.ExpressionAttributeValues![":available"], 1);
  assert.equal(items[3].Put!.ConditionExpression, "attribute_not_exists(id)");
});
test("invalid quantity, sold-out, blocked account and end time fail before sending", () => {
  for (const quantity of [0, -1, 1.5, NaN, Infinity, 3]) assert.throws(() => reserveCommand(tables, deal, customer, { ...record, quantity }, now));
  assert.throws(() => reserveCommand(tables, { ...deal, quantity_left: 0, status: "sold_out" }, customer, record, now));
  assert.throws(() => reserveCommand(tables, deal, { ...customer, blocked: true }, record, now));
  assert.throws(() => reserveCommand(tables, deal, customer, record, deal.pickup_end!));
});
test("cancellation authorizes account and restores stock only before pickup end", () => {
  const items = cancelCommand(tables, deal, record, customer.id, now).input.TransactItems!;
  assert.match(items[0].Update!.ConditionExpression!, /customer_id = :customer/);
  assert.equal(items[1].Update!.ExpressionAttributeValues![":delta"], 1);
  assert.equal(items[3].Update!.ExpressionAttributeValues![":delta"], -1);
  assert.throws(() => cancelCommand(tables, deal, record, "c_other", now));
  assert.throws(() => cancelCommand(tables, deal, record, customer.id, deal.pickup_end!));
});
test("pickup is window gated and emits one transactional usage record", () => {
  const items = pickupCommand(tables, deal, record, now).input.TransactItems!;
  assert.equal(items[3].Put!.Item!.id, "usage:r_1");
  assert.equal(items[3].Put!.ConditionExpression, "attribute_not_exists(id)");
  assert.throws(() => pickupCommand(tables, deal, record, "2026-10-11T18:59:59Z"));
  assert.throws(() => pickupCommand(tables, deal, record, "2026-10-11T22:00:01Z"));
});
test("second no-show blocks account, count is conditioned on prior count", () => {
  const items = noShowCommand(tables, deal, record, { ...customer, no_show_count: 1 }, "2026-10-11T22:15:00Z").input.TransactItems!;
  assert.equal(items[3].Update!.ExpressionAttributeValues![":blocked"], true);
  assert.match(items[3].Update!.ConditionExpression!, /no_show_count = :previous/);
  assert.throws(() => noShowCommand(tables, deal, record, customer, "2026-10-11T22:14:59Z"));
});
test("publish requires allergens and optionally a plan", () => {
  const draft = { ...deal, status: "draft" as const, published_at: null };
  publishCommand("Deals", draft, merchant, now);
  assert.throws(() => publishCommand("Deals", { ...draft, allergens: null }, merchant, now));
  assert.throws(() => publishCommand("Deals", draft, { ...merchant, plan_status: "none" }, now, true));
});
test("live edits protect reserved units and forbid price raises", () => {
  assert.throws(() => liveEditCommand("Deals", { ...deal, quantity_left: 1 }, merchant.id, { quantity_total: 3 }, now));
  assert.throws(() => liveEditCommand("Deals", deal, merchant.id, { deal_price_cents: 401 }, now));
  liveEditCommand("Deals", deal, merchant.id, { deal_price_cents: 300 }, now);
});
test("offsets normalize for comparisons; local dates use New York", () => {
  assert.equal(utc("2026-10-11T15:00:00-04:00"), now);
  assert.equal(localDate("2026-10-12T01:00:00Z"), "2026-10-11");
  assert.throws(() => utc("2026-10-11T15:00:00"));
  assert.throws(() => utc("2026-02-30T15:00:00Z"));
});
test("configuration fails closed and prices reject fractional cents", () => {
  assert.throws(() => getDbConfig({})); assert.throws(() => cents(1.5)); cents(100);
});
test("pickup codes contain four digits", () => {
  for (let i = 0; i < 100; i++) assert.match(generatePickupCode(), /^\d{4}$/);
});

test("customer projection excludes password hashes and signup claims unique phone atomically", async () => {
  const { createCustomerCommand, customerDto } = await import("../lib/db/customer-transactions");
  const command = createCustomerCommand("Customers", customer, "salted-test-hash");
  assert.equal(command.input.TransactItems!.length, 2);
  assert.equal("password_hash" in customerDto({ ...customer, password_hash: "secret" }), false);
});
test("draft normalizes numeric offsets and preserves explicit nulls", async () => {
  const { createDraft } = await import("../lib/services/deal-draft");
  const draft = createDraft(merchant, { title: deal.title, items: deal.items, kind: deal.kind,
    original_price_cents: null, deal_price_cents: null, quantity_total: null, allergens: null,
    pickup_start: "2026-10-11T15:00:00-04:00", pickup_end: null }, now);
  assert.equal(draft.pickup_start, now);
  assert.equal(draft.photo_url, null); assert.equal(draft.published_at, null);
  assert.equal(draft.quantity_left, null); assert.equal(draft.status, "draft");
});
