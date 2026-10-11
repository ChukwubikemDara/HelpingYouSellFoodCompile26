/**
 * POST /api/e2e/no-shows: test-only hook for scripts/e2e.ts (not in the
 * contract). Body { customer_id, count? } gives that customer `count`
 * (default 2) reservations whose pickup window has already ended, so they read
 * as no_show. On only when E2E_HOOKS=1 outside production; otherwise every
 * method answers 404 NOT_FOUND exactly like an unknown /api path. See
 * lib/services/e2e-hooks.ts.
 */
import { ApiError, handle, json, readJson } from "@/lib/http";
import { createNoShows, requireE2eHooks } from "@/lib/services/e2e-hooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  requireE2eHooks();
  return json(await createNoShows(await readJson(request)), 201);
});

/** Other methods: the catch-all's 404, so the route looks like any unknown path. */
const notFound = handle(async () => {
  throw new ApiError("NOT_FOUND", "Not found.");
});

export const GET = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
