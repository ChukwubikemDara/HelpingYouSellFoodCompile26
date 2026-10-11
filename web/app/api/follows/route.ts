/** GET /api/follows -> { merchant_ids }. POST /api/follows { merchant_id } -> { ok: true }. */
import { handle, json, ok, readJson } from "@/lib/http";
import { follow, listFollows } from "@/lib/services/customers";
import { requireCustomer } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (request) => {
  const customer = await requireCustomer(request);
  return json({ merchant_ids: await listFollows(customer) });
});

export const POST = handle(async (request) => {
  const customer = await requireCustomer(request);
  await follow(customer, await readJson(request));
  return ok();
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
