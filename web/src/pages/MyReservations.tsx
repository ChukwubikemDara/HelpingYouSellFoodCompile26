import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Button, Card, ErrorNote, Field, Input, Loading, StatusBadge } from '../components/ui'
import { clock, money } from '../format'
import { useLoad } from '../hooks'
import { normalizePhone, storage } from '../storage'

function List({ phone }: { phone: string }) {
  const { data, error, loading } = useLoad(() => api.myReservations(phone), phone)

  if (loading) return <Loading />
  if (error) return <ErrorNote>{error.message}</ErrorNote>
  if (!data?.length) return <p className="py-6 text-center text-stone-500">No reservations for this number yet.</p>

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

export function MyReservations() {
  const [phone, setPhone] = useState(storage.customer().phone)
  const [input, setInput] = useState(phone)
  const [error, setError] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizePhone(input)
    if (!normalized) return setError('Enter a 10 digit US phone number.')
    setError('')
    setPhone(normalized)
  }

  return (
    <>
      <h1 className="text-2xl font-bold">My pickups</h1>
      <form onSubmit={submit} className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Phone number you reserved with">
            <Input value={input} onChange={(e) => setInput(e.target.value)} type="tel" placeholder="(814) 555-0123" />
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          Look up
        </Button>
      </form>
      <ErrorNote>{error}</ErrorNote>
      {phone && <List phone={phone} />}
    </>
  )
}
