import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { nonEmptyString } from "../validation/primitives";

export type RecordWithId = { id: string };
export type Page<T> = { items: T[]; nextCursor?: string };
export type IndexName = "merchant_id-index" | "deal_id-index" | "customer_id-index";
export class Repository {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly table: string) {}
  async get<T extends RecordWithId>(id: string): Promise<T | undefined> {
    nonEmptyString(id, "id");
    const result = await this.client.send(new GetCommand({ TableName: this.table, Key: { id }, ConsistentRead: true }));
    return result.Item as T | undefined;
  }
  async create<T extends RecordWithId>(item: T): Promise<void> {
    nonEmptyString(item.id, "id");
    await this.client.send(new PutCommand({ TableName: this.table, Item: item, ConditionExpression: "attribute_not_exists(id)" }));
  }
  async query<T extends RecordWithId>(index: IndexName, value: string, limit = 25, cursor?: string): Promise<Page<T>> {
    nonEmptyString(value, "index value");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be 1–100");
    const field = index.replace(/-index$/, "");
    let key: Record<string, string> | undefined;
    if (cursor) {
      if (cursor.length > 4096) throw new Error("Invalid cursor");
      try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (decoded.table !== this.table || decoded.index !== index || decoded.value !== value ||
            !decoded.key || typeof decoded.key.id !== "string" || decoded.key[field] !== value ||
            Object.keys(decoded.key).some(k => k !== "id" && k !== field)) throw new Error();
        key = decoded.key;
      } catch { throw new Error("Invalid cursor"); }
    }
    const result = await this.client.send(new QueryCommand({
      TableName: this.table, IndexName: index,
      KeyConditionExpression: "#field = :value", ExpressionAttributeNames: { "#field": field },
      ExpressionAttributeValues: { ":value": value }, Limit: limit, ExclusiveStartKey: key,
    }));
    return { items: (result.Items ?? []) as T[], nextCursor: result.LastEvaluatedKey ?
      Buffer.from(JSON.stringify({ table: this.table, index, value, key: result.LastEvaluatedKey })).toString("base64url") : undefined };
  }
}
