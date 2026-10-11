export interface BillingAdapter {
  links(merchantId: string): Promise<{ pricing_url: string; portal_url: string }>;
  // Use reservationId as the idempotency key for exactly one usage event.
  recordPickup(reservationId: string, merchantId: string): Promise<void>;
}
// No fake successful billing provider is installed.
