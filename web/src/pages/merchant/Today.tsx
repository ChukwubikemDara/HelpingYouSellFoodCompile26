import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api'
import { Button, Card, ErrorNote, Input, Loading, StatusBadge } from '../../components/ui'
import { clock, money, today } from '../../format'
import { useLoad } from '../../hooks'
import type { Deal, Reservation } from '../../types'
import { useMerchant } from './useMerchant'

const POLL_MS = 10_000

function Redeem({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Reservation | undefined>()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setDone(undefined)
    try {
      setDone(await api.redeem(code))
      setCode('')
      onRedeemed()
    } catch (err) {
      const known = err instanceof ApiError ? err.code : undefined
      setError(
        known === 'CODE_INVALID'
          ? 'No open reservation with that code. Check the digits.'
          : known === 'CODE_ALREADY_USED'
            ? 'That code was already redeemed.'
            : (err as Error).message,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-2">
      <p className="font-semibold">Redeem a pickup code</p>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          placeholder="4 digits"
          className="font-mono text-lg tracking-widest"
          aria-label="Pickup code"
        />
        <Button type="submit" disabled={busy || code.length !== 4}>
          Redeem
        </Button>
      </form>
      <ErrorNote>{error}</ErrorNote>
      {done && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Hand over {done.quantity} × {done.deal.title} to {done.customer_name}. Collect {money(done.total_cents)}.
        </p>
      )}
    </Card>
  )
}

function DealRow({ deal, onChange }: { deal: Deal; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function act(fn: (id: string) => Promise<Deal>) {
    setBusy(true)
    setError('')
    try {
      await fn(deal.id)
      onChange()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canCancel = deal.status === 'draft' || deal.status === 'live'
  const canDonate = deal.status === 'expired' && deal.quantity_left > 0 && deal.unsold_action === 'none'

  return (
    <Card className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{deal.title}</p>
          <p className="text-sm text-stone-600">
            {money(deal.deal_price_cents)} · {deal.quantity_left}/{deal.quantity_total} left · until{' '}
            {clock(deal.pickup_end)}
          </p>
          {deal.unsold_action === 'donated' && <p className="text-sm text-sky-700">Unsold units donated</p>}
        </div>
        <StatusBadge status={deal.status} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex gap-3 text-sm">
        {(deal.status === 'draft' || deal.status === 'live' || deal.status === 'sold_out') && (
          <Link to={`/merchant/deals/${deal.id}`} className="font-medium text-emerald-700">
            {deal.status === 'draft' ? 'Review & publish' : 'Edit'}
          </Link>
        )}
        {canCancel && (
          <button
            disabled={busy}
            className="text-red-700 disabled:opacity-50"
            onClick={() => {
              if (window.confirm('Cancel this deal? Open reservations will be cancelled too.')) void act(api.cancelDeal)
            }}
          >
            Cancel
          </button>
        )}
        {canDonate && (
          <button disabled={busy} className="text-sky-700 disabled:opacity-50" onClick={() => act(api.markDonated)}>
            Mark unsold as donated
          </button>
        )}
      </div>
    </Card>
  )
}

export function Today() {
  const merchant = useMerchant()
  const date = today()
  const deals = useLoad(() => api.merchantDeals(merchant.id, date), `${merchant.id}:${date}`, POLL_MS)
  const reservations = useLoad(() => api.merchantReservations(merchant.id, date), `${merchant.id}:${date}`, POLL_MS)

  function refresh() {
    void deals.reload()
    void reservations.reload()
  }

  const open = reservations.data?.filter((r) => r.status === 'reserved') ?? []
  const closed = reservations.data?.filter((r) => r.status !== 'reserved') ?? []

  return (
    <>
      <Redeem onRedeemed={refresh} />

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Waiting for pickup ({open.length})</h2>
        {reservations.loading && <Loading />}
        <ErrorNote>{reservations.error?.message}</ErrorNote>
        {reservations.data && open.length === 0 && <p className="text-sm text-stone-500">No open reservations.</p>}
        {open.map((r) => (
          <Card key={r.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {r.customer_name} · {r.quantity} × {r.deal.title}
              </p>
              <p className="text-sm text-stone-600">
                {money(r.total_cents)} · by {clock(r.deal.pickup_end)}
              </p>
            </div>
            <span className="font-mono text-lg font-bold">{r.pickup_code}</span>
          </Card>
        ))}
        {closed.length > 0 && (
          <details className="text-sm text-stone-600">
            <summary className="cursor-pointer">Earlier today ({closed.length})</summary>
            <ul className="mt-2 space-y-1">
              {closed.map((r) => (
                <li key={r.id} className="flex items-center justify-between">
                  <span>
                    {r.customer_name} · {r.quantity} × {r.deal.title}
                  </span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Today's deals</h2>
          <Link to="/merchant/new" className="text-sm font-medium text-emerald-700">
            + New deal
          </Link>
        </div>
        {deals.loading && <Loading />}
        <ErrorNote>{deals.error?.message}</ErrorNote>
        {deals.data?.length === 0 && <p className="text-sm text-stone-500">Nothing listed yet today.</p>}
        {deals.data?.map((d) => (
          <DealRow key={d.id} deal={d} onChange={refresh} />
        ))}
      </section>
    </>
  )
}
