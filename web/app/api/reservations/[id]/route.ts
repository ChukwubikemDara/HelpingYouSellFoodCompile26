/** GET /api/reservations/{id} -> Reservation; 404 unless it is the signed-in customer's. */
import { now } from "@/lib/clock";
import { handle, json } from "@/lib/http";
import { getCustomerReservation } from "@/lib/services/reservations";
import { requireCustomer } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const customer = await requireCustomer(request);
  return json(await getCustomerReservation(customer, id, now()));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
