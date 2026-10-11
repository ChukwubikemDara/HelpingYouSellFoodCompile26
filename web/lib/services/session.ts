/**
 * Who is calling. Route handlers use these instead of lib/auth directly so
 * every endpoint answers the same way:
 * - merchant endpoints: 401 UNAUTHORIZED without a session;
 * - /merchants/{id}/...: 404 NOT_FOUND unless {id} is the signed-in merchant;
 * - customer endpoints: 401 UNAUTHORIZED without a valid bearer token.
 */
import { getCurrentCustomer, getCurrentMerchant, type RequestLike, type SignedInMerchant } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import type { CustomerRecord, MerchantRecord } from "@/lib/store";

export const MESSAGES = {
  merchantSignIn: "Sign in to continue.",
  customerSignIn: "Sign in to continue.",
  notOnboarded: "Set up your store first.",
  merchantNotFound: "Store not found.",
} as const;

/** The signed-in merchant account (merchant may be null = not onboarded). 401 without a session. */
export async function requireMerchantSession(request: RequestLike): Promise<SignedInMerchant> {
  const signedIn = await getCurrentMerchant(request);
  if (!signedIn) throw new ApiError("UNAUTHORIZED", MESSAGES.merchantSignIn);
  return signedIn;
}

/** The signed-in, onboarded merchant. 401 without a session; 404 before onboarding. */
export async function requireMerchant(request: RequestLike): Promise<MerchantRecord> {
  const { merchant } = await requireMerchantSession(request);
  if (!merchant) throw new ApiError("NOT_FOUND", MESSAGES.notOnboarded);
  return merchant;
}

/** The signed-in merchant, which must have id `id`. 401 without a session; 404 for any other id. */
export async function requireOwnMerchant(request: RequestLike, id: string): Promise<MerchantRecord> {
  const { merchant } = await requireMerchantSession(request);
  if (!merchant || merchant.id !== id) throw new ApiError("NOT_FOUND", MESSAGES.merchantNotFound);
  return merchant;
}

/** The signed-in customer. 401 without a valid bearer token. */
export async function requireCustomer(request: RequestLike): Promise<CustomerRecord> {
  const customer = await getCurrentCustomer(request);
  if (!customer) throw new ApiError("UNAUTHORIZED", MESSAGES.customerSignIn);
  return customer;
}
