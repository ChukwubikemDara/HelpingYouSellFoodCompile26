import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { Button, Card, ErrorNote, Field, Input, Loading } from '../components/ui'
import { money, percentOff, pickupWindow } from '../format'
import { useLoad } from '../hooks'
import { normalizePhone, storage } from '../storage'
import type { Deal } from '../types'

function ReserveForm({ deal, onStale }: { deal: Deal; onStale: () => void }) {
  const navigate = useNavigate()
  const saved = storage.customer()
  const [name, setName] = useState(saved.name)
  const [phone, setPhone] = useState(saved.phone)
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const max = Math.min(deal.quantity_left, deal.max_per_customer)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizePhone(phone)
    if (!name.trim()) return setError('Enter your name so the shop knows who is picking up.')
    if (!normalized) return setError('Enter a 10 digit US phone number.')
    setError('')
    setBusy(true) // stays disabled on success: we navigate away
    try {
      const r = await api.reserve({
        deal_id: deal.id,
        quantity,
        customer_name: name.trim(),
        customer_phone: normalized,
      })
      storage.setCustomer(name.trim(), normalized)
      storage.addReservationId(r.id)
      navigate(`/reservations/${r.id}`)
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
      if (err instanceof ApiError && (err.code === 'SOLD_OUT' || err.code === 'DEAL_NOT_LIVE')) onStale()
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required />
      </Field>
      <Field label="Phone" hint="Used to look up your reservation. No account needed.">
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          autoComplete="tel"
          placeholder="(814) 555-0123"
          required
        />
      </Field>
      <Field label="Quantity" hint={`Limit ${deal.max_per_customer} per customer`}>
        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>
            −
          </Button>
          <span className="w-6 text-center text-lg font-semibold">{quantity}</span>
          <Button
            type="button"
            variant="secondary"
            disabled={quantity >= max}
            onClick={() => setQuantity(quantity + 1)}
          >
            +
          </Button>
        </div>
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Reserving…' : `Reserve · ${money(quantity * (deal.deal_price_cents ?? 0))}`}
      </Button>
      <p className="text-center text-xs text-stone-500">Pay at the shop when you pick up.</p>
    </form>
  )
}

export function DealDetail() {
  const { id = '' } = useParams()
  const { data: deal, error, loading, reload } = useLoad(() => api.deal(id), id)

  if (loading) return <Loading />
  if (!deal) return <ErrorNote>{error?.message ?? 'Deal not found'}</ErrorNote>

  return (
    <>
      <Link to="/" className="text-sm text-stone-600">
        ← All deals
      </Link>

      {deal.photo_url && <img src={deal.photo_url} alt="" className="h-48 w-full rounded-xl object-cover" />}

      <div>
        <p className="text-xs tracking-wide text-stone-500 uppercase">{deal.merchant.name}</p>
        <h1 className="text-2xl font-bold">{deal.title}</h1>
        <p className="mt-1">
          <span className="text-xl font-bold text-emerald-700">{money(deal.deal_price_cents)}</span>{' '}
          <span className="text-stone-400 line-through">{money(deal.original_price_cents)}</span>{' '}
          <span className="text-sm font-medium text-emerald-700">
            {percentOff(deal.original_price_cents, deal.deal_price_cents)}% off
          </span>
        </p>
      </div>

      <Card className="space-y-3 text-sm">
        <div>
          <p className="font-medium">What you get</p>
          <ul className="text-stone-700">
            {deal.items.map((item) => (
              <li key={item.name}>
                {item.qty} × {item.name}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium">Pickup</p>
          <p className="text-stone-700">{pickupWindow(deal.pickup_start, deal.pickup_end)}</p>
          <p className="text-stone-700">{deal.merchant.address}</p>
        </div>
        <div>
          <p className="font-medium">Allergens</p>
          <p className="text-stone-700">
            {deal.allergens === null
              ? 'Not provided, ask the shop'
              : deal.allergens.length
                ? deal.allergens.join(', ')
                : 'None listed'}
          </p>
        </div>
        {deal.note && <p className="text-stone-600 italic">“{deal.note}”</p>}
      </Card>

      {deal.status === 'live' ? (
        <>
          <p className="text-sm text-stone-600">{deal.quantity_left} left</p>
          <ReserveForm deal={deal} onStale={reload} />
        </>
      ) : (
        <Card className="text-center text-stone-600">
          {deal.status === 'sold_out' ? 'Sold out. Check back, a cancellation may free one up.' : 'No longer available.'}
        </Card>
      )}
    </>
  )
}
