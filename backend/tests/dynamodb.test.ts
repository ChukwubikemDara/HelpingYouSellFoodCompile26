import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ReservationService } from "../lib/services/reservations";
import { createCustomerCommand } from "../lib/db/customer-transactions";
import { liveEditCommand, publishCommand } from "../lib/db/deal-transactions";
import { codeKey, reserveCommand } from "../lib/db/reservation-transactions";
import type { Customer, DealRecord, ReservationRecord } from "../lib/db/models";
import { customer, deal, merchant, now, record } from "./fixtures";
const endpoint = process.env.DYNAMODB_TEST_ENDPOINT;
test("DynamoDB Local: concurrent stock, customer limits, lifecycle and price snapshots", { skip: !endpoint, timeout: 60000 }, async () => {
  const url = new URL(endpoint!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Integration tests must use a local emulator.");
  const raw = new DynamoDBClient({ region: "us-east-1", endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } });
  const db = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
  const prefix = `test-${randomUUID()}`;
  const tables = { merchants: `${prefix}-Merchants`, deals: `${prefix}-Deals`, reservations: `${prefix}-Reservations`, customers: `${prefix}-Customers` };
  const created: string[] = [];
  let clock = now;
  const service = new ReservationService(db, tables, () => clock);
  const put = (TableName: string, Item: object) => db.send(new PutCommand({ TableName, Item }));
  const get = async <T>(TableName: string, id: string) => (await db.send(new GetCommand({ TableName, Key: { id }, ConsistentRead: true }))).Item as T;
  const principal = (id: string) => ({ role: "customer" as const, customer_id: id });
  try {
    for (const [TableName, fields] of [[tables.merchants, []], [tables.customers, []], [tables.deals, ["merchant_id"]], [tables.reservations, ["deal_id", "customer_id", "merchant_id"]]] as [string, string[]][]) {
      await raw.send(new CreateTableCommand({ TableName, BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: ["id", ...fields].map(AttributeName => ({ AttributeName, AttributeType: "S" })),
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        ...(fields.length ? { GlobalSecondaryIndexes: fields.map(field => ({ IndexName: `${field}-index`,
          KeySchema: [{ AttributeName: field, KeyType: "HASH" }], Projection: { ProjectionType: "ALL" } })) } : {}) }));
      created.push(TableName);
    }
    const signup = { ...customer, id: "c_signup", phone: "+18145550777" };
    await db.send(createCustomerCommand(tables.customers, signup, "salted-test-hash"));
    await assert.rejects(db.send(createCustomerCommand(tables.customers, { ...signup, id: "c_duplicate" }, "other-hash")), TransactionCanceledException);
    assert.equal(await get(tables.customers, "c_duplicate"), undefined);
    await put(tables.merchants, merchant);
    await put(tables.deals, { ...deal, status: "draft", published_at: null });
    await db.send(publishCommand(tables.deals, { ...deal, status: "draft", published_at: null }, merchant, now));
    const users = Array.from({ length: 12 }, (_, i) => ({ ...customer, id: `c_${i}` }));
    await Promise.all(users.map(user => put(tables.customers, user)));
    const competing = await Promise.allSettled(users.map(user => service.reserve(principal(user.id), { deal_id: deal.id, quantity: 1 })));
    const booked = competing.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof service.reserve>>>).value);
    assert.equal(booked.length, 5);
    for (const result of competing.filter(r => r.status === "rejected")) assert.equal((result as PromiseRejectedResult).reason.code, "SOLD_OUT");
    assert.equal(new Set(booked.map(r => r.pickup_code)).size, booked.length);
    const soldOut = await get<DealRecord>(tables.deals, deal.id);
    assert.equal(soldOut.quantity_left, 0); assert.equal(soldOut.status, "sold_out");
    assert.equal("version" in booked[0].deal, false); assert.equal("merchant_id" in booked[0], false);
    assert.equal(booked[0].deal.distance_m, null);
    // Customer cannot read/mutate another account's reservation.
    await assert.rejects(service.cancel(principal("stranger"), booked[0].id), { code: "NOT_FOUND" });
    const cancelled = await service.cancel(principal(booked[0].customer_id), booked[0].id);
    assert.equal(cancelled.status, "cancelled");
    await service.cancel(principal(booked[0].customer_id), booked[0].id);
    const reopened = await get<DealRecord>(tables.deals, deal.id);
    assert.equal(reopened.quantity_left, 1); assert.equal(reopened.status, "live");
    await db.send(liveEditCommand(tables.deals, reopened, merchant.id, { deal_price_cents: 300 }, now));
    const fresh = await service.reserve(principal(booked[0].customer_id), { deal_id: deal.id, quantity: 1 });
    assert.equal(fresh.unit_price_cents, 300);
    assert.equal((await get<ReservationRecord>(tables.reservations, booked[1].id)).unit_price_cents, 400);
    // Customer confirmation racing cancellation has exactly one winner.
    const race = await Promise.allSettled([
      service.cancel(principal(fresh.customer_id), fresh.id), service.confirmPickup(principal(fresh.customer_id), fresh.id),
    ]);
    assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
    const terminal = await get<ReservationRecord>(tables.reservations, fresh.id);
    const afterRace = await get<DealRecord>(tables.deals, deal.id);
    assert.equal(afterRace.quantity_left, terminal.status === "cancelled" ? 1 : 0);
    // Merchant redeem accepts only that merchant's code; duplicate pickup does not double-bill.
    await assert.rejects(service.redeem({ role: "merchant", merchant_id: "other" }, booked[1].pickup_code), { code: "CODE_INVALID" });
    await service.redeem({ role: "merchant", merchant_id: merchant.id }, booked[1].pickup_code);
    await assert.rejects(service.redeem({ role: "merchant", merchant_id: merchant.id }, booked[1].pickup_code), { code: "CODE_ALREADY_USED" });
    await service.confirmPickup(principal(booked[1].customer_id), booked[1].id);
    const scan = await db.send(new ScanCommand({ TableName: tables.reservations, ConsistentRead: true }));
    assert.equal(scan.Items!.filter(i => i.reservation_id === booked[1].id && i.event_type === "picked_up").length, 1);
    // Cumulative limit remains two even across separate competing requests.
    const limitDeal = { ...deal, id: "d_limit", quantity_total: 10, quantity_left: 10 };
    await put(tables.deals, limitDeal);
    const limitResults = await Promise.allSettled(Array.from({ length: 5 }, () => service.reserve(principal("c_0"), { deal_id: "d_limit", quantity: 1 })));
    assert.equal(limitResults.filter(r => r.status === "fulfilled").length, 2);
    assert.equal((await get<DealRecord>(tables.deals, "d_limit")).quantity_left, 8);
    // Duplicate code causes the entire transaction (including stock) to roll back.
    const codeDeal = { ...deal, id: "d_code" };
    await put(tables.deals, codeDeal);
    const collisionUser = { ...customer, id: "c_11" };
    const collisionRecord = { ...record, id: "r_collision", deal_id: codeDeal.id, customer_id: collisionUser.id };
    await put(tables.reservations, { id: codeKey(merchant.id, record.pickup_code), reservation_id: "existing" });
    await assert.rejects(db.send(reserveCommand(tables, codeDeal, collisionUser, collisionRecord, now)), TransactionCanceledException);
    assert.equal((await get<DealRecord>(tables.deals, codeDeal.id)).quantity_left, 5);
    assert.equal(await get(tables.reservations, collisionRecord.id), undefined);
    // Two no-shows for the same customer count once each, even when retried.
    const noShowDeal = { ...deal, id: "d_no_show" }; await put(tables.deals, noShowDeal);
    const noShows = [await service.reserve(principal("c_11"), { deal_id: noShowDeal.id, quantity: 1 }),
      await service.reserve(principal("c_11"), { deal_id: noShowDeal.id, quantity: 1 })];
    clock = "2026-10-11T22:15:00.000Z";
    await Promise.all(noShows.map(r => service.markNoShow(r.id)));
    await Promise.all(noShows.map(r => service.markNoShow(r.id)));
    const blocked = await get<Customer>(tables.customers, "c_11");
    assert.equal(blocked.no_show_count, 2); assert.equal(blocked.blocked, true);
    clock = now;
    await assert.rejects(service.reserve(principal("c_11"), { deal_id: codeDeal.id, quantity: 1 }), { code: "CUSTOMER_BLOCKED" });
  } finally {
    for (const TableName of created) await raw.send(new DeleteTableCommand({ TableName }));
    raw.destroy();
  }
});
