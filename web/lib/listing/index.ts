/**
 * The listing agent's code side: the build step (pure rules from
 * docs/agent-spec.md) and the drafts service behind
 * POST /api/merchants/{id}/drafts.
 */
export * from "./build";
export {
  DRAFT_LIMITS,
  createDrafts,
  draftRecordOf,
  normalizeDraftText,
  parseDraftsRequest,
  type DraftsDeps,
  type DraftsRequestBody,
} from "./drafts";
export { dealFromRecord, dealMerchantOf } from "./serialize";
