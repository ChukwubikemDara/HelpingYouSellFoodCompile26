import { DeleteCommand, GetCommand, PutCommand, ScanCommand, type ScanCommandOutput, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
export class Store {
  constructor(public readonly db: DynamoDBDocumentClient) {}
  async get<T>(table: string, id: string): Promise<T | undefined> {
    return (await this.db.send(new GetCommand({ TableName: table, Key: { id }, ConsistentRead: true }))).Item as T | undefined;
  }
  async put(table: string, item: object, onlyNew = false) {
    await this.db.send(new PutCommand({ TableName: table, Item: item,
      ...(onlyNew ? { ConditionExpression: "attribute_not_exists(id)" } : {}) }));
  }
  async remove(table: string, id: string) { await this.db.send(new DeleteCommand({ TableName: table, Key: { id } })); }
  // Bounded pages internally; full collection is acceptable only for this small hackathon MVP.
  async all<T>(table: string): Promise<T[]> {
    const items: T[] = []; let key: Record<string, unknown> | undefined;
    do {
      const page: ScanCommandOutput = await this.db.send(new ScanCommand({ TableName: table, ConsistentRead: true, Limit: 100, ExclusiveStartKey: key }));
      items.push(...(page.Items ?? []) as T[]); key = page.LastEvaluatedKey;
    } while (key);
    return items;
  }
}
