/**
 * Load the demo restaurants in scripts/data/demo-restaurants.json into a
 * running server through the public HTTP API only.
 *
 *   npx tsx scripts/import-demo-restaurants.ts <api_base_url> --credentials <file.json>
 *   e.g. npx tsx scripts/import-demo-restaurants.ts https://example.com/api --credentials ~/demo-logins.json
 *
 * Per restaurant:
 *   1. Sign in as <slug>@lastcall-demo.com; sign up when the account does not exist yet.
 *      Passwords live in the --credentials file (never in git). A missing
 *      entry gets a new random password, written back to that file.
 *   2. GET /me. Not onboarded: POST /merchants. Onboarded: PATCH /merchants/{id}
 *      so the store details match the data file.
 *   3. GET /merchants/{id}/deals for today. An item whose title already has a
 *      live or sold_out deal today is skipped, so the script can run again.
 *   4. For each other item: POST /merchants/{id}/drafts with the item photo
 *      (the only API path that sets Deal.photo_url; POST /deals and PATCH
 *      ignore photo_url), keep the first draft and cancel any extra ones,
 *      then PATCH every draft field from the data file and publish. When the
 *      drafts call returns no draft, fall back to POST /deals without a photo.
 *
 * Deal values: deal price = regular x (100 - pct)%, rounded down to a multiple
 * of 25 cents, where pct is item.discount_pct when set, else
 * default_discount_pct; pickup from now (rounded up to 5 min) until
 * deal_defaults.pickup_end_local today (America/New_York), or until the store's
 * closes_at when deal_defaults.pickup_end_at_close_min_lead is set and closing
 * is at least that many minutes away; kind = surplus when pickup_end is within
 * 2 h of closes_at, else timed.
 *
 * Datasets: scripts/data/demo-restaurants.json (default) and
 * scripts/data/demo-cafes-bakeries.json (pass it with --data).
 *
 * Photos are read from photo_base_url + item.photo (public S3 objects).
 * Exits 0 when every item is live (published now or already), 1 otherwise.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Item = {
  name: string;
  photo: string;
  price_cents: number;
  quantity_total: number;
  discount_pct?: number;
  allergens: string[];
  note: string;
};
type Restaurant = {
  slug: string;
  name: string;
  category: "bakery" | "cafe" | "restaurant";
  address: string;
  lat: number;
  lng: number;
  phone: string;
  closes_at: string;
  items: Item[];
};
type DataFile = {
  photo_base_url: string;
  default_discount_pct: number;
  deal_defaults: { pickup_end_local: string; max_per_customer: number; pickup_end_at_close_min_lead?: number };
  restaurants: Restaurant[];
};
type Credentials = Record<string, { email: string; password: string }>;
type Deal = { id: string; title: string; status: string; photo_url: string | null };

const BANNED = /leftover|expiring|waste|about to be thrown out|\btoss|\bbin\b|rescued/i;
const TZ = "America/New_York";
const EMAIL_DOMAIN = "lastcall-demo.com";

function usage(message: string): never {
  console.error(message);
  console.error("usage: npx tsx scripts/import-demo-restaurants.ts <api_base_url> --credentials <file.json> [--data <file.json>]");
  process.exit(2);
}

function parseArgs(argv: string[]) {
  let base: string | null = null;
  let credentials: string | null = null;
  let data = path.resolve("scripts/data/demo-restaurants.json"); // run from the repo root
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--credentials") credentials = argv[++i] ?? usage("--credentials needs a path");
    else if (arg === "--data") data = argv[++i] ?? usage("--data needs a path");
    else if (!arg.startsWith("--") && base === null) base = arg;
    else usage(`unknown argument: ${arg}`);
  }
  if (!base) usage("missing api_base_url");
  if (!credentials) usage("missing --credentials");
  return { base: base.replace(/\/+$/, ""), credentials, data };
}

/* ---------------- time ---------------- */

