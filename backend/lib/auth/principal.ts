import { DomainError } from "../services/errors";
/** Only construct after a server-side bearer token/session cookie verification. */
export type CustomerPrincipal = { role: "customer"; customer_id: string };
export type MerchantPrincipal = { role: "merchant"; merchant_id: string };
export type Principal = CustomerPrincipal | MerchantPrincipal;
export function requireCustomer(principal: Principal | null): CustomerPrincipal {
  if (principal?.role !== "customer") throw new DomainError("UNAUTHORIZED", "Sign in to continue.", 401);
  return principal;
}
export function requireMerchant(principal: Principal | null): MerchantPrincipal {
  if (principal?.role !== "merchant") throw new DomainError("UNAUTHORIZED", "Sign in to continue.", 401);
  return principal;
}
