import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getDbConfig } from "./config";

export function createDbClient() {
  const { region, endpoint } = getDbConfig();
  // SDK credential chain: local AWS profile or deployed IAM role.
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region, endpoint }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}
let client: DynamoDBDocumentClient | undefined;
export function getDbClient() {
  return client ??= createDbClient();
}
