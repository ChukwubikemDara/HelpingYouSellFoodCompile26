"use client";

/**
 * Wraps every signed-in portal page. Loads GET /me once and shares the
 * merchant with the page, and routes by session state:
 * - signed out (401)           -> /signin
 * - signed in, no merchant yet -> /onboarding
 * - onboarded, on /onboarding  -> /today
 * Any later 401 from a merchant endpoint also sends the merchant to /signin.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ErrorState, Loading } from "@/components/States";
import { errorCode, errorMessage, getMe, UNAUTHORIZED_EVENT } from "@/lib/client/api";
import { localTime12 } from "@/lib/client/format";
import type { Merchant } from "@/lib/contract";

type MeState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; merchant: Merchant | null };

interface PortalContextValue {
  merchant: Merchant | null;
  setMerchant: (merchant: Merchant) => void;
}

const PortalContext = createContext<PortalContextValue | null>(null);

/** The signed-in merchant. Only for pages that render after onboarding. */
export function useMerchant(): Merchant {
  const ctx = useContext(PortalContext);
  if (!ctx?.merchant) throw new Error("useMerchant() used before the merchant is loaded");
  return ctx.merchant;
}

/** Replace the merchant in the shell, e.g. after onboarding. */
export function useSetMerchant(): (merchant: Merchant) => void {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("useSetMerchant() used outside PortalShell");
  return ctx.setMerchant;
}

const ONBOARDING = "/onboarding";

/** Bottom tab bar. `match` lists the path prefixes that keep a tab highlighted. */
const NAV = [
  {
    href: "/today",
    label: "Today",
    match: ["/today"],
    icon: <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />,
  },
  {
    href: "/listing",
    label: "New deal",
    match: ["/listing", "/drafts"],
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
  },
  {
    href: "/summary",
    label: "Summary",
    match: ["/summary"],
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  },
  {
    href: "/store",
    label: "Store",
    match: ["/store"],
    icon: <path d="M4 10 5.5 4h13L20 10M4 10v10h16V10M4 10h16M10 20v-5h4v5" />,
  },
];

const isActive = (path: string, match: string[]) => match.some((m) => path === m || path.startsWith(`${m}/`));

export function PortalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeState>({ status: "loading" });

  const load = useCallback(async () => {
    setMe({ status: "loading" });
    try {
      const res = await getMe({ quietUnauthorized: true });
      setMe({ status: "ready", merchant: res.merchant });
    } catch (err) {
      if (errorCode(err) === "UNAUTHORIZED") {
        router.replace("/signin");
        return;
      }
      setMe({ status: "error", message: errorMessage(err) });
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onUnauthorized = () => router.replace("/signin");
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [router]);

  const merchant = me.status === "ready" ? me.merchant : null;
  const onOnboarding = pathname === ONBOARDING;
  const needsOnboarding = me.status === "ready" && merchant === null && !onOnboarding;
  const alreadyOnboarded = me.status === "ready" && merchant !== null && onOnboarding;

  useEffect(() => {
    if (needsOnboarding) router.replace(ONBOARDING);
    else if (alreadyOnboarded) router.replace("/today");
  }, [needsOnboarding, alreadyOnboarded, router]);

  const setMerchant = useCallback((m: Merchant) => setMe({ status: "ready", merchant: m }), []);

  let body: React.ReactNode;
  if (me.status === "loading" || needsOnboarding || alreadyOnboarded) body = <Loading />;
  else if (me.status === "error") body = <ErrorState message={me.message} onRetry={() => void load()} />;
  else body = children;

  return (
    <PortalContext.Provider value={{ merchant, setMerchant }}>
      <main className="page">
        {me.status !== "loading" && (
          <div className="merchant-bar">
            <div className="grow">
              {merchant ? (
                <>
                  <p className="title truncate">{merchant.name}</p>
                  <p className="fine muted">Closes at {localTime12(merchant.closes_at)}</p>
                </>
              ) : (
                <p className="brand-mark">
                  Last Call<span>.</span>
                </p>
              )}
            </div>
            <Link href="/signout" prefetch={false} className="link-muted">
              Sign out
            </Link>
          </div>
        )}
        {body}
      </main>
      {merchant && (
        <nav className="tabbar" aria-label="Portal">
          <div className="tabbar-inner">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="tab"
                aria-current={isActive(pathname, item.match) ? "page" : undefined}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {item.icon}
                </svg>
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </PortalContext.Provider>
  );
}
