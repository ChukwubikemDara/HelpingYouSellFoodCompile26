/**
 * Keeps the listing assistant's last drafts in sessionStorage, so the review
 * screen still has agent_notes, price_source and the estimate after a reload.
 * The deals themselves are always re-read from the API. Storage can be
 * missing or blocked; every access is guarded and failure means "no cache".
 */
import type { Draft } from "@/lib/contract";

const KEY = "portal.drafts.v1";

export function saveDrafts(drafts: Draft[]): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    // Storage blocked or full: the review screen falls back to the API.
  }
}

export function loadDrafts(): Draft[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Draft[]) : [];
  } catch {
    return [];
  }
}

export function forgetDraft(dealId: string): void {
  const rest = loadDrafts().filter((d) => d.deal?.id !== dealId);
  saveDrafts(rest);
}
