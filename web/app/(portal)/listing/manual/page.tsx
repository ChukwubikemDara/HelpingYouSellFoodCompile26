"use client";

/**
 * Manual listing: POST /api/deals (status "draft") then POST /deals/{id}/publish.
 * If publishing fails, the created draft is kept and the next try updates it
 * (PATCH) and publishes it again instead of creating a second deal.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { DealFields } from "@/components/DealFields";
import { PlanLink, PlanNotice } from "@/components/PlanLink";
import { useMerchant } from "@/components/PortalShell";
import { InlineMessage, Loading } from "@/components/States";
import { createDeal, errorCode, errorMessage, publishDeal, updateDeal } from "@/lib/client/api";
import { kindFor, validateDealForm, type DealForm, type DealFormErrors } from "@/lib/client/deal-form";
import { addDays, addMinutes, isLocalTime, localTimeOf, now, roundUpToMinutes, today, zonedDateTime } from "@/lib/clock";
import { RULES, type Merchant } from "@/lib/contract";

export default function ManualListingPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ManualListing />
    </Suspense>
  );
}

/**
 * Pickup from now (rounded up to 5 min) until closing time, if closing is at
 * least 15 min away: today's closing time, or for a store that closes after
 * midnight, tomorrow's when it is at most 12 h away.
 */
function initialForm(merchant: Merchant, date: string): DealForm {
  const at = now();
  const start = localTimeOf(roundUpToMinutes(at, 5));
  let end = "";
  if (isLocalTime(merchant.closes_at)) {
    const earliest = addMinutes(at, 15).getTime();
    const closes = zonedDateTime(date, merchant.closes_at).getTime();
    const closesTomorrow = zonedDateTime(addDays(date, 1), merchant.closes_at).getTime();
    if (closes >= earliest) end = merchant.closes_at;
    else if (closesTomorrow >= earliest && closesTomorrow - at.getTime() <= 12 * 60 * 60 * 1000) end = merchant.closes_at;
  }
  return {
    title: "",
    unitSize: "1",
    original: "",
    price: "",
    quantity: "",
    maxPerCustomer: String(RULES.DEFAULT_MAX_PER_CUSTOMER),
    start,
    end,
    allergens: null,
    note: "",
  };
}

function ManualListing() {
  const merchant = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const fromEmpty = params.get("from") === "empty";

  const [date] = useState(() => today());
  const [form, setForm] = useState<DealForm>(() => initialForm(merchant, date));
  const [errors, setErrors] = useState<DealFormErrors>({});
  const [dealId, setDealId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planRequired, setPlanRequired] = useState(false);

  function change(patch: Partial<DealForm>) {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch) as (keyof DealForm)[]) delete next[k];
      return next;
    });
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const { errors: e, values } = validateDealForm(form, date);
    setErrors(e);
    if (!values) {
      setError("Fix the fields marked above, then publish.");
      return;
    }
    const unitSize = Number(form.unitSize.trim());
    const body = {
      ...values,
      items: [{ name: values.title, qty: unitSize }],
      kind: kindFor(values.pickup_end, merchant.closes_at, date),
    };
    setBusy(true);
    setError(null);
    setPlanRequired(false);
    let id = dealId;
    try {
      if (id) {
        await updateDeal(id, body);
      } else {
        const created = await createDeal(body);
        id = created.id;
        setDealId(id);
      }
      await publishDeal(id);
      router.push("/today");
    } catch (err) {
      setPlanRequired(errorCode(err) === "PLAN_REQUIRED");
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={onSubmit} noValidate>
      <div className="stack">
        <h1>Enter a deal</h1>
        {fromEmpty && <p className="note-warn">We couldn&apos;t make a listing from that. Enter the details below.</p>}
        {dealId && <p className="note-info">Saved as a draft. It goes live when you publish it.</p>}
      </div>

      <DealFields
        form={form}
        onChange={change}
        errors={errors}
        highlightMissing={false}
        showUnitSize
        defaultDiscountPct={merchant.default_discount_pct}
      />

      <div className="stack">
        <PlanNotice planStatus={merchant.plan_status} />
        <InlineMessage error text={error} />
        {planRequired && <PlanLink />}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Publishing…" : "Publish"}
        </button>
      </div>
    </form>
  );
}
