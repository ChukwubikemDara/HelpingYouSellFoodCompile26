/** POST /api/suggestions/{id}/accept -> Deal for lower_price; { ok: true } for list_now. */
import { now } from "@/lib/clock";
import { handle, json } from "@/lib/http";
import { requireMerchant } from "@/lib/services/session";
import { acceptSuggestion } from "@/lib/services/suggestions";

export const dynamic = "force-dynamic";

export const POST = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const merchant = await requireMerchant(request);
  return json(await acceptSuggestion(merchant, id, now()));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
