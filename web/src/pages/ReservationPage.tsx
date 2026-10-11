import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { Button, Card, ErrorNote, Loading, StatusBadge } from '../components/ui'
import { money, pickupWindow } from '../format'
import { useLoad } from '../hooks'
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

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{HEADLINES[r.status]}</h1>
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

      <ErrorNote>{actionError}</ErrorNote>

      {open && (
        <div className="space-y-2">
          <Button className="w-full" disabled={busy} onClick={() => act(api.confirmPickup)}>
            I picked it up
          </Button>
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
        </div>
      )}

      <Link to="/" className="block text-center text-sm text-emerald-700">
        Browse more deals
      </Link>
    </>
  )
}
