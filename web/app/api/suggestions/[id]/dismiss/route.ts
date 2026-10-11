/** POST /api/suggestions/{id}/dismiss -> { ok: true }. Does not come back for that deal / that day. */
import { now } from "@/lib/clock";
import { handle, ok } from "@/lib/http";
import { requireMerchant } from "@/lib/services/session";
import { dismissSuggestion } from "@/lib/services/suggestions";

export const dynamic = "force-dynamic";

export const POST = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const merchant = await requireMerchant(request);
  await dismissSuggestion(merchant, id, now());
  return ok();
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
