/**
 * DynamoDB Store driver (one table, AWS SDK v3 with @aws-sdk/lib-dynamodb).
 *
 * The table layout is in ./schema.ts and docs/AWS.md. Summary:
 * - Every entity is one item keyed `PK = <TYPE>#<id>`. Unique values (email,
 *   phone, owner account, open pickup code, notification dedupe key) are
 *   marker items written in the same TransactWriteItems as the entity, with
 *   `attribute_not_exists(PK)`.
 * - Lists are Query calls on GSI1-GSI4 (newest first via a `<utcKey>#<id>`
 *   sort key) or on a base-table partition. No Scan anywhere.
 * - `reserve` is one TransactWriteItems: a conditional update of the deal
 *   (live, before pickup_end, quantity_left >= q, price unchanged, customer
 *   under max_per_customer) that decrements quantity_left, plus the
 *   reservation put and the pickup-code lock put.
 * - Every read by key is strongly consistent. GSI queries are eventually
 *   consistent (DynamoDB does not offer more); nothing atomic depends on them.
 *
 * Expected failures come back as the same `{ ok: false, reason }` results the
 * in-memory driver returns. Infrastructure errors are thrown.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { isDeepStrictEqual } from "node:util";
import { toMs, utcKey } from "@/lib/clock";
import type {
  CustomerRecord,
  CustomerTokenRecord,
  DealPatch,
  DealRecord,
  MerchantAccountRecord,
  MerchantRecord,
  MerchantSessionRecord,
  NewDealRecord,
  NotificationRecord,
  ReservationRecord,
  ReserveFailure,
  ReserveInput,
  Store,
  SuggestionStateRecord,
  UpdateDealOptions,
} from "../types";
import {
  AFTER,
  CUSTOMER_QTY_PREFIX,
  GSI,
  MAX_BATCH_GET,
  MAX_TRANSACT_ITEMS,
  OPEN_RES_PREFIX,
  PICKUP_END_KEY_ATTR,
  PK,
  SK,
  TYPE_ATTR,
  indexKeys,
  isInternalAttribute,
  keys,
  timeSortKey,
  type GsiName,
} from "./schema";

export * from "./schema";

export interface DynamoStoreOptions {
  /** DYNAMODB_TABLE. */
  tableName: string;
  /** APP_AWS_REGION, falling back to AWS_REGION. undefined = SDK default chain. */
  region?: string;
  /** DYNAMODB_ENDPOINT, for a local emulator (dynalite) in tests. undefined = AWS. */
  endpoint?: string;
}

/** The driver lib/store/index.ts uses for STORE_DRIVER=dynamodb. */
export function createDynamoStore(options: DynamoStoreOptions): Store {
  const local = options.endpoint !== undefined && isLoopback(options.endpoint);
  const region = options.region ?? (options.endpoint ? "us-east-1" : undefined);
  const client = new DynamoDBClient({
    ...(region ? { region } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    // A local emulator accepts any signature; AWS uses the default credential chain.
    ...(local ? { credentials: { accessKeyId: "local", secretAccessKey: "local" } } : {}),
  });
  return createDynamoStoreWithClient({ client, tableName: options.tableName });
}

/** Same driver on a caller-built client (tests wrap the client's request handler). */
export function createDynamoStoreWithClient(options: {
  client: DynamoDBClient;
  tableName: string;
}): Store {
  return buildStore(
    DynamoDBDocumentClient.from(options.client, {
      marshallOptions: { removeUndefinedValues: true },
      unmarshallOptions: { wrapNumbers: false },
    }),
    options.tableName,
  );
}

function isLoopback(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname;
    return ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"].includes(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Item = Record<string, unknown>;
type Key = Record<string, string>;
type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/** Builds expression placeholders. Every attribute name is aliased (many record fields are reserved words). */
class Expr {
  private readonly nameFor = new Map<string, string>();
  private readonly names: Record<string, string> = {};
  private readonly values: Record<string, unknown> = {};
  private n = 0;

  name(attribute: string): string {
    let placeholder = this.nameFor.get(attribute);
    if (!placeholder) {
      placeholder = `#a${this.nameFor.size}`;
      this.nameFor.set(attribute, placeholder);
      this.names[placeholder] = attribute;
    }
    return placeholder;
  }

  value(value: unknown): string {
    const placeholder = `:v${this.n++}`;
    this.values[placeholder] = value;
    return placeholder;
  }

  /** ExpressionAttributeNames/Values, omitting empty maps (DynamoDB rejects them). */
  params(): { ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Item } {
    return {
      ...(Object.keys(this.names).length > 0 ? { ExpressionAttributeNames: { ...this.names } } : {}),
      ...(Object.keys(this.values).length > 0 ? { ExpressionAttributeValues: { ...this.values } } : {}),
    };
  }
}

function updateExpression(set: string[], remove: string[] = []): string {
  const parts: string[] = [];
  if (set.length > 0) parts.push(`SET ${set.join(", ")}`);
  if (remove.length > 0) parts.push(`REMOVE ${remove.join(", ")}`);
  return parts.join(" ");
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    return String((error as { name: unknown }).name);
  }
  return "";
}

const isConditionFailed = (error: unknown) => errorName(error) === "ConditionalCheckFailedException";

/** Cancellation reason codes that mean "try again", not "your condition is false". */
const RETRYABLE_CANCEL_CODES = new Set([
  "TransactionConflict",
  "ThrottlingError",
  "ProvisionedThroughputExceeded",
  "RequestLimitExceeded",
]);

/** How often a write is retried on a transaction conflict or throttle before the error is thrown. */
const MAX_CONFLICT_RETRIES = 8;
/** How often a store operation re-reads and retries after a lost race (a changed condition). */
const MAX_RACE_RETRIES = 12;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Full-jitter exponential backoff, capped at 1 s. */
const backoff = (attempt: number) => sleep(Math.random() * Math.min(1000, 25 * 2 ** attempt));

/** The record fields of an item: drops key and driver-internal attributes. */
function toRecord<T>(item: Item | undefined | null): T | null {
  if (!item) return null;
  const out: Item = {};
  for (const [name, value] of Object.entries(item)) {
    if (!isInternalAttribute(name)) out[name] = value;
  }
  return out as T;
}

function toRecords<T>(items: Item[]): T[] {
  return items.map((item) => toRecord<T>(item) as T);
}

/** The patch's own fields that are not undefined, not fixed and not internal. */
function definedFields(patch: object, fixed: readonly string[]): Item {
  const out: Item = {};
  for (const [name, value] of Object.entries(patch)) {
    if (value !== undefined && !fixed.includes(name) && !isInternalAttribute(name)) {
      out[name] = structuredClone(value);
    }
  }
  return out;
}

function newestFirst<T extends { created_at: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => toMs(b.created_at) - toMs(a.created_at));
}

