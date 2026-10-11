/** POST /api/merchants -> 201 Merchant (onboarding). lat/lng stay null when not sent (no geocoding). */
import { handle, json, readJson } from "@/lib/http";
import { createMerchant } from "@/lib/services/merchants";
import { requireMerchantSession } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const POST = handle(async (request) => {
  const { account } = await requireMerchantSession(request);
  return json(await createMerchant(account.id, await readJson(request)), 201);
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
