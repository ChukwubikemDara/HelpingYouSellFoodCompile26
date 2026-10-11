/** POST /api/reservations/redeem { pickup_code } (merchant) -> Reservation (picked_up), or CODE_INVALID / CODE_ALREADY_USED. */
import { now } from "@/lib/clock";
import { handle, json, readJson } from "@/lib/http";
import { redeem } from "@/lib/services/reservations";
import { requireMerchant } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export const POST = handle(async (request) => {
  const merchant = await requireMerchant(request);
  return json(await redeem(merchant, await readJson(request), now()));
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as GET, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
