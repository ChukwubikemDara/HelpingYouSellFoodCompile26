/** POST /api/auth/customer/signin -> { token, customer }, or BAD_CREDENTIALS. */
import { handle, json, readJson } from "@/lib/http";
import { signinCustomer } from "@/lib/services/accounts";

export const dynamic = "force-dynamic";

export const POST = handle(async (request) => json(await signinCustomer(await readJson(request))));

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
