/**
 * GET /api/billing/links -> { pricing_url, portal_url }. STUB: no billing code
 * here (CLAUDE.md); /monetize generates the real pages.
 */
import type { BillingLinks } from "@/lib/contract";
import { handle, json } from "@/lib/http";
import { billingLinks } from "@/lib/services/billing";
import { requireMerchantSession } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (request) => {
  await requireMerchantSession(request);
  return json<BillingLinks>(billingLinks());
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
