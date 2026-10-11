/** POST /api/customers/me/push-token { expo_push_token } -> { ok: true }. Stored; remote push is off. */
import { handle, ok, readJson } from "@/lib/http";
import { savePushToken } from "@/lib/services/customers";
import { requireCustomer } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const POST = handle(async (request) => {
  const customer = await requireCustomer(request);
  await savePushToken(customer, await readJson(request));
  return ok();
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
