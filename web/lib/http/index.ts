/**
 * Shared helpers for route handlers under app/api.
 *
 * - Errors use the contract envelope `{"error": {"code", "message"}}` with the
 *   HTTP status the contract assigns to the code (ERROR_STATUS).
 * - Throw `ApiError` anywhere inside a handler wrapped with `handle()`; it
 *   becomes the right response. Zod errors become 422 VALIDATION. Anything else
 *   becomes 500 INTERNAL with a safe message and is logged server side.
 * - `message` is shown to users as is: write it as a short, plain sentence.
 */
import type { ZodError, ZodType } from "zod";
import {
  ERROR_STATUS,
  INTERNAL_ERROR_CODE,
  INTERNAL_ERROR_STATUS,
  type ApiErrorBody,
  type ApiErrorCode,
  type ErrorCode,
} from "@/lib/contract";

export const INTERNAL_ERROR_MESSAGE = "Something went wrong. Try again.";

/** An error with a contract code. Its HTTP status comes from ERROR_STATUS. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

const NO_STORE = { "cache-control": "no-store" } as const;

function mergeHeaders(init: ResponseInit | undefined): Headers {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(NO_STORE)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return headers;
}

/**
 * JSON success response. `init` may be a status number or a ResponseInit.
 * Sets `cache-control: no-store` unless the caller sets its own.
 */
export function json<T>(data: T, init?: number | ResponseInit): Response {
  const responseInit: ResponseInit = typeof init === "number" ? { status: init } : (init ?? {});
  return Response.json(data, { ...responseInit, headers: mergeHeaders(responseInit) });
}

/** `{ "ok": true }` with status 200. */
export function ok(init?: ResponseInit): Response {
  return json({ ok: true as const }, init);
}

/** Error envelope response. The status comes from the code. */
export function errorResponse(code: ApiErrorCode, message: string, init?: ResponseInit): Response {
  const status = code === INTERNAL_ERROR_CODE ? INTERNAL_ERROR_STATUS : ERROR_STATUS[code];
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { ...init, status, headers: mergeHeaders(init) });
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function describePath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((segment, i) => {
      if (typeof segment === "number") return `[${segment}]`;
      const name = String(segment);
      return i === 0 ? name : `.${name}`;
    })
    .join("");
}

/**
 * A zod error as a 422 VALIDATION ApiError. The message names the first
 * failing field ("quantity: Too small...") so the user knows what to fix.
 * Give schemas custom messages where the default wording is not user-friendly.
 */
export function validationError(error: ZodError): ApiError {
  const issue = error.issues[0];
  if (!issue) return new ApiError("VALIDATION", "Invalid request.");
  const where = describePath(issue.path);
  return new ApiError("VALIDATION", where ? `${where}: ${issue.message}` : issue.message);
}

function isZodError(value: unknown): value is ZodError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { name?: unknown }).name === "ZodError" &&
    Array.isArray((value as { issues?: unknown }).issues)
  );
}

/** Validate a value (body, query object, params) with a zod schema; failures throw 422 VALIDATION. */
export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/**
 * Read the request body as JSON. An empty or malformed body throws
 * 422 VALIDATION. Do not call it for endpoints that take no body.
 */
export async function readJson(request: Request): Promise<unknown> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new ApiError("VALIDATION", "Could not read the request body.");
  }
  if (text.trim() === "") throw new ApiError("VALIDATION", "Request body is required.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("VALIDATION", "Request body must be valid JSON.");
  }
}

/** True when Content-Type is application/json (parameters such as charset allowed). */
export function hasJsonContentType(request: Request): boolean {
  const type = request.headers.get("content-type");
  return type !== null && /^application\/json\s*(;|$)/i.test(type.trim());
}

/**
 * `readJson` that also requires `Content-Type: application/json`, else 422
 * VALIDATION. For endpoints that set a session cookie without needing one
 * (merchant sign-in and sign-up): a cross-site HTML form can only send form
 * encodings or text/plain, so this stops a site from signing a visitor into
 * another account (login CSRF). Other merchant endpoints need the cookie,
 * which SameSite=Lax keeps off cross-site POSTs. The portal always sends JSON.
 */
export async function readJsonStrict(request: Request): Promise<unknown> {
  if (!hasJsonContentType(request)) {
    throw new ApiError("VALIDATION", "Send the request body as JSON (Content-Type: application/json).");
  }
  return readJson(request);
}

/** Read the JSON body and validate it. Malformed JSON or schema failure throws 422 VALIDATION. */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  return parseWith(schema, await readJson(request));
}

/** The URL's query parameters as a plain object (last value wins), ready for `parseWith`. */
export function queryObject(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) out[key] = value;
  return out;
}

/* ------------------------------------------------------------------ */
/* Handler wrapper                                                     */
/* ------------------------------------------------------------------ */

/** Any thrown value as a contract error response. Unknown errors are logged and become 500. */
export function toErrorResponse(error: unknown): Response {
  if (isApiError(error)) return errorResponse(error.code, error.message);
  if (isZodError(error)) {
    const apiError = validationError(error);
    return errorResponse(apiError.code, apiError.message);
  }
  console.error("[api] unhandled error", error);
  return errorResponse(INTERNAL_ERROR_CODE, INTERNAL_ERROR_MESSAGE);
}

/**
 * Wrap a route handler so thrown errors become contract error responses.
 *
 *   export const GET = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
 *     const { id } = await ctx.params;
 *     ...
 *     return json(deal);
 *   });
 */
export function handle<C = unknown>(
  fn: (request: Request, context: C) => Response | Promise<Response>,
): (request: Request, context: C) => Promise<Response> {
  return async (request, context) => {
    try {
      return await fn(request, context);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/**
 * 404 NOT_FOUND "Not found." in the error envelope. The catch-all route
 * answers unknown /api paths with it, and every route file exports it for the
 * methods it does not support, so Next.js never answers 405 with an empty
 * body (the contract has no 405 code).
 */
export const unknownRoute = handle(async () => {
  throw new ApiError("NOT_FOUND", "Not found.");
});
