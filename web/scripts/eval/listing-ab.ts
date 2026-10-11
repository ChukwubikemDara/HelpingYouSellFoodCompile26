/**
 * A/B harness for the listing agent (docs/agent-spec.md). Runs the real
 * extract step (runExtract with the Bedrock provider, built from the same
 * listingModelConfig() the app uses) and the real build step (buildDrafts)
 * in-process, for every case x config, N repeats, with bounded concurrency.
 * No HTTP, no store writes.
 *
 *   npx tsx scripts/eval/listing-ab.ts --cases <dir with cases.json> --out <dir> \
 *     --label screen --repeats 1 --concurrency 4 --only-text \
 *     --models us.anthropic.claude-haiku-4-5-20251001-v1:0,us.anthropic.claude-sonnet-4-6 \
 *     --temps 0,unset --tools tool,auto --prompts spec,v2 --imgs 1568
 *
 *   --config "<model>|<temp>|<tool>|<prompt>|<img>"  (repeatable; instead of the matrix flags)
 *
 * cases.json: an array of
 *   { id, group, text, photo (path relative to the cases dir) | null,
 *     context: { now_local, closes_at, category, default_discount_pct, menu: [{ name, price_cents }] },
 *     expect: { products: [{ match: [substr], quantity: n | null | [allowed...], unit_size?, deal?, original?,
 *               discount?, allergens?, menu_name? }],
 *               stated_prices: [cents], stated_discounts: [pct], stated_allergens: [..] | null,
 *               stated_quantities: [n], allow_single?, empty_ok?, allow_extra?, min_products?,
 *               all_quantities?, pickup_start?, pickup_end?, spec_case? } }
 *
 * Scoring (agent-spec "Test set"): a run passes when the products and their
 * quantities are right and nothing was invented. Invented (hard constraint):
 * a price, discount, allergen or quantity the case does not state, or a price
 * of 0. Recorded but not scored: times, menu-name use, stated prices/discounts
 * read correctly, and (spec cases 1-9) the spec's own strict check.
 *
 * Writes <out>/<label>.json (every run) and <out>/<label>.md (table).
 * Image size: --imgs 1568 sends the photo as is when its longer side is at
 * most 1568 px; any other value resizes to that longer side (JPEG q85) first,
 * the way the client would.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { localTimeOf, today, zonedDateTime } from "@/lib/clock";
import type { MerchantCategory } from "@/lib/contract";
import {
  createBedrockModel,
  listingModelConfig,
  runExtract,
  type ExtractInput,
  type ExtractLog,
  type ExtractOutput,
} from "@/lib/extract";
import { detectPhotoType } from "@/lib/photos/decode";
import { buildDrafts, normalizeProductName, type DraftPlan } from "@/lib/listing";
import { SPEC_CASES, specBuildContext } from "@/lib/listing/spec-cases";

type QuantityExpect = number | null | (number | null)[];

interface ExpectedProduct {
  match: string[];
  quantity: QuantityExpect;
  unit_size?: number;
  deal?: number;
  original?: number;
  discount?: number;
  allergens?: string[];
  menu_name?: string;
}

interface EvalCase {
  id: string;
  group: string;
  text: string | null;
  photo: string | null;
  context: {
    now_local: string;
    closes_at: string;
    category: MerchantCategory;
    default_discount_pct: number;
    menu: { name: string; price_cents: number }[];
  };
  expect: {
    products: ExpectedProduct[];
    stated_prices: number[];
    stated_discounts: number[];
    stated_allergens: string[] | null;
    stated_quantities: number[];
    allow_single?: boolean;
    empty_ok?: boolean;
    allow_extra?: boolean;
    min_products?: number;
    all_quantities?: (number | null)[];
    pickup_start?: string | null;
    pickup_end?: string | null;
    spec_case?: number;
  };
}

interface RunConfig {
  key: string;
  model: string;
  temp: string;
  tool: string;
  prompt: string;
  img: number;
}

interface RunResult {
  config: string;
  case_id: string;
  group: string;
  repeat: number;
  pass: boolean;
  products_ok: boolean;
  violations: string[];
  problems: string[];
  soft: { times_ok: boolean; menu_names_ok: boolean; stated_values_ok: boolean; spec_strict_ok: boolean | null };
  outcome: string;
  throttle_retries: number;
  attempts: number;
  schema_retry: boolean;
  latency_ms: number;
  error: string | null;
  raw_output: unknown;
}

/* ------------------------------------------------------------------ */
/* Args                                                                */
/* ------------------------------------------------------------------ */

