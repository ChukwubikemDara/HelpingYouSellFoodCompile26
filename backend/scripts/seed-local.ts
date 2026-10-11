import { getDbClient } from "../lib/db/client";
import { getDbConfig } from "../lib/db/config";
import { Accounts } from "../lib/auth/accounts";
import { Store } from "../lib/db/store";
import { Marketplace } from "../lib/services/marketplace";
import type { DealRecord } from "../lib/db/models";
const config = getDbConfig();
if (!config.endpoint || !["localhost", "127.0.0.1"].includes(new URL(config.endpoint).hostname)) throw new Error("Demo seed requires a local endpoint.");
const store = new Store(getDbClient()), accounts = new Accounts(store, config.tables), market = new Marketplace(store, config.tables);
const email = "demo@lastcall.local", phone = "+18145550123", password = "DemoFood26!";
let token: string;
try { token = await accounts.merchantSignin({ email, password }); }
catch (error) { if ((error as { code?: string }).code !== "BAD_CREDENTIALS") throw error; token = await accounts.merchantSignup({ email, password }); }
let account = await accounts.merchant(token);
if (!account.merchant_id) {
  await market.onboard(account, { name: "Demo Bakery", category: "bakery", address: "123 College Ave, State College, PA", lat: 40.7934, lng: -77.86,
    phone: "+18145550100", closes_at: "23:59", default_discount_pct: 50, menu: [{ name: "Croissant", price_cents: 400 }] });
  account = await accounts.merchant(token);
}
try { await accounts.customerSignin({ phone, password }); }
catch (error) { if ((error as { code?: string }).code !== "BAD_CREDENTIALS") throw error; await accounts.customerSignup({ name: "Demo Student", phone, password }); }
// Recreate an expired demo listing under a new id; preserve prior reservations.
const listed = (await market.deals()).some(d => d.merchant_id === account.merchant_id && d.pickup_end && Date.parse(d.pickup_end) > Date.now());
if (!listed) {
  const now = new Date().toISOString();
  const d = await market.create(account, { title: "Croissants (2-pack)", items: [{ name: "Croissant", qty: 2 }], original_price_cents: 800, deal_price_cents: 400,
    kind: "surplus", quantity_total: 10, max_per_customer: 2, pickup_start: now, pickup_end: new Date(Date.now() + 7200000).toISOString(), allergens: ["wheat", "milk"], note: "Local demo listing." });
  await market.publish(account, d.id);
}
console.log("Local demo accounts and listing are ready.");
