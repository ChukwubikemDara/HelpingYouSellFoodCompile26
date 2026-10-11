import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, waitUntilTableExists } from "@aws-sdk/client-dynamodb";
import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb";
import { getDbConfig } from "../lib/db/config";
const { region, endpoint, tables } = getDbConfig();
const client = new DynamoDBClient({ region, endpoint });
for (const [table, fields] of [[tables.merchants, []], [tables.deals, ["merchant_id"]],
  [tables.reservations, ["deal_id", "customer_id", "merchant_id"]], [tables.customers, []]] as [string, string[]][]) {
  const input: CreateTableCommandInput = {
    TableName: table, BillingMode: "PAY_PER_REQUEST",
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: ["id", ...fields].map(AttributeName => ({ AttributeName, AttributeType: "S" })),
    ...(fields.length ? { GlobalSecondaryIndexes: fields.map(field => ({
      IndexName: `${field}-index`, KeySchema: [{ AttributeName: field, KeyType: "HASH" }], Projection: { ProjectionType: "ALL" },
    })) } : {}),
  };
  try { await client.send(new CreateTableCommand(input)); }
  catch (error) { if (!(error instanceof Error) || error.name !== "ResourceInUseException") throw error; }
  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: table });
  const { Table } = await client.send(new DescribeTableCommand({ TableName: table }));
  const validKey = (keys: { AttributeName?: string; KeyType?: string }[] | undefined, field: string) =>
    keys?.length === 1 && keys[0].AttributeName === field && keys[0].KeyType === "HASH";
  if (!validKey(Table?.KeySchema, "id") || fields.some(field => {
    const index = Table?.GlobalSecondaryIndexes?.find(i => i.IndexName === `${field}-index`);
    return !validKey(index?.KeySchema, field) || index?.Projection?.ProjectionType !== "ALL" || index?.IndexStatus !== "ACTIVE";
  }) || ["id", ...fields].some(field => !Table?.AttributeDefinitions?.some(a => a.AttributeName === field && a.AttributeType === "S"))) {
    throw new Error(`Existing table ${table} has an incompatible schema or inactive indexes`);
  }
  console.log(`Ready: ${table}`);
}
