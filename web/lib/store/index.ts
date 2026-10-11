/**
 * Data access entry point. Route handlers and services call getStore() and
 * never import a driver directly.
 *
 * STORE_DRIVER selects the driver (read in lib/config.ts): "memory" (the
 * default outside production; tests and local dev) or "dynamodb" (the
 * default in production; DYNAMODB_TABLE, optional DYNAMODB_ENDPOINT, region
 * from APP_AWS_REGION / AWS_REGION).
 */
import { STORE_DRIVERS, storeDriver, type StoreDriver } from "@/lib/config";
import { awsRegion, isProduction } from "@/lib/env";
import { createDynamoStore } from "./dynamodb";
import { getMemoryStore, resetMemoryStore } from "./memory";
import type { Store } from "./types";

export type * from "./types";
export { createMemoryStore } from "./memory";
export {
  countNoShows,
  deriveDealStatus,
  deriveReservationStatus,
  isBlocked,
  noShowAt,
} from "./derive";

export { STORE_DRIVERS, storeDriver, type StoreDriver };

const holder = globalThis as typeof globalThis & {
  __appStore?: Store;
  __appStoreWarned?: boolean;
};

/** The process-wide store for the configured driver. Memoized on globalThis. */
export function getStore(): Store {
  if (holder.__appStore) return holder.__appStore;
  const driver = storeDriver();
  if (driver === "dynamodb") {
    const tableName = process.env.DYNAMODB_TABLE?.trim();
    if (!tableName) throw new Error("DYNAMODB_TABLE is required when STORE_DRIVER=dynamodb");
    holder.__appStore = createDynamoStore({
      tableName,
      region: awsRegion(),
      endpoint: process.env.DYNAMODB_ENDPOINT?.trim() || undefined,
    });
  } else {
    if (isProduction() && !holder.__appStoreWarned) {
      holder.__appStoreWarned = true;
      console.warn(
        "[store] STORE_DRIVER=memory in production: data lives in this process only and is lost on restart.",
      );
    }
    holder.__appStore = getMemoryStore();
  }
  return holder.__appStore;
}

/** Use this store for every getStore() call until resetStore(). Test use only. */
export function setStore(store: Store): void {
  holder.__appStore = store;
}

/** Forget the chosen store (and empty the shared in-memory store). Test use only. */
export function resetStore(): void {
  delete holder.__appStore;
  resetMemoryStore();
}
