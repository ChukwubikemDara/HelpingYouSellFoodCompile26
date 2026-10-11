/** GET /api/merchants/{id}/deals?date= -> { deals } all statuses, for that business date (default today). */
import { now } from "@/lib/clock";
import { handle, json, queryObject } from "@/lib/http";
import { listMerchantDeals } from "@/lib/services/deals";
import { requireOwnMerchant } from "@/lib/services/session";
import { parseDateQuery } from "@/lib/services/validation";

export const dynamic = "force-dynamic";

export const GET = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const merchant = await requireOwnMerchant(request, id);
  const date = parseDateQuery(queryObject(request).date);
  return json({ deals: await listMerchantDeals(merchant, date, now()) });
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
