"use client";

/**
 * Onboarding: store details, default discount and a short menu of regular
 * items (about five), then POST /api/merchants. The form is shared with the
 * store page, where the merchant changes these later.
 */
import { useRouter } from "next/navigation";
import { useSetMerchant } from "@/components/PortalShell";
import { StoreForm } from "@/components/StoreForm";
import { createMerchant } from "@/lib/client/api";

export default function OnboardingPage() {
  const router = useRouter();
  const setMerchant = useSetMerchant();

  return (
    <div className="stack-lg">
      <div className="stack">
        <h1>Set up your store</h1>
        <p className="muted">
          Do this once. After that, one message lists what&apos;s left of today&apos;s batch for nearby students. They see your
          store name and address; you can change both later under Store.
        </p>
      </div>
      <StoreForm
        initial={null}
        submitLabel="Save and continue"
        busyLabel="Saving…"
        leavesAfterSave
        onSave={async (body) => {
          const merchant = await createMerchant(body);
          setMerchant(merchant);
          router.replace("/today");
        }}
      />
    </div>
  );
}
