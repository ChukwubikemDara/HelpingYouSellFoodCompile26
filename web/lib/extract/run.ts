/**
 * The extract step's control flow, independent of the provider
 * (docs/agent-spec.md "Failure handling"):
 *
 * - Validate the output against the schema. On failure, retry once with the
 *   validation error appended; a second failure is `invalid_output`.
 * - A call that throws is `model_error`.
 * - The whole step (retry included) has EXTRACT_LIMITS.timeoutMs; running
 *   over is `timeout`.
 * - One log line per extract step: input text, whether a photo was sent, raw
 *   output, validation result, latency. Never the photo.
 *
 * Never throws for model or schema failures.
 */
import { TOOL_NAME, validateExtractOutput } from "./schema";
import {
  EXTRACT_LIMITS,
  type ExtractAttemptLog,
  type ExtractFailureReason,
  type ExtractInput,
  type ExtractLog,
  type ExtractModel,
  type ExtractOutput,
  type ExtractResult,
  type FailedAttempt,
  type ModelReply,
} from "./types";

export interface RunExtractOptions {
  /** Budget for the whole step. Default EXTRACT_LIMITS.timeoutMs. */
  timeoutMs?: number;
  /** Where the log line goes. Default: console.info as one JSON line. */
  log?: (entry: ExtractLog) => void;
}

class TimeoutError extends Error {
  constructor() {
    super("The model call took too long.");
    this.name = "TimeoutError";
  }
}

export function defaultExtractLogger(entry: ExtractLog): void {
  console.info(`[listing.extract] ${JSON.stringify(entry)}`);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Run `fn` with an abort signal that fires after `ms`; reject with TimeoutError then. */
async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } catch (error) {
    if (controller.signal.aborted) throw new TimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    // A provider that ignores the signal must not leave an unhandled rejection behind.
    timeout.catch(() => undefined);
  }
}

function rawOutputOf(reply: ModelReply): unknown {
  if (reply.toolInput !== undefined) return reply.toolInput;
  return reply.text;
}

/** Check one reply: the tool must have been called with a valid input. */
function validateReply(reply: ModelReply) {
  if (reply.toolInput === undefined) {
    return {
      ok: false as const,
      error: `No call to the ${TOOL_NAME} tool. Answer by calling ${TOOL_NAME} with the schema.`,
    };
  }
  return validateExtractOutput(reply.toolInput);
}

/** Run the extract step with a given model. */
export async function runExtract(
  input: ExtractInput,
  model: ExtractModel,
  options: RunExtractOptions = {},
): Promise<ExtractResult> {
  const timeoutMs = options.timeoutMs ?? EXTRACT_LIMITS.timeoutMs;
  const log = options.log ?? defaultExtractLogger;
  const started = Date.now();
  const details: ExtractAttemptLog[] = [];
  const failed: FailedAttempt[] = [];

  const finish = (
    outcome: { ok: true; output: ExtractOutput } | { ok: false; reason: ExtractFailureReason },
    error: string | null,
  ): ExtractResult => {
    const last = details[details.length - 1];
    const entry: ExtractLog = {
      provider: model.provider,
      model_id: model.modelId,
      input_text: input.text,
      photo_sent: input.photo !== null,
      raw_output: last ? last.raw_output : null,
      validation_error: last ? last.validation_error : null,
      attempts: details.length,
      latency_ms: Date.now() - started,
      outcome: outcome.ok ? "ok" : outcome.reason,
      error,
      attempt_details: details,
    };
    try {
      log(entry);
    } catch {
      // Logging must never break the request.
    }
    return outcome.ok
      ? { ok: true, output: outcome.output, log: entry }
      : { ok: false, reason: outcome.reason, log: entry };
  };

  for (let attempt = 0; attempt < EXTRACT_LIMITS.maxAttempts; attempt += 1) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) return finish({ ok: false, reason: "timeout" }, "TimeoutError: no time left for a retry.");

    const callStarted = Date.now();
    let reply: ModelReply;
    try {
      reply = await withTimeout(remaining, (signal) => model.call(input, failed, signal));
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      details.push({
        raw_output: null,
        validation_error: null,
        error: describeError(error),
        stop_reason: null,
        latency_ms: Date.now() - callStarted,
      });
      return finish({ ok: false, reason: timedOut ? "timeout" : "model_error" }, describeError(error));
    }

    const validation = validateReply(reply);
    details.push({
      raw_output: rawOutputOf(reply),
      validation_error: validation.ok ? null : validation.error,
      error: null,
      stop_reason: reply.stopReason,
      latency_ms: Date.now() - callStarted,
    });
    if (validation.ok) return finish({ ok: true, output: validation.output }, null);
    failed.push({ reply, validationError: validation.error });
  }
  return finish({ ok: false, reason: "invalid_output" }, null);
}

/** A failed result for an extract step that could not start (bad configuration). No model call is made. */
export function configFailure(
  input: ExtractInput,
  provider: string,
  message: string,
  log: (entry: ExtractLog) => void = defaultExtractLogger,
): ExtractResult {
  const entry: ExtractLog = {
    provider,
    model_id: null,
    input_text: input.text,
    photo_sent: input.photo !== null,
    raw_output: null,
    validation_error: null,
    attempts: 0,
    latency_ms: 0,
    outcome: "model_error",
    error: `ListingConfigError: ${message}`,
    attempt_details: [],
  };
  try {
    log(entry);
  } catch {
    // ignore
  }
  return { ok: false, reason: "model_error", log: entry };
}
