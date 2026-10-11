/** GET /api/notifications?since=<ISO time> -> { notifications } newest first, created at or after `since`. Due pickup reminders are created on read. */
import { INSTANT_RANGE, isInstantInRange, isIsoInstant, now } from "@/lib/clock";
import { ApiError, handle, json, queryObject } from "@/lib/http";
import { db } from "@/lib/services/db";
import { listNotifications } from "@/lib/services/notifications";
import { requireCustomer } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (request) => {
  const customer = await requireCustomer(request);
  const raw = queryObject(request).since?.trim();
  const since = raw ? raw : undefined;
  if (since !== undefined && !isIsoInstant(since)) {
    throw new ApiError("VALIDATION", "since: Must be an ISO 8601 time with offset, like 2026-10-11T18:00:00-04:00.");
  }
  if (since !== undefined && !isInstantInRange(since)) throw new ApiError("VALIDATION", `since: ${INSTANT_RANGE.message}`);
  return json({ notifications: await listNotifications(await db(), customer.id, since, now()) });
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