function args(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    const value = next !== undefined && !next.startsWith("--") ? (i += 1, next) : "true";
    out.set(name, [...(out.get(name) ?? []), value]);
  }
  return out;
}

const SHORT: Record<string, string> = {
  "us.anthropic.claude-haiku-4-5-20251001-v1:0": "haiku45",
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0": "sonnet45",
  "us.anthropic.claude-sonnet-4-6": "sonnet46",
  "us.anthropic.claude-sonnet-4-20250514-v1:0": "sonnet4",
};

function configsFrom(a: Map<string, string[]>): RunConfig[] {
  const make = (model: string, temp: string, tool: string, prompt: string, img: string): RunConfig => ({
    key: `${SHORT[model] ?? model}|t=${temp}|${tool}|${prompt}|${img}`,
    model,
    temp,
    tool,
    prompt,
    img: Number(img),
  });
  const explicit = a.get("config") ?? [];
  if (explicit.length > 0) {
    return explicit.map((c) => {
      const [model, temp, tool, prompt, img] = c.split("|");
      return make(model, temp, tool, prompt, img ?? "1568");
    });
  }
  const list = (name: string, fallback: string) => (a.get(name)?.[0] ?? fallback).split(",").map((s) => s.trim());
  const out: RunConfig[] = [];
  for (const model of list("models", "us.anthropic.claude-haiku-4-5-20251001-v1:0"))
    for (const temp of list("temps", "unset"))
      for (const tool of list("tools", "auto"))
        for (const prompt of list("prompts", "spec"))
          for (const img of list("imgs", "1568")) out.push(make(model, temp, tool, prompt, img));
  return out;
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

type SharpFn = (input: Buffer) => {
  metadata(): Promise<{ width?: number; height?: number }>;
  resize(opts: { width: number; height: number; fit: "inside"; withoutEnlargement: boolean }): {
    jpeg(opts: { quality: number }): { toBuffer(): Promise<Buffer> };
  };
};

const photoCache = new Map<string, Promise<{ bytes: Uint8Array; content_type: string }>>();

function loadPhoto(file: string, maxSide: number): Promise<{ bytes: Uint8Array; content_type: string }> {
  const key = `${file}@${maxSide}`;
  let p = photoCache.get(key);
  if (!p) {
    p = (async () => {
      const raw = readFileSync(file);
      const require = createRequire(import.meta.url);
      const sharp = require("sharp") as SharpFn;
      const meta = await sharp(raw).metadata();
      const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
      if (longest > maxSide || maxSide < 1568) {
        const bytes = await sharp(raw)
          .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        return { bytes: new Uint8Array(bytes), content_type: "image/jpeg" };
      }
      const bytes = new Uint8Array(raw);
      const type = detectPhotoType(bytes);
      if (!type) throw new Error(`Unsupported photo ${file}`);
      return { bytes, content_type: type };
    })();
    photoCache.set(key, p);
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function allergenStated(value: string, stated: string[]): boolean {
  const v = norm(value);
  return stated.some((s) => {
    const n = norm(s);
    return v === n || v.includes(n) || n.includes(v) || normalizeProductName(v) === normalizeProductName(n);
  });
}

function quantityAllowed(expect: QuantityExpect, actual: number | null): boolean {
  if (Array.isArray(expect)) return expect.includes(actual);
  return expect === actual;
}

function score(c: EvalCase, output: ExtractOutput | null, drafts: DraftPlan[]) {
  const e = c.expect;
  const violations: string[] = [];
  const problems: string[] = [];
  const products = output?.products ?? [];

  // Hard constraints on the extract output (what the model claimed was stated).
  const qtyOk = new Set<number | null>([null, ...e.stated_quantities, ...(e.allow_single ? [1] : [])]);
  for (const p of products) {
    for (const [field, value] of [
      ["original_price_cents", p.original_price_cents],
      ["deal_price_cents", p.deal_price_cents],
    ] as const) {
      if (value === null) continue;
      if (value <= 0) violations.push(`${p.name}: ${field} ${value} (price 0 or below)`);
      else if (!e.stated_prices.includes(value)) violations.push(`${p.name}: ${field} ${value} not stated`);
    }
    if (p.discount_pct !== null && !e.stated_discounts.includes(p.discount_pct)) {
      violations.push(`${p.name}: discount_pct ${p.discount_pct} not stated`);
    }
    if (p.allergens !== null && p.allergens.length > 0) {
      if (e.stated_allergens === null) violations.push(`${p.name}: allergens ${JSON.stringify(p.allergens)} not stated`);
      else {
        const extra = p.allergens.filter((a) => !allergenStated(a, e.stated_allergens as string[]));
        if (extra.length > 0) violations.push(`${p.name}: allergens ${JSON.stringify(extra)} not stated`);
      }
    }
    if (!qtyOk.has(p.quantity)) violations.push(`${p.name}: quantity ${p.quantity} not stated/countable`);
  }
  // And on the built drafts: never a price of 0, no allergens unless stated.
  for (const d of drafts) {
    for (const v of [d.deal.original_price_cents, d.deal.deal_price_cents]) {
      if (v !== null && v <= 0) violations.push(`${d.deal.title}: draft price ${v}`);
    }
    if (d.deal.allergens !== null && e.stated_allergens === null) violations.push(`${d.deal.title}: draft allergens set`);
  }

  // Products and quantities.
  let productsOk = true;
  const used = new Set<number>();
  let menuNamesOk = true;
  let statedOk = true;
  if (products.length === 0 && e.empty_ok) {
    // An empty answer is acceptable for this case.
  } else {
    for (const exp of e.products) {
      const idx = products.findIndex(
        (p, i) => !used.has(i) && exp.match.some((m) => norm(p.name).includes(norm(m))),
      );
      if (idx < 0) {
        productsOk = false;
        problems.push(`missing product ${exp.match.join("/")}`);
        continue;
      }
      used.add(idx);
      const p = products[idx];
      if (!quantityAllowed(exp.quantity, p.quantity)) {
        productsOk = false;
        problems.push(`${p.name}: quantity ${p.quantity}, expected ${JSON.stringify(exp.quantity)}`);
      }
      if (exp.unit_size !== undefined && p.unit_size !== exp.unit_size) {
        productsOk = false;
        problems.push(`${p.name}: unit_size ${p.unit_size}, expected ${exp.unit_size}`);
      }
      if (exp.menu_name !== undefined && p.name !== exp.menu_name) menuNamesOk = false;
      if (exp.deal !== undefined && p.deal_price_cents !== exp.deal) statedOk = false;
      if (exp.original !== undefined && p.original_price_cents !== exp.original) statedOk = false;
      if (exp.discount !== undefined && p.discount_pct !== exp.discount) statedOk = false;
      if (exp.allergens !== undefined) {
        const got = [...(p.allergens ?? [])].map(norm).sort();
        if (JSON.stringify(got) !== JSON.stringify([...exp.allergens].map(norm).sort())) statedOk = false;
      }
    }
    const extra = products.length - used.size;
    if (extra > 0 && !e.allow_extra) {
      productsOk = false;
      problems.push(`${extra} extra product(s): ${products.filter((_, i) => !used.has(i)).map((p) => p.name).join(", ")}`);
    }
    if (e.min_products !== undefined && products.length < e.min_products) {
      productsOk = false;
      problems.push(`${products.length} products, expected at least ${e.min_products}`);
    }
    if (e.all_quantities) {
      for (const p of products) {
        if (!e.all_quantities.includes(p.quantity)) {
          productsOk = false;
          problems.push(`${p.name}: quantity ${p.quantity} not allowed`);
        }
      }
    }
  }
  if (!statedOk) problems.push("(soft) a stated price/discount/allergen was not read as stated");
  if (!menuNamesOk) problems.push("(soft) menu name not used");

  // A pickup_end equal to closes_at when none was stated builds the same draft as null.
  const endOk = (actual: string | null) =>
    actual === (e.pickup_end ?? null) || ((e.pickup_end ?? null) === null && actual === c.context.closes_at);
  const timesOk =
    output === null ||
    products.length === 0 ||
    ((output.pickup_start ?? null) === (e.pickup_start ?? null) && endOk(output.pickup_end ?? null));
  if (!timesOk) {
    problems.push(
      `(soft) times ${output?.pickup_start}-${output?.pickup_end}, expected ${e.pickup_start ?? null}-${e.pickup_end ?? null}`,
    );
  }
  return { violations, problems, productsOk, timesOk, menuNamesOk, statedOk };
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

async function runOne(c: EvalCase, cfg: RunConfig, repeat: number, casesDir: string, date: string): Promise<RunResult> {
  const env: Record<string, string | undefined> = {
    LISTING_MODEL_PROVIDER: "bedrock",
    LISTING_MODEL_ID: cfg.model,
    LISTING_TOOL_CHOICE: cfg.tool,
    LISTING_PROMPT_VARIANT: cfg.prompt,
    LISTING_MODEL_TEMPERATURE: cfg.temp === "unset" ? undefined : cfg.temp,
  };
  const model = createBedrockModel(listingModelConfig(env));
  const photo = c.photo ? await loadPhoto(path.resolve(casesDir, c.photo), cfg.img) : null;
  const input: ExtractInput = {
    now_local: c.context.now_local,
    closes_at: c.context.closes_at,
    category: c.context.category,
    text: c.text,
    photo,
    menu_item_names: c.context.menu.map((m) => m.name),
  };
  let log: ExtractLog | null = null;
  // Throttling is an account quota, not model quality: back off and rerun the
  // case (counted in throttle_retries) instead of scoring it as a failure.
  let throttleRetries = 0;
  let result = await runExtract(input, model, { log: (entry) => (log = entry) });
  while (!result.ok && /Throttling|Too many requests/i.test(result.log.error ?? "") && throttleRetries < 6) {
    throttleRetries += 1;
    await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** Math.min(throttleRetries, 4) * (0.5 + Math.random())));
    result = await runExtract(input, model, { log: (entry) => (log = entry) });
  }
  const output = result.ok ? result.output : null;
  const now = zonedDateTime(date, c.context.now_local);
  const drafts =
    output && output.products.length > 0
      ? buildDrafts(output, {
          now,
          merchant: {
            closes_at: c.context.closes_at,
            default_discount_pct: c.context.default_discount_pct,
            menu: c.context.menu.map((m) => ({ ...m })),
          },
          history: [],
          photoUrl: photo ? "https://example.invalid/photo.jpg" : null,
        })
      : [];
  const s = score(c, output, drafts);
  let specStrict: boolean | null = null;
  if (c.expect.spec_case !== undefined) {
    const sc = SPEC_CASES.find((x) => x.id === c.expect.spec_case);
    if (sc) {
      const specDrafts = output && output.products.length > 0 ? buildDrafts(output, specBuildContext(date)) : [];
      specStrict = result.ok && sc.check(specDrafts, output).length === 0;
    }
  }
  const failed = !result.ok;
  if (!result.ok) s.problems.unshift(`extract failed (${result.reason}): ${result.log.error ?? result.log.validation_error ?? ""}`);
  const l = (log ?? result.log) as ExtractLog;
  return {
    config: cfg.key,
    case_id: c.id,
    group: c.group,
    repeat,
    pass: !failed && s.productsOk && s.violations.length === 0,
    products_ok: !failed && s.productsOk,
    violations: s.violations,
    problems: s.problems,
    soft: { times_ok: s.timesOk, menu_names_ok: s.menuNamesOk, stated_values_ok: s.statedOk, spec_strict_ok: specStrict },
    outcome: l.outcome,
    throttle_retries: throttleRetries,
    attempts: l.attempts,
    schema_retry: l.attempt_details.some((a) => a.validation_error !== null),
    latency_ms: l.latency_ms,
    error: l.error,
    raw_output: l.raw_output,
  };
}

async function pool<T>(items: (() => Promise<T>)[], concurrency: number, onDone: (n: number) => void): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await items[i]();
      done += 1;
      onDone(done);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${((100 * n) / d).toFixed(1)}%`;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

export interface ConfigSummary {
  config: string;
  runs: number;
  pass: number;
  pass_rate: number;
  hard_violation_runs: number;
  schema_failure_runs: number;
  errors: number;
  throttle_retries: number;
  p50_ms: number;
  p95_ms: number;
  times_ok_rate: number;
  menu_names_ok_rate: number;
  stated_values_ok_rate: number;
  spec_strict_pass: string;
}

function summarize(results: RunResult[]): ConfigSummary[] {
  const byConfig = new Map<string, RunResult[]>();
  for (const r of results) byConfig.set(r.config, [...(byConfig.get(r.config) ?? []), r]);
  const out: ConfigSummary[] = [];
  for (const [config, rs] of byConfig) {
    const lat = rs.filter((r) => r.outcome !== "model_error").map((r) => r.latency_ms);
    const spec = rs.filter((r) => r.soft.spec_strict_ok !== null);
    out.push({
      config,
      runs: rs.length,
      pass: rs.filter((r) => r.pass).length,
      pass_rate: rs.filter((r) => r.pass).length / rs.length,
      hard_violation_runs: rs.filter((r) => r.violations.length > 0).length,
      schema_failure_runs: rs.filter((r) => r.schema_retry || r.outcome === "invalid_output").length,
      errors: rs.filter((r) => r.outcome === "model_error" || r.outcome === "timeout").length,
      throttle_retries: rs.reduce((n, r) => n + r.throttle_retries, 0),
      p50_ms: quantile(lat, 0.5),
      p95_ms: quantile(lat, 0.95),
      times_ok_rate: rs.filter((r) => r.soft.times_ok).length / rs.length,
      menu_names_ok_rate: rs.filter((r) => r.soft.menu_names_ok).length / rs.length,
      stated_values_ok_rate: rs.filter((r) => r.soft.stated_values_ok).length / rs.length,
      spec_strict_pass: spec.length === 0 ? "-" : `${spec.filter((r) => r.soft.spec_strict_ok).length}/${spec.length}`,
    });
  }
  // Ranking: zero hard violations first, then pass rate, then p95 latency.
  return out.sort(
    (a, b) =>
      Number(a.hard_violation_runs > 0) - Number(b.hard_violation_runs > 0) ||
      b.pass_rate - a.pass_rate ||
      a.p95_ms - b.p95_ms,
  );
}

function markdown(label: string, summaries: ConfigSummary[], results: RunResult[]): string {
  const lines = [
    `# Listing agent A/B: ${label}`,
    "",
    "Ranking: zero hard-constraint violations, then pass rate, then p95 latency. Config = model|temperature|tool choice|prompt|image max px.",
    "",
    "| # | config | runs | pass | pass rate | hard violations | schema retries | errors | throttle retries | p50 ms | p95 ms | times ok | menu names ok | stated values ok | spec 1-9 strict |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...summaries.map(
      (s, i) =>
        `| ${i + 1} | \`${s.config}\` | ${s.runs} | ${s.pass} | ${pct(s.pass, s.runs)} | ${s.hard_violation_runs} | ${s.schema_failure_runs} | ${s.errors} | ${s.throttle_retries} | ${s.p50_ms} | ${s.p95_ms} | ${pct(s.times_ok_rate * s.runs, s.runs)} | ${pct(s.menu_names_ok_rate * s.runs, s.runs)} | ${pct(s.stated_values_ok_rate * s.runs, s.runs)} | ${s.spec_strict_pass} |`,
    ),
    "",
    "## Failures",
    "",
  ];
  for (const r of results.filter((x) => !x.pass || x.violations.length > 0)) {
    lines.push(
      `- \`${r.config}\` ${r.case_id}#${r.repeat}: ${[...r.violations.map((v) => `VIOLATION ${v}`), ...r.problems].join("; ")}`,
    );
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const a = args();
  const casesDir = path.resolve(a.get("cases")?.[0] ?? "cases");
  const outDir = path.resolve(a.get("out")?.[0] ?? ".");
  const label = a.get("label")?.[0] ?? "run";
  const repeats = Number(a.get("repeats")?.[0] ?? "1");
  const concurrency = Number(a.get("concurrency")?.[0] ?? "4");
  let cases = JSON.parse(readFileSync(path.join(casesDir, "cases.json"), "utf8")) as EvalCase[];
  if (a.has("only-text")) cases = cases.filter((c) => c.photo === null);
  if (a.has("only-photo")) cases = cases.filter((c) => c.photo !== null);
  const only = a.get("case")?.[0];
  if (only) cases = cases.filter((c) => only.split(",").includes(c.id));
  const configs = configsFrom(a);
  const date = today();

  const jobs: (() => Promise<RunResult>)[] = [];
  for (let r = 0; r < repeats; r += 1)
    for (const cfg of configs) for (const c of cases) jobs.push(() => runOne(c, cfg, r, casesDir, date));
  console.log(`${label}: ${cases.length} cases x ${configs.length} configs x ${repeats} = ${jobs.length} runs, concurrency ${concurrency}`);
  const started = Date.now();
  const results = await pool(jobs, concurrency, (n) => {
    if (n % 20 === 0 || n === jobs.length) console.log(`  ${n}/${jobs.length} (${Math.round((Date.now() - started) / 1000)} s)`);
  });
  const summaries = summarize(results);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, `${label}.json`),
    JSON.stringify({ label, date, localTime: localTimeOf(new Date()), configs, summaries, results }, null, 1),
  );
  const md = markdown(label, summaries, results);
  writeFileSync(path.join(outDir, `${label}.md`), md);
  console.log(md.split("## Failures")[0]);
}

main().catch((error: unknown) => {
  console.error("listing-ab: unexpected error", error);
  process.exit(2);
});
