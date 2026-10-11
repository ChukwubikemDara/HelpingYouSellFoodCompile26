import { randomInt } from "node:crypto";
// Codes are not unique identifiers or authorization secrets.
// Redemption must use reservation id + code and an authenticated merchant.
export function generatePickupCode(): string {
  return randomInt(0, 10_000).toString().padStart(4, "0");
}
