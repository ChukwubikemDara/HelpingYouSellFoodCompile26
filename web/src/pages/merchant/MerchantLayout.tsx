import type { ReactNode } from 'react'
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { Button, ErrorNote, Loading } from '../../components/ui'
import { clockFromHHMM } from '../../format'
import { useLoad } from '../../hooks'
import { storage } from '../../storage'

// Wraps every merchant screen: sends you to onboarding if this browser has no merchant yet.
export function MerchantLayout() {
  const merchantId = storage.merchantId()
  if (!merchantId) return <Navigate to="/merchant/onboard" replace />
  return <Loaded merchantId={merchantId} />
}

function Tab({ to, end, label, children }: { to: string; end?: boolean; label: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-bold ${isActive ? 'text-ember' : 'text-muted'}`
      }
    >
      <svg
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
      {label}
    </NavLink>
  )
}

function Loaded({ merchantId }: { merchantId: string }) {
  const navigate = useNavigate()
  const { data: merchant, error, loading } = useLoad(() => api.merchant(merchantId), merchantId)

  function signOut() {
    storage.clearMerchant()
    navigate('/merchant/onboard')
  }

  if (loading) return <Loading />
  if (!merchant) {
    return (
      <>
        <ErrorNote>{error?.message ?? 'Could not load your store'}</ErrorNote>
        <Button variant="secondary" onClick={signOut}>
          Set up again
        </Button>
      </>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg text-paper">
            {merchant.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold">{merchant.name}</p>
            <p className="text-xs text-muted">Closes {clockFromHHMM(merchant.closes_at)}</p>
          </div>
        </div>
        <button onClick={signOut} className="shrink-0 text-xs font-bold text-muted underline">
          Switch store
        </button>
      </div>

      <Outlet context={merchant} />

      {/* fixed to the bottom so it's reachable one-handed at the counter */}
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-md">
          <Tab to="/merchant" end label="Today">
            <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
          </Tab>
          <Tab to="/merchant/new" label="New deal">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </Tab>
          <Tab to="/merchant/summary" label="Summary">
            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
          </Tab>
        </div>
      </nav>
    </>
  )
}