function fail<R extends string>(reason: R): { ok: false; reason: R } {
  return { ok: false, reason };
}

function okResult<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/* ------------------------------------------------------------------ */
/* Item builders                                                       */
/* ------------------------------------------------------------------ */

function isOpenDeal(deal: Pick<DealRecord, "status" | "pickup_end">): deal is { status: "live"; pickup_end: string } {
  return deal.status === "live" && deal.pickup_end !== null;
}

function dealItem(deal: DealRecord): Item {
  return {
    ...deal,
    ...keys.deal(deal.id),
    [TYPE_ATTR]: "deal",
    [GSI.GSI1.pk]: indexKeys.merchantDeals(deal.merchant_id),
    [GSI.GSI1.sk]: timeSortKey(deal.created_at, deal.id),
    [GSI.GSI2.pk]: indexKeys.merchantDealsByDate(deal.merchant_id, deal.local_date),
    [GSI.GSI2.sk]: timeSortKey(deal.created_at, deal.id),
    ...(isOpenDeal(deal)
      ? { [GSI.GSI3.pk]: indexKeys.openDeals(), [GSI.GSI3.sk]: timeSortKey(deal.pickup_end, deal.id) }
      : {}),
    ...(deal.pickup_end !== null ? { [PICKUP_END_KEY_ATTR]: utcKey(deal.pickup_end) } : {}),
  };
}

function reservationItem(r: ReservationRecord): Item {
  const sort = timeSortKey(r.created_at, r.id);
  return {
    ...r,
    ...keys.reservation(r.id),
    [TYPE_ATTR]: "reservation",
    [GSI.GSI1.pk]: indexKeys.customerReservations(r.customer_id),
    [GSI.GSI1.sk]: sort,
    [GSI.GSI2.pk]: indexKeys.dealReservations(r.deal_id),
    [GSI.GSI2.sk]: sort,
    [GSI.GSI3.pk]: indexKeys.merchantReservationsByDate(r.merchant_id, r.local_date),
    [GSI.GSI3.sk]: sort,
    [GSI.GSI4.pk]: indexKeys.merchantPickupCode(r.merchant_id, r.pickup_code),
    [GSI.GSI4.sk]: sort,
  };
}

function notificationItem(n: NotificationRecord): Item {
  return {
    ...n,
    ...keys.notification(n.id),
    [TYPE_ATTR]: "notification",
    [GSI.GSI1.pk]: indexKeys.customerNotifications(n.customer_id),
    [GSI.GSI1.sk]: timeSortKey(n.created_at, n.id),
  };
}

const keyOf = (item: Item): Key => ({ [PK]: item[PK] as string, [SK]: item[SK] as string });

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

