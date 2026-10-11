/**
 * Listing model configuration from the environment.
 *
 * - LISTING_MODEL_PROVIDER: "bedrock" | "fake", read in lib/config.ts. Unset:
 *   "bedrock" in production, "fake" elsewhere (with a warning). "fake" is a
 *   rule-based stand-in for local dev and the e2e script only.
 * - LISTING_MODEL_ID: Bedrock model id or inference profile id. Required for bedrock.
 * - LISTING_MODEL_TEMPERATURE: sent only when set (current Claude models on
 *   Bedrock reject a non-default temperature).
 * - LISTING_TOOL_CHOICE: "auto" (default; the system prompt tells the model to
 *   call the tool) or "tool" (forces the tool; some models reject it).
 * - LISTING_MODEL_EXTRA_FIELDS: JSON object passed as additionalModelRequestFields.
 * - LISTING_PROMPT_VARIANT: "spec" (default; the spec's instruction verbatim) or
 *   "v2" (the spec's instruction plus clarifications; see prompt.ts).
 */
import {
  ConfigError,
  LISTING_PROVIDERS,
  listingProvider,
  listingProviderIsDefault,
  type ListingProvider,
} from "@/lib/config";
import { PROMPT_VARIANTS, type PromptVariant } from "./prompt";

export { LISTING_PROVIDERS, type ListingProvider };

export const TOOL_CHOICES = ["auto", "tool"] as const;
export type ToolChoiceMode = (typeof TOOL_CHOICES)[number];

export interface ListingModelConfig {
  provider: ListingProvider;
  /** null for the fake provider. */
  modelId: string | null;
  temperature: number | undefined;
  toolChoice: ToolChoiceMode;
  extraFields: Record<string, unknown> | undefined;
  promptVariant: PromptVariant;
}

export class ListingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListingConfigError";
  }
}

type Env = Record<string, string | undefined>;

const holder = globalThis as typeof globalThis & { __listingFakeWarned?: boolean };

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** Read and check the configuration. Throws ListingConfigError with a plain message when it is invalid. */
export function listingModelConfig(env: Env = process.env): ListingModelConfig {
  let provider: ListingProvider;
  try {
    provider = listingProvider(env);
  } catch (error) {
    if (error instanceof ConfigError) throw new ListingConfigError(error.message);
    throw error;
  }
  if (provider === "fake" && listingProviderIsDefault(env) && !holder.__listingFakeWarned) {
    holder.__listingFakeWarned = true;
    console.warn(
      "[listing] LISTING_MODEL_PROVIDER is not set: using the rule-based fake extractor (local dev only). Set LISTING_MODEL_PROVIDER=bedrock and LISTING_MODEL_ID to use the real model.",
    );
  }

  const modelId = read(env, "LISTING_MODEL_ID") ?? null;
  if (provider === "bedrock" && modelId === null) {
    throw new ListingConfigError("LISTING_MODEL_ID is required when LISTING_MODEL_PROVIDER=bedrock.");
  }

  const rawTemperature = read(env, "LISTING_MODEL_TEMPERATURE");
  let temperature: number | undefined;
  if (rawTemperature !== undefined) {
    temperature = Number(rawTemperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
      throw new ListingConfigError(
        `LISTING_MODEL_TEMPERATURE must be a number from 0 to 1; got "${rawTemperature}".`,
      );
    }
  }

  const rawToolChoice = read(env, "LISTING_TOOL_CHOICE")?.toLowerCase() ?? "auto";
  if (!(TOOL_CHOICES as readonly string[]).includes(rawToolChoice)) {
    throw new ListingConfigError(
      `LISTING_TOOL_CHOICE must be one of ${TOOL_CHOICES.join(", ")}; got "${rawToolChoice}".`,
    );
  }

  const rawVariant = read(env, "LISTING_PROMPT_VARIANT")?.toLowerCase() ?? "spec";
  if (!(PROMPT_VARIANTS as readonly string[]).includes(rawVariant)) {
    throw new ListingConfigError(
      `LISTING_PROMPT_VARIANT must be one of ${PROMPT_VARIANTS.join(", ")}; got "${rawVariant}".`,
    );
  }

  const rawExtra = read(env, "LISTING_MODEL_EXTRA_FIELDS");
  let extraFields: Record<string, unknown> | undefined;
  if (rawExtra !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawExtra) as unknown;
    } catch {
      throw new ListingConfigError("LISTING_MODEL_EXTRA_FIELDS must be a JSON object.");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ListingConfigError("LISTING_MODEL_EXTRA_FIELDS must be a JSON object.");
    }
    extraFields = parsed as Record<string, unknown>;
  }

  return {
    provider,
    modelId: provider === "fake" ? null : modelId,
    temperature,
    toolChoice: rawToolChoice as ToolChoiceMode,
    extraFields,
    promptVariant: rawVariant as PromptVariant,
  };
}
