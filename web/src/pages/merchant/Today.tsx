import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api'
import { Button, Card, ErrorNote, Eyebrow, Loading, StatusBadge } from '../../components/ui'
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
    <div className="space-y-3 rounded-3xl bg-ink p-5 text-paper">
      <Eyebrow className="text-marigold!">Customer at the counter?</Eyebrow>
      <p className="font-display text-2xl">Enter their pickup code</p>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          placeholder="0000"
          className="min-w-0 flex-1 rounded-2xl bg-paper px-4 py-3 text-center font-mono text-3xl tracking-[0.3em] text-ink outline-none placeholder:text-line focus:ring-2 focus:ring-marigold"
          aria-label="Pickup code"
        />
        <Button type="submit" disabled={busy || code.length !== 4}>
          Redeem
        </Button>
      </form>
      <ErrorNote>{error}</ErrorNote>
      {done && (
        <p className="rounded-2xl bg-forest px-4 py-3 text-sm font-medium text-white">
          Hand over {done.quantity} × {done.deal.title} to {done.customer_name}. Collect {money(done.total_cents)}.
        </p>
      )}
    </div>
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
          <p className="text-sm text-muted">
            {money(deal.deal_price_cents)} · {deal.quantity_left}/{deal.quantity_total} left · until{' '}
            {clock(deal.pickup_end)}
          </p>
          {deal.unsold_action === 'donated' && <p className="text-sm text-forest">Unsold units donated</p>}
        </div>
        <StatusBadge status={deal.status} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex gap-3 text-sm">
        {(deal.status === 'draft' || deal.status === 'live' || deal.status === 'sold_out') && (
          <Link to={`/merchant/deals/${deal.id}`} className="font-medium text-ember">
            {deal.status === 'draft' ? 'Review & publish' : 'Edit'}
          </Link>
        )}
        {canCancel && (
          <button
            disabled={busy}
            className="text-ember disabled:opacity-50"
            onClick={() => {
              if (window.confirm('Cancel this deal? Open reservations will be cancelled too.')) void act(api.cancelDeal)
            }}
          >
            Cancel
          </button>
        )}
        {canDonate && (
          <button disabled={busy} className="text-forest disabled:opacity-50" onClick={() => act(api.markDonated)}>
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
        <h2 className="font-display text-xl">Waiting for pickup ({open.length})</h2>
        {reservations.loading && <Loading />}
        <ErrorNote>{reservations.error?.message}</ErrorNote>
        {reservations.data && open.length === 0 && <p className="text-sm text-muted">No open reservations.</p>}
        {open.map((r) => (
          <Card key={r.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-bold">{r.customer_name}</p>
              <p className="truncate text-sm text-ink-soft">
                {r.quantity} × {r.deal.title}
              </p>
              <p className="text-sm text-muted">
                Collect {money(r.total_cents)} · by {clock(r.deal.pickup_end)}
              </p>
            </div>
            <span className="rounded-xl bg-ink px-3 py-1.5 font-mono text-lg tracking-widest text-paper">
              {r.pickup_code}
            </span>
          </Card>
        ))}
        {closed.length > 0 && (
          <details className="text-sm text-muted">
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
          <h2 className="font-display text-xl">Today's deals</h2>
          <Link to="/merchant/new" className="text-sm font-medium text-ember">
            + New deal
          </Link>
        </div>
        {deals.loading && <Loading />}
        <ErrorNote>{deals.error?.message}</ErrorNote>
        {deals.data?.length === 0 && <p className="text-sm text-muted">Nothing listed yet today.</p>}
        {deals.data?.map((d) => (
          <DealRow key={d.id} deal={d} onChange={refresh} />
        ))}
      </section>
    </>
  )
}
