import { getDbClient } from "./client";
import { getDbConfig } from "./config";
import { Repository } from "./repository";
export function repositories() {
  const client = getDbClient(); const { tables } = getDbConfig();
  return {
    merchants: new Repository(client, tables.merchants), deals: new Repository(client, tables.deals),
    reservations: new Repository(client, tables.reservations), customers: new Repository(client, tables.customers),
  };
}
