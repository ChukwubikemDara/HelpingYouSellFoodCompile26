/** POST /api/notifications/{id}/read -> { ok: true }; 404 unless it is the customer's. */
import { handle, ok } from "@/lib/http";
import { db } from "@/lib/services/db";
import { markNotificationRead } from "@/lib/services/notifications";
import { requireCustomer } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const POST = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const customer = await requireCustomer(request);
  await markNotificationRead(await db(), customer.id, id);
  return ok();
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