function buildStore(doc: DynamoDBDocumentClient, tableName: string): Store {
  /* Low-level calls ------------------------------------------------- */

  /** Retry a single write that hit an in-flight transaction on the same item. */
  async function write<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (errorName(error) === "TransactionConflictException" && attempt < MAX_CONFLICT_RETRIES) {
          await backoff(attempt);
          continue;
        }
        throw error;
      }
    }
  }

  async function getItem(key: Key): Promise<Item | null> {
    const out = await doc.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
    return (out.Item as Item | undefined) ?? null;
  }

  async function getRecord<T>(key: Key): Promise<T | null> {
    return toRecord<T>(await getItem(key));
  }

  /** Strongly consistent batch get. Unknown keys are skipped; order is unspecified. */
  async function batchGet(keyList: Key[]): Promise<Item[]> {
    const unique = new Map(keyList.map((k) => [`${k[PK]}\u0000${k[SK]}`, k]));
    const all = [...unique.values()];
    const out: Item[] = [];
    for (let i = 0; i < all.length; i += MAX_BATCH_GET) {
      let pending: Key[] = all.slice(i, i + MAX_BATCH_GET);
      for (let attempt = 0; pending.length > 0; attempt++) {
        if (attempt > 0) {
          if (attempt > MAX_CONFLICT_RETRIES) throw new Error("dynamodb store: BatchGetItem kept returning unprocessed keys");
          await backoff(attempt);
        }
        const res = await doc.send(
          new BatchGetCommand({ RequestItems: { [tableName]: { Keys: pending, ConsistentRead: true } } }),
        );
        out.push(...((res.Responses?.[tableName] as Item[] | undefined) ?? []));
        pending = (res.UnprocessedKeys?.[tableName]?.Keys as Key[] | undefined) ?? [];
      }
    }
    return out;
  }

  /** Every page of a query, or the first `limit` items. */
  async function queryAll(
    input: Omit<QueryCommandInput, "TableName" | "ExclusiveStartKey" | "Limit">,
    limit?: number,
  ): Promise<Item[]> {
    if (limit !== undefined && limit <= 0) return [];
    const out: Item[] = [];
    let start: Item | undefined;
    do {
      const res = await doc.send(
        new QueryCommand({
          ...input,
          TableName: tableName,
          ...(start ? { ExclusiveStartKey: start } : {}),
          ...(limit !== undefined ? { Limit: limit - out.length } : {}),
        }),
      );
      out.push(...((res.Items as Item[] | undefined) ?? []));
      start = res.LastEvaluatedKey as Item | undefined;
    } while (start && (limit === undefined || out.length < limit));
    return limit === undefined ? out : out.slice(0, limit);
  }

  /** Query one GSI partition. `after`: only sort keys strictly greater. Eventually consistent. */
  function queryIndex(
    index: GsiName,
    partition: string,
    options: { newestFirst: boolean; after?: string; limit?: number },
  ): Promise<Item[]> {
    const g = GSI[index];
    const e = new Expr();
    let condition = `${e.name(g.pk)} = ${e.value(partition)}`;
    if (options.after !== undefined) condition += ` AND ${e.name(g.sk)} > ${e.value(options.after)}`;
    return queryAll(
      {
        IndexName: g.name,
        KeyConditionExpression: condition,
        ScanIndexForward: !options.newestFirst,
        ...e.params(),
      },
      options.limit,
    );
  }

  /** Every item of one base-table partition, strongly consistent. */
  function queryPartition(partition: string): Promise<Item[]> {
    const e = new Expr();
    return queryAll({
      KeyConditionExpression: `${e.name(PK)} = ${e.value(partition)}`,
      ConsistentRead: true,
      ...e.params(),
    });
  }

  /**
   * Put an item that must not exist yet. A duplicate is a programmer error and
   * throws, unless the stored item is exactly this one (an SDK retry of our
   * own write whose first response was lost).
   */
  async function putNew(item: Item, what: string, id: string): Promise<void> {
    try {
      await write(() =>
        doc.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: "attribute_not_exists(#pk)",
            ExpressionAttributeNames: { "#pk": PK },
          }),
        ),
      );
    } catch (error) {
      if (!isConditionFailed(error)) throw error;
      if (isDeepStrictEqual(await getItem(keyOf(item)), item)) return;
      throw new Error(`dynamodb store: ${what} ${id} already exists`);
    }
  }

  type TransactResult = { ok: true } | { ok: false; reasons: string[] };

  /**
   * TransactWriteItems. Retries conflicts and throttles; returns the
   * per-action reason codes when a condition failed. The SDK sends an
   * idempotency token (ClientRequestToken), so its own network retries are safe.
   */
  async function transact(items: TransactItem[]): Promise<TransactResult> {
    if (items.length > MAX_TRANSACT_ITEMS) {
      throw new Error(`dynamodb store: transaction of ${items.length} actions exceeds ${MAX_TRANSACT_ITEMS}`);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await doc.send(new TransactWriteCommand({ TransactItems: items }));
        return { ok: true };
      } catch (error) {
        const name = errorName(error);
        const retryable =
          name === "TransactionConflictException" ||
          (name === "TransactionCanceledException" &&
            cancellationCodes(error, items.length).some((code) => RETRYABLE_CANCEL_CODES.has(code)));
        if (retryable && attempt < MAX_CONFLICT_RETRIES) {
          await backoff(attempt);
          continue;
        }
        if (name === "TransactionCanceledException") {
          const reasons = cancellationCodes(error, items.length);
          if (reasons.includes("ConditionalCheckFailed")) return { ok: false, reasons };
        }
        throw error;
      }
    }
  }

  const failedAt = (result: TransactResult, index: number) =>
    !result.ok && result.reasons[index] === "ConditionalCheckFailed";

  /* Shared write actions -------------------------------------------- */

  const putIfAbsent = (item: Item): TransactItem => ({
    Put: {
      TableName: tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(#pk)",
      ExpressionAttributeNames: { "#pk": PK },
    },
  });

  /** Create an entity plus its uniqueness marker in one transaction. */
  async function createUnique(entity: Item, marker: Item): Promise<"created" | "marker_taken" | "entity_exists"> {
    const result = await transact([putIfAbsent(entity), putIfAbsent(marker)]);
    if (result.ok) return "created";
    if (failedAt(result, 1)) return "marker_taken";
    if (failedAt(result, 0)) return "entity_exists";
    throw new Error("dynamodb store: unexpected transaction failure");
  }

  /** Set reserved -> `status` on a reservation; fails unless it is still reserved. */
  function reservationTransition(r: ReservationRecord, set: Item): TransactItem {
    const e = new Expr();
    const assignments = Object.entries(set).map(([name, value]) => `${e.name(name)} = ${e.value(value)}`);
    return {
      Update: {
        TableName: tableName,
        Key: keys.reservation(r.id),
        UpdateExpression: updateExpression(assignments),
        ConditionExpression: `${e.name("status")} = ${e.value("reserved")}`,
        ...e.params(),
      },
    };
  }

  /** Free a pickup code held by this reservation. A missing lock is fine; one held by another reservation is not. */
  function releasePickupCode(r: ReservationRecord): TransactItem {
    const e = new Expr();
    return {
      Delete: {
        TableName: tableName,
        Key: keys.pickupCode(r.merchant_id, r.pickup_code),
        ConditionExpression: `attribute_not_exists(${e.name(PK)}) OR ${e.name("reservation_id")} = ${e.value(r.id)}`,
        ...e.params(),
      },
    };
  }

  async function getReservationsByIds(ids: readonly string[]): Promise<ReservationRecord[]> {
    return toRecords<ReservationRecord>(await batchGet(ids.map((id) => keys.reservation(id))));
  }

  /**
   * cancelDeal for deals with more open reservations than fit in one
   * transaction: cancel the rest in chunks, skipping any that stopped being
   * reserved meanwhile (picked up or cancelled by the customer).
   */
  async function cancelReservationsInChunks(
    reservations: ReservationRecord[],
    at: string,
  ): Promise<ReservationRecord[]> {
    const done: ReservationRecord[] = [];
    const perChunk = Math.floor(MAX_TRANSACT_ITEMS / 2);
    for (let i = 0; i < reservations.length; i += perChunk) {
      let chunk = reservations.slice(i, i + perChunk);
      for (let attempt = 0; chunk.length > 0; attempt++) {
        if (attempt >= MAX_RACE_RETRIES) throw new Error("dynamodb store: cancelDeal could not cancel every reservation");
        const result = await transact(
          chunk.flatMap((r) => [
            reservationTransition(r, { status: "cancelled", cancelled_at: at }),
            releasePickupCode(r),
          ]),
        );
        if (result.ok) {
          done.push(...chunk.map((r) => ({ ...r, status: "cancelled" as const, cancelled_at: at })));
          break;
        }
        const fresh = await getReservationsByIds(chunk.map((r) => r.id));
        chunk = fresh.filter((r) => r.status === "reserved");
      }
    }
    return done;
  }

  /* Store ----------------------------------------------------------- */

  const store: Store = {
    /* Merchant accounts ---------------------------------------------- */

    async createMerchantAccount(record) {
      const outcome = await createUnique(
        { ...record, ...keys.account(record.id), [TYPE_ATTR]: "merchant_account" },
        { ...keys.email(record.email), [TYPE_ATTR]: "unique_email", account_id: record.id },
      );
      if (outcome === "marker_taken") return fail("EMAIL_TAKEN");
      if (outcome === "entity_exists") throw new Error(`dynamodb store: merchant account ${record.id} already exists`);
      return okResult(structuredClone(record));
    },

    async getMerchantAccount(id) {
      return getRecord<MerchantAccountRecord>(keys.account(id));
    },

    async getMerchantAccountByEmail(email) {
      const marker = await getItem(keys.email(email));
      return marker ? getRecord<MerchantAccountRecord>(keys.account(marker.account_id as string)) : null;
    },

    /* Merchant sessions ---------------------------------------------- */

    async createMerchantSession(record: MerchantSessionRecord) {
      await putNew({ ...record, ...keys.session(record.id), [TYPE_ATTR]: "merchant_session" }, "merchant session", record.id);
    },

    async getMerchantSession(id) {
      return getRecord<MerchantSessionRecord>(keys.session(id));
    },

    async deleteMerchantSession(id) {
      await write(() => doc.send(new DeleteCommand({ TableName: tableName, Key: keys.session(id) })));
    },

    /* Customers ------------------------------------------------------ */

    async createCustomer(record) {
      const outcome = await createUnique(
        { ...record, ...keys.customer(record.id), [TYPE_ATTR]: "customer" },
        { ...keys.phone(record.phone), [TYPE_ATTR]: "unique_phone", customer_id: record.id },
      );
      if (outcome === "marker_taken") return fail("PHONE_TAKEN");
      if (outcome === "entity_exists") throw new Error(`dynamodb store: customer ${record.id} already exists`);
      return okResult(structuredClone(record));
    },

    async getCustomer(id) {
      return getRecord<CustomerRecord>(keys.customer(id));
    },

    async getCustomerByPhone(phone) {
      const marker = await getItem(keys.phone(phone));
      return marker ? getRecord<CustomerRecord>(keys.customer(marker.customer_id as string)) : null;
    },

    async getCustomersByIds(ids) {
      return toRecords<CustomerRecord>(await batchGet(ids.map((id) => keys.customer(id))));
    },

    async updateCustomer(id, patch) {
      const fields: Item = {};
      if (patch.name !== undefined) fields.name = patch.name;
      if (patch.expo_push_token !== undefined) fields.expo_push_token = patch.expo_push_token;
      return updateExisting<CustomerRecord>(keys.customer(id), fields);
    },

    /* Customer tokens ------------------------------------------------ */

    async createCustomerToken(record: CustomerTokenRecord) {
      await putNew({ ...record, ...keys.token(record.id), [TYPE_ATTR]: "customer_token" }, "customer token", record.id);
    },

    async getCustomerToken(id) {
      return getRecord<CustomerTokenRecord>(keys.token(id));
    },

    async deleteCustomerToken(id) {
      await write(() => doc.send(new DeleteCommand({ TableName: tableName, Key: keys.token(id) })));
    },

    /* Merchants ------------------------------------------------------ */

    async createMerchant(record) {
      const outcome = await createUnique(
        { ...record, ...keys.merchant(record.id), [TYPE_ATTR]: "merchant" },
        { ...keys.owner(record.owner_account_id), [TYPE_ATTR]: "unique_owner", merchant_id: record.id },
      );
      if (outcome === "marker_taken") return fail("OWNER_HAS_MERCHANT");
      if (outcome === "entity_exists") throw new Error(`dynamodb store: merchant ${record.id} already exists`);
      return okResult(structuredClone(record));
    },

    async getMerchant(id) {
      return getRecord<MerchantRecord>(keys.merchant(id));
    },

    async getMerchantByOwner(accountId) {
      const marker = await getItem(keys.owner(accountId));
      return marker ? getRecord<MerchantRecord>(keys.merchant(marker.merchant_id as string)) : null;
    },

    async getMerchantsByIds(ids) {
      return toRecords<MerchantRecord>(await batchGet(ids.map((id) => keys.merchant(id))));
    },

    async updateMerchant(id, patch) {
      return updateExisting<MerchantRecord>(
        keys.merchant(id),
        definedFields(patch, ["id", "owner_account_id", "created_at"]),
      );
    },

    /* Deals ---------------------------------------------------------- */

    async createDeal(record: NewDealRecord) {
      const stored: DealRecord = { ...structuredClone(record), version: 1 };
      await putNew(dealItem(stored), "deal", stored.id);
      return structuredClone(stored);
    },

    async getDeal(id) {
      return getRecord<DealRecord>(keys.deal(id));
    },

    async getDealsByIds(ids) {
      return toRecords<DealRecord>(await batchGet(ids.map((id) => keys.deal(id))));
    },

    async listDealsByMerchant(merchantId, options) {
      const limit = options?.limit !== undefined ? Math.max(0, Math.floor(options.limit)) : undefined;
      return toRecords<DealRecord>(
        await queryIndex("GSI1", indexKeys.merchantDeals(merchantId), { newestFirst: true, limit }),
      );
    },

    async listDealsByMerchantDate(merchantId, localDate) {
      return toRecords<DealRecord>(
        await queryIndex("GSI2", indexKeys.merchantDealsByDate(merchantId, localDate), { newestFirst: true }),
      );
    },

    async listOpenDeals({ pickupEndAfter }) {
      const after = toMs(pickupEndAfter);
      const rows = toRecords<DealRecord>(
        await queryIndex("GSI3", indexKeys.openDeals(), {
          newestFirst: false,
          after: `${utcKey(pickupEndAfter)}${AFTER}`,
        }),
      );
      return rows.filter((d) => isOpenDeal(d) && toMs(d.pickup_end) > after);
    },

    async updateDeal(id, patch: DealPatch, options?: UpdateDealOptions) {
      const fields = definedFields(patch, ["id", "merchant_id", "created_at", "local_date", "version"]);
      for (let attempt = 0; attempt < MAX_RACE_RETRIES; attempt++) {
        const current = await getRecord<DealRecord>(keys.deal(id));
        if (!current) return fail("NOT_FOUND");
        if (options?.ifVersion !== undefined && current.version !== options.ifVersion) {
          return fail("VERSION_CONFLICT");
        }
        const next = { ...current, ...fields } as DealRecord;
        const e = new Expr();
        const set = Object.entries(fields).map(([name, value]) => `${e.name(name)} = ${e.value(value)}`);
        set.push(`${e.name("version")} = ${e.value(current.version + 1)}`);
        const remove: string[] = [];
        // Keep the open-deals index and the pickup_end key in step with status and pickup_end.
        if (isOpenDeal(next)) {
          set.push(`${e.name(GSI.GSI3.pk)} = ${e.value(indexKeys.openDeals())}`);
          set.push(`${e.name(GSI.GSI3.sk)} = ${e.value(timeSortKey(next.pickup_end, next.id))}`);
        } else {
          remove.push(e.name(GSI.GSI3.pk), e.name(GSI.GSI3.sk));
        }
        if (next.pickup_end !== null) {
          set.push(`${e.name(PICKUP_END_KEY_ATTR)} = ${e.value(utcKey(next.pickup_end))}`);
        } else {
          remove.push(e.name(PICKUP_END_KEY_ATTR));
        }
        try {
          const out = await write(() =>
            doc.send(
              new UpdateCommand({
                TableName: tableName,
                Key: keys.deal(id),
                UpdateExpression: updateExpression(set, remove),
                // Version-guarded even without ifVersion, so the index attributes
                // above are computed from the state being replaced.
                ConditionExpression: `${e.name("version")} = ${e.value(current.version)}`,
                ReturnValues: "ALL_NEW",
                ...e.params(),
              }),
            ),
          );
          return okResult(toRecord<DealRecord>(out.Attributes as Item) as DealRecord);
        } catch (error) {
          if (!isConditionFailed(error)) throw error;
          if (options?.ifVersion !== undefined) {
            const latest = await getRecord<DealRecord>(keys.deal(id));
            return latest ? fail("VERSION_CONFLICT") : fail("NOT_FOUND");
          }
          await backoff(attempt);
        }
      }
      throw new Error(`dynamodb store: updateDeal ${id} lost too many races`);
    },

    async cancelDeal(id, { at }) {
      for (let attempt = 0; attempt < MAX_RACE_RETRIES; attempt++) {
        const item = await getItem(keys.deal(id));
        const deal = toRecord<DealRecord>(item);
        if (!item || !deal) return fail("NOT_FOUND");
        const cancellable =
          deal.status === "draft" ||
          (deal.status === "live" && (deal.pickup_end === null || toMs(at) < toMs(deal.pickup_end)));
        if (!cancellable) return fail("NOT_CANCELLABLE");

        const markers = Object.keys(item).filter((name) => name.startsWith(OPEN_RES_PREFIX));
        const open = (await getReservationsByIds(markers.map((m) => m.slice(OPEN_RES_PREFIX.length)))).filter(
          (r) => r.status === "reserved" && r.deal_id === id,
        );

        // Deal: cancelled, out of the open index, markers gone, per-customer quantities back.
        const e = new Expr();
        const set = [
          `${e.name("status")} = ${e.value("cancelled")}`,
          `${e.name("cancelled_at")} = ${e.value(at)}`,
          `${e.name("version")} = ${e.value(deal.version + 1)}`,
        ];
        const perCustomer = new Map<string, number>();
        for (const r of open) perCustomer.set(r.customer_id, (perCustomer.get(r.customer_id) ?? 0) + r.quantity);
        for (const [customerId, quantity] of perCustomer) {
          const attr = e.name(CUSTOMER_QTY_PREFIX + customerId);
          const q = e.value(quantity);
          set.push(`${attr} = if_not_exists(${attr}, ${q}) - ${q}`);
        }
        const remove = [e.name(GSI.GSI3.pk), e.name(GSI.GSI3.sk), ...markers.map((m) => e.name(m))];
        const dealAction: TransactItem = {
          Update: {
            TableName: tableName,
            Key: keys.deal(id),
            UpdateExpression: updateExpression(set, remove),
            ConditionExpression: `${e.name("version")} = ${e.value(deal.version)}`,
            ...e.params(),
          },
        };
        const cancelOne = (r: ReservationRecord) => [
          reservationTransition(r, { status: "cancelled", cancelled_at: at }),
          releasePickupCode(r),
        ];
        // The deal write and as many reservations as fit go in one transaction.
        // Any change since the read (a new reservation bumps the version, a pickup
        // fails a reservation's condition) cancels it and we start over.
        const head = open.slice(0, Math.floor((MAX_TRANSACT_ITEMS - 1) / 2));
        const tail = open.slice(head.length);
        const result = await transact([dealAction, ...head.flatMap(cancelOne)]);
        if (!result.ok) {
          await backoff(attempt);
          continue;
        }
        const cancelled: ReservationRecord[] = head.map((r) => ({ ...r, status: "cancelled" as const, cancelled_at: at }));
        if (tail.length > 0) cancelled.push(...(await cancelReservationsInChunks(tail, at)));
        return okResult({
          deal: { ...deal, status: "cancelled" as const, cancelled_at: at, version: deal.version + 1 },
          cancelled_reservations: newestFirst(cancelled),
        });
      }
      throw new Error(`dynamodb store: cancelDeal ${id} lost too many races`);
    },

    /* Reservations --------------------------------------------------- */

    async reserve(input: ReserveInput) {
      if (!Number.isInteger(input.quantity) || input.quantity < 1) {
        throw new Error(`dynamodb store: reserve quantity must be an integer >= 1, got ${input.quantity}`);
      }
      for (let attempt = 0; attempt < MAX_RACE_RETRIES; attempt++) {
        const item = await getItem(keys.deal(input.deal_id));
        const deal = toRecord<DealRecord>(item);
        if (!item || !deal) return fail<ReserveFailure>("DEAL_NOT_FOUND");
        if (
          deal.status !== "live" ||
          deal.pickup_end === null ||
          deal.deal_price_cents === null ||
          toMs(input.at) >= toMs(deal.pickup_end)
        ) {
          return fail<ReserveFailure>("DEAL_NOT_LIVE");
        }
        if ((deal.quantity_left ?? 0) < input.quantity) return fail<ReserveFailure>("SOLD_OUT");
        const held = Number(item[CUSTOMER_QTY_PREFIX + input.customer_id] ?? 0);
        if (held + input.quantity > deal.max_per_customer) return fail<ReserveFailure>("MAX_PER_CUSTOMER");

        const reservation: ReservationRecord = {
          id: input.id,
          deal_id: deal.id,
          merchant_id: deal.merchant_id,
          local_date: deal.local_date,
          customer_id: input.customer_id,
          customer_name: input.customer_name,
          customer_phone: input.customer_phone,
          quantity: input.quantity,
          unit_price_cents: deal.deal_price_cents,
          total_cents: input.quantity * deal.deal_price_cents,
          payment_method: input.payment_method,
          pickup_code: input.pickup_code,
          status: "reserved",
          created_at: input.at,
          picked_up_at: null,
          cancelled_at: null,
        };

        // The one conditional write on the deal. Everything the checks above
        // read is re-checked here, so a concurrent reserve, cancel, price drop
        // or edit makes the transaction fail and we re-read.
        const e = new Expr();
        const q = e.value(input.quantity);
        const one = e.value(1);
        const left = e.name("quantity_left");
        const version = e.name("version");
        const held_ = e.name(CUSTOMER_QTY_PREFIX + input.customer_id);
        const dealAction: TransactItem = {
          Update: {
            TableName: tableName,
            Key: keys.deal(deal.id),
            UpdateExpression: updateExpression([
              `${left} = ${left} - ${q}`,
              `${version} = ${version} + ${one}`,
              `${held_} = if_not_exists(${held_}, ${e.value(0)}) + ${q}`,
              `${e.name(OPEN_RES_PREFIX + reservation.id)} = ${one}`,
            ]),
            ConditionExpression: [
              `attribute_exists(${e.name(PK)})`,
              `${e.name("status")} = ${e.value("live")}`,
              `${e.name(PICKUP_END_KEY_ATTR)} > ${e.value(utcKey(input.at))}`,
              `${left} >= ${q}`,
              `${e.name("deal_price_cents")} = ${e.value(deal.deal_price_cents)}`,
              `${e.name("max_per_customer")} = ${e.value(deal.max_per_customer)}`,
              `(attribute_not_exists(${held_}) OR ${held_} <= ${e.value(deal.max_per_customer - input.quantity)})`,
            ].join(" AND "),
            ...e.params(),
          },
        };
        const result = await transact([
          dealAction,
          putIfAbsent(reservationItem(reservation)),
          putIfAbsent({
            ...keys.pickupCode(deal.merchant_id, input.pickup_code),
            [TYPE_ATTR]: "pickup_code",
            reservation_id: reservation.id,
            deal_id: deal.id,
            created_at: input.at,
          }),
        ]);
        if (result.ok) {
          const after = await getRecord<DealRecord>(keys.deal(deal.id));
          if (!after) throw new Error(`dynamodb store: deal ${deal.id} vanished after reserve`);
          return okResult({ reservation: structuredClone(reservation), deal: after });
        }
        if (failedAt(result, 1)) throw new Error(`dynamodb store: reservation ${input.id} already exists`);
        // Deal checks come first: re-read and report (or retry) from the fresh state.
        if (failedAt(result, 0)) continue;
        if (failedAt(result, 2)) return fail<ReserveFailure>("PICKUP_CODE_TAKEN");
        throw new Error("dynamodb store: unexpected reserve transaction failure");
      }
      throw new Error(`dynamodb store: reserve on deal ${input.deal_id} lost too many races`);
    },

    async getReservation(id) {
      return getRecord<ReservationRecord>(keys.reservation(id));
    },

    async listReservationsByCustomer(customerId) {
      return toRecords<ReservationRecord>(
        await queryIndex("GSI1", indexKeys.customerReservations(customerId), { newestFirst: true }),
      );
    },

    async listReservationsByDeal(dealId) {
      return toRecords<ReservationRecord>(
        await queryIndex("GSI2", indexKeys.dealReservations(dealId), { newestFirst: true }),
      );
    },

    async listReservationsByMerchantDate(merchantId, localDate) {
      return toRecords<ReservationRecord>(
        await queryIndex("GSI3", indexKeys.merchantReservationsByDate(merchantId, localDate), { newestFirst: true }),
      );
    },

    async findReservationsByPickupCode(merchantId, pickupCode) {
      // The index lists every reservation that used the code (eventually
      // consistent); the lock item names the open one (strongly consistent).
      // Re-read all of them by key so statuses are current for redeem.
      const [indexed, lock] = await Promise.all([
        queryIndex("GSI4", indexKeys.merchantPickupCode(merchantId, pickupCode), { newestFirst: true }),
        getItem(keys.pickupCode(merchantId, pickupCode)),
      ]);
      const ids = new Set(indexed.map((item) => item.id as string));
      if (lock) ids.add(lock.reservation_id as string);
      if (ids.size === 0) return [];
      const rows = await getReservationsByIds([...ids]);
      return newestFirst(rows.filter((r) => r.merchant_id === merchantId && r.pickup_code === pickupCode));
    },

    async cancelReservation(id, { at }) {
      for (let attempt = 0; attempt < MAX_RACE_RETRIES; attempt++) {
        const r = await getRecord<ReservationRecord>(keys.reservation(id));
        if (!r) return fail("NOT_FOUND");
        if (r.status !== "reserved") return fail("NOT_OPEN");
        const e = new Expr();
        const q = e.value(r.quantity);
        const left = e.name("quantity_left");
        const version = e.name("version");
        const held = e.name(CUSTOMER_QTY_PREFIX + r.customer_id);
        const result = await transact([
          reservationTransition(r, { status: "cancelled", cancelled_at: at }),
          {
            Update: {
              TableName: tableName,
              Key: keys.deal(r.deal_id),
              UpdateExpression: updateExpression(
                [
                  `${left} = ${left} + ${q}`,
                  `${version} = ${version} + ${e.value(1)}`,
                  `${held} = if_not_exists(${held}, ${q}) - ${q}`,
                ],
                [e.name(OPEN_RES_PREFIX + r.id)],
              ),
              ConditionExpression: `attribute_exists(${e.name(PK)})`,
              ...e.params(),
            },
          },
          releasePickupCode(r),
        ]);
        if (result.ok) {
          const deal = await getRecord<DealRecord>(keys.deal(r.deal_id));
          if (!deal) throw new Error(`dynamodb store: deal ${r.deal_id} vanished after cancel`);
          return okResult({ reservation: { ...r, status: "cancelled" as const, cancelled_at: at }, deal });
        }
        if (failedAt(result, 1)) throw new Error(`dynamodb store: deal ${r.deal_id} of reservation ${id} is missing`);
        if (failedAt(result, 2)) throw new Error(`dynamodb store: pickup code of reservation ${id} is held by another reservation`);
        // The reservation changed under us: re-read decides (NOT_OPEN).
      }
      throw new Error(`dynamodb store: cancelReservation ${id} lost too many races`);
    },

    async markReservationPickedUp(id, { at }) {
      for (let attempt = 0; attempt < MAX_RACE_RETRIES; attempt++) {
        const r = await getRecord<ReservationRecord>(keys.reservation(id));
        if (!r) return fail("NOT_FOUND");
        if (r.status !== "reserved") return fail("NOT_OPEN");
        // Units stay taken, so the deal is not written. Its `_o#` marker stays;
        // cancelDeal skips reservations that are no longer reserved.
        const result = await transact([
          reservationTransition(r, { status: "picked_up", picked_up_at: at }),
          releasePickupCode(r),
        ]);
        if (result.ok) return okResult({ ...r, status: "picked_up" as const, picked_up_at: at });
        if (failedAt(result, 1)) throw new Error(`dynamodb store: pickup code of reservation ${id} is held by another reservation`);
      }
      throw new Error(`dynamodb store: markReservationPickedUp ${id} lost too many races`);
    },

    /* Follows -------------------------------------------------------- */

    async addFollow(customerId, merchantId, at) {
      try {
        await write(() =>
          doc.send(
            new PutCommand({
              TableName: tableName,
              Item: {
                ...keys.follow(customerId, merchantId),
                [TYPE_ATTR]: "follow",
                customer_id: customerId,
                merchant_id: merchantId,
                created_at: at,
                [GSI.GSI1.pk]: indexKeys.merchantFollowers(merchantId),
                [GSI.GSI1.sk]: `C#${customerId}`,
              },
              // Idempotent: a repeat keeps the first follow time.
              ConditionExpression: "attribute_not_exists(#pk)",
              ExpressionAttributeNames: { "#pk": PK },
            }),
          ),
        );
      } catch (error) {
        if (!isConditionFailed(error)) throw error;
      }
    },

    async removeFollow(customerId, merchantId) {
      await write(() => doc.send(new DeleteCommand({ TableName: tableName, Key: keys.follow(customerId, merchantId) })));
    },

    async listFollowedMerchantIds(customerId) {
      const rows = await queryPartition(keys.followPartition(customerId));
      return newestFirst(rows as unknown as { created_at: string; merchant_id: string }[]).map((r) => r.merchant_id);
    },

    async listFollowerIds(merchantId) {
      const rows = await queryIndex("GSI1", indexKeys.merchantFollowers(merchantId), { newestFirst: false });
      return rows.map((row) => row.customer_id as string);
    },

    /* Notifications -------------------------------------------------- */

    async createNotification(record) {
      const item = notificationItem(record);
      if (record.dedupe_key === null) {
        await putNew(item, "notification", record.id);
        return { notification: structuredClone(record), created: true };
      }
      const markerKey = keys.notificationDedupe(record.customer_id, record.dedupe_key);
      for (let attempt = 0; attempt < MAX_RACE_RETRIES; attempt++) {
        const outcome = await createUnique(item, {
          ...markerKey,
          [TYPE_ATTR]: "unique_notification",
          notification_id: record.id,
        });
        if (outcome === "created") return { notification: structuredClone(record), created: true };
        if (outcome === "entity_exists") throw new Error(`dynamodb store: notification ${record.id} already exists`);
        const marker = await getItem(markerKey);
        const existing = marker ? await getRecord<NotificationRecord>(keys.notification(marker.notification_id as string)) : null;
        if (existing) return { notification: existing, created: false };
        await backoff(attempt);
      }
      throw new Error(`dynamodb store: notification dedupe ${record.dedupe_key} points at a missing notification`);
    },

    async getNotification(id) {
      return getRecord<NotificationRecord>(keys.notification(id));
    },

    async listNotificationsByCustomer(customerId, options) {
      const since = options?.since;
      return toRecords<NotificationRecord>(
        await queryIndex("GSI1", indexKeys.customerNotifications(customerId), {
          newestFirst: true,
          // Sort keys are `<utcKey(created_at)>#<id>`, so "greater than the bare
          // utcKey" keeps every notification created at or after `since`.
          ...(since !== undefined ? { after: utcKey(since) } : {}),
        }),
      );
    },

    async markNotificationRead(id) {
      return updateExisting<NotificationRecord>(keys.notification(id), { read: true });
    },

    /* Suggestion state ----------------------------------------------- */

    async putSuggestionState(record: SuggestionStateRecord) {
      await write(() =>
        doc.send(
          new PutCommand({
            TableName: tableName,
            Item: { ...record, ...keys.suggestion(record.merchant_id, record.id), [TYPE_ATTR]: "suggestion_state" },
          }),
        ),
      );
    },

    async getSuggestionState(merchantId, id) {
      return getRecord<SuggestionStateRecord>(keys.suggestion(merchantId, id));
    },

    async listSuggestionStates(merchantId) {
      return toRecords<SuggestionStateRecord>(await queryPartition(keys.suggestionPartition(merchantId)));
    },
  };

  /** Patch an existing item's fields; null if it does not exist. */
  async function updateExisting<T>(key: Key, fields: Item): Promise<T | null> {
    if (Object.keys(fields).length === 0) return getRecord<T>(key);
    const e = new Expr();
    const set = Object.entries(fields).map(([name, value]) => `${e.name(name)} = ${e.value(value)}`);
    try {
      const out = await write(() =>
        doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key,
            UpdateExpression: updateExpression(set),
            ConditionExpression: `attribute_exists(${e.name(PK)})`,
            ReturnValues: "ALL_NEW",
            ...e.params(),
          }),
        ),
      );
      return toRecord<T>(out.Attributes as Item);
    } catch (error) {
      if (isConditionFailed(error)) return null;
      throw error;
    }
  }

  return store;
}

function cancellationCodes(error: unknown, count: number): string[] {
  const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
  return Array.from({ length: count }, (_, i) => reasons[i]?.Code ?? "None");
}
