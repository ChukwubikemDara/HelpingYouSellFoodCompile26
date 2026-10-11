/** GET /api/me -> { merchant: Merchant | null } (null = signed in but not onboarded). */
import type { MeResponse } from "@/lib/contract";
import { handle, json } from "@/lib/http";
import { requireMerchantSession } from "@/lib/services/session";
import { merchantView } from "@/lib/services/views";

export const dynamic = "force-dynamic";

export const GET = handle(async (request) => {
  const { merchant } = await requireMerchantSession(request);
  return json<MeResponse>({ merchant: merchant ? merchantView(merchant) : null });
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
