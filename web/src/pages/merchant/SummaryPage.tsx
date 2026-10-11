import { useState } from 'react'
import { api } from '../../api'
import { Card, ErrorNote, Input, Loading } from '../../components/ui'
import { money, today } from '../../format'
import { useLoad } from '../../hooks'
import { useMerchant } from './useMerchant'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <p className="text-sm text-stone-500">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </Card>
  )
}

export function SummaryPage() {
  const merchant = useMerchant()
  const [date, setDate] = useState(today())
  const { data: s, error, loading } = useLoad(() => api.summary(merchant.id, date), `${merchant.id}:${date}`)
  const links = useLoad(() => api.billingLinks(), 'billing')

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Summary</h1>
        <Input
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
          className="w-auto"
          aria-label="Date"
        />
      </div>

      {loading && <Loading />}
      <ErrorNote>{error?.message}</ErrorNote>

      {s && (
        <>
          <Card className="bg-emerald-50">
            <p className="text-sm text-emerald-900">Recovered from food that would have been unsold</p>
            <p className="text-4xl font-bold text-emerald-800">{money(s.recovered_cents)}</p>
            <p className="text-sm text-emerald-900">versus {money(s.if_discarded_cents)} if it had been discarded</p>
          </Card>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Listed" value={s.units_listed} />
            <Stat label="Picked up" value={s.units_picked_up} />
            <Stat label="Unsold" value={s.units_unsold} />
          </div>
          <p className="text-sm text-stone-600">
            Platform fee: {money(s.platform_fee_cents)}. Charged only on picked-up reservations.
          </p>
        </>
      )}

      {links.data && (
        <p className="text-sm">
          {merchant.plan_status === 'active' ? (
            <a href={links.data.portal_url} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
              Manage billing
            </a>
          ) : (
            <a href={links.data.pricing_url} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
              Choose a plan
            </a>
          )}
        </p>
      )}
    </>
  )
}