/** Offset of America/New_York at the given instant, as "-04:00". */
function nyOffset(at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = name?.match(/GMT([+-]\d{2}:\d{2})/);
  return match ? match[1] : "-05:00";
}

function nyParts(at: Date): { date: string; hh: number; mm: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hh: Number(parts.hour), mm: Number(parts.minute) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Now rounded up to the next 5 minutes, as local ISO with offset. */
function pickupStart(now: Date): string {
  const rounded = new Date(Math.ceil(now.getTime() / (5 * 60_000)) * 5 * 60_000);
  const { date, hh, mm } = nyParts(rounded);
  return `${date}T${pad(hh)}:${pad(mm)}:00${nyOffset(rounded)}`;
}

function todayAt(now: Date, hhmm: string): string {
  return `${nyParts(now).date}T${hhmm}:00${nyOffset(now)}`;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/* ---------------- http ---------------- */

class Session {
  cookie: string | null = null;
  constructor(private base: string) {}

  async call<T>(method: string, route: string, body?: unknown): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(this.base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.getSetCookie().find((c) => /^[^=]+=[^;]+/.test(c));
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 300) };
    }
    return { status: res.status, data: data as T };
  }

  async ok<T>(method: string, route: string, body?: unknown): Promise<T> {
    const { status, data } = await this.call<T>(method, route, body);
    if (status < 200 || status >= 300) throw new Error(`${method} ${route} -> ${status} ${JSON.stringify(data)}`);
    return data;
  }
}

const errorCode = (data: unknown): string | undefined =>
  (data as { error?: { code?: string } } | null)?.error?.code;

/* ---------------- steps ---------------- */

async function signInOrUp(s: Session, email: string, password: string): Promise<"signed_in" | "signed_up"> {
  const signin = await s.call("POST", "/auth/merchant/signin", { email, password });
  if (signin.status === 200) return "signed_in";
  if (errorCode(signin.data) !== "BAD_CREDENTIALS") throw new Error(`signin ${email} -> ${signin.status} ${JSON.stringify(signin.data)}`);
  const signup = await s.call("POST", "/auth/merchant/signup", { email, password });
  if (signup.status === 200 || signup.status === 201) return "signed_up";
  throw new Error(`signup ${email} -> ${signup.status} ${JSON.stringify(signup.data)} (account exists with another password?)`);
}

