/**
 * End-to-end check of the API, playing the merchant and the customers through
 * the public HTTP API only (plus one test-only hook, below).
 *
 *   npx tsx scripts/e2e.ts [base_url]        (default http://localhost:3000)
 *   npm run e2e -- http://localhost:3000
 *
 * Flow: merchant signs up -> onboards with a menu and a location -> asks for
 * drafts from "6 croissants, 3 baguettes, closing at 6" -> publish is refused
 * while allergens is null -> sets allergens -> publishes -> a customer signs
 * up -> follows the merchant -> the merchant publishes the second draft -> the
 * customer lists deals with lat/lng and sort=distance -> reserves -> a second
 * customer tries to reserve more than is left -> cancel returns units -> the
 * merchant sees the reservations -> redeems the code -> the summary shows the
 * pickup -> the customer's notifications include the new deal. Then: price on
 * a live deal goes down but not up; a cancelled deal cancels its reservations
 * and notifies; a blocked customer cannot reserve; sign-out. The last step
 * cancels the test merchant's remaining deal, so a run against a shared
 * server leaves nothing in the public deal list.
 *
 * Every response is checked against the object shapes in
 * docs/api-contract.md: every field present (no extra ones), right type,
 * nullable fields present as null, enums and formats, plus the cross-field
 * rules the contract states. The shapes are written out here from the
 * contract, not imported from the app, so the app's own types cannot hide a
 * mismatch.
 *
 * Blocked customer: the contract gives no way to make a no-show without
 * waiting until pickup_end + 15 min. The script calls the test-only hook
 * POST /api/e2e/no-shows, which exists only when the server runs with
 * E2E_HOOKS=1 and NODE_ENV is not production (lib/services/e2e-hooks.ts). It
 * creates a separate test store with a deal whose pickup window has already
 * ended and two reservations by the customer on it. Without the hook (any
 * production server) that step is reported as SKIP.
 *
 * Emails and phone numbers are unique per run, so the script can run any
 * number of times against the same server. Prints one line per step and exits
 * 0 when no step failed, 1 when any failed, 2 when the server is unreachable.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from the wire, checked by the shape specs below */

/* ------------------------------------------------------------------ */
/* Shapes from docs/api-contract.md                                    */
/* ------------------------------------------------------------------ */

type Spec =
  | { t: "string"; pattern?: RegExp; what?: string; allowEmpty?: boolean }
  | { t: "int"; min?: number; max?: number }
  | { t: "number"; min?: number; max?: number }
  | { t: "boolean" }
  | { t: "true" }
  | { t: "enum"; values: readonly string[] }
  | { t: "nullable"; inner: Spec }
  | { t: "array"; of: Spec }
  | { t: "object"; fields: Record<string, Spec> }
  | { t: "record" };

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?[+-]\d{2}:\d{2}$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const PICKUP_CODE = /^\d{4}$/;

const str = (pattern?: RegExp, what?: string): Spec => ({ t: "string", pattern, what });
/** A billing link: a URL, or "" while the stub has no page to link to (the portal then shows no link). */
const link: Spec = { t: "string", allowEmpty: true };
const int = (min?: number, max?: number): Spec => ({ t: "int", min, max });
const num = (min?: number, max?: number): Spec => ({ t: "number", min, max });
const bool: Spec = { t: "boolean" };
const oneOf = (...values: string[]): Spec => ({ t: "enum", values });
const nullable = (inner: Spec): Spec => ({ t: "nullable", inner });
const arr = (of: Spec): Spec => ({ t: "array", of });
const obj = (fields: Record<string, Spec>): Spec => ({ t: "object", fields });
const iso = str(ISO_WITH_OFFSET, "ISO 8601 time with offset");
const id = str(/^\S+$/, "id string");

const CUSTOMER = obj({
  id,
  name: str(),
  phone: str(E164, "E.164 phone"),
  no_show_count: int(0),
  blocked: bool,
  created_at: iso,
});

const MERCHANT_CATEGORY = oneOf("bakery", "cafe", "restaurant");

const MERCHANT = obj({
  id,
  name: str(),
  category: MERCHANT_CATEGORY,
  address: str(),
  lat: nullable(num(-90, 90)),
  lng: nullable(num(-180, 180)),
  phone: str(E164, "E.164 phone"),
  closes_at: str(LOCAL_TIME, "HH:MM"),
  default_discount_pct: int(10, 90),
  menu: arr(obj({ name: str(), price_cents: int(0) })),
  plan_status: oneOf("none", "active"),
});

const DEAL = obj({
  id,
  merchant_id: id,
  merchant: obj({
    id,
    name: str(),
    category: MERCHANT_CATEGORY,
    address: str(),
    lat: nullable(num(-90, 90)),
    lng: nullable(num(-180, 180)),
  }),
  title: str(),
  items: arr(obj({ name: str(), qty: int(1) })),
  original_price_cents: nullable(int(1)),
  deal_price_cents: nullable(int(1)),
  kind: oneOf("surplus", "timed"),
  quantity_total: nullable(int(1)),
  quantity_left: nullable(int(0)),
  max_per_customer: int(1),
  unsold_action: oneOf("none", "donated"),
  pickup_start: iso,
  pickup_end: nullable(iso),
  allergens: nullable(arr(str())),
  note: nullable(str()),
  photo_url: nullable(str()),
  status: oneOf("draft", "live", "sold_out", "expired", "cancelled"),
  created_at: iso,
  published_at: nullable(iso),
  distance_m: nullable(int(0)),
});

const MISSING_FIELDS = ["original_price_cents", "deal_price_cents", "quantity_total", "pickup_end", "allergens"] as const;

const DRAFT = obj({
  deal: DEAL,
  missing_fields: arr(oneOf(...MISSING_FIELDS)),
  price_source: nullable(oneOf("stated", "menu", "history")),
  agent_notes: str(),
  estimate: nullable(
    obj({
      units: int(1),
      deal_price_cents: int(1),
      assumed_sell_through: num(0, 1),
      expected_recovered_cents: int(0),
      if_discarded_cents: int(0),
    }),
  ),
});

const RESERVATION = obj({
  id,
  deal_id: id,
  deal: DEAL,
  customer_id: id,
  customer_name: str(),
  customer_phone: str(E164, "E.164 phone"),
  quantity: int(1),
  unit_price_cents: int(1),
  total_cents: int(1),
  payment_method: str(),
  pickup_code: str(PICKUP_CODE, "4-digit code"),
  status: oneOf("reserved", "picked_up", "cancelled", "no_show"),
  created_at: iso,
});

const NOTIFICATION = obj({
  id,
  type: oneOf("new_deal", "deal_cancelled", "pickup_reminder"),
  title: str(),
  body: str(),
  deal_id: nullable(id),
  reservation_id: nullable(id),
  read: bool,
  created_at: iso,
});

const SUGGESTION = obj({
  id,
  type: oneOf("list_now", "lower_price"),
  deal_id: nullable(id),
  message: str(),
  proposed: nullable(obj({ deal_price_cents: int(1) })),
  basis: { t: "record" },
});

const SUMMARY = obj({
  date: str(LOCAL_DATE, "YYYY-MM-DD"),
  units_listed: int(0),
  units_picked_up: int(0),
  units_no_show: int(0),
  units_unsold: int(0),
  recovered_cents: int(0),
  platform_fee_cents: int(0),
  if_discarded_cents: int(0),
});

const OK = obj({ ok: { t: "true" } });
const ERROR_ENVELOPE = obj({ error: obj({ code: str(), message: str(/\S/, "non-empty message") }) });

