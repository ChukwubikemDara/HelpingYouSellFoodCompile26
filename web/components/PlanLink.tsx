"use client";

/**
 * "Choose a plan" link from GET /api/billing/links (owned by the backend; the
 * pricing page itself comes from the billing tool). Shown before publishing
 * when plan_status is "none", and with a PLAN_REQUIRED error. An empty
 * pricing_url means there is no pricing page yet: nothing is shown then, so
 * the merchant never lands on a missing page.
 */
import { useEffect, useState } from "react";
import { getBillingLinks } from "@/lib/client/api";
import type { BillingLinks } from "@/lib/contract";

let cached: Promise<BillingLinks | null> | null = null;

function loadLinks(): Promise<BillingLinks | null> {
  if (!cached) {
    cached = getBillingLinks().catch(() => {
      cached = null; // try again next time
      return null;
    });
  }
  return cached;
}

/** The pricing page URL, or null while loading, on error, or when there is no pricing page yet. */
function usePricingUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadLinks().then((l) => {
      if (live) setUrl(l?.pricing_url ? l.pricing_url : null);
    });
    return () => {
      live = false;
    };
  }, []);
  return url;
}

export function PlanLink() {
  const url = usePricingUrl();
  if (!url) return null;
  return (
    <a className="link" href={url}>
      Choose a plan
    </a>
  );
}

/** One line for publish screens when the merchant has no plan yet and a pricing page exists. */
export function PlanNotice({ planStatus }: { planStatus: string }) {
  const url = usePricingUrl();
  if (planStatus !== "none" || !url) return null;
  return (
    <div className="card small inline">
      <span className="muted">No plan yet.</span>
      <a className="link" href={url}>
        Choose a plan
      </a>
    </div>
  );
}
