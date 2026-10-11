/** POST /api/deals/{id}/mark-donated -> Deal (unsold_action donated), only when expired with units left. */
import { now } from "@/lib/clock";
import { handle, json } from "@/lib/http";
import { markDealDonated } from "@/lib/services/deals";
import { requireMerchant } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const POST = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const merchant = await requireMerchant(request);
  return json(await markDealDonated(merchant, id, now()));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
