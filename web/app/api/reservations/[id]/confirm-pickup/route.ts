/** POST /api/reservations/{id}/confirm-pickup -> Reservation (picked_up), only inside the pickup window. */
import { now } from "@/lib/clock";
import { handle, json } from "@/lib/http";
import { confirmPickup } from "@/lib/services/reservations";
import { requireCustomer } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const POST = handle(async (request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const customer = await requireCustomer(request);
  return json(await confirmPickup(customer, id, now()));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
