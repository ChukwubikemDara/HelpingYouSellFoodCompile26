import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { Button, ErrorNote, Loading } from '../../components/ui'
import { useLoad } from '../../hooks'
import { storage } from '../../storage'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex-1 rounded-lg px-3 py-1.5 text-center text-sm ${
    isActive ? 'bg-stone-900 font-medium text-white' : 'text-stone-600 hover:bg-stone-200'
  }`

// Wraps every merchant screen: sends you to onboarding if this browser has no merchant yet.
export function MerchantLayout() {
  const merchantId = storage.merchantId()
  if (!merchantId) return <Navigate to="/merchant/onboard" replace />
  return <Loaded merchantId={merchantId} />
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
        <ErrorNote>{error?.message ?? 'Could not load your business'}</ErrorNote>
        <Button variant="secondary" onClick={signOut}>
          Set up again
        </Button>
      </>
    )
  }

  return (
    <>
      <div className="flex items-baseline justify-between">
        <p className="font-semibold">{merchant.name}</p>
        <button onClick={signOut} className="text-xs text-stone-500 underline">
          Switch business
        </button>
      </div>
      <nav className="flex gap-1 rounded-xl bg-stone-100 p-1">
        <NavLink to="/merchant" end className={tabClass}>
          Today
        </NavLink>
        <NavLink to="/merchant/new" className={tabClass}>
          New deal
        </NavLink>
        <NavLink to="/merchant/summary" className={tabClass}>
          Summary
        </NavLink>
      </nav>
      <Outlet context={merchant} />
    </>
  )
}
