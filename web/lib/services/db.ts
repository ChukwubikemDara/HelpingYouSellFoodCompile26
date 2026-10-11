/**
 * The store for services and lib/auth.
 *
 * `db()` returns getStore(). When SEED_ON_START=1 and the in-memory driver is
 * in use, the first call seeds the demo data once per process (the memory
 * store starts empty on every dev server start). The seed is idempotent, so
 * concurrent first requests share one run.
 */
import { getStore, storeDriver, type Store } from "@/lib/store";
import { seedStore } from "./seed";

const holder = globalThis as typeof globalThis & { __appSeedOnStart?: Promise<void> };

function seedOnStartEnabled(): boolean {
  return process.env.SEED_ON_START === "1";
}

export async function db(): Promise<Store> {
  const store = getStore();
  if (seedOnStartEnabled() && storeDriver() === "memory") {
    if (!holder.__appSeedOnStart) {
      holder.__appSeedOnStart = seedStore(store)
        .then((result) => {
          console.log(
            `[seed] SEED_ON_START: merchant ${result.merchant.email} / ${result.merchant.password}, ` +
              `customer ${result.customer.phone} / ${result.customer.password}`,
          );
        })
        .catch((error: unknown) => {
          // Let a later request try again.
          holder.__appSeedOnStart = undefined;
          console.error("[seed] SEED_ON_START failed", error);
        });
    }
    await holder.__appSeedOnStart;
  }
  return store;
}

/** Forget that the seed ran (tests that reset the store). */
export function resetSeedOnStart(): void {
  holder.__appSeedOnStart = undefined;
}
