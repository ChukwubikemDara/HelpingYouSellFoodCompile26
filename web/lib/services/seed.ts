/**
 * Demo data over the Store interface (works with any driver).
 *
 * - One merchant account and its merchant: a bakery in downtown State College
 *   with a five-item menu.
 * - Two live deals whose pickup window is open now (pickup_start <= now <
 *   pickup_end), with allergens set.
 * - One customer account.
 *
 * Idempotent: accounts, the merchant and the customer are reused when they
 * exist, and a deal is only created when the merchant has no open live deal
 * with that title. Uses lib/auth/password directly (no session needed).
 */
import { addMinutes, localDateOf, now, roundUpToMinutes, toIso, toMs } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/auth/password";
import type { DealRecord, MerchantRecord, Store } from "@/lib/store/types";

export const SEED_MERCHANT = {
  email: "demo-merchant@example.com",
  password: "demo-merchant-pass",
} as const;

export const SEED_CUSTOMER = {
  name: "Sam",
  phone: "+18145550123",
  password: "demo-customer-pass",
} as const;

const SEED_MERCHANT_PROFILE = {
  name: "Example Bakery",
  category: "bakery",
  address: "123 S Allen St, State College, PA 16801",
  // Downtown State College (S Allen St and College Ave).
  lat: 40.7944,
  lng: -77.8606,
  phone: "+18145550100",
  closes_at: "18:00",
  default_discount_pct: 50,
  menu: [
    { name: "Butter croissant", price_cents: 400 },
    { name: "Chocolate croissant", price_cents: 450 },
    { name: "Blueberry muffin", price_cents: 350 },
    { name: "Baguette", price_cents: 500 },
    { name: "Cinnamon roll", price_cents: 425 },
  ],
} as const;

interface SeedDealSpec {
  title: string;
  items: { name: string; qty: number }[];
  original_price_cents: number;
  deal_price_cents: number;
  quantity_total: number;
  allergens: string[];
  note: string | null;
  /** Pickup window length from now. */
  minutes_open: number;
}

const SEED_DEALS: SeedDealSpec[] = [
  {
    title: "Croissants (2-pack)",
    items: [{ name: "Butter croissant", qty: 2 }],
    original_price_cents: 800,
    deal_price_cents: 400,
    quantity_total: 6,
    allergens: ["wheat", "milk", "egg"],
    note: "Baked this morning.",
    minutes_open: 180,
  },
  {
    title: "Blueberry muffin",
    items: [{ name: "Blueberry muffin", qty: 1 }],
    original_price_cents: 350,
    deal_price_cents: 175,
    quantity_total: 4,
    allergens: ["wheat", "milk", "egg"],
    note: null,
    minutes_open: 240,
  },
];

export interface SeedResult {
  merchant: { email: string; password: string; id: string };
  customer: { phone: string; password: string; id: string };
  deals: { id: string; title: string; created: boolean }[];
}

async function ensureMerchant(store: Store, at: string): Promise<MerchantRecord> {
  let account = await store.getMerchantAccountByEmail(SEED_MERCHANT.email);
  if (!account) {
    const created = await store.createMerchantAccount({
      id: newId("ma"),
      email: SEED_MERCHANT.email,
      password_hash: await hashPassword(SEED_MERCHANT.password),
      created_at: at,
    });
    account = created.ok ? created.value : await store.getMerchantAccountByEmail(SEED_MERCHANT.email);
    if (!account) throw new Error("seed: could not create the merchant account");
  }
  const existing = await store.getMerchantByOwner(account.id);
  if (existing) return existing;
  const created = await store.createMerchant({
    id: newId("m"),
    owner_account_id: account.id,
    ...SEED_MERCHANT_PROFILE,
    menu: SEED_MERCHANT_PROFILE.menu.map((item) => ({ ...item })),
    plan_status: "none",
    created_at: at,
  });
  if (created.ok) return created.value;
  const merchant = await store.getMerchantByOwner(account.id);
  if (!merchant) throw new Error("seed: could not create the merchant");
  return merchant;
}

async function ensureCustomer(store: Store, at: string): Promise<string> {
  const existing = await store.getCustomerByPhone(SEED_CUSTOMER.phone);
  if (existing) return existing.id;
  const created = await store.createCustomer({
    id: newId("c"),
    name: SEED_CUSTOMER.name,
    phone: SEED_CUSTOMER.phone,
    password_hash: await hashPassword(SEED_CUSTOMER.password),
    expo_push_token: null,
    created_at: at,
  });
  if (created.ok) return created.value.id;
  const customer = await store.getCustomerByPhone(SEED_CUSTOMER.phone);
  if (!customer) throw new Error("seed: could not create the customer");
  return customer.id;
}

/** Seed the store. Safe to run more than once. */
export async function seedStore(store: Store, at: Date = now()): Promise<SeedResult> {
  const atIso = toIso(at);
  const merchant = await ensureMerchant(store, atIso);
  const customerId = await ensureCustomer(store, atIso);

  const open = (await store.listOpenDeals({ pickupEndAfter: atIso })).filter(
    (d) => d.merchant_id === merchant.id && toMs(d.pickup_start) <= at.getTime(),
  );
  const deals: SeedResult["deals"] = [];
  for (const spec of SEED_DEALS) {
    const existing = open.find((d) => d.title === spec.title);
    if (existing) {
      deals.push({ id: existing.id, title: existing.title, created: false });
      continue;
    }
    const record: Omit<DealRecord, "version"> = {
      id: newId("d"),
      merchant_id: merchant.id,
      title: spec.title,
      items: spec.items.map((item) => ({ ...item })),
      original_price_cents: spec.original_price_cents,
      deal_price_cents: spec.deal_price_cents,
      kind: "surplus",
      quantity_total: spec.quantity_total,
      quantity_left: spec.quantity_total,
      max_per_customer: 2,
      unsold_action: "none",
      // Window open now: started at the current second, ends on a 5-minute mark.
      pickup_start: atIso,
      pickup_end: toIso(roundUpToMinutes(addMinutes(at, spec.minutes_open), 5)),
      allergens: [...spec.allergens],
      note: spec.note,
      photo_url: null,
      status: "live",
      created_at: atIso,
      published_at: atIso,
      cancelled_at: null,
      local_date: localDateOf(at),
      price_lowered_by_suggestion: false,
    };
    const created = await store.createDeal(record);
    deals.push({ id: created.id, title: created.title, created: true });
  }

  return {
    merchant: { email: SEED_MERCHANT.email, password: SEED_MERCHANT.password, id: merchant.id },
    customer: { phone: SEED_CUSTOMER.phone, password: SEED_CUSTOMER.password, id: customerId },
    deals,
  };
}
