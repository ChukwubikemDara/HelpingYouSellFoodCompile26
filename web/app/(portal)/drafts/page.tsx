"use client";

/**
 * Draft review: one draft at a time (one primary button per screen).
 * Fields the merchant must fill are highlighted in marigold. "Approve and
 * publish" = PATCH /deals/{id} then POST /deals/{id}/publish; "Discard" =
 * POST /deals/{id}/cancel.
 *
 * Drafts are today's deals with status "draft" from the API. The listing
 * assistant's notes and estimate come from the drafts response, kept in
 * sessionStorage, when available.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { DealFields } from "@/components/DealFields";
import { PlanLink, PlanNotice } from "@/components/PlanLink";
import { useMerchant } from "@/components/PortalShell";
import { ErrorState, InlineMessage, Loading } from "@/components/States";
import { cancelDeal, errorCode, errorMessage, listMerchantDeals, publishDeal, updateDeal } from "@/lib/client/api";
import {
  estimateCents,
  formFromDeal,
  kindFor,
  missingInForm,
  validateDealForm,
  type DealForm,
  type DealFormErrors,
} from "@/lib/client/deal-form";
import { forgetDraft, loadDrafts } from "@/lib/client/drafts-cache";
import { formatCents, isoToLocalDate, parseCents, parseWhole } from "@/lib/client/format";
import { RULES, type Deal, type Draft } from "@/lib/contract";

interface QueueItem {
  deal: Deal;
  /** The listing assistant's draft, when this session made it. */
  meta: Draft | null;
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

export default function DraftsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DraftReview />
    </Suspense>
  );
}

function DraftReview() {
  const merchant = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const wantedId = params.get("id");

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [index, setIndex] = useState(0);

  const fetchQueue = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const { deals } = await listMerchantDeals(merchant.id);
      const drafts = deals.filter((d) => d.status === "draft");
      const live = new Map(drafts.map((d) => [d.id, d]));
      const cached = loadDrafts().filter((c) => c?.deal?.id && live.has(c.deal.id));
      const cachedIds = new Set(cached.map((c) => c.deal.id));
      const next: QueueItem[] = [
        ...cached.map((c) => ({ deal: live.get(c.deal.id) as Deal, meta: c })),
        ...drafts.filter((d) => !cachedIds.has(d.id)).map((d) => ({ deal: d, meta: null })),
      ];
      setQueue(next);
      const at = wantedId ? next.findIndex((q) => q.deal.id === wantedId) : -1;
      setIndex(at >= 0 ? at : 0);
      setLoad({ status: "ready" });
    } catch (err) {
      setLoad({ status: "error", message: errorMessage(err) });
    }
  }, [merchant.id, wantedId]);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  const done = useCallback(
    (dealId: string) => {
      forgetDraft(dealId);
      const rest = queue.filter((q) => q.deal.id !== dealId);
      if (rest.length === 0) {
        router.push("/today");
        return;
      }
      setQueue(rest);
      setIndex((i) => Math.min(i, rest.length - 1));
    },
    [queue, router],
  );

  if (load.status === "loading") return <Loading />;
  if (load.status === "error") return <ErrorState message={load.message} onRetry={() => void fetchQueue()} />;
  if (queue.length === 0) {
    return (
      <div className="stack">
        <h1>Drafts</h1>
        <p className="muted">No drafts to review.</p>
        <Link className="btn btn-secondary btn-block" href="/listing">
          New deal
        </Link>
      </div>
    );
  }

  const item = queue[Math.min(index, queue.length - 1)];
  return (
    <DraftEditor
      key={item.deal.id}
      item={item}
      position={index + 1}
      count={queue.length}
      planStatus={merchant.plan_status}
      defaultDiscountPct={merchant.default_discount_pct}
      closesAt={merchant.closes_at}
      onDone={done}
      onSkip={() => setIndex((i) => (i + 1) % queue.length)}
    />
  );
}

