/**
 * POST /api/merchants/{id}/drafts: the listing agent (docs/agent-spec.md).
 *
 * Body: { text?: string, photo_base64?: string }, at least one.
 * Returns { drafts: [Draft] }, one per product; may be empty, in which case
 * the portal shows the manual form. Each draft's deal is saved with status
 * "draft"; nothing is published.
 *
 * 401 UNAUTHORIZED without a merchant session; 404 NOT_FOUND unless {id} is
 * the signed-in merchant; 422 VALIDATION for a bad body or neither text nor photo.
 */
import { z } from "zod";
import { handle, json, parseJsonBody } from "@/lib/http";
import { createDrafts } from "@/lib/listing";
import { requireOwnMerchant } from "@/lib/services/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  text: z.string({ error: "must be text" }).nullish(),
  photo_base64: z.string({ error: "must be a base64 string" }).nullish(),
});

export const POST = handle(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const merchant = await requireOwnMerchant(request, id);
  const body = await parseJsonBody(request, bodySchema);
  return json(await createDrafts(merchant, body));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
