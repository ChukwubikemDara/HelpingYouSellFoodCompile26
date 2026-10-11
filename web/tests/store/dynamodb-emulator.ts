/**
 * Local DynamoDB for tests: dynalite in-process, plus an emulation of
 * TransactWriteItems, which dynalite 4 does not implement.
 *
 * How the emulation works (test-only, never shipped):
 * - The store's DynamoDBClient gets a request handler that runs every request
 *   one at a time (a global lock), so no request ever sees a half-applied
 *   transaction.
 * - A TransactWriteItems request is split into its Put/Update/Delete actions.
 *   Each runs against dynalite with its own ConditionExpression (so dynalite
 *   evaluates the real expressions). If any condition fails, every applied
 *   action is rolled back from a snapshot and the client receives a
 *   TransactionCanceledException with one CancellationReasons entry per
 *   action, as DynamoDB sends it.
 * - Like DynamoDB, it rejects two actions on the same item and more than 100
 *   actions. ConditionCheck actions and TransactGetItems are not emulated and
 *   fail loudly (the driver uses neither).
 *
 * What it cannot show: real DynamoDB's TransactionConflict cancellations under
 * contention (the lock serializes everything). The driver retries those; run
 * the suite against a real table (DYNAMODB_IT_TABLE) to cover them.
 */
import { createRequire } from "node:module";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";

type DynaliteFactory = (options: Record<string, unknown>) => Server;

/** dynalite, or null when it is not installed. */
export function loadDynalite(): DynaliteFactory | null {
  try {
    return createRequire(import.meta.url)("dynalite") as DynaliteFactory;
  } catch {
    return null;
  }
}

export interface LocalDynamo {
  endpoint: string;
  /** Client with emulated transactions. Give this one to the store. */
  client: DynamoDBClient;
  /** Plain client straight to dynalite (table setup, inspection). */
  raw: DynamoDBClient;
  /** X-Amz-Target operation names the store's client has sent, e.g. "Query". */
  operations: Set<string>;
  close(): Promise<void>;
}

const LOCAL = { region: "us-east-1", credentials: { accessKeyId: "local", secretAccessKey: "local" } };

