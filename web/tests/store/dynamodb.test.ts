/**
 * DynamoDB driver tests.
 *
 * 1. The full Store conformance suite against dynalite (in-process), with
 *    TransactWriteItems emulated (see ./dynamodb-emulator.ts). Skipped with a
 *    message when dynalite is not installed.
 * 2. Driver-specific checks: index maintenance on publish/edit/cancel, the
 *    multi-transaction cancelDeal path, no Scan, the getStore() wiring.
 * 3. Optional: the conformance suite against a real AWS table when
 *    DYNAMODB_IT_TABLE is set (never set in CI; needs AWS credentials).
 */
import { afterAll, describe, expect, it } from "vitest";
import { CreateTableCommand, DescribeTableCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { addMinutes, toIso } from "@/lib/clock";
import { awsRegion } from "@/lib/env";
import { newId } from "@/lib/ids";
import { getStore, resetStore } from "@/lib/store";
import { createDynamoStore, createDynamoStoreWithClient, tableDefinition } from "@/lib/store/dynamodb";
import type { NewDealRecord, Store } from "@/lib/store/types";
import { runStoreConformance } from "./conformance";
import { loadDynalite, startLocalDynamo, type LocalDynamo } from "./dynamodb-emulator";

const T0 = "2026-10-11T16:00:00-04:00";
const at = (minutes: number) => toIso(addMinutes(T0, minutes));
const TABLE = "conformance-main";

async function waitForActive(client: DynamoDBClient, tableName: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
    const indexesReady = (Table?.GlobalSecondaryIndexes ?? []).every((g) => g.IndexStatus === "ACTIVE");
    if (Table?.TableStatus === "ACTIVE" && indexesReady) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`table ${tableName} did not become ACTIVE`);
}

const dynalite = loadDynalite();

