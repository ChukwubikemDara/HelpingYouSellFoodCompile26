/** DELETE /api/follows/{merchant_id} -> { ok: true }. Idempotent. */
import { handle, ok } from "@/lib/http";
import { unfollow } from "@/lib/services/customers";
import { requireCustomer } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const DELETE = handle(async (request, ctx: { params: Promise<{ merchant_id: string }> }) => {
  const { merchant_id } = await ctx.params;
  const customer = await requireCustomer(request);
  await unfollow(customer, merchant_id);
  return ok();
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH } from "@/lib/http";
