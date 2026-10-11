"use client";

/**
 * Store details: the onboarding form, filled in, saved with
 * PATCH /api/merchants/{id}. Closing time, menu and default discount feed
 * every new draft; "Use my current location" adds or replaces the location.
 */
import { useState } from "react";
import { useMerchant, useSetMerchant } from "@/components/PortalShell";
import { StoreForm } from "@/components/StoreForm";
import { updateMerchant } from "@/lib/client/api";

export default function StorePage() {
  const merchant = useMerchant();
  const setMerchant = useSetMerchant();
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <div className="stack-lg">
      <div className="stack">
        <h1>Store details</h1>
        <p className="muted">Changes apply to new listings. Deals already listed keep their prices and times.</p>
      </div>
      <StoreForm
        key={merchant.id}
        initial={merchant}
        submitLabel="Save changes"
        busyLabel="Saving…"
        savedText={saved}
        onSave={async (body) => {
          setSaved(null);
          const next = await updateMerchant(merchant.id, body);
          setMerchant(next);
          setSaved("Saved.");
        }}
      />
    </div>
  );
}
