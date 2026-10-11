export function getDbConfig(env: Record<string, string | undefined> = process.env) {
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Missing environment variable: ${key}`);
    return value;
  };
  return {
    region: required("AWS_REGION"), endpoint: env.DYNAMODB_ENDPOINT || undefined,
    tables: {
      merchants: required("DYNAMODB_MERCHANTS_TABLE"), deals: required("DYNAMODB_DEALS_TABLE"),
      reservations: required("DYNAMODB_RESERVATIONS_TABLE"), customers: required("DYNAMODB_CUSTOMERS_TABLE"),
    },
  };
}
export type DbConfig = ReturnType<typeof getDbConfig>;