const ERROR_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  BAD_CREDENTIALS: 401,
  PLAN_REQUIRED: 402,
  CUSTOMER_BLOCKED: 403,
  NOT_FOUND: 404,
  CODE_INVALID: 404,
  SOLD_OUT: 409,
  DEAL_NOT_LIVE: 409,
  CODE_ALREADY_USED: 409,
  ACCOUNT_EXISTS: 409,
  VALIDATION: 422,
};

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Problems with `value` against `spec`, as "path: problem" strings. */
function shapeProblems(value: unknown, spec: Spec, path: string): string[] {
  switch (spec.t) {
    case "nullable":
      return value === null ? [] : shapeProblems(value, spec.inner, path);
    case "string":
      if (typeof value !== "string") return [`${path}: expected string, got ${describe(value)}`];
      if (value.length === 0) return spec.allowEmpty ? [] : [`${path}: empty string`];
      if (spec.pattern && !spec.pattern.test(value)) return [`${path}: "${value}" is not ${spec.what ?? spec.pattern}`];
      return [];
    case "int":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return [`${path}: expected number, got ${describe(value)}`];
      if (spec.t === "int" && !Number.isInteger(value)) return [`${path}: expected integer, got ${value}`];
      if (spec.min !== undefined && value < spec.min) return [`${path}: ${value} < ${spec.min}`];
      if (spec.max !== undefined && value > spec.max) return [`${path}: ${value} > ${spec.max}`];
      return [];
    }
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path}: expected boolean, got ${describe(value)}`];
    case "true":
      return value === true ? [] : [`${path}: expected true, got ${JSON.stringify(value)}`];
    case "enum":
      return typeof value === "string" && spec.values.includes(value)
        ? []
        : [`${path}: expected one of ${spec.values.join("|")}, got ${JSON.stringify(value)}`];
    case "array":
      if (!Array.isArray(value)) return [`${path}: expected array, got ${describe(value)}`];
      return value.flatMap((item, i) => shapeProblems(item, spec.of, `${path}[${i}]`));
    case "record":
      return value !== null && typeof value === "object" && !Array.isArray(value)
        ? []
        : [`${path}: expected object, got ${describe(value)}`];
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return [`${path}: expected object, got ${describe(value)}`];
      }
      const record = value as Record<string, unknown>;
      const problems: string[] = [];
      for (const [key, fieldSpec] of Object.entries(spec.fields)) {
        if (!(key in record)) problems.push(`${path}.${key}: missing`);
        else if (record[key] === undefined) problems.push(`${path}.${key}: undefined`);
        else problems.push(...shapeProblems(record[key], fieldSpec, `${path}.${key}`));
      }
      for (const key of Object.keys(record)) {
        if (!(key in spec.fields)) problems.push(`${path}.${key}: not in the contract`);
      }
      return problems;
    }
  }
}

/* ---- rules the contract states across fields ---------------------- */

function ms(value: string): number {
  return Date.parse(value);
}

function dealRuleProblems(deal: any, path: string): string[] {
  const p: string[] = [];
  if (deal.merchant?.id !== deal.merchant_id) p.push(`${path}.merchant.id != merchant_id`);
  const published = deal.status === "live" || deal.status === "sold_out" || deal.status === "expired";
  if (deal.status === "draft" && deal.published_at !== null) p.push(`${path}: draft with published_at`);
  if (published) {
    if (deal.published_at === null) p.push(`${path}: ${deal.status} deal with published_at null`);
    for (const field of ["original_price_cents", "deal_price_cents", "quantity_total", "quantity_left", "pickup_end", "allergens"]) {
      if (deal[field] === null) p.push(`${path}.${field}: null on a ${deal.status} deal`);
    }
    if (deal.deal_price_cents !== null && deal.original_price_cents !== null && deal.deal_price_cents >= deal.original_price_cents) {
      p.push(`${path}: deal_price_cents ${deal.deal_price_cents} not below original_price_cents ${deal.original_price_cents}`);
    }
  }
  if (deal.status === "sold_out" && deal.quantity_left !== 0) p.push(`${path}: sold_out with quantity_left ${deal.quantity_left}`);
  if (deal.status === "live" && !(deal.quantity_left > 0)) p.push(`${path}: live with quantity_left ${deal.quantity_left}`);
  if (deal.quantity_left !== null && deal.quantity_total !== null && deal.quantity_left > deal.quantity_total) {
    p.push(`${path}: quantity_left ${deal.quantity_left} > quantity_total ${deal.quantity_total}`);
  }
  if (deal.pickup_end !== null && ms(deal.pickup_end) <= ms(deal.pickup_start) && deal.status !== "draft") {
    p.push(`${path}: pickup_end not after pickup_start`);
  }
  if (deal.distance_m !== null && (deal.merchant?.lat === null || deal.merchant?.lng === null)) {
    p.push(`${path}: distance_m set for a merchant without a location`);
  }
  return p;
}

function draftRuleProblems(draft: any, path: string): string[] {
  const p = dealRuleProblems(draft.deal, `${path}.deal`);
  if (draft.deal.status !== "draft") p.push(`${path}.deal.status is ${draft.deal.status}, expected draft`);
  for (const field of MISSING_FIELDS) {
    const isNull = draft.deal[field] === null;
    const listed = draft.missing_fields.includes(field);
    if (listed && !isNull) p.push(`${path}: ${field} listed in missing_fields but set in deal`);
    if (!listed && isNull) p.push(`${path}: ${field} is null in deal but not in missing_fields`);
  }
  const canEstimate = draft.deal.quantity_total !== null && draft.deal.deal_price_cents !== null;
  if (canEstimate !== (draft.estimate !== null)) {
    p.push(`${path}.estimate: ${draft.estimate === null ? "null" : "set"} with quantity ${draft.deal.quantity_total} and deal price ${draft.deal.deal_price_cents}`);
  }
  if (draft.estimate) {
    if (draft.estimate.units !== draft.deal.quantity_total) p.push(`${path}.estimate.units != deal.quantity_total`);
    if (draft.estimate.deal_price_cents !== draft.deal.deal_price_cents) p.push(`${path}.estimate.deal_price_cents != deal.deal_price_cents`);
  }
  return p;
}

function reservationRuleProblems(r: any, path: string): string[] {
  const p = dealRuleProblems(r.deal, `${path}.deal`);
  if (r.deal.id !== r.deal_id) p.push(`${path}.deal.id != deal_id`);
  if (r.total_cents !== r.quantity * r.unit_price_cents) p.push(`${path}: total_cents ${r.total_cents} != quantity x unit_price_cents`);
  if (r.deal.distance_m !== null) p.push(`${path}.deal.distance_m should be null outside GET /deals`);
  return p;
}

function suggestionRuleProblems(s: any, path: string): string[] {
  const p: string[] = [];
  if (s.type === "list_now" && (s.deal_id !== null || s.proposed !== null)) p.push(`${path}: list_now needs deal_id and proposed null`);
  if (s.type === "lower_price") {
    if (s.deal_id === null || s.proposed === null) p.push(`${path}: lower_price needs deal_id and proposed`);
    for (const key of ["reserved", "total", "minutes_left"]) {
      if (!Number.isInteger(s.basis?.[key])) p.push(`${path}.basis.${key}: expected integer`);
    }
  }
  return p;
}

function newestFirstProblems(items: any[], path: string): string[] {
  for (let i = 1; i < items.length; i++) {
    if (ms(items[i - 1].created_at) < ms(items[i].created_at)) return [`${path}: not newest first at [${i}]`];
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

class StepFailure extends Error {}
class StepSkip extends Error {}

function fail(reason: string): never {
  throw new StepFailure(reason);
}

function expect(condition: unknown, reason: string): asserts condition {
  if (!condition) fail(reason);
}

function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new StepFailure(`needs ${what} from an earlier step`);
  return value;
}

type Outcome = "PASS" | "FAIL" | "SKIP";
const outcomes: Outcome[] = [];

async function step(name: string, run: () => Promise<string | void>): Promise<boolean> {
  const n = String(outcomes.length + 1).padStart(2, "0");
  try {
    const detail = await run();
    outcomes.push("PASS");
    console.log(`PASS  ${n}  ${name}${detail ? `  (${detail})` : ""}`);
    return true;
  } catch (error) {
    if (error instanceof StepSkip) {
      outcomes.push("SKIP");
      console.log(`SKIP  ${n}  ${name}: ${error.message}`);
      return false;
    }
    outcomes.push("FAIL");
    const reason = error instanceof StepFailure ? error.message : `unexpected error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
    console.log(`FAIL  ${n}  ${name}: ${reason}`);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

interface Res {
  method: string;
  path: string;
  status: number;
  body: any;
  headers: Headers;
}

interface CallOptions {
  body?: unknown;
  token?: string;
  cookie?: string;
  headers?: Record<string, string>;
}

let API = "";

async function call(method: string, path: string, opts: CallOptions = {}): Promise<Res> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  Object.assign(headers, opts.headers);
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: any = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  return { method, path, status: res.status, body, headers: res.headers };
}

function label(res: Res): string {
  return `${res.method} ${res.path}`;
}

