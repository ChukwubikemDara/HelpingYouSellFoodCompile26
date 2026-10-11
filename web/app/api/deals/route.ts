/**
 * GET /api/deals (no sign-in): live and sold_out deals; ?category=&kind=&lat=&lng=&sort=.
 * POST /api/deals (merchant): manual draft.
 */
import { now } from "@/lib/clock";
import { handle, json, queryObject, readJson } from "@/lib/http";
import { createDeal, listPublicDeals, parsePublicDealsQuery } from "@/lib/services/deals";
import { requireMerchant } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (request) => {
  const query = parsePublicDealsQuery(queryObject(request));
  return json({ deals: await listPublicDeals(query, now()) });
});

export const POST = handle(async (request) => {
  const merchant = await requireMerchant(request);
  return json(await createDeal(merchant, await readJson(request), now()));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
