/** POST /api/auth/merchant/signin -> { ok: true } + session cookie, or BAD_CREDENTIALS. */
import { handle, json, readJsonStrict } from "@/lib/http";
import { signinMerchant } from "@/lib/services/accounts";

export const dynamic = "force-dynamic";

export const POST = handle(async (request) => {
  const { setCookie } = await signinMerchant(await readJsonStrict(request));
  return json({ ok: true as const }, { headers: { "set-cookie": setCookie } });
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
