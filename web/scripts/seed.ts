/**
 * npm run seed: seed demo data into the store STORE_DRIVER selects
 * (memory by default, or dynamodb with DYNAMODB_TABLE).
 *
 * With the memory driver the data lives only in this process, so this run
 * only checks the seed. To get seeded data in a dev server, start it with
 * SEED_ON_START=1 (lib/services/db.ts seeds the in-memory store on the first
 * request).
 *
 * Safe to run twice.
 */
import { getStore, storeDriver } from "@/lib/store";
import { seedStore } from "@/lib/services/seed";

async function main(): Promise<void> {
  const driver = storeDriver();
  const result = await seedStore(getStore());
  console.log(`seed: driver ${driver}`);
  console.log(`  merchant  email ${result.merchant.email}  password ${result.merchant.password}  (merchant id ${result.merchant.id})`);
  console.log(`  customer  phone ${result.customer.phone}  password ${result.customer.password}`);
  for (const deal of result.deals) {
    console.log(`  deal      ${deal.id}  ${deal.title}  ${deal.created ? "created" : "already live"}`);
  }
  if (driver === "memory") {
    console.log("  note: the memory driver keeps data only in this process. Start the dev server with SEED_ON_START=1 instead.");
  }
}

main().catch((error: unknown) => {
  console.error("seed failed:", error);
  process.exit(1);
});
