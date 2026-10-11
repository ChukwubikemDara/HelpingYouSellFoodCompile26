/**
 * GET /api/deals/{id} (no sign-in): a published deal; a draft only for its own merchant.
 * PATCH /api/deals/{id} (merchant): draft or live edits.
 */
import { getCurrentMerchant } from "@/lib/auth";
import { now } from "@/lib/clock";
import { handle, json, readJson } from "@/lib/http";
import { getPublicDeal, updateDeal } from "@/lib/services/deals";
import { requireMerchant } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const viewer = async () => (await getCurrentMerchant(request))?.merchant?.id ?? null;
  return json(await getPublicDeal(id, now(), viewer));
});

export const PATCH = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const merchant = await requireMerchant(request);
  return json(await updateDeal(merchant, id, await readJson(request), now()));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as DELETE } from "@/lib/http";
