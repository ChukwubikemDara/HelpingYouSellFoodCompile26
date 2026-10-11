/**
 * Deal records as API Deals, for the drafts response. Delegates to the core
 * services' views so every endpoint returns the same Deal shape (contract
 * v0.6); distance_m is always null here.
 */
import type { Deal, DealMerchant } from "@/lib/contract";
import type { Instant } from "@/lib/clock";
import { dealMerchantView, dealView } from "@/lib/services/views";
import type { DealRecord, MerchantRecord } from "@/lib/store/types";

export function dealMerchantOf(merchant: MerchantRecord): DealMerchant {
  return dealMerchantView(merchant);
}

export function dealFromRecord(record: DealRecord, merchant: MerchantRecord, at: Instant): Deal {
  return dealView(record, merchant, at);
}
