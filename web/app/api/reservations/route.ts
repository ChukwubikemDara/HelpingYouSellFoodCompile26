/**
 * POST /api/reservations { deal_id, quantity } -> 201 Reservation, or SOLD_OUT / DEAL_NOT_LIVE / CUSTOMER_BLOCKED.
 * GET /api/reservations -> { reservations } newest first.
 */
import { now } from "@/lib/clock";
import { handle, json, readJson } from "@/lib/http";
import { listCustomerReservations, reserve } from "@/lib/services/reservations";
import { requireCustomer } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (request) => {
  const customer = await requireCustomer(request);
  return json({ reservations: await listCustomerReservations(customer, now()) });
});

export const POST = handle(async (request) => {
  const customer = await requireCustomer(request);
  return json(await reserve(customer, await readJson(request), now()), 201);
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
