/** POST /api/auth/merchant/signup -> { ok: true } + session cookie, or ACCOUNT_EXISTS. */
import { handle, json, readJsonStrict } from "@/lib/http";
import { signupMerchant } from "@/lib/services/accounts";

export const dynamic = "force-dynamic";

export const POST = handle(async (request) => {
  const { setCookie } = await signupMerchant(await readJsonStrict(request));
  return json({ ok: true as const }, { headers: { "set-cookie": setCookie } });
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