export async function startLocalDynamo(
  dynalite: DynaliteFactory,
  keyAttributes: readonly string[] = ["PK", "SK"],
): Promise<LocalDynamo> {
  const server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}`;
  const raw = new DynamoDBClient({ ...LOCAL, endpoint });
  const client = new DynamoDBClient({ ...LOCAL, endpoint });
  const operations = new Set<string>();
  installTransactionEmulator(client, raw, keyAttributes, operations);
  return {
    endpoint,
    client,
    raw,
    operations,
    async close() {
      client.destroy();
      raw.destroy();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/* ------------------------------------------------------------------ */

interface HttpRequestLike {
  headers: Record<string, string>;
  body?: unknown;
}

interface HttpResponseLike {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

interface HttpHandlerLike {
  handle(request: HttpRequestLike, options?: unknown): Promise<{ response: unknown }>;
  destroy?(): void;
  updateHttpClientConfig?(key: never, value: never): void;
  httpHandlerConfigs?(): unknown;
}

type Av = Record<string, AttributeValue>;

interface ActionSpec {
  TableName: string;
  Item?: Av;
  Key?: Av;
  UpdateExpression?: string;
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Av;
}

type ActionKind = "Put" | "Update" | "Delete" | "ConditionCheck";

function installTransactionEmulator(
  client: DynamoDBClient,
  raw: DynamoDBClient,
  keyAttributes: readonly string[],
  operations: Set<string>,
): void {
  const config = client.config as unknown as { requestHandler: HttpHandlerLike };
  const inner = config.requestHandler;
  if (!inner || typeof inner.handle !== "function") {
    throw new Error("dynamodb emulator: the client has no request handler to wrap");
  }

  let tail: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };

  config.requestHandler = {
    handle: (request, options) =>
      oneAtATime(async () => {
        const target = header(request.headers, "x-amz-target") ?? "";
        const operation = target.slice(target.indexOf(".") + 1);
        operations.add(operation);
        if (operation === "TransactWriteItems") {
          return { response: await transactWrite(JSON.parse(bodyText(request.body))) };
        }
        if (operation === "TransactGetItems") {
          return { response: error("ValidationException", "TransactGetItems is not emulated") };
        }
        return inner.handle(request, options);
      }),
    destroy: () => inner.destroy?.(),
    updateHttpClientConfig: (key, value) => inner.updateHttpClientConfig?.(key, value),
    httpHandlerConfigs: () => inner.httpHandlerConfigs?.() ?? {},
  };

  async function transactWrite(body: { TransactItems?: Partial<Record<ActionKind, ActionSpec>>[] }) {
    const items = body.TransactItems ?? [];
    if (items.length === 0 || items.length > 100) {
      return error("ValidationException", `TransactItems must hold 1 to 100 actions; got ${items.length}`);
    }
    const ops: { kind: ActionKind; spec: ActionSpec; key: Av }[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const kinds = Object.keys(item) as ActionKind[];
      if (kinds.length !== 1) return error("ValidationException", "Each TransactItem must hold exactly one action");
      const kind = kinds[0];
      const spec = item[kind] as ActionSpec;
      if (kind === "ConditionCheck") return error("ValidationException", "ConditionCheck is not emulated");
      const source = kind === "Put" ? spec.Item : spec.Key;
      if (!source) return error("ValidationException", `${kind} without ${kind === "Put" ? "Item" : "Key"}`);
      const key: Av = {};
      for (const name of keyAttributes) {
        if (source[name] === undefined) return error("ValidationException", `${kind} is missing key attribute ${name}`);
        key[name] = source[name];
      }
      const id = `${spec.TableName}|${JSON.stringify(key)}`;
      if (seen.has(id)) {
        return error("ValidationException", "Transaction request cannot include multiple operations on one item");
      }
      seen.add(id);
      ops.push({ kind, spec, key });
    }

    const applied: { table: string; key: Av; before: Av | null }[] = [];
    const reasons: { Code: string; Message?: string }[] = [];
    let fatal: unknown = null;
    for (const op of ops) {
      const before =
        (await raw.send(new GetItemCommand({ TableName: op.spec.TableName, Key: op.key, ConsistentRead: true }))).Item ??
        null;
      const expressions = {
        ConditionExpression: op.spec.ConditionExpression,
        ExpressionAttributeNames: op.spec.ExpressionAttributeNames,
        ExpressionAttributeValues: op.spec.ExpressionAttributeValues,
      };
      try {
        if (op.kind === "Put") {
          await raw.send(new PutItemCommand({ TableName: op.spec.TableName, Item: op.spec.Item, ...expressions }));
        } else if (op.kind === "Update") {
          await raw.send(
            new UpdateItemCommand({
              TableName: op.spec.TableName,
              Key: op.key,
              UpdateExpression: op.spec.UpdateExpression,
              ...expressions,
            }),
          );
        } else {
          await raw.send(new DeleteItemCommand({ TableName: op.spec.TableName, Key: op.key, ...expressions }));
        }
        applied.push({ table: op.spec.TableName, key: op.key, before });
        reasons.push({ Code: "None" });
      } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
          reasons.push({ Code: "ConditionalCheckFailed", Message: "The conditional request failed" });
        } else {
          fatal = e;
          break;
        }
      }
    }

    const cancelled = fatal !== null || reasons.some((r) => r.Code !== "None");
    if (cancelled) {
      for (const a of applied.reverse()) {
        if (a.before) await raw.send(new PutItemCommand({ TableName: a.table, Item: a.before }));
        else await raw.send(new DeleteItemCommand({ TableName: a.table, Key: a.key }));
      }
    }
    if (fatal !== null) {
      const e = fatal as { name?: string; message?: string };
      return error(e.name ?? "InternalServerError", e.message ?? "emulated transaction failed");
    }
    if (cancelled) {
      return error(
        "TransactionCanceledException",
        `Transaction cancelled, please refer cancellation reasons for specific reasons [${reasons.map((r) => r.Code).join(", ")}]`,
        { CancellationReasons: reasons },
      );
    }
    return json(200, {});
  }
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const match = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return match === undefined ? undefined : headers[match];
}

function bodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  throw new Error("dynamodb emulator: unexpected request body type");
}

function json(statusCode: number, body: unknown): HttpResponseLike {
  return {
    statusCode,
    headers: { "content-type": "application/x-amz-json-1.0", "x-amzn-requestid": "local-emulator" },
    body: new TextEncoder().encode(JSON.stringify(body)),
  };
}

function error(type: string, message: string, extra: Record<string, unknown> = {}): HttpResponseLike {
  return json(400, {
    __type: `com.amazonaws.dynamodb.v20120810#${type}`,
    message,
    Message: message,
    ...extra,
  });
}