function brief(body: unknown): string {
  const text = JSON.stringify(body);
  return text === undefined ? "no JSON body" : text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

/** A 2xx (or exactly `status`) response whose body matches `spec`. Returns the body. */
function expectOk(res: Res, spec: Spec, status?: number): any {
  if (status !== undefined) expect(res.status === status, `${label(res)} returned ${res.status}, expected ${status}: ${brief(res.body)}`);
  else expect(res.status >= 200 && res.status < 300, `${label(res)} returned ${res.status}: ${brief(res.body)}`);
  expect(res.body !== undefined, `${label(res)} returned no JSON body`);
  const problems = shapeProblems(res.body, spec, "body");
  expect(problems.length === 0, `${label(res)} shape: ${problems.slice(0, 5).join("; ")}`);
  return res.body;
}

/** An error response with this contract code, its status, and the error envelope shape. */
function expectError(res: Res, code: string): string {
  const status = ERROR_STATUS[code];
  expect(res.status === status, `${label(res)} returned ${res.status}, expected ${status} ${code}: ${brief(res.body)}`);
  const problems = shapeProblems(res.body, ERROR_ENVELOPE, "body");
  expect(problems.length === 0, `${label(res)} error envelope: ${problems.join("; ")}`);
  expect(res.body.error.code === code, `${label(res)} code ${res.body.error.code}, expected ${code}`);
  return res.body.error.message;
}

function rules(problems: string[]): void {
  expect(problems.length === 0, problems.slice(0, 5).join("; "));
}

/* ------------------------------------------------------------------ */
/* Time and data helpers                                               */
/* ------------------------------------------------------------------ */

const NY = "America/New_York";

function nyParts(date: Date): { date: string; time: string; offset: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const offset = get("timeZoneName").replace("GMT", "") || "+00:00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}:${get("second")}`, offset };
}

/** ISO 8601 with the New York offset, seconds precision ("2026-10-11T17:30:00-04:00"). */
function nyIso(date: Date): string {
  const p = nyParts(date);
  return `${p.date}T${p.time}${p.offset}`;
}

/** The instant of HH:MM on a New York local date. */
function nyInstant(localDate: string, hhmm: string): Date {
  const guess = new Date(`${localDate}T${hhmm}:00Z`);
  const offset = nyParts(guess).offset; // "-04:00"
  return new Date(`${localDate}T${hhmm}:00${offset}`);
}

function floorMinutes(date: Date, step: number): Date {
  const stepMs = step * 60_000;
  return new Date(Math.floor(date.getTime() / stepMs) * stepMs);
}

function cents(value: number): string {
  return `$${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function randomDigits(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += String(Math.floor(Math.random() * 10));
  return out;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const base = (process.argv[2] ?? process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  API = base.endsWith("/api") ? base : `${base}/api`;

  const run = `${Date.now().toString(36)}${randomDigits(3)}`;
  const password = "e2e-password-1";
  const merchantEmail = `e2e-${run}@example.com`;
  const phones = new Set<string>();
  while (phones.size < 3) phones.add(`+1814${randomDigits(7)}`);
  const [phone1, phone2, phone3] = [...phones];
  const storeLat = Math.round((40.7934 + (Math.random() - 0.5) * 0.02) * 1e6) / 1e6;
  const storeLng = Math.round((-77.86 + (Math.random() - 0.5) * 0.02) * 1e6) / 1e6;
  const menu = [
    { name: "Croissant", price_cents: 400 },
    { name: "Muffin", price_cents: 350 },
    { name: "Bagel", price_cents: 250 },
    { name: "Latte", price_cents: 550 },
    { name: "Cookie", price_cents: 200 },
  ];

  console.log(`E2E against ${API} (run ${run})`);
  try {
    await call("GET", "/health");
  } catch (error) {
    console.log(`FAIL  00  server reachable: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  // State shared between steps.
  let cookie: string | null = null;
  let merchant: any = null;
  let croissant: any = null;
  let baguette: any = null;
  let token1: string | null = null;
  let token2: string | null = null;
  let token3: string | null = null;
  let customer1: any = null;
  let customer3: any = null;
  let reservation1: any = null;
  let reservation2: any = null;
  let pickupWindow: { start: string; end: string } | null = null;
  let laterDeal: any = null;
  let laterReservation: any = null;

  const merchantCall = (method: string, path: string, body?: unknown) =>
    call(method, path, { body, cookie: need(cookie, "the merchant session cookie") });

  /* ---- merchant: sign up and onboard ------------------------------ */

  await step("merchant signs up (email + password) and gets an httpOnly session cookie", async () => {
    const res = await call("POST", "/auth/merchant/signup", { body: { email: merchantEmail, password } });
    expectOk(res, OK);
    const setCookie = res.headers.getSetCookie().find((c) => /^[^=]+=[^;]+/.test(c));
    expect(setCookie, "no Set-Cookie header");
    expect(/;\s*httponly/i.test(setCookie), `cookie is not HttpOnly: ${setCookie}`);
    cookie = setCookie.split(";")[0];
    return cookie.split("=")[0];
  });

  await step("a second sign-up with the same email gets ACCOUNT_EXISTS", async () => {
    expectError(await call("POST", "/auth/merchant/signup", { body: { email: merchantEmail, password } }), "ACCOUNT_EXISTS");
  });

  await step("GET /me before onboarding returns { merchant: null }", async () => {
    const body = expectOk(await merchantCall("GET", "/me"), obj({ merchant: nullable(MERCHANT) }));
    expect(body.merchant === null, `merchant is ${brief(body.merchant)}`);
  });

  await step("merchant onboards with a menu and a location (POST /merchants -> 201)", async () => {
    const input = {
      name: `E2E Bakery ${run}`,
      category: "bakery",
      address: "123 S Allen St, State College, PA",
      phone: "+18145550100",
      closes_at: "18:00",
      default_discount_pct: 50,
      menu,
      lat: storeLat,
      lng: storeLng,
    };
    const body = expectOk(await merchantCall("POST", "/merchants", input), MERCHANT, 201);
    for (const [key, value] of Object.entries(input)) {
      expect(JSON.stringify(body[key]) === JSON.stringify(value), `${key} is ${JSON.stringify(body[key])}, sent ${JSON.stringify(value)}`);
    }
    merchant = body;
    return `${body.id}, ${body.lat}, ${body.lng}, plan_status ${body.plan_status}`;
  });

  await step("GET /me and GET /merchants/{id} return the merchant", async () => {
    const m = need(merchant, "the merchant");
    const me = expectOk(await merchantCall("GET", "/me"), obj({ merchant: nullable(MERCHANT) }));
    expect(JSON.stringify(me.merchant) === JSON.stringify(m), `GET /me differs: ${brief(me.merchant)}`);
    const byId = expectOk(await merchantCall("GET", `/merchants/${m.id}`), MERCHANT);
    expect(JSON.stringify(byId) === JSON.stringify(m), `GET /merchants/{id} differs: ${brief(byId)}`);
  });

  /* ---- merchant: drafts from text --------------------------------- */

  await step('merchant asks for drafts from "6 croissants, 3 baguettes, closing at 6"', async () => {
    const m = need(merchant, "the merchant");
    const res = await merchantCall("POST", `/merchants/${m.id}/drafts`, { text: "6 croissants, 3 baguettes, closing at 6" });
    const body = expectOk(res, obj({ drafts: arr(DRAFT) }));
    rules(body.drafts.flatMap((d: any, i: number) => draftRuleProblems(d, `drafts[${i}]`)));
    expect(body.drafts.length === 2, `expected 2 drafts, got ${body.drafts.length}: ${body.drafts.map((d: any) => d.deal.title).join(", ")}`);
    const c = body.drafts.find((d: any) => /croissant/i.test(d.deal.title));
    const b = body.drafts.find((d: any) => /baguette/i.test(d.deal.title));
    expect(c && b, `expected a croissant and a baguette draft, got ${body.drafts.map((d: any) => d.deal.title).join(", ")}`);

    // Spec case 1 (docs/agent-spec.md): Croissant qty 6, 400/200 from the menu; Baguette qty 3, prices null.
    expect(c.deal.quantity_total === 6, `croissant quantity_total ${c.deal.quantity_total}, expected 6`);
    expect(c.deal.original_price_cents === 400 && c.deal.deal_price_cents === 200, `croissant prices ${c.deal.original_price_cents}/${c.deal.deal_price_cents}, expected 400/200`);
    expect(c.price_source === "menu", `croissant price_source ${c.price_source}, expected menu`);
    expect(b.deal.quantity_total === 3, `baguette quantity_total ${b.deal.quantity_total}, expected 3`);
    expect(b.deal.original_price_cents === null && b.deal.deal_price_cents === null, "baguette prices should be null (not on the menu)");
    expect(b.price_source === null, `baguette price_source ${b.price_source}, expected null`);
    for (const d of [c, b]) {
      expect(d.deal.allergens === null && d.missing_fields.includes("allergens"), `${d.deal.title}: allergens must be null and missing (the agent never sets them)`);
      expect(d.deal.quantity_left === d.deal.quantity_total, `${d.deal.title}: quantity_left should mirror quantity_total while draft`);
    }
    expect(c.estimate?.expected_recovered_cents === 720 && c.estimate?.if_discarded_cents === 0, `croissant estimate ${brief(c.estimate)}, expected 720 recovered`);

    // "closing at 6" is 18:00 today while it is still before 6 PM in New York.
    const now = new Date();
    const local = nyParts(now);
    let timing = `now ${local.time.slice(0, 5)} New York`;
    if (local.time < "18:00") {
      const six = nyInstant(local.date, "18:00").getTime();
      for (const d of [c, b]) {
        expect(d.deal.pickup_end !== null && ms(d.deal.pickup_end) === six, `${d.deal.title}: pickup_end ${d.deal.pickup_end}, expected 18:00 today`);
        expect(d.deal.kind === "surplus", `${d.deal.title}: kind ${d.deal.kind}, expected surplus`);
      }
      timing += ", pickup_end 18:00, surplus";
    } else {
      timing += ", after 6 PM so pickup_end not checked";
    }
    croissant = c.deal;
    baguette = b.deal;
    return `Croissant qty 6 ${cents(400)}->${cents(200)} menu; Baguette qty 3 prices null; ${timing}`;
  });

  await step("the drafts are listed in GET /merchants/{id}/deals with status draft", async () => {
    const m = need(merchant, "the merchant");
    const body = expectOk(await merchantCall("GET", `/merchants/${m.id}/deals`), obj({ deals: arr(DEAL) }));
    rules(body.deals.flatMap((d: any, i: number) => dealRuleProblems(d, `deals[${i}]`)));
    for (const draft of [need(croissant, "the croissant draft"), need(baguette, "the baguette draft")]) {
      const listed = body.deals.find((d: any) => d.id === draft.id);
      expect(listed?.status === "draft", `${draft.title} is ${listed ? listed.status : "missing"}`);
    }
  });

  await step("publish is refused while allergens is null (422 VALIDATION)", async () => {
    const c = need(croissant, "the croissant draft");
    const message = expectError(await merchantCall("POST", `/deals/${c.id}/publish`), "VALIDATION");
    const after = expectOk(await call("GET", `/deals/${c.id}`, { cookie: need(cookie, "cookie") }), DEAL);
    expect(after.status === "draft", `deal is ${after.status} after a refused publish`);
    return message;
  });

  await step("merchant sets allergens, limit per customer and pickup window on the croissant draft (PATCH /deals/{id})", async () => {
    const c = need(croissant, "the croissant draft");
    const now = new Date();
    // Pick up from now (so redeem works right away) until the stated end, or 2 h from now when that is too close.
    const start = nyIso(floorMinutes(now, 1));
    const end =
      c.pickup_end !== null && ms(c.pickup_end) > now.getTime() + 45 * 60_000
        ? c.pickup_end
        : nyIso(floorMinutes(new Date(now.getTime() + 2 * 3600_000), 5));
    pickupWindow = { start, end };
    // The same body the portal's draft review sends.
    const patch = {
      title: c.title,
      original_price_cents: 400,
      deal_price_cents: 200,
      quantity_total: 6,
      // 5 per customer, so a request for 5 of the 4 left breaks only the "more than is left" rule.
      max_per_customer: 5,
      pickup_start: start,
      pickup_end: end,
      allergens: ["wheat", "milk", "egg"],
      note: null,
    };
    const body = expectOk(await merchantCall("PATCH", `/deals/${c.id}`, patch), DEAL);
    rules(dealRuleProblems(body, "deal"));
    expect(body.status === "draft", `status ${body.status}`);
    expect(JSON.stringify(body.allergens) === JSON.stringify(patch.allergens), `allergens ${brief(body.allergens)}`);
    expect(ms(body.pickup_start) === ms(start) && ms(body.pickup_end) === ms(end), `pickup window ${body.pickup_start} - ${body.pickup_end}`);
    expect(body.quantity_left === 6 && body.max_per_customer === 5, `quantity_left ${body.quantity_left}, max_per_customer ${body.max_per_customer}`);
    croissant = body;
    return `pickup ${body.pickup_start} - ${body.pickup_end}`;
  });

  await step("merchant publishes the croissant deal (draft -> live, published_at set)", async () => {
    const c = need(croissant, "the croissant draft");
    const body = expectOk(await merchantCall("POST", `/deals/${c.id}/publish`), DEAL);
    rules(dealRuleProblems(body, "deal"));
    expect(body.status === "live" && body.published_at !== null && body.quantity_left === 6, `status ${body.status}, published_at ${body.published_at}, quantity_left ${body.quantity_left}`);
    croissant = body;
  });

  await step("GET /deals (no sign-in) lists the live deal; only live and sold_out, ending soonest first", async () => {
    const c = need(croissant, "the croissant deal");
    const body = expectOk(await call("GET", "/deals"), obj({ deals: arr(DEAL) }));
    rules(body.deals.flatMap((d: any, i: number) => dealRuleProblems(d, `deals[${i}]`)));
    expect(body.deals.some((d: any) => d.id === c.id), "the croissant deal is not listed");
    const bad = body.deals.find((d: any) => d.status !== "live" && d.status !== "sold_out");
    expect(!bad, `listed a ${bad?.status} deal`);
    for (let i = 1; i < body.deals.length; i++) {
      expect(ms(body.deals[i - 1].pickup_end) <= ms(body.deals[i].pickup_end), `not sorted by pickup_end at [${i}]`);
    }
    expect(body.deals.every((d: any) => d.distance_m === null), "distance_m set without lat/lng");
    return `${body.deals.length} deals`;
  });

  await step("GET /deals filters by category and kind", async () => {
    const c = need(croissant, "the croissant deal");
    const bakery = expectOk(await call("GET", "/deals?category=bakery"), obj({ deals: arr(DEAL) }));
    expect(bakery.deals.some((d: any) => d.id === c.id), "category=bakery leaves out the bakery's deal");
    expect(bakery.deals.every((d: any) => d.merchant.category === "bakery"), "category=bakery lists another category");
    const cafe = expectOk(await call("GET", "/deals?category=cafe"), obj({ deals: arr(DEAL) }));
    expect(!cafe.deals.some((d: any) => d.id === c.id), "category=cafe lists the bakery's deal");
    const other = c.kind === "surplus" ? "timed" : "surplus";
    const sameKind = expectOk(await call("GET", `/deals?kind=${c.kind}`), obj({ deals: arr(DEAL) }));
    expect(sameKind.deals.some((d: any) => d.id === c.id) && sameKind.deals.every((d: any) => d.kind === c.kind), `kind=${c.kind} is wrong`);
    const otherKind = expectOk(await call("GET", `/deals?kind=${other}`), obj({ deals: arr(DEAL) }));
    expect(!otherKind.deals.some((d: any) => d.id === c.id), `kind=${other} lists a ${c.kind} deal`);
  });

  /* ---- customer 1: sign up, follow -------------------------------- */

  await step("customer 1 signs up (name, phone, password -> 201 { token, customer })", async () => {
    const body = expectOk(
      await call("POST", "/auth/customer/signup", { body: { name: "Sam E2E", phone: phone1, password } }),
      obj({ token: str(), customer: CUSTOMER }),
      201,
    );
    expect(body.customer.name === "Sam E2E" && body.customer.phone === phone1, `customer ${brief(body.customer)}`);
    expect(body.customer.no_show_count === 0 && body.customer.blocked === false, `new customer ${brief(body.customer)}`);
    token1 = body.token;
    customer1 = body.customer;
  });

  await step("customer 1 signs in with phone + password; a wrong password gets BAD_CREDENTIALS", async () => {
    const c = need(customer1, "customer 1");
    const body = expectOk(await call("POST", "/auth/customer/signin", { body: { phone: phone1, password } }), obj({ token: str(), customer: CUSTOMER }));
    expect(body.customer.id === c.id, "signed in as someone else");
    expectError(await call("POST", "/auth/customer/signin", { body: { phone: phone1, password: "wrong-password" } }), "BAD_CREDENTIALS");
    expectError(await call("POST", "/auth/customer/signup", { body: { name: "Again", phone: phone1, password } }), "ACCOUNT_EXISTS");
    const me = expectOk(await call("GET", "/customers/me", { token: body.token }), CUSTOMER);
    expect(me.id === c.id, "GET /customers/me with the sign-in token is someone else");
  });

  await step("customer 1 follows the merchant (POST /follows, GET /follows)", async () => {
    const m = need(merchant, "the merchant");
    const token = need(token1, "customer 1's token");
    expectOk(await call("POST", "/follows", { token, body: { merchant_id: m.id } }), OK);
    const body = expectOk(await call("GET", "/follows", { token }), obj({ merchant_ids: arr(id) }));
    expect(body.merchant_ids.includes(m.id), `merchant_ids ${brief(body.merchant_ids)}`);
  });

  /* ---- merchant: publish the second draft (followers are notified) */

  await step("merchant fills in the baguette draft (prices, allergens) and publishes it", async () => {
    const b = need(baguette, "the baguette draft");
    const window = need(pickupWindow, "the pickup window");
    const patch = {
      title: b.title,
      original_price_cents: 500,
      deal_price_cents: 250,
      quantity_total: 3,
      max_per_customer: 2,
      pickup_start: window.start,
      pickup_end: window.end,
      allergens: ["wheat"],
      note: null,
    };
    const patched = expectOk(await merchantCall("PATCH", `/deals/${b.id}`, patch), DEAL);
    expect(patched.status === "draft" && patched.deal_price_cents === 250, `after PATCH: ${patched.status}, ${patched.deal_price_cents}`);
    const body = expectOk(await merchantCall("POST", `/deals/${b.id}/publish`), DEAL);
    rules(dealRuleProblems(body, "deal"));
    expect(body.status === "live", `status ${body.status}`);
    baguette = body;
  });

  /* ---- customer 1: browse and reserve ----------------------------- */

  await step("customer lists deals with lat/lng and sort=distance (nearest first, distance_m set)", async () => {
    const c = need(croissant, "the croissant deal");
    const b = need(baguette, "the baguette deal");
    const body = expectOk(await call("GET", `/deals?lat=${storeLat}&lng=${storeLng}&sort=distance`), obj({ deals: arr(DEAL) }));
    rules(body.deals.flatMap((d: any, i: number) => dealRuleProblems(d, `deals[${i}]`)));
    let seenNull = false;
    for (let i = 0; i < body.deals.length; i++) {
      const d = body.deals[i];
      const located = d.merchant.lat !== null && d.merchant.lng !== null;
      expect(located === (d.distance_m !== null), `deals[${i}]: distance_m ${d.distance_m} for a merchant ${located ? "with" : "without"} a location`);
      if (d.distance_m === null) seenNull = true;
      else {
        expect(!seenNull, `deals[${i}]: a located deal after one with no location`);
        const expected = haversineMeters(storeLat, storeLng, d.merchant.lat, d.merchant.lng);
        expect(Math.abs(d.distance_m - expected) <= 2, `deals[${i}]: distance_m ${d.distance_m}, expected about ${Math.round(expected)}`);
        if (i > 0 && body.deals[i - 1].distance_m !== null) {
          expect(body.deals[i - 1].distance_m <= d.distance_m, `not sorted by distance at [${i}]`);
        }
      }
    }
    const firstTwo = body.deals.slice(0, 2).map((d: any) => d.id).sort();
    expect(JSON.stringify(firstTwo) === JSON.stringify([c.id, b.id].sort()), `the two deals at the customer's location are not first: ${body.deals.slice(0, 3).map((d: any) => `${d.title} ${d.distance_m}m`).join(", ")}`);
    return `${body.deals.length} deals, nearest ${body.deals[0].distance_m} m`;
  });

  await step("GET /deals/{id} returns the deal (distance_m null)", async () => {
    const c = need(croissant, "the croissant deal");
    const body = expectOk(await call("GET", `/deals/${c.id}`), DEAL);
    rules(dealRuleProblems(body, "deal"));
    expect(body.id === c.id && body.status === "live" && body.distance_m === null, `deal ${body.id} ${body.status} distance_m ${body.distance_m}`);
  });

  await step("customer 1 reserves 2 croissants (201; quantity_left 6 -> 4)", async () => {
    const c = need(croissant, "the croissant deal");
    const token = need(token1, "customer 1's token");
    const body = expectOk(await call("POST", "/reservations", { token, body: { deal_id: c.id, quantity: 2 } }), RESERVATION, 201);
    rules(reservationRuleProblems(body, "reservation"));
    const cust = need(customer1, "customer 1");
    expect(body.status === "reserved" && body.quantity === 2, `status ${body.status}, quantity ${body.quantity}`);
    expect(body.unit_price_cents === 200 && body.total_cents === 400, `unit ${body.unit_price_cents}, total ${body.total_cents}`);
    expect(body.customer_id === cust.id && body.customer_name === cust.name && body.customer_phone === cust.phone, "name/phone do not come from the account");
    expect(body.deal.quantity_left === 4, `deal.quantity_left ${body.deal.quantity_left}, expected 4`);
    reservation1 = body;
    return `code ${body.pickup_code}`;
  });

  await step("customer 1 sees the reservation (GET /reservations/{id}, GET /reservations newest first)", async () => {
    const r = need(reservation1, "customer 1's reservation");
    const token = need(token1, "customer 1's token");
    const one = expectOk(await call("GET", `/reservations/${r.id}`, { token }), RESERVATION);
    expect(one.id === r.id && one.status === "reserved" && one.pickup_code === r.pickup_code, `reservation ${brief(one)}`);
    const list = expectOk(await call("GET", "/reservations", { token }), obj({ reservations: arr(RESERVATION) }));
    rules([...list.reservations.flatMap((x: any, i: number) => reservationRuleProblems(x, `reservations[${i}]`)), ...newestFirstProblems(list.reservations, "reservations")]);
    expect(list.reservations.some((x: any) => x.id === r.id), "not in the list");
  });

  /* ---- customer 2: more than is left; cancel returns units -------- */

  await step("customer 2 signs up", async () => {
    const body = expectOk(
      await call("POST", "/auth/customer/signup", { body: { name: "Alex E2E", phone: phone2, password } }),
      obj({ token: str(), customer: CUSTOMER }),
      201,
    );
    token2 = body.token;
  });

  await step("customer 2 tries to reserve more than is left (5 of 4, limit 5) and gets SOLD_OUT", async () => {
    const c = need(croissant, "the croissant deal");
    const message = expectError(await call("POST", "/reservations", { token: need(token2, "customer 2's token"), body: { deal_id: c.id, quantity: 5 } }), "SOLD_OUT");
    const after = expectOk(await call("GET", `/deals/${c.id}`), DEAL);
    expect(after.quantity_left === 4, `quantity_left ${after.quantity_left} after a refused reserve`);
    return message;
  });

  await step("customer 2 reserves 1 and cancels it: the unit goes back (4 -> 3 -> 4)", async () => {
    const c = need(croissant, "the croissant deal");
    const token = need(token2, "customer 2's token");
    const r = expectOk(await call("POST", "/reservations", { token, body: { deal_id: c.id, quantity: 1 } }), RESERVATION, 201);
    expect(r.deal.quantity_left === 3, `quantity_left ${r.deal.quantity_left} after reserving 1, expected 3`);
    const cancelled = expectOk(await call("POST", `/reservations/${r.id}/cancel`, { token }), RESERVATION);
    rules(reservationRuleProblems(cancelled, "reservation"));
    expect(cancelled.status === "cancelled", `status ${cancelled.status}`);
    const after = expectOk(await call("GET", `/deals/${c.id}`), DEAL);
    expect(after.quantity_left === 4, `quantity_left ${after.quantity_left} after cancel, expected 4`);
    reservation2 = cancelled;
  });

  await step("a customer gets 404 for another customer's reservation", async () => {
    const r = need(reservation2, "customer 2's reservation");
    expectError(await call("GET", `/reservations/${r.id}`, { token: need(token1, "customer 1's token") }), "NOT_FOUND");
    expectError(await call("POST", `/reservations/${r.id}/cancel`, { token: need(token1, "customer 1's token") }), "NOT_FOUND");
    expectError(await call("GET", "/reservations"), "UNAUTHORIZED");
  });

  /* ---- merchant: reservations, redeem, summary -------------------- */

  await step("merchant sees the reservations (GET /merchants/{id}/reservations)", async () => {
    const m = need(merchant, "the merchant");
    const r1 = need(reservation1, "customer 1's reservation");
    const r2 = need(reservation2, "customer 2's reservation");
    const body = expectOk(await merchantCall("GET", `/merchants/${m.id}/reservations`), obj({ reservations: arr(RESERVATION) }));
    rules(body.reservations.flatMap((x: any, i: number) => reservationRuleProblems(x, `reservations[${i}]`)));
    const one = body.reservations.find((x: any) => x.id === r1.id);
    expect(one?.status === "reserved" && one.customer_name === r1.customer_name && one.quantity === 2, `customer 1's reservation: ${brief(one)}`);
    const two = body.reservations.find((x: any) => x.id === r2.id);
    expect(two?.status === "cancelled", `customer 2's reservation: ${two ? two.status : "missing"}`);
    expect(body.reservations.every((x: any) => x.deal.merchant_id === m.id), "lists another merchant's reservation");
    return `${body.reservations.length} reservations`;
  });

  await step("merchant redeems the pickup code (-> picked_up); again gets CODE_ALREADY_USED", async () => {
    const r = need(reservation1, "customer 1's reservation");
    const body = expectOk(await merchantCall("POST", "/reservations/redeem", { pickup_code: r.pickup_code }), RESERVATION);
    rules(reservationRuleProblems(body, "reservation"));
    expect(body.id === r.id && body.status === "picked_up", `redeemed ${body.id} ${body.status}`);
    expectError(await merchantCall("POST", "/reservations/redeem", { pickup_code: r.pickup_code }), "CODE_ALREADY_USED");
    const mine = expectOk(await call("GET", `/reservations/${r.id}`, { token: need(token1, "customer 1's token") }), RESERVATION);
    expect(mine.status === "picked_up", `customer sees ${mine.status}`);
  });

  await step("an unknown pickup code gets CODE_INVALID", async () => {
    const used = new Set([need(reservation1, "r1").pickup_code, need(reservation2, "r2").pickup_code]);
    let code = "0000";
    for (let i = 0; i < 10_000 && used.has(code); i++) code = String(i).padStart(4, "0");
    return expectError(await merchantCall("POST", "/reservations/redeem", { pickup_code: code }), "CODE_INVALID");
  });

  await step("summary shows the pickup (units, recovered amount, platform fee)", async () => {
    const m = need(merchant, "the merchant");
    const body = expectOk(await merchantCall("GET", `/merchants/${m.id}/summary`), SUMMARY);
    const today = nyParts(new Date()).date;
    expect(body.date === today, `date ${body.date}, expected ${today}`);
    expect(body.units_listed === 9, `units_listed ${body.units_listed}, expected 9 (6 + 3)`);
    expect(body.units_picked_up === 2, `units_picked_up ${body.units_picked_up}, expected 2`);
    expect(body.units_no_show === 0, `units_no_show ${body.units_no_show}`);
    expect(body.units_unsold === 7, `units_unsold ${body.units_unsold}, expected 7`);
    expect(body.recovered_cents === 400, `recovered_cents ${body.recovered_cents}, expected 400`);
    expect(body.platform_fee_cents > 0, `platform_fee_cents ${body.platform_fee_cents}: one picked_up reservation should count`);
    expect(body.if_discarded_cents === 0, `if_discarded_cents ${body.if_discarded_cents}`);
    return `listed 9, picked up 2, recovered ${cents(body.recovered_cents)}, fee ${cents(body.platform_fee_cents)}`;
  });

  /* ---- customer 1: notifications ---------------------------------- */

  await step("customer 1's notifications include the new deal (published after the follow)", async () => {
    const m = need(merchant, "the merchant");
    const b = need(baguette, "the baguette deal");
    const c = need(croissant, "the croissant deal");
    const token = need(token1, "customer 1's token");
    const body = expectOk(await call("GET", "/notifications", { token }), obj({ notifications: arr(NOTIFICATION) }));
    rules(newestFirstProblems(body.notifications, "notifications"));
    const newDeal = body.notifications.find((n: any) => n.type === "new_deal" && n.deal_id === b.id);
    expect(newDeal, `no new_deal for ${b.title}: ${brief(body.notifications)}`);
    expect(newDeal.title === m.name, `title "${newDeal.title}", expected the store name`);
    expect(newDeal.reservation_id === null && newDeal.read === false, `reservation_id ${newDeal.reservation_id}, read ${newDeal.read}`);
    const bodyPattern = new RegExp(`^${b.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} for \\$2\\.50, pickup until \\d{1,2}:\\d{2} (AM|PM)$`);
    expect(bodyPattern.test(newDeal.body), `body "${newDeal.body}" does not read like "${b.title} for $2.50, pickup until 6:00 PM"`);
    const early = body.notifications.find((n: any) => n.type === "new_deal" && n.deal_id === c.id);
    expect(!early, "got new_deal for a deal published before the customer followed");
    return `"${newDeal.body}"`;
  });

  await step("customer 1 marks it read; ?since= returns those created at or after it", async () => {
    const token = need(token1, "customer 1's token");
    const b = need(baguette, "the baguette deal");
    const list = expectOk(await call("GET", "/notifications", { token }), obj({ notifications: arr(NOTIFICATION) }));
    const n = list.notifications.find((x: any) => x.type === "new_deal" && x.deal_id === b.id);
    expect(n, "the new_deal notification is gone");
    expectOk(await call("POST", `/notifications/${n.id}/read`, { token }), OK);
    const after = expectOk(await call("GET", "/notifications", { token }), obj({ notifications: arr(NOTIFICATION) }));
    expect(after.notifications.find((x: any) => x.id === n.id)?.read === true, "still unread");
    const since = n.created_at;
    const newer = expectOk(await call("GET", `/notifications?since=${encodeURIComponent(since)}`, { token }), obj({ notifications: arr(NOTIFICATION) }));
    const older = newer.notifications.find((x: any) => ms(x.created_at) < ms(since));
    expect(!older, `?since=${since} returned one from ${older?.created_at}`);
    // Inclusive: created_at has seconds precision, so one from the same second must not be lost.
    expect(newer.notifications.some((x: any) => x.id === n.id), `?since=${since} left out the notification created at ${since}`);
  });

  /* ---- price changes on a live deal ------------------------------- */

  await step("price on a live deal can go down (200 -> 175); existing reservations keep their price", async () => {
    const c = need(croissant, "the croissant deal");
    const body = expectOk(await merchantCall("PATCH", `/deals/${c.id}`, { deal_price_cents: 175 }), DEAL);
    rules(dealRuleProblems(body, "deal"));
    expect(body.deal_price_cents === 175 && body.status === "live", `deal_price_cents ${body.deal_price_cents}, status ${body.status}`);
    const r = need(reservation1, "customer 1's reservation");
    const mine = expectOk(await call("GET", `/reservations/${r.id}`, { token: need(token1, "customer 1's token") }), RESERVATION);
    expect(mine.unit_price_cents === 200 && mine.total_cents === 400, `reservation now ${mine.unit_price_cents}/${mine.total_cents}, expected 200/400`);
    croissant = body;
  });

  await step("price on a live deal cannot go up (175 -> 300 gets VALIDATION)", async () => {
    const c = need(croissant, "the croissant deal");
    const message = expectError(await merchantCall("PATCH", `/deals/${c.id}`, { deal_price_cents: 300 }), "VALIDATION");
    const after = expectOk(await call("GET", `/deals/${c.id}`), DEAL);
    expect(after.deal_price_cents === 175, `deal_price_cents ${after.deal_price_cents} after a refused raise`);
    return message;
  });

  await step("live deal: quantity_total can grow but not below the reserved units; title cannot change", async () => {
    const c = need(croissant, "the croissant deal");
    const before = expectOk(await call("GET", `/deals/${c.id}`), DEAL);
    const taken = before.quantity_total - before.quantity_left; // customer 1's 2 picked-up units
    expect(taken === 2, `${taken} units taken, expected 2`);
    expectError(await merchantCall("PATCH", `/deals/${c.id}`, { quantity_total: taken - 1 }), "VALIDATION");
    const grown = expectOk(await merchantCall("PATCH", `/deals/${c.id}`, { quantity_total: before.quantity_total + 1 }), DEAL);
    expect(grown.quantity_total === before.quantity_total + 1 && grown.quantity_left === before.quantity_left + 1, `quantity ${grown.quantity_left}/${grown.quantity_total}`);
    expectError(await merchantCall("PATCH", `/deals/${c.id}`, { title: "Renamed while live" }), "VALIDATION");
    const note = expectOk(await merchantCall("PATCH", `/deals/${c.id}`, { note: "Baked this morning." }), DEAL);
    expect(note.note === "Baked this morning." && note.title === before.title, `note ${note.note}, title ${note.title}`);
    croissant = note;
    return `${before.quantity_total} -> ${grown.quantity_total} units`;
  });

  await step("merchant suggestions match the Suggestion shape", async () => {
    const m = need(merchant, "the merchant");
    const body = expectOk(await merchantCall("GET", `/merchants/${m.id}/suggestions`), obj({ suggestions: arr(SUGGESTION) }));
    rules(body.suggestions.flatMap((s: any, i: number) => suggestionRuleProblems(s, `suggestions[${i}]`)));
    return `${body.suggestions.length} suggestions`;
  });

  /* ---- a cancelled deal cancels its reservations and notifies ----- */

  await step("merchant cancels a deal: its open reservation is cancelled and the customer is notified", async () => {
    const b = need(baguette, "the baguette deal");
    const token = need(token2, "customer 2's token");
    const r = expectOk(await call("POST", "/reservations", { token, body: { deal_id: b.id, quantity: 1 } }), RESERVATION, 201);
    const cancelled = expectOk(await merchantCall("POST", `/deals/${b.id}/cancel`), DEAL);
    rules(dealRuleProblems(cancelled, "deal"));
    expect(cancelled.status === "cancelled", `deal status ${cancelled.status}`);
    const mine = expectOk(await call("GET", `/reservations/${r.id}`, { token }), RESERVATION);
    expect(mine.status === "cancelled", `reservation status ${mine.status}`);
    const notes = expectOk(await call("GET", "/notifications", { token }), obj({ notifications: arr(NOTIFICATION) }));
    const n = notes.notifications.find((x: any) => x.type === "deal_cancelled" && x.deal_id === b.id);
    expect(n, `no deal_cancelled notification: ${brief(notes.notifications)}`);
    expect(n.reservation_id === r.id, `reservation_id ${n.reservation_id}, expected ${r.id}`);
    const list = expectOk(await call("GET", "/deals"), obj({ deals: arr(DEAL) }));
    expect(!list.deals.some((d: any) => d.id === b.id), "the cancelled deal is still in GET /deals");
    return `"${n.body}"`;
  });

  await step("manual listing: POST /deals creates a draft with pickup starting in an hour; publish", async () => {
    const now = Date.now();
    // The body the portal's manual form sends.
    const input = {
      title: "Muffin",
      items: [{ name: "Muffin", qty: 1 }],
      kind: "timed",
      original_price_cents: 350,
      deal_price_cents: 200,
      quantity_total: 4,
      max_per_customer: 1,
      pickup_start: nyIso(floorMinutes(new Date(now + 60 * 60_000), 5)),
      pickup_end: nyIso(floorMinutes(new Date(now + 120 * 60_000), 5)),
      allergens: [],
      note: null,
    };
    const draft = expectOk(await merchantCall("POST", "/deals", input), DEAL);
    rules(dealRuleProblems(draft, "deal"));
    expect(draft.status === "draft" && draft.published_at === null, `status ${draft.status}, published_at ${draft.published_at}`);
    for (const [key, value] of Object.entries(input)) {
      const got = key.startsWith("pickup_") ? ms(draft[key]) : JSON.stringify(draft[key]);
      const want = key.startsWith("pickup_") ? ms(value as string) : JSON.stringify(value);
      expect(got === want, `${key} is ${JSON.stringify(draft[key])}, sent ${JSON.stringify(value)}`);
    }
    expect(JSON.stringify(draft.allergens) === "[]", "allergens [] (none) must stay [], not null");
    const live = expectOk(await merchantCall("POST", `/deals/${draft.id}/publish`), DEAL);
    expect(live.status === "live", `status ${live.status}`);
    laterDeal = live;
  });

  await step("pickup before pickup_start is refused (VALIDATION) for both confirm-pickup and redeem", async () => {
    const d = need(laterDeal, "the later deal");
    const token = need(token2, "customer 2's token");
    const r = expectOk(await call("POST", "/reservations", { token, body: { deal_id: d.id, quantity: 1 } }), RESERVATION, 201);
    expectError(await call("POST", `/reservations/${r.id}/confirm-pickup`, { token }), "VALIDATION");
    expectError(await merchantCall("POST", "/reservations/redeem", { pickup_code: r.pickup_code }), "VALIDATION");
    const still = expectOk(await call("GET", `/reservations/${r.id}`, { token }), RESERVATION);
    expect(still.status === "reserved", `status ${still.status}`);
    laterReservation = still;
  });

  await step("limit per customer: reserving past max_per_customer is refused (VALIDATION)", async () => {
    const d = need(laterDeal, "the later deal");
    need(laterReservation, "customer 2's first reservation on it");
    return expectError(await call("POST", "/reservations", { token: need(token2, "customer 2's token"), body: { deal_id: d.id, quantity: 1 } }), "VALIDATION");
  });

  await step("a cancelled deal cannot be reserved (DEAL_NOT_LIVE)", async () => {
    const d = need(laterDeal, "the later deal");
    const r = need(laterReservation, "customer 2's reservation on it");
    const cancelled = expectOk(await merchantCall("POST", `/deals/${d.id}/cancel`), DEAL);
    expect(cancelled.status === "cancelled", `status ${cancelled.status}`);
    const mine = expectOk(await call("GET", `/reservations/${r.id}`, { token: need(token2, "customer 2's token") }), RESERVATION);
    expect(mine.status === "cancelled", `reservation ${mine.status}`);
    return expectError(await call("POST", "/reservations", { token: need(token1, "customer 1's token"), body: { deal_id: d.id, quantity: 1 } }), "DEAL_NOT_LIVE");
  });

  /* ---- a blocked customer cannot reserve -------------------------- */

  await step("customer 3 signs up", async () => {
    const body = expectOk(
      await call("POST", "/auth/customer/signup", { body: { name: "Kim E2E", phone: phone3, password } }),
      obj({ token: str(), customer: CUSTOMER }),
      201,
    );
    token3 = body.token;
    customer3 = body.customer;
  });

  await step("a customer with 2 no-shows is blocked and cannot reserve (CUSTOMER_BLOCKED)", async () => {
    const cust = need(customer3, "customer 3");
    const token = need(token3, "customer 3's token");
    const c = need(croissant, "the croissant deal");
    const hook = await call("POST", "/e2e/no-shows", { body: { customer_id: cust.id, count: 2 } });
    if (hook.status === 404) {
      throw new StepSkip("the server has no test hooks (start it with E2E_HOOKS=1, not in production)");
    }
    expect(hook.status === 201, `POST /e2e/no-shows returned ${hook.status}: ${brief(hook.body)}`);
    const me = expectOk(await call("GET", "/customers/me", { token }), CUSTOMER);
    expect(me.no_show_count === 2 && me.blocked === true, `no_show_count ${me.no_show_count}, blocked ${me.blocked}`);
    const list = expectOk(await call("GET", "/reservations", { token }), obj({ reservations: arr(RESERVATION) }));
    rules(list.reservations.flatMap((x: any, i: number) => reservationRuleProblems(x, `reservations[${i}]`)));
    const noShows = list.reservations.filter((x: any) => x.status === "no_show").length;
    expect(noShows === 2, `${noShows} reservations read as no_show, expected 2`);
    const before = expectOk(await call("GET", `/deals/${c.id}`), DEAL);
    const message = expectError(await call("POST", "/reservations", { token, body: { deal_id: c.id, quantity: 1 } }), "CUSTOMER_BLOCKED");
    const after = expectOk(await call("GET", `/deals/${c.id}`), DEAL);
    expect(after.quantity_left === before.quantity_left, `quantity_left ${before.quantity_left} -> ${after.quantity_left} after a blocked reserve`);
    return message;
  });

  await step("customer 2 confirms a pickup in the app (confirm-pickup -> picked_up)", async () => {
    const c = need(croissant, "the croissant deal");
    const token = need(token2, "customer 2's token");
    const r = expectOk(await call("POST", "/reservations", { token, body: { deal_id: c.id, quantity: 1 } }), RESERVATION, 201);
    const picked = expectOk(await call("POST", `/reservations/${r.id}/confirm-pickup`, { token }), RESERVATION);
    rules(reservationRuleProblems(picked, "reservation"));
    expect(picked.status === "picked_up", `status ${picked.status}`);
    expect(picked.unit_price_cents === 175, `unit_price_cents ${picked.unit_price_cents}, expected the lowered 175`);
  });

  await step("customer 1 unfollows; a push token is accepted", async () => {
    const m = need(merchant, "the merchant");
    const token = need(token1, "customer 1's token");
    expectOk(await call("DELETE", `/follows/${m.id}`, { token }), OK);
    const body = expectOk(await call("GET", "/follows", { token }), obj({ merchant_ids: arr(id) }));
    expect(!body.merchant_ids.includes(m.id), "still following");
    expectOk(await call("POST", "/customers/me/push-token", { token, body: { expo_push_token: `ExponentPushToken[e2e-${run}]` } }), OK);
  });

  await step("manual listing can be discarded while draft (POST /deals/{id}/cancel)", async () => {
    const now = Date.now();
    const draft = expectOk(
      await merchantCall("POST", "/deals", {
        title: "Bagel",
        items: [{ name: "Bagel", qty: 1 }],
        original_price_cents: 250,
        deal_price_cents: 125,
        quantity_total: 2,
        max_per_customer: 2,
        pickup_start: nyIso(floorMinutes(new Date(now), 1)),
        pickup_end: nyIso(floorMinutes(new Date(now + 90 * 60_000), 5)),
        allergens: null,
        note: null,
      }),
      DEAL,
    );
    expect(draft.status === "draft" && draft.allergens === null, `status ${draft.status}, allergens ${brief(draft.allergens)}`);
    const discarded = expectOk(await merchantCall("POST", `/deals/${draft.id}/cancel`), DEAL);
    expect(discarded.status === "cancelled" && discarded.published_at === null, `status ${discarded.status}, published_at ${discarded.published_at}`);
    // A discarded draft stays private: only its merchant can read it.
    expectError(await call("GET", `/deals/${draft.id}`), "NOT_FOUND");
    expectOk(await merchantCall("GET", `/deals/${draft.id}`), DEAL);
  });

  await step("merchant updates the store (PATCH /merchants/{id}); billing links are there", async () => {
    const m = need(merchant, "the merchant");
    const body = expectOk(await merchantCall("PATCH", `/merchants/${m.id}`, { default_discount_pct: 40, closes_at: "19:00" }), MERCHANT);
    expect(body.default_discount_pct === 40 && body.closes_at === "19:00" && body.name === m.name, `merchant ${brief(body)}`);
    expectError(await merchantCall("PATCH", `/merchants/${m.id}`, { default_discount_pct: 95 }), "VALIDATION");
    const me = expectOk(await merchantCall("GET", "/me"), obj({ merchant: nullable(MERCHANT) }));
    expect(me.merchant?.default_discount_pct === 40, "GET /me does not show the change");
    const links = expectOk(await merchantCall("GET", "/billing/links"), obj({ pricing_url: link, portal_url: link }));
    return `pricing_url ${JSON.stringify(links.pricing_url)}`;
  });

  await step("merchant lists another date (?date=): none of today's deals or reservations", async () => {
    const m = need(merchant, "the merchant");
    const yesterday = nyParts(new Date(Date.now() - 24 * 3600_000)).date;
    const deals = expectOk(await merchantCall("GET", `/merchants/${m.id}/deals?date=${yesterday}`), obj({ deals: arr(DEAL) }));
    expect(deals.deals.length === 0, `${deals.deals.length} deals on ${yesterday}`);
    const res = expectOk(await merchantCall("GET", `/merchants/${m.id}/reservations?date=${yesterday}`), obj({ reservations: arr(RESERVATION) }));
    expect(res.reservations.length === 0, `${res.reservations.length} reservations on ${yesterday}`);
    const summary = expectOk(await merchantCall("GET", `/merchants/${m.id}/summary?date=${yesterday}`), SUMMARY);
    expect(summary.date === yesterday && summary.units_listed === 0, `summary ${brief(summary)}`);
  });

  await step("passwords under 8 characters are refused (VALIDATION)", async () => {
    expectError(await call("POST", "/auth/merchant/signup", { body: { email: `short-${run}@example.com`, password: "1234567" } }), "VALIDATION");
    expectError(await call("POST", "/auth/customer/signup", { body: { name: "Short", phone: "+18145550000", password: "1234567" } }), "VALIDATION");
  });

  await step("CORS for the consumer app: preflight and responses carry Access-Control-Allow-Origin", async () => {
    const origin = { origin: "http://localhost:8081" };
    const pre = await call("OPTIONS", "/reservations", {
      headers: { ...origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" },
    });
    expect(pre.status >= 200 && pre.status < 300, `preflight returned ${pre.status}`);
    expect(pre.headers.get("access-control-allow-origin"), "preflight has no Access-Control-Allow-Origin");
    expect(/authorization/i.test(pre.headers.get("access-control-allow-headers") ?? ""), "preflight does not allow the Authorization header");
    const list = await call("GET", "/deals", { headers: origin });
    expect(list.headers.get("access-control-allow-origin"), "GET /deals has no Access-Control-Allow-Origin");
    return `allow-origin ${list.headers.get("access-control-allow-origin")}`;
  });

  /* ---- merchant access rules and sign-out ------------------------- */

  await step("merchant endpoints: 401 without a session, 404 for another merchant's id", async () => {
    const m = need(merchant, "the merchant");
    expectError(await call("GET", "/me"), "UNAUTHORIZED");
    expectError(await call("GET", `/merchants/${m.id}/deals`), "UNAUTHORIZED");
    expectError(await merchantCall("GET", "/merchants/m_not_mine/deals"), "NOT_FOUND");
    expectError(await merchantCall("GET", "/merchants/m_not_mine/summary"), "NOT_FOUND");
  });

  await step("unknown paths, unsupported methods and malformed paths answer the 404 error envelope", async () => {
    expectError(await call("GET", "/nope"), "NOT_FOUND");
    expectError(await call("GET", ""), "NOT_FOUND");
    expectError(await call("PUT", "/deals", { body: {} }), "NOT_FOUND");
    expectError(await call("DELETE", "/deals/d_x"), "NOT_FOUND");
    expectError(await merchantCall("GET", "/reservations/redeem"), "NOT_FOUND");
    expectError(await call("GET", "/deals/%E0%A4%A"), "NOT_FOUND");
  });

  await step("merchant signs out (the old cookie stops working) and signs in again", async () => {
    expectOk(await merchantCall("POST", "/auth/merchant/signout"), OK);
    expectError(await merchantCall("GET", "/me"), "UNAUTHORIZED");
    const again = await call("POST", "/auth/merchant/signin", { body: { email: merchantEmail, password } });
    expectOk(again, OK);
    const fresh = again.headers.getSetCookie().find((c) => /;\s*httponly/i.test(c));
    expect(fresh, "sign-in set no httpOnly cookie");
    cookie = fresh.split(";")[0];
    expectOk(await merchantCall("GET", "/me"), obj({ merchant: nullable(MERCHANT) }));
    expectError(await call("POST", "/auth/merchant/signin", { body: { email: merchantEmail, password: "wrong-password" } }), "BAD_CREDENTIALS");
  });

  await step("cleanup: the merchant cancels its remaining live deal, so it leaves the public list", async () => {
    const c = need(croissant, "the croissant deal");
    const body = expectOk(await merchantCall("POST", `/deals/${c.id}/cancel`), DEAL);
    expect(body.status === "cancelled", `status ${body.status}`);
    const list = expectOk(await call("GET", "/deals"), obj({ deals: arr(DEAL) }));
    expect(!list.deals.some((d: any) => d.merchant_id === c.merchant_id), "a deal of the test merchant is still listed");
  });

  const passed = outcomes.filter((o) => o === "PASS").length;
  const failed = outcomes.filter((o) => o === "FAIL").length;
  const skipped = outcomes.filter((o) => o === "SKIP").length;
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed, ${skipped} skipped (${outcomes.length} steps)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
