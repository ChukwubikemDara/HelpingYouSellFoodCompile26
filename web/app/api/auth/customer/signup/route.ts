/** POST /api/auth/customer/signup -> 201 { token, customer }, or ACCOUNT_EXISTS. */
import { handle, json, readJson } from "@/lib/http";
import { signupCustomer } from "@/lib/services/accounts";

export const dynamic = "force-dynamic";

export const POST = handle(async (request) => json(await signupCustomer(await readJson(request)), 201));

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
