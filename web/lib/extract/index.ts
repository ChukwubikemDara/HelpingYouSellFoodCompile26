/**
 * The listing agent's extract step (docs/agent-spec.md): one model call with
 * schema-constrained output that returns what the merchant's text and/or
 * photo state. Prices, times, allergens and kind are never inferred here.
 *
 * extract(input) picks the provider from LISTING_MODEL_PROVIDER (bedrock |
 * fake) and LISTING_MODEL_ID (see config.ts), then runs the shared control
 * flow in run.ts: schema validation, one retry with the validation error,
 * a 15 s budget for the whole step, one log line per call (never the photo).
 */
import { createBedrockModel } from "./bedrock";
import { ListingConfigError, listingModelConfig } from "./config";
import { createFakeModel } from "./fake";
import { configFailure, runExtract } from "./run";
import type { ExtractInput, ExtractModel, ExtractResult } from "./types";

export * from "./types";
export { runExtract, defaultExtractLogger, type RunExtractOptions } from "./run";
export { validateExtractOutput, OUTPUT_JSON_SCHEMA, TOOL_NAME } from "./schema";
export { SYSTEM_PROMPT, SPEC_INSTRUCTION, PROMPT_VARIANTS, V2_CLARIFICATIONS, systemPromptFor, buildUserText, type PromptVariant } from "./prompt";
export { listingModelConfig, ListingConfigError, type ListingModelConfig } from "./config";
export { createBedrockModel, getBedrockClient, buildConverseInput, readConverseReply } from "./bedrock";
export { createFakeModel, fakeExtract } from "./fake";

/** The model for the current environment. Throws ListingConfigError on bad configuration. */
export function modelFromEnv(): ExtractModel {
  const config = listingModelConfig();
  return config.provider === "bedrock" ? createBedrockModel(config) : createFakeModel();
}

/** Run the extract step. Never throws for model, configuration or schema failures: they come back as { ok: false }. */
export async function extract(input: ExtractInput): Promise<ExtractResult> {
  let model: ExtractModel;
  try {
    model = modelFromEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof ListingConfigError)) console.error("[listing.extract] could not create the model client", error);
    console.error(`[listing.extract] configuration error: ${message}`);
    return configFailure(input, process.env.LISTING_MODEL_PROVIDER ?? "unset", message);
  }
  return runExtract(input, model);
}
