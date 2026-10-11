/**
 * Types for the listing agent's extract step (docs/agent-spec.md).
 * Re-exported from lib/extract.
 */
import type { MerchantCategory } from "@/lib/contract";

/** Input to the model (agent-spec "Input to the model"). Prices are never sent. */
export interface ExtractInput {
  /** Current local time, "HH:MM" 24h, America/New_York. */
  now_local: string;
  /** The merchant's closing time, "HH:MM" 24h. */
  closes_at: string;
  category: MerchantCategory;
  /** The merchant's message, passed to the model wrapped as data. null if none. */
  text: string | null;
  /** The photo, if any. Never logged. */
  photo: ExtractPhoto | null;
  /** Names of the items on the merchant's menu (names only, no prices). */
  menu_item_names: string[];
}

export interface ExtractPhoto {
  bytes: Uint8Array;
  /** "image/jpeg", "image/png", "image/webp" or "image/gif". */
  content_type: string;
}

/** One product as the model returns it (agent-spec "Output schema"). */
export interface ExtractedProduct {
  /** Singular, as the merchant would label it. */
  name: string;
  /** Integer >= 1, or null when not stated / not countable. */
  quantity: number | null;
  /** Integer >= 1. Items per sale unit; 1 unless packs or boxes are stated. */
  unit_size: number;
  original_price_cents: number | null;
  deal_price_cents: number | null;
  /** Integer 1-99, or null. */
  discount_pct: number | null;
  /** Only allergens the message names for this product, or null. */
  allergens: string[] | null;
}

/** The model's validated output. */
export interface ExtractOutput {
  /** At most EXTRACT_LIMITS.maxProducts; the rest are ignored. */
  products: ExtractedProduct[];
  /** "HH:MM" 24h or null. */
  pickup_start: string | null;
  /** "HH:MM" 24h or null. */
  pickup_end: string | null;
}

export type ExtractFailureReason =
  /** Output did not match the schema, also after the one retry. */
  | "invalid_output"
  /** The model call errored (including missing or invalid configuration). */
  | "model_error"
  /** The extract step took longer than EXTRACT_LIMITS.timeoutMs. */
  | "timeout";

/** One model call inside an extract step. */
export interface ExtractAttemptLog {
  /** What the model returned: the tool input, or its text when it did not call the tool. null if the call failed. */
  raw_output: unknown;
  /** Why the output was rejected, or null if it was valid (or the call failed). */
  validation_error: string | null;
  /** Error name and message when the call itself failed. Never request contents. */
  error: string | null;
  /** The provider's stop reason, when it gives one. */
  stop_reason: string | null;
  latency_ms: number;
}

/** Facts logged for every call (agent-spec "Log for every call"). Never the photo. */
export interface ExtractLog {
  provider: string;
  model_id: string | null;
  input_text: string | null;
  photo_sent: boolean;
  /** Raw model output of the last attempt, or null if there was none. */
  raw_output: unknown;
  /** Validation error of the last attempt, or null if it was valid. */
  validation_error: string | null;
  /** 1, or 2 after the schema retry. 0 if no call was made (configuration error). */
  attempts: number;
  /** Total latency of the extract step. */
  latency_ms: number;
  /** "ok", or the failure reason. */
  outcome: "ok" | ExtractFailureReason;
  /** Error name and message of the last failed call, or the configuration error. */
  error: string | null;
  /** Every model call, in order. */
  attempt_details: ExtractAttemptLog[];
}

export type ExtractResult =
  | { ok: true; output: ExtractOutput; log: ExtractLog }
  | { ok: false; reason: ExtractFailureReason; log: ExtractLog };

export const EXTRACT_LIMITS = {
  maxProducts: 20,
  /** Budget for the whole extract step, retry included. */
  timeoutMs: 15_000,
  /** One retry after a schema failure, with the validation error appended. */
  maxAttempts: 2,
  /** Cap on the model's answer. 20 products fit easily. */
  maxOutputTokens: 4096,
} as const;

/** What a provider returned for one call. */
export interface ModelReply {
  /** The tool's input when the model called the tool; undefined when it did not. */
  toolInput: unknown;
  /** Text the model wrote, if any. */
  text: string | null;
  stopReason: string | null;
  /** The provider's own message object, replayed on the retry. Opaque here. */
  message: unknown;
}

/** An earlier attempt whose output failed validation. */
export interface FailedAttempt {
  reply: ModelReply;
  validationError: string;
}

/** A model provider behind extract(). */
export interface ExtractModel {
  readonly provider: string;
  readonly modelId: string | null;
  /**
   * One model call. `previous` holds earlier attempts in this extract step
   * whose output failed validation; the provider appends them (and the
   * validation error) to the conversation. Must stop when `signal` aborts.
   */
  call(input: ExtractInput, previous: readonly FailedAttempt[], signal: AbortSignal): Promise<ModelReply>;
}
