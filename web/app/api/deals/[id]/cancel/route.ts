/** POST /api/deals/{id}/cancel -> Deal (cancelled); open reservations are cancelled and notified. */
import { now } from "@/lib/clock";
import { handle, json } from "@/lib/http";
import { cancelDeal } from "@/lib/services/deals";
import { requireMerchant } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const POST = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const merchant = await requireMerchant(request);
  return json(await cancelDeal(merchant, id, now()));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
