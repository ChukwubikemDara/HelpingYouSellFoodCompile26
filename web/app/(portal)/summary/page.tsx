"use client";

/**
 * Summary for a New York local date (?date=YYYY-MM-DD, default today).
 * The amount recovered is the main figure (Fraunces 48 on an ink card) with
 * "If discarded" directly under it, then the unit counts as quiet rows.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useMerchant } from "@/components/PortalShell";
import { ErrorState, Loading } from "@/components/States";
import { errorMessage, getSummary } from "@/lib/client/api";
import { formatCents, formatLocalDate } from "@/lib/client/format";
import { isLocalDate, today } from "@/lib/clock";
import type { Summary } from "@/lib/contract";

export default function SummaryPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SummaryView />
    </Suspense>
  );
}

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; summary: Summary };

function SummaryView() {
  const merchant = useMerchant();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("date");
  const todayDate = today();
  const date = requested && isLocalDate(requested) ? requested : todayDate;
  const isToday = date === todayDate;

  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      // Send the date only when one was asked for; the server defaults to today.
      const summary = await getSummary(merchant.id, requested && isLocalDate(requested) ? requested : undefined);
      setState({ status: "ready", summary });
    } catch (err) {
      setState({ status: "error", message: errorMessage(err) });
    }
  }, [merchant.id, requested]);

  useEffect(() => {
    void load();
  }, [load]);

  function pickDate(value: string) {
    if (!isLocalDate(value)) return;
    router.replace(value === todayDate ? pathname : `${pathname}?date=${value}`);
  }

  return (
    <div className="stack-lg">
      <div className="spread">
        <h1>Summary</h1>
        <input
          className="input input-auto"
          type="date"
          aria-label="Date"
          value={date}
          max={todayDate}
          onChange={(e) => pickDate(e.target.value)}
        />
      </div>

      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={() => void load()} />}
      {state.status === "ready" && <SummaryBody summary={state.summary} isToday={isToday} />}
    </div>
  );
}

function SummaryBody({ summary: s, isToday }: { summary: Summary; isToday: boolean }) {
  if (s.units_listed === 0) {
    return <p className="muted">No deals listed {isToday ? "today" : `on ${formatLocalDate(s.date)}`}.</p>;
  }
  const stats: [string, number][] = [
    ["Listed", s.units_listed],
    ["Picked up", s.units_picked_up],
    ["No-shows", s.units_no_show],
    ["Not sold", s.units_unsold],
  ];
  return (
    <div className="stack-lg">
      <div className="card-ink">
        <span className="eyebrow">{isToday ? "Recovered today" : `Recovered on ${formatLocalDate(s.date)}`}</span>
        <p className="figure-xl" style={{ marginTop: 8 }}>
          {formatCents(s.recovered_cents)}
        </p>
        <p className="small" style={{ marginTop: 4, color: "var(--on-ink-soft)" }}>
          If discarded: {formatCents(s.if_discarded_cents)}
        </p>
      </div>
      <section className="stack-sm">
        <h2>Units</h2>
        <ul className="rows">
          {stats.map(([label, value]) => (
            <li className="stat-row" key={label}>
              <span className="soft">{label}</span>
              <span className="figure">{value}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="small muted">
        Platform fee: {formatCents(s.platform_fee_cents)}. Totals count picked-up reservations only.
      </p>
    </div>
  );
}
