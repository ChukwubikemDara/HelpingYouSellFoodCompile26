/** GET /api/customers/me -> Customer (no_show_count and blocked derived now). */
import { now } from "@/lib/clock";
import { handle, json } from "@/lib/http";
import { getMe } from "@/lib/services/customers";
import { requireCustomer } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (request) => {
  const customer = await requireCustomer(request);
  return json(await getMe(customer, now()));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
