/** GET /api/merchants/{id}/suggestions -> { suggestions }, computed now. */
import { now } from "@/lib/clock";
import { handle, json } from "@/lib/http";
import { requireOwnMerchant } from "@/lib/services/session";
import { listSuggestions } from "@/lib/services/suggestions";

export const dynamic = "force-dynamic";

export const GET = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const merchant = await requireOwnMerchant(request, id);
  return json({ suggestions: await listSuggestions(merchant, now()) });
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
