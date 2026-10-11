"use client";

/**
 * Today: a suggestion if there is one (one marigold card), the pickup code
 * entry (ink card), reservations waiting for pickup and today's deals.
 * Polls every 10 s while the page is visible.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { useMerchant } from "@/components/PortalShell";
import { ErrorState, InlineMessage, Loading } from "@/components/States";
import {
  acceptSuggestion,
  cancelDeal,
  dismissSuggestion,
  errorMessage,
  listMerchantDeals,
  listMerchantReservations,
  listSuggestions,
  markDealDonated,
  redeemPickupCode,
  updateDeal,
} from "@/lib/client/api";
import {
  DEAL_STATUS_LABEL,
  RESERVATION_STATUS_LABEL,
  formatCents,
  formatLocalDate,
  formatPhone,
  parseCents,
  paymentLine,
  untilTime,
} from "@/lib/client/format";
import { today } from "@/lib/clock";
import { RULES, type Deal, type Reservation, type Suggestion } from "@/lib/contract";

const POLL_MS = 10_000;

interface TodayData {
  deals: Deal[];
  reservations: Reservation[];
  suggestions: Suggestion[];
}

export default function TodayPage() {
  const merchant = useMerchant();
  const [data, setData] = useState<TodayData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const queued = useRef<Promise<void> | null>(null);
  const hasData = useRef(false);

  const load = useCallback(async () => {
    try {
      const [dealsRes, reservationsRes, suggestions] = await Promise.all([
        listMerchantDeals(merchant.id),
        listMerchantReservations(merchant.id),
        // Suggestions are optional help: if they fail, the counter keeps working without them.
        listSuggestions(merchant.id).then(
          (r) => r.suggestions,
          () => [] as Suggestion[],
        ),
      ]);
      setData({ deals: dealsRes.deals, reservations: reservationsRes.reservations, suggestions });
      hasData.current = true;
      setLoadError(null);
      setRefreshError(null);
    } catch (err) {
      if (hasData.current) setRefreshError(errorMessage(err));
      else setLoadError(errorMessage(err));
    }
  }, [merchant.id]);

  /**
   * Reload deals, reservations and suggestions. A call while a load is in
   * flight (a poll that may have read the data before the caller's change)
   * queues one more load after it, shared by every caller meanwhile, and
   * resolves when that one is done, so an action always shows its result.
   */
  const refresh = useCallback((): Promise<void> => {
    const start = (): Promise<void> => {
      const p = load().finally(() => {
        if (running.current === p) running.current = null;
      });
      running.current = p;
      return p;
    };
    if (!running.current) return start();
    if (!queued.current) {
      queued.current = running.current.then(() => {
        queued.current = null;
        return start();
      });
    }
    return queued.current;
  }, [load]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (!data) {
    if (loadError) {
      return (
        <ErrorState
          message={loadError}
          onRetry={() => {
            setLoadError(null);
            void refresh();
          }}
        />
      );
    }
    return <Loading />;
  }

  const suggestion = data.suggestions[0] ?? null;
  // Both keep the API order (newest first).
  const open = data.reservations.filter((r) => r.status === "reserved");
  const closed = data.reservations.filter((r) => r.status !== "reserved");

  return (
    <div className="stack-lg">
      <div>
        <h1>Today</h1>
        <p className="small muted">{formatLocalDate(today())}</p>
      </div>

      {refreshError && <p className="note-error">{refreshError}</p>}

      {suggestion && <SuggestionRow key={suggestion.id} suggestion={suggestion} onChanged={refresh} />}

      <RedeemForm onRedeemed={refresh} />

      <section className="stack-sm">
        <h2>Waiting for pickup ({open.length})</h2>
        {open.length === 0 ? (
          <p className="small muted">No reservations waiting.</p>
        ) : (
          <ul className="rows">
            {open.map((r) => (
              <OpenReservation key={r.id} reservation={r} onPickedUp={refresh} />
            ))}
          </ul>
        )}
        {closed.length > 0 && (
          <details className="earlier">
            <summary>Earlier today ({closed.length})</summary>
            <ul className="stack-sm" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {closed.map((r) => (
                <li key={r.id} className="spread small muted">
                  <span className="truncate">
                    {r.customer_name} · {r.quantity} × {r.deal.title}
                  </span>
                  <span className={`badge badge-${r.status}`}>{RESERVATION_STATUS_LABEL[r.status]}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="stack-sm">
        <div className="spread">
          <h2>Today&apos;s deals</h2>
          <Link className="link link-accent" href="/listing">
            + New deal
          </Link>
        </div>
        {data.deals.length === 0 ? (
          <p className="small muted">Nothing listed today. Use New deal to add what&apos;s left of today&apos;s batch.</p>
        ) : (
          <ul className="rows">
            {data.deals.map((deal) => (
              <DealRow key={deal.id} deal={deal} pickedUp={pickedUpUnits(data.reservations, deal.id)} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Suggestion                                                          */
/* ------------------------------------------------------------------ */

function SuggestionRow({ suggestion, onChanged }: { suggestion: Suggestion; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  async function accept() {
    setBusy("accept");
    setError(null);
    try {
      await acceptSuggestion(suggestion.id);
      if (suggestion.type === "list_now") {
        router.push("/listing");
        return;
      }
      setHidden(true);
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  async function dismiss() {
    setBusy("dismiss");
    setError(null);
    try {
      await dismissSuggestion(suggestion.id);
      setHidden(true);
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  if (hidden) return null;
  return (
    <div className="stack-sm">
      <div className="accent-row stack">
        <p className="title">{suggestion.message}</p>
        <div className="inline">
          <button type="button" className="btn btn-dark btn-sm" onClick={accept} disabled={busy !== null}>
            {busy === "accept" ? "Accepting…" : "Accept"}
          </button>
          <button type="button" className="link link-quiet" onClick={dismiss} disabled={busy !== null}>
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
        <p className="fine soft">Based on reservations so far.</p>
      </div>
      <InlineMessage error text={error} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pickup code                                                         */
/* ------------------------------------------------------------------ */

function RedeemForm({ onRedeemed }: { onRedeemed: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Reservation | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const value = code.trim();
    if (!new RegExp(`^\\d{${RULES.PICKUP_CODE_LENGTH}}$`).test(value)) {
      setError(`Enter the ${RULES.PICKUP_CODE_LENGTH}-digit pickup code.`);
      setDone(null);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const reservation = await redeemPickupCode(value);
      setDone(reservation);
      setCode("");
      void onRedeemed();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card-ink stack" onSubmit={onSubmit} noValidate>
      <label htmlFor="pickup-code" className="eyebrow">
        Customer at the counter? Enter their code, or tap Picked up on their order below.
      </label>
      <div className="stack">
        <input
          id="pickup-code"
          className="code-input"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={RULES.PICKUP_CODE_LENGTH}
          placeholder={"0".repeat(RULES.PICKUP_CODE_LENGTH)}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, RULES.PICKUP_CODE_LENGTH));
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Checking…" : "Mark as picked up"}
        </button>
      </div>
      <InlineMessage error text={error} />
      {done && (
        <p className="note-ok" role="status">
          Hand over {done.quantity} × {done.deal.title} to {done.customer_name}.{" "}
          {paymentLine(done.payment_method, done.total_cents)}.
        </p>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Deals                                                               */
/* ------------------------------------------------------------------ */

function DealPrice({ deal }: { deal: Deal }) {
  if (deal.deal_price_cents === null) return <span>No price yet</span>;
  return (
    <span className="nowrap">
      <span>{formatCents(deal.deal_price_cents)}</span>
      {deal.original_price_cents !== null && (
        <>
          {" "}
          <span className="fine strike">{formatCents(deal.original_price_cents)}</span>
        </>
      )}
    </span>
  );
}

/** Units of a deal that were picked up, from today's reservations (same ?date as the deals). */
function pickedUpUnits(reservations: Reservation[], dealId: string): number {
  return reservations
    .filter((r) => r.deal_id === dealId && r.status === "picked_up")
    .reduce((sum, r) => sum + r.quantity, 0);
}

function DealRow({ deal, pickedUp, onChanged }: { deal: Deal; pickedUp: number; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<"cancel" | "donate" | "price" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState(false);
  const [newPrice, setNewPrice] = useState("");

  const left = deal.quantity_left ?? 0;
  const muted = deal.status === "cancelled" || deal.status === "sold_out" || deal.status === "expired";
  const canCancel = deal.status === "live" || deal.status === "sold_out";
  const canLower = deal.status === "live" && deal.deal_price_cents !== null;
  // Same rule as the server's mark-donated: units not picked up, so no-shows still count as in the store.
  const notPickedUp = Math.max(0, (deal.quantity_total ?? 0) - pickedUp);
  const canDonate = deal.status === "expired" && notPickedUp > 0 && deal.unsold_action === "none";

  async function run(kind: "cancel" | "donate", fn: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function savePrice(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy || deal.deal_price_cents === null) return;
    const cents = parseCents(newPrice);
    if (cents === null || Number.isNaN(cents)) {
      setError("Enter a price like 3.00.");
      return;
    }
    if (cents >= deal.deal_price_cents) {
      setError(`The new price must be lower than ${formatCents(deal.deal_price_cents)}.`);
      return;
    }
    setBusy("price");
    setError(null);
    try {
      await updateDeal(deal.id, { deal_price_cents: cents });
      setEditingPrice(false);
      setNewPrice("");
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="stack-sm">
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <p className={muted ? "title truncate row-muted" : "title truncate"}>{deal.title}</p>
          <p className="small muted">
            <DealPrice deal={deal} />
            {deal.quantity_total !== null && (
              <span>
                {" · "}
                {left} of {deal.quantity_total} left
              </span>
            )}
            <span>
              {" · "}
              {untilTime(deal.pickup_end)}
            </span>
          </p>
          {deal.status === "expired" && notPickedUp > 0 && (
            <p className="small muted" style={deal.unsold_action === "donated" ? { color: "var(--forest)" } : undefined}>
              {notPickedUp} not picked up{deal.unsold_action === "donated" ? ", donated" : ""}
            </p>
          )}
        </div>
        <span className={`badge badge-${deal.status}`}>{DEAL_STATUS_LABEL[deal.status]}</span>
      </div>

      {canLower && editingPrice && (
        <form className="stack" onSubmit={savePrice} noValidate>
          <label className="field">
            <span className="label">New deal price ($)</span>
            <input
              className="input"
              inputMode="decimal"
              value={newPrice}
              placeholder={formatCents(deal.deal_price_cents as number).slice(1)}
              onChange={(e) => setNewPrice(e.target.value)}
              autoFocus
            />
            <span className="hint">
              While a deal is live the price can only go down. Customers who already reserved keep their price.
            </span>
          </label>
          <div className="inline">
            <button type="submit" className="btn btn-dark" disabled={busy !== null}>
              {busy === "price" ? "Saving…" : "Save price"}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setEditingPrice(false);
                setNewPrice("");
                setError(null);
              }}
              disabled={busy !== null}
            >
              Close
            </button>
          </div>
        </form>
      )}

      {(deal.status === "draft" || canLower || canCancel || canDonate) && !editingPrice && (
        <div className="actions">
          {deal.status === "draft" && (
            <Link className="link link-accent" href={`/drafts?id=${encodeURIComponent(deal.id)}`}>
              Review draft
            </Link>
          )}
          {canLower && (
            <button type="button" className="link" onClick={() => setEditingPrice(true)} disabled={busy !== null}>
              Change price
            </button>
          )}
          {canDonate && (
            <button
              type="button"
              className="link link-forest"
              onClick={() => run("donate", () => markDealDonated(deal.id))}
              disabled={busy !== null}
            >
              {busy === "donate" ? "Saving…" : "Mark as donated"}
            </button>
          )}
          {canCancel && (
            <ConfirmButton
              variant="link"
              label="Cancel deal"
              question="Cancel this deal? Open reservations on it are cancelled and customers are told."
              confirmLabel="Yes, cancel deal"
              busyLabel="Cancelling…"
              busy={busy === "cancel"}
              disabled={busy !== null}
              onConfirm={() => run("cancel", () => cancelDeal(deal.id))}
            />
          )}
        </div>
      )}
      <InlineMessage error text={error} />
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Reservations                                                        */
/* ------------------------------------------------------------------ */

/**
 * A reservation waiting for pickup: who, what, and the code the customer shows.
 * "Picked up" redeems the row's own code, so the merchant does not have to type it.
 */
function OpenReservation({ reservation: r, onPickedUp }: { reservation: Reservation; onPickedUp: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickUp() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await redeemPickupCode(r.pickup_code);
      await onPickedUp();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="res">
      <div className="grow">
        <p className="title truncate">{r.customer_name}</p>
        <p className="small soft truncate">
          {r.quantity} × {r.deal.title}
        </p>
        <p className="small muted">
          {paymentLine(r.payment_method, r.total_cents)}
          {r.deal.pickup_end ? ` · ${untilTime(r.deal.pickup_end)}` : ""}
          {" · "}
          <a className="muted" href={`tel:${r.customer_phone}`}>
            {formatPhone(r.customer_phone)}
          </a>
        </p>
        <InlineMessage error text={error} />
      </div>
      <div className="res-actions">
        <span className="code-chip">{r.pickup_code}</span>
        <button type="button" className="btn btn-dark btn-sm" onClick={pickUp} disabled={busy}>
          {busy ? "Saving…" : "Picked up"}
        </button>
      </div>
    </li>
  );
}