function DraftEditor({
  item,
  position,
  count,
  planStatus,
  defaultDiscountPct,
  closesAt,
  onDone,
  onSkip,
}: {
  item: QueueItem;
  position: number;
  count: number;
  planStatus: string;
  defaultDiscountPct: number;
  closesAt: string;
  onDone: (dealId: string) => void;
  onSkip: () => void;
}) {
  const { deal, meta } = item;
  const [form, setForm] = useState<DealForm>(() => formFromDeal(deal));
  const [errors, setErrors] = useState<DealFormErrors>({});
  const [busy, setBusy] = useState<"publish" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planRequired, setPlanRequired] = useState(false);

  const date = isoToLocalDate(deal.pickup_start);
  const missing = missingInForm(form);

  const sellThrough = meta?.estimate?.assumed_sell_through ?? RULES.ASSUMED_SELL_THROUGH;
  const estimate = useMemo(() => {
    const units = parseWhole(form.quantity);
    const price = parseCents(form.price);
    if (units === null || price === null || Number.isNaN(units) || Number.isNaN(price) || units < 1) return null;
    return estimateCents(units, price, sellThrough);
  }, [form.quantity, form.price, sellThrough]);

  function change(patch: Partial<DealForm>) {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch) as (keyof DealForm)[]) delete next[k];
      return next;
    });
  }

  async function approve() {
    if (busy) return;
    const { errors: e, values } = validateDealForm(form, date);
    setErrors(e);
    if (!values) {
      setError("Fix the fields marked above, then publish.");
      return;
    }
    setBusy("publish");
    setError(null);
    setPlanRequired(false);
    try {
      // kind follows the pickup end the merchant approves, by the agent's rule (as manual entry does).
      await updateDeal(deal.id, { ...values, kind: kindFor(values.pickup_end, closesAt, date) });
      await publishDeal(deal.id);
      onDone(deal.id);
    } catch (err) {
      setPlanRequired(errorCode(err) === "PLAN_REQUIRED");
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  async function discard() {
    if (busy) return;
    setBusy("discard");
    setError(null);
    try {
      await cancelDeal(deal.id);
      onDone(deal.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  const pct = Math.round(sellThrough * 100);

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <div className="spread">
          <h1>Review draft</h1>
          <span className="badge badge-draft">Draft</span>
        </div>
        {count > 1 && (
          <p className="small muted">
            Draft {position} of {count}
          </p>
        )}
        {deal.items.length > 0 && (
          <p className="fine muted">
            One unit: {deal.items.map((it) => `${it.qty} × ${it.name}`).join(", ")}
          </p>
        )}
        {deal.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element -- photo URL is set by the backend (S3 or local)
          <img className="photo-preview" src={deal.photo_url} alt={`Photo for ${deal.title}`} />
        )}
      </div>

      <div className="card-tip stack-sm">
        {meta?.agent_notes && <p>{meta.agent_notes}</p>}
        {estimate !== null ? (
          <p className="soft">
            Estimate, assuming {pct}% sells: <strong>{formatCents(estimate)}</strong>
          </p>
        ) : (
          <p className="muted">Enter the quantity and deal price to see an estimate.</p>
        )}
        {meta?.estimate && <p className="fine muted">If discarded: {formatCents(meta.estimate.if_discarded_cents)}</p>}
      </div>

      <DealFields
        form={form}
        onChange={change}
        errors={errors}
        highlightMissing
        showUnitSize={false}
        defaultDiscountPct={defaultDiscountPct}
      />

      <div className="stack">
        <PlanNotice planStatus={planStatus} />
        <InlineMessage error text={error} />
        {planRequired && <PlanLink />}
        {missing.length > 0 && <p className="small muted">Fill in the highlighted fields to publish.</p>}
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={approve}
          disabled={busy !== null || missing.length > 0}
        >
          {busy === "publish" ? "Publishing…" : "Approve and publish"}
        </button>
        <div className="actions" style={{ justifyContent: "center" }}>
          <ConfirmButton
            variant="link"
            label="Discard"
            question="Discard this draft? It will not be published."
            confirmLabel="Yes, discard"
            busyLabel="Discarding…"
            busy={busy === "discard"}
            disabled={busy !== null}
            onConfirm={discard}
          />
          {count > 1 && (
            <button type="button" className="link link-quiet" onClick={onSkip} disabled={busy !== null}>
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
