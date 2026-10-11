import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { Button, Card, ErrorNote, Loading, StatusBadge } from '../components/ui'
import { clock, money, pickupWindow } from '../format'
import { useLoad, useNow } from '../hooks'
import type { Reservation } from '../types'

const HEADLINES: Record<Reservation['status'], string> = {
  reserved: "You're set!",
  picked_up: 'Picked up. Enjoy!',
  cancelled: 'Reservation cancelled',
  no_show: 'Pickup window missed',
}

export function ReservationPage() {
  const { id = '' } = useParams()
  // poll so the screen flips to "picked up" when the shop redeems the code
  const { data: r, error, loading, setData } = useLoad(() => api.reservation(id), id, 10_000)
  const [busy, setBusy] = useState(false)
  const now = useNow()
  const [actionError, setActionError] = useState('')

  async function act(fn: (id: string) => Promise<Reservation>) {
    setBusy(true)
    setActionError('')
    try {
      setData(await fn(id))
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />
  if (!r) return <ErrorNote>{error?.message ?? 'Reservation not found'}</ErrorNote>

  const open = r.status === 'reserved'
  const beforeWindow = now < Date.parse(r.deal.pickup_start)
  const windowOver = now > Date.parse(r.deal.pickup_end)
  const shopCancelled = r.status === 'cancelled' && r.deal.status === 'cancelled'

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{shopCancelled ? 'The store cancelled this deal' : HEADLINES[r.status]}</h1>
        <StatusBadge status={r.status} />
      </div>

      {open && (
        <Card className="text-center">
          <p className="text-sm text-stone-600">Show this code at the counter</p>
          <p className="my-2 font-mono text-5xl font-bold tracking-[0.3em]">{r.pickup_code}</p>
          <p className="text-sm text-stone-600">
            {r.customer_name} · {r.quantity} × {r.deal.title}
          </p>
        </Card>
      )}

      <Card className="space-y-2 text-sm">
        <p className="font-semibold">{r.deal.merchant.name}</p>
        <p className="text-stone-700">{r.deal.merchant.address}</p>
        <p className="text-stone-700">Pickup {pickupWindow(r.deal.pickup_start, r.deal.pickup_end)}</p>
        <p className="text-stone-700">
          {r.quantity} × {r.deal.title}
        </p>
        <p className="font-medium">
          {money(r.total_cents)} · {r.payment_method === 'in_store' ? 'pay at the shop' : r.payment_method}
        </p>
      </Card>

      {r.status === 'no_show' && (
        <p className="text-sm text-stone-600">Two missed pickups block this phone from reserving again.</p>
      )}

      <ErrorNote>{actionError}</ErrorNote>

      {open && (
        <div className="space-y-2">
          <Button
            className="w-full"
            disabled={busy || beforeWindow || windowOver}
            onClick={() => act(api.confirmPickup)}
          >
            I picked it up
          </Button>
          {beforeWindow && (
            <p className="text-center text-xs text-stone-500">
              You can confirm once pickup opens at {clock(r.deal.pickup_start)}.
            </p>
          )}
          {windowOver ? (
            <p className="text-center text-sm text-stone-600">
              The pickup window has ended. If you collected it, the store can still enter your code.
            </p>
          ) : (
            <Button
              variant="danger"
              className="w-full"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Cancel this reservation?')) void act(api.cancelReservation)
              }}
            >
              Cancel reservation
            </Button>
          )}
        </div>
      )}

      <Link to="/" className="block text-center text-sm text-emerald-700">
        Browse more deals
      </Link>
    </>
  )
}
