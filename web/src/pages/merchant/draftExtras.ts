import type { Draft } from '../../types'

// The draft's notes and estimate only come back once, from the create call,
// so keep them around for the review screen.
export function saveDraftExtras(draft: Draft) {
  try {
    sessionStorage.setItem(`draft_${draft.deal.id}`, JSON.stringify(draft))
  } catch {
    // review screen falls back to the plain deal
  }
}

export function loadDraftExtras(dealId: string): Draft | undefined {
  try {
    const raw = sessionStorage.getItem(`draft_${dealId}`)
    return raw ? (JSON.parse(raw) as Draft) : undefined
  } catch {
    return undefined
  }
}