async function photoBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = JSON.parse(readFileSync(args.data, "utf8")) as DataFile;
  const creds: Credentials = existsSync(args.credentials) ? JSON.parse(readFileSync(args.credentials, "utf8")) : {};
  const now = new Date();
  const today = nyParts(now).date;
  const start = pickupStart(now);
  const nowMinutes = nyParts(now).hh * 60 + nyParts(now).mm;
  const pct = data.default_discount_pct;
  let failures = 0;
  const report: string[] = [];

  for (const r of data.restaurants) {
    for (const text of [r.name, ...r.items.flatMap((i) => [i.name, i.note])]) {
      if (BANNED.test(text)) throw new Error(`banned word in "${text}"`);
    }
  }

  await Promise.all(
    data.restaurants.map(async (r) => {
      const log = (line: string) => console.log(`[${r.slug}] ${line}`);
      if (!creds[r.slug]) {
        creds[r.slug] = { email: `${r.slug}@${EMAIL_DOMAIN}`, password: randomBytes(18).toString("base64url") };
        writeFileSync(args.credentials, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
      }
      const { email, password } = creds[r.slug];
      const s = new Session(args.base);
      log(`${await signInOrUp(s, email, password)} as ${email}`);

      const store = {
        name: r.name,
        category: r.category,
        address: r.address,
        phone: r.phone,
        closes_at: r.closes_at,
        default_discount_pct: pct,
        menu: r.items.map((i) => ({ name: i.name, price_cents: i.price_cents })),
        lat: r.lat,
        lng: r.lng,
      };
      const me = await s.ok<{ merchant: { id: string } | null }>("GET", "/me");
      let merchantId: string;
      if (me.merchant) {
        merchantId = me.merchant.id;
        await s.ok("PATCH", `/merchants/${merchantId}`, store);
        log(`merchant ${merchantId} updated`);
      } else {
        merchantId = (await s.ok<{ id: string }>("POST", "/merchants", store)).id;
        log(`merchant ${merchantId} created`);
      }

      const existing = await s.ok<{ deals: Deal[] }>("GET", `/merchants/${merchantId}/deals?date=${today}`);
      const liveTitles = new Set(existing.deals.filter((d) => d.status === "live" || d.status === "sold_out").map((d) => d.title));
      const lead = data.deal_defaults.pickup_end_at_close_min_lead;
      const endLocal =
        lead !== undefined && minutesOf(r.closes_at) - nowMinutes >= lead ? r.closes_at : data.deal_defaults.pickup_end_local;
      const end = todayAt(now, endLocal);
      const closeGap = Math.abs(minutesOf(r.closes_at) - minutesOf(endLocal));
      const kind = closeGap <= 120 ? "surplus" : "timed";

      for (const item of r.items) {
        if (liveTitles.has(item.name)) {
          log(`skip "${item.name}": already live today`);
          continue;
        }
        try {
          const itemPct = item.discount_pct ?? pct;
          const dealPrice = Math.floor((item.price_cents * (100 - itemPct)) / 100 / 25) * 25;
          if (dealPrice <= 0 || dealPrice >= item.price_cents) throw new Error(`bad deal price ${dealPrice}`);
          const fields = {
            title: item.name,
            items: [{ name: item.name, qty: 1 }],
            original_price_cents: item.price_cents,
            deal_price_cents: dealPrice,
            kind,
            quantity_total: item.quantity_total,
            max_per_customer: data.deal_defaults.max_per_customer,
            pickup_start: start,
            pickup_end: end,
            allergens: item.allergens,
            note: item.note,
          };

          let dealId: string | null = null;
          const photo = await photoBase64(data.photo_base_url + item.photo);
          if (photo) {
            const res = await s.call<{ drafts?: { deal: Deal }[] }>("POST", `/merchants/${merchantId}/drafts`, {
              text: `${item.name}. Regular price $${(item.price_cents / 100).toFixed(2)}.`,
              photo_base64: photo,
            });
            const drafts = res.status === 200 ? (res.data.drafts ?? []) : [];
            const keep = drafts.find((d) => d.deal.photo_url) ?? null;
            for (const d of drafts) if (d !== keep) await s.call("POST", `/deals/${d.deal.id}/cancel`);
            if (keep) dealId = keep.deal.id;
            else log(`"${item.name}": drafts gave ${drafts.length} draft(s) with a photo (status ${res.status}); creating without photo`);
          } else {
            log(`"${item.name}": photo not reachable; creating without photo`);
          }

          if (dealId) await s.ok("PATCH", `/deals/${dealId}`, fields);
          else dealId = (await s.ok<Deal>("POST", "/deals", fields)).id;
          const live = await s.ok<Deal>("POST", `/deals/${dealId}/publish`);
          log(`live ${live.id} "${live.title}" photo=${live.photo_url ? "yes" : "no"}`);
        } catch (error) {
          failures++;
          log(`FAIL "${item.name}": ${(error as Error).message}`);
        }
      }

      const after = await s.ok<{ deals: Deal[] }>("GET", `/merchants/${merchantId}/deals?date=${today}`);
      const liveCount = after.deals.filter((d) => d.status === "live" || d.status === "sold_out").length;
      report.push(`${r.name}: ${email} merchant ${merchantId}, ${liveCount} live deal(s) today`);
    }),
  );

  console.log("\n" + report.join("\n"));
  console.log(`logins: ${args.credentials}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
