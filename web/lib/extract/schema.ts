/**
 * The extract step's output schema (docs/agent-spec.md "Output schema"), in
 * two forms that must stay in step:
 * - OUTPUT_JSON_SCHEMA: sent to the model as the tool's input schema.
 * - validateExtractOutput(): checks what the model returned (zod).
 *
 * Validation rules:
 * - Only the first EXTRACT_LIMITS.maxProducts products are read; the rest are
 *   ignored before validation ("Max 20 products; ignore the rest").
 * - A missing nullable field is read as null and a missing unit_size as 1:
 *   both mean "not stated", which is what the spec asks for. Extra keys are
 *   dropped. Wrong types and out-of-range values fail validation.
 * - Times may come as "H:MM"; they are padded to "HH:MM".
 */
import { z } from "zod";
import type { ExtractOutput } from "./types";
import { EXTRACT_LIMITS } from "./types";

export const TOOL_NAME = "record_listing";

export const TOOL_DESCRIPTION =
  "Record the products, quantities, prices, allergens and pickup times that the message and photo state.";

const HHMM_PATTERN = "^([01]\\d|2[0-3]):[0-5]\\d$";

/** JSON Schema for the tool input. Mirrors the spec's output schema. */
export const OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      description: `Each distinct product once. At most ${EXTRACT_LIMITS.maxProducts}.`,
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Singular, as the merchant would label it." },
          quantity: {
            type: ["integer", "null"],
            minimum: 1,
            description: "The number of sale units, or null.",
          },
          unit_size: {
            type: "integer",
            minimum: 1,
            description: "Items per sale unit. 1 unless the message says items are sold in packs or boxes.",
          },
          original_price_cents: {
            type: ["integer", "null"],
            description: "Regular price per sale unit in cents, only if the message gives it.",
          },
          deal_price_cents: {
            type: ["integer", "null"],
            description: "Sale price per sale unit in cents, only if the message gives it.",
          },
          discount_pct: {
            type: ["integer", "null"],
            minimum: 1,
            maximum: 99,
            description: "Discount in percent, only if the message gives it.",
          },
          allergens: {
            type: ["array", "null"],
            items: { type: "string" },
            description: "Only allergens the message names for this product, or null.",
          },
        },
        required: [
          "name",
          "quantity",
          "unit_size",
          "original_price_cents",
          "deal_price_cents",
          "discount_pct",
          "allergens",
        ],
        additionalProperties: false,
      },
    },
    pickup_start: {
      type: ["string", "null"],
      pattern: HHMM_PATTERN,
      description: "24-hour HH:MM, only if the message gives it.",
    },
    pickup_end: {
      type: ["string", "null"],
      pattern: HHMM_PATTERN,
      description: "24-hour HH:MM, only if the message gives it.",
    },
  },
  required: ["products", "pickup_start", "pickup_end"],
  additionalProperties: false,
} as const;

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const timeSchema = z
  .string()
  .trim()
  .regex(TIME, "must be 24-hour HH:MM")
  .transform((value) => {
    const m = TIME.exec(value) as RegExpExecArray;
    return `${m[1].padStart(2, "0")}:${m[2]}`;
  });

const nullableInt = z.number().int("must be an integer").nullable().default(null);

const productSchema = z.object({
  name: z.string().trim().min(1, "must not be empty"),
  quantity: z.number().int("must be an integer").min(1, "must be at least 1").nullable().default(null),
  unit_size: z.number().int("must be an integer").min(1, "must be at least 1").default(1),
  original_price_cents: nullableInt,
  deal_price_cents: nullableInt,
  discount_pct: z
    .number()
    .int("must be an integer")
    .min(1, "must be 1-99")
    .max(99, "must be 1-99")
    .nullable()
    .default(null),
  allergens: z.array(z.string()).nullable().default(null),
});

const envelopeSchema = z.object({
  products: z.array(z.unknown()),
  pickup_start: timeSchema.nullable().default(null),
  pickup_end: timeSchema.nullable().default(null),
});

export type ValidationResult = { ok: true; output: ExtractOutput } | { ok: false; error: string };

function describeIssue(issue: z.core.$ZodIssue, prefix: (string | number)[]): string {
  const path = [...prefix, ...issue.path]
    .map((segment, i) =>
      typeof segment === "number" ? `[${segment}]` : i === 0 ? String(segment) : `.${String(segment)}`,
    )
    .join("");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function describeError(error: z.ZodError, prefix: (string | number)[] = []): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => describeIssue(issue, prefix))
    .join("; ");
}

/** Validate the model's tool input. Never throws. */
export function validateExtractOutput(raw: unknown): ValidationResult {
  let value = raw;
  // Some models send the tool input as a JSON string.
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return { ok: false, error: "The answer is not a JSON object." };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "The answer must be a JSON object with products, pickup_start and pickup_end." };
  }
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) return { ok: false, error: describeError(envelope.error) };

  const products = [];
  const kept = envelope.data.products.slice(0, EXTRACT_LIMITS.maxProducts);
  for (let i = 0; i < kept.length; i += 1) {
    const parsed = productSchema.safeParse(kept[i]);
    if (!parsed.success) return { ok: false, error: describeError(parsed.error, ["products", i]) };
    products.push(parsed.data);
  }
  return {
    ok: true,
    output: {
      products,
      pickup_start: envelope.data.pickup_start,
      pickup_end: envelope.data.pickup_end,
    },
  };
}
