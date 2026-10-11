/** POST /api/auth/merchant/signout -> { ok: true }; ends the session and clears the cookie (also without a session). */
import { destroyMerchantSession } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = handle(async (request) => {
  const { setCookie } = await destroyMerchantSession(request);
  return json({ ok: true as const }, { headers: { "set-cookie": setCookie } });
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