if (!dynalite) {
  describe("Store conformance: dynamodb (dynalite)", () => {
    it.skip("SKIPPED: dynalite is not installed (dev dependency), so the DynamoDB driver was not tested locally", () => {});
  });
} else {
  let local: Promise<LocalDynamo> | null = null;
  const start = () =>
    (local ??= (async () => {
      const l = await startLocalDynamo(dynalite);
      await l.raw.send(new CreateTableCommand(tableDefinition(TABLE)));
      await waitForActive(l.raw, TABLE);
      return l;
    })());

  let shared: Store | null = null;
  const sharedStore = async () => (shared ??= createDynamoStoreWithClient({ client: (await start()).client, tableName: TABLE }));

  afterAll(async () => {
    if (local) await (await local).close();
  });

  // One table for the whole run, as in production.
  runStoreConformance("dynamodb (dynalite, emulated transactions)", sharedStore);

  describe("dynamodb driver", () => {
    const liveDeal = (merchantId: string, overrides: Partial<NewDealRecord> = {}): NewDealRecord => ({
      id: newId("d"),
      merchant_id: merchantId,
      title: "Bagels",
      items: [{ name: "Bagel", qty: 1 }],
      original_price_cents: 300,
      deal_price_cents: 150,
      kind: "surplus",
      quantity_total: 5,
      quantity_left: 5,
      max_per_customer: 2,
      unsold_action: "none",
      pickup_start: at(30),
      pickup_end: at(120),
      allergens: [],
      note: null,
      photo_url: null,
      status: "live",
      created_at: at(0),
      published_at: at(0),
      cancelled_at: null,
      local_date: "2026-10-11",
      price_lowered_by_suggestion: false,
      ...overrides,
    });

    const openIds = async (store: Store, after: string, mine: string[]) =>
      (await store.listOpenDeals({ pickupEndAfter: after })).map((d) => d.id).filter((id) => mine.includes(id));

    it("keeps the open-deals index in step with publish, pickup_end edits and cancel", async () => {
      const store = await sharedStore();
      const merchantId = newId("m");
      const other = await store.createDeal(liveDeal(merchantId, { pickup_end: at(90) }));
      const draft = await store.createDeal(
        liveDeal(merchantId, { status: "draft", published_at: null, pickup_end: null, quantity_total: null, quantity_left: null }),
      );
      const mine = [other.id, draft.id];
      expect(await openIds(store, at(0), mine)).toEqual([other.id]);

      // A draft cannot be reserved; filling it in and publishing makes it reservable.
      const c = { id: newId("c"), name: "Sam", phone: "+18145550000" };
      const reserveInput = (dealId: string, overrides = {}) => ({
        id: newId("r"),
        deal_id: dealId,
        customer_id: c.id,
        customer_name: c.name,
        customer_phone: c.phone,
        quantity: 1,
        pickup_code: String(1000 + Math.floor(Math.random() * 9000)),
        payment_method: "in_store" as const,
        at: at(10),
        ...overrides,
      });
      expect(await store.reserve(reserveInput(draft.id))).toEqual({ ok: false, reason: "DEAL_NOT_LIVE" });
      const filled = await store.updateDeal(draft.id, { pickup_end: at(60), quantity_total: 4, quantity_left: 4 }, { ifVersion: 1 });
      expect(filled.ok).toBe(true);
      expect(await openIds(store, at(0), mine)).toEqual([other.id]);
      const published = await store.updateDeal(draft.id, { status: "live", published_at: at(5) }, { ifVersion: 2 });
      expect(published.ok && published.value.version).toBe(3);
      expect(await openIds(store, at(0), mine)).toEqual([draft.id, other.id]);
      expect((await store.reserve(reserveInput(draft.id))).ok).toBe(true);

      // Moving pickup_end reorders the index and moves the reserve cut-off.
      const moved = await store.updateDeal(draft.id, { pickup_end: at(100) });
      expect(moved.ok).toBe(true);
      expect(await openIds(store, at(0), mine)).toEqual([other.id, draft.id]);
      expect((await store.reserve(reserveInput(draft.id, { at: at(95) }))).ok).toBe(true);
      const shortened = await store.updateDeal(draft.id, { pickup_end: at(40) });
      expect(shortened.ok).toBe(true);
      expect(await store.reserve(reserveInput(draft.id, { at: at(45), customer_id: newId("c") }))).toEqual({
        ok: false,
        reason: "DEAL_NOT_LIVE",
      });

      // Cancelled deals leave the index, through either path.
      expect((await store.cancelDeal(draft.id, { at: at(20) })).ok).toBe(true);
      expect(await openIds(store, at(0), mine)).toEqual([other.id]);
      expect((await store.updateDeal(other.id, { status: "cancelled", cancelled_at: at(21) })).ok).toBe(true);
      expect(await openIds(store, at(0), mine)).toEqual([]);
    });

    it("returns records without key or internal attributes", async () => {
      const store = await sharedStore();
      const deal = await store.createDeal(liveDeal(newId("m")));
      const customer = { id: newId("c"), name: "Ana", phone: "+18145550001" };
      const reserved = await store.reserve({
        id: newId("r"),
        deal_id: deal.id,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.phone,
        quantity: 1,
        pickup_code: "6161",
        payment_method: "in_store",
        at: at(10),
      });
      expect(reserved.ok).toBe(true);
      const read = await store.getDeal(deal.id);
      const internal = (o: object) => Object.keys(o).filter((k) => k.startsWith("_") || /^(PK|SK|GSI\d(PK|SK))$/.test(k));
      expect(internal(read!)).toEqual([]);
      if (reserved.ok) {
        expect(internal(reserved.value.deal)).toEqual([]);
        expect(internal((await store.getReservation(reserved.value.reservation.id))!)).toEqual([]);
      }
      expect(Object.keys(read!).sort()).toEqual(Object.keys({ ...liveDeal("m"), version: 1 }).sort());
    });

    it("cancels a deal with more open reservations than one transaction holds", async () => {
      const store = await sharedStore();
      const merchantId = newId("m");
      const count = 60;
      const deal = await store.createDeal(
        liveDeal(merchantId, { quantity_total: count, quantity_left: count, max_per_customer: count }),
      );
      const customer = { id: newId("c"), name: "Lee", phone: "+18145550002" };
      const codes = Array.from({ length: count }, (_, i) => String(2000 + i));
      for (const code of codes) {
        const r = await store.reserve({
          id: newId("r"),
          deal_id: deal.id,
          customer_id: customer.id,
          customer_name: customer.name,
          customer_phone: customer.phone,
          quantity: 1,
          pickup_code: code,
          payment_method: "in_store",
          at: at(10),
        });
        expect(r.ok).toBe(true);
      }
      const result = await store.cancelDeal(deal.id, { at: at(20) });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.cancelled_reservations).toHaveLength(count);
      const rows = await store.listReservationsByDeal(deal.id);
      expect(rows.filter((r) => r.status === "cancelled")).toHaveLength(count);
      // Every code is free again.
      const next = await store.createDeal(liveDeal(merchantId, { quantity_total: 3, quantity_left: 3 }));
      for (const code of [codes[0], codes[30], codes[59]]) {
        const r = await store.reserve({
          id: newId("r"),
          deal_id: next.id,
          customer_id: newId("c"),
          customer_name: "Kim",
          customer_phone: "+18145550003",
          quantity: 1,
          pickup_code: code,
          payment_method: "in_store",
          at: at(30),
        });
        expect(r.ok).toBe(true);
      }
    });

    it("works through createDynamoStore and getStore() with a local endpoint", async () => {
      const l = await start();
      const direct = createDynamoStore({ tableName: TABLE, endpoint: l.endpoint });
      const deal = await direct.createDeal(liveDeal(newId("m")));
      expect((await direct.getDeal(deal.id))?.id).toBe(deal.id);

      const saved = { ...process.env };
      try {
        process.env.STORE_DRIVER = "dynamodb";
        process.env.DYNAMODB_TABLE = TABLE;
        process.env.DYNAMODB_ENDPOINT = l.endpoint;
        resetStore();
        expect((await getStore().getDeal(deal.id))?.title).toBe("Bagels");
      } finally {
        for (const name of ["STORE_DRIVER", "DYNAMODB_TABLE", "DYNAMODB_ENDPOINT"]) {
          if (saved[name] === undefined) delete process.env[name];
          else process.env[name] = saved[name];
        }
        resetStore();
      }
    });

    it("never scanned the table and never used TransactGetItems", async () => {
      const l = await start();
      expect(l.operations.has("TransactWriteItems")).toBe(true);
      expect(l.operations.has("Query")).toBe(true);
      expect([...l.operations].filter((op) => op === "Scan" || op === "TransactGetItems")).toEqual([]);
    });

    it("emulator: a failed condition rolls back every action of the transaction", async () => {
      const l = await start();
      const { DynamoDBDocumentClient, TransactWriteCommand, GetCommand, PutCommand } = await import("@aws-sdk/lib-dynamodb");
      const doc = DynamoDBDocumentClient.from(l.client);
      const a = { PK: `EMU#${newId("c")}`, SK: "X", n: 1 };
      const b = { PK: `EMU#${newId("c")}`, SK: "X", n: 1 };
      await doc.send(new PutCommand({ TableName: TABLE, Item: b }));
      const attempt = doc.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: TABLE, Item: a, ConditionExpression: "attribute_not_exists(PK)" } },
            { Put: { TableName: TABLE, Item: { ...b, n: 2 }, ConditionExpression: "attribute_not_exists(PK)" } },
          ],
        }),
      );
      await expect(attempt).rejects.toMatchObject({
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
      });
      expect((await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: a.PK, SK: "X" } }))).Item).toBeUndefined();
      expect((await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: b.PK, SK: "X" } }))).Item?.n).toBe(1);
      const twice = doc.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: TABLE, Item: a } },
            { Delete: { TableName: TABLE, Key: { PK: a.PK, SK: "X" } } },
          ],
        }),
      );
      await expect(twice).rejects.toMatchObject({ name: "ValidationException" });
    });
  });
}

/* Opt-in: the same suite against a real table (needs AWS credentials). */
const realTable = process.env.DYNAMODB_IT_TABLE?.trim();
if (realTable) {
  let real: Store | null = null;
  runStoreConformance(`dynamodb (AWS table ${realTable})`, () => (real ??= createDynamoStore({ tableName: realTable, region: awsRegion() })));
}
