/** GET / PATCH /api/merchants/{id}; 404 unless {id} is the signed-in merchant. */
import { handle, json, readJson } from "@/lib/http";
import { updateMerchant } from "@/lib/services/merchants";
import { requireOwnMerchant } from "@/lib/services/session";
import { merchantView } from "@/lib/services/views";

export const dynamic = "force-dynamic";

export const GET = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return json(merchantView(await requireOwnMerchant(request, id)));
});

export const PATCH = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const merchant = await requireOwnMerchant(request, id);
  return json(await updateMerchant(merchant, await readJson(request)));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as DELETE } from "@/lib/http";
