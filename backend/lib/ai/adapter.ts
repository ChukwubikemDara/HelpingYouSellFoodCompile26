import type { Draft, Merchant } from "../db/models";
/** Teammate-owned Luminal engine supplies this boundary. Never publishes. */
export interface ListingAssistant {
  generateDrafts(input: { merchant: Merchant; text?: string; photo_base64?: string }): Promise<Draft[]>;
}
