/**
 * Runs the agent spec's text test cases 1-9 (docs/agent-spec.md "Test set")
 * against the real listing model, with the spec's fixed context: now 16:00,
 * closes 18:00, default discount 50%, menu "Croissant" at 400, no history.
 * Prints expected vs actual per case and a pass count. Photo cases 10-12
 * need photos and are run by hand.
 *
 *   LISTING_MODEL_ID=<bedrock model or inference profile id> APP_AWS_REGION=us-east-1 \
 *     npx tsx scripts/agent-cases.ts
 *
 *   npx tsx scripts/agent-cases.ts --fake     (rule-based stand-in; checks the script, not the model)
 *
 * Uses LISTING_MODEL_ID, LISTING_MODEL_TEMPERATURE, LISTING_TOOL_CHOICE and
 * LISTING_MODEL_EXTRA_FIELDS like the app; the provider is always bedrock
 * unless --fake is given. AWS credentials come from the SDK default chain
 * (or a Bedrock API key in AWS_BEARER_TOKEN_BEDROCK).
 *
 * Exit codes: 0 all cases pass, 1 some cases fail, 2 configuration or
 * credentials missing (nothing was sent to the model).
 */
import { formatTime12, localTimeOf, setNow, today } from "@/lib/clock";
import {
  ListingConfigError,
  createBedrockModel,
  createFakeModel,
  getBedrockClient,
  listingModelConfig,
  runExtract,
  type ExtractLog,
  type ExtractModel,
  type ExtractResult,
} from "@/lib/extract";
import { buildDrafts, type DraftPlan } from "@/lib/listing";
import { SPEC_CASES, SPEC_CONTEXT, specBuildContext, specNow } from "@/lib/listing/spec-cases";

function fail(message: string): never {
  console.error(`\nagent-cases: ${message}\n`);
  process.exit(2);
}

function money(cents: number | null): string {
  return cents === null ? "null" : String(cents);
}

function describeDraft(plan: DraftPlan): string {
  const d = plan.deal;
  const window = `${localTimeOf(d.pickup_start)}-${d.pickup_end === null ? "null" : localTimeOf(d.pickup_end)}`;
  return [
    `"${d.title}"`,
    `qty ${d.quantity_total ?? "null"}`,
    `unit ${d.items[0]?.qty ?? "?"}`,
    `${money(d.original_price_cents)}/${money(d.deal_price_cents)}`,
    `source ${plan.price_source ?? "null"}`,
    window,
    d.kind,
    `allergens ${JSON.stringify(d.allergens)}`,
    `missing [${plan.missing_fields.join(", ")}]`,
  ].join(", ");
}

async function preflight(model: ExtractModel): Promise<void> {
  if (model.provider !== "bedrock") return;
  const client = getBedrockClient();
  let region: string;
  try {
    region = await client.config.region();
  } catch {
    fail("No AWS region. Set APP_AWS_REGION (or AWS_REGION) to the region where the model is enabled, e.g. us-east-1.");
  }
  if (!region) fail("No AWS region. Set APP_AWS_REGION (or AWS_REGION).");
  if (process.env.AWS_BEARER_TOKEN_BEDROCK?.trim()) {
    console.log(`Region ${region}, Bedrock API key from AWS_BEARER_TOKEN_BEDROCK.`);
    return;
  }
  try {
    const credentials = await client.config.credentials();
    if (!credentials?.accessKeyId) throw new Error("empty credentials");
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    fail(
      `No AWS credentials found (${reason}).\n` +
        "Configure credentials for an IAM principal allowed to call bedrock:InvokeModel on the model " +
        "(for example `aws login` / `aws configure`, AWS_PROFILE, or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY), " +
        "or set a Bedrock API key in AWS_BEARER_TOKEN_BEDROCK. Nothing was sent to the model.",
    );
  }
  console.log(`Region ${region}, credentials from the SDK default chain.`);
}

