import { Link } from 'react-router-dom'
import { api } from '../api'
import { Card, ErrorNote, Loading, StatusBadge } from '../components/ui'
import { clock, money } from '../format'
import { useLoad } from '../hooks'
import { storage } from '../storage'

function List({ phone }: { phone: string }) {
  const { data, error, loading } = useLoad(() => api.myReservations(phone), phone, 10_000)

  if (loading) return <Loading />
  if (error) return <ErrorNote>{error.message}</ErrorNote>
  if (!data?.length) return <Empty />

  const newestFirst = [...data].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  return (
    <div className="space-y-3">
      {newestFirst.map((r) => (
        <Link key={r.id} to={`/reservations/${r.id}`} className="block">
          <Card className="flex items-center justify-between gap-3 hover:border-emerald-500">
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {r.quantity} × {r.deal.title}
              </p>
              <p className="text-sm text-stone-600">
                {r.deal.merchant.name} · by {clock(r.deal.pickup_end)} · {money(r.total_cents)}
              </p>
            </div>
            <StatusBadge status={r.status} />
          </Card>
        </Link>
      ))}
    </div>
  )
}

function Empty() {
  return (
    <div className="py-10 text-center text-stone-500">
      <p>No reservations on this phone yet.</p>
      <Link to="/" className="text-emerald-700">
        Browse tonight's deals
      </Link>
    </div>
  )
}

// Reservations belong to the phone that made them, so there is no lookup by
// someone else's number: we only ever ask for the one saved when reserving here.
export function MyReservations() {
  const { phone } = storage.customer()

  return (
    <>
      <h1 className="text-2xl font-bold">My pickups</h1>
      {phone ? <List phone={phone} /> : <Empty />}
    </>
  )
}