function summarizeLog(log: ExtractLog): string {
  const parts = [`${log.outcome} after ${log.attempts} call(s), ${log.latency_ms} ms`];
  if (log.validation_error) parts.push(`validation: ${log.validation_error}`);
  if (log.error) parts.push(`error: ${log.error}`);
  return parts.join("; ");
}

async function main(): Promise<void> {
  const useFake = process.argv.includes("--fake");
  let model: ExtractModel;
  if (useFake) {
    model = createFakeModel();
  } else {
    try {
      const config = listingModelConfig({ ...process.env, LISTING_MODEL_PROVIDER: "bedrock" });
      model = createBedrockModel(config);
    } catch (error) {
      if (error instanceof ListingConfigError) fail(error.message);
      throw error;
    }
  }

  const date = today();
  const now = specNow(date);
  // The build step reads `now` from its context; pin the clock too so nothing else drifts.
  setNow(now);

  console.log(`Listing agent text cases 1-${SPEC_CASES.length}`);
  console.log(`Provider: ${model.provider}${model.modelId ? ` (${model.modelId})` : ""}${useFake ? "  [rule-based stand-in, NOT the real model]" : ""}`);
  console.log(
    `Context: ${date}, now ${SPEC_CONTEXT.now_local} (${formatTime12(now)}), closes ${SPEC_CONTEXT.closes_at}, ` +
      `default ${SPEC_CONTEXT.default_discount_pct}%, menu ${SPEC_CONTEXT.menu.map((m) => `${m.name} ${m.price_cents}`).join(", ")}, no history`,
  );
  await preflight(model);

  let passed = 0;
  for (const c of SPEC_CASES) {
    const result: ExtractResult = await runExtract(
      {
        now_local: SPEC_CONTEXT.now_local,
        closes_at: SPEC_CONTEXT.closes_at,
        category: SPEC_CONTEXT.category,
        text: c.text,
        photo: null,
        menu_item_names: SPEC_CONTEXT.menu.map((item) => item.name),
      },
      model,
      { log: () => undefined },
    );
    const drafts = result.ok ? buildDrafts(result.output, specBuildContext(date)) : [];
    const problems = c.check(drafts, result.ok ? result.output : null);
    // The API answers a failed extract with { drafts: [] }, which some cases
    // accept; for judging the model, a failed call is a failed case.
    if (!result.ok) problems.unshift(`extract failed (${result.reason})`);
    const pass = problems.length === 0;
    if (pass) passed += 1;

    console.log(`\n#${c.id} ${JSON.stringify(c.text)}`);
    console.log(`  expected: ${c.expected}`);
    console.log(`  extract:  ${summarizeLog(result.log)}`);
    console.log(`  raw:      ${JSON.stringify(result.log.raw_output)}`);
    if (drafts.length === 0) console.log("  actual:   { drafts: [] }");
    else drafts.forEach((plan, i) => console.log(`  ${i === 0 ? "actual:  " : "         "} ${describeDraft(plan)}`));
    console.log(`  ${pass ? "PASS" : "FAIL"}${pass ? "" : `: ${problems.join("; ")}`}`);

    if (!result.ok && result.reason === "model_error" && c === SPEC_CASES[0]) {
      // Misconfiguration (model id, access, permissions) fails every case the
      // same way; stop instead of sending the rest.
      fail(
        `The first model call failed: ${result.log.error ?? "unknown error"}\n` +
          "Check LISTING_MODEL_ID (model or inference profile id), the region, model access in the Bedrock console " +
          "and bedrock:InvokeModel permission. Stopped after one call.",
      );
    }
  }

  console.log(`\nPassed ${passed} of ${SPEC_CASES.length} text cases.`);
  console.log("Spec pass bar (all 12 cases): products and quantities right in at least 10 of 12; no unstated allergen or price in any.");
  process.exit(passed === SPEC_CASES.length ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("agent-cases: unexpected error", error);
  process.exit(2);
});
