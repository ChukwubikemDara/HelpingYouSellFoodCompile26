import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Card, ErrorNote, Loading } from '../components/ui'
import { clock, money, percentOff } from '../format'
import { useLoad } from '../hooks'
import type { Category, Deal } from '../types'

const FILTERS: { value: Category | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'bakery', label: 'Bakery' },
  { value: 'cafe', label: 'Cafe' },
  { value: 'restaurant', label: 'Restaurant' },
]

export function DealCard({ deal }: { deal: Deal }) {
  const soldOut = deal.status === 'sold_out'
  return (
    <Link to={`/deals/${deal.id}`} className="block">
      <Card className={`flex gap-3 hover:border-emerald-500 ${soldOut ? 'opacity-60' : ''}`}>
        {deal.photo_url && <img src={deal.photo_url} alt="" className="h-20 w-20 rounded-lg object-cover" />}
        <div className="min-w-0 flex-1">
          <p className="text-xs tracking-wide text-stone-500 uppercase">{deal.merchant.name}</p>
          <h2 className="truncate font-semibold">{deal.title}</h2>
          <p className="text-sm text-stone-600">
            Pick up by {clock(deal.pickup_end)} · {soldOut ? 'Sold out' : `${deal.quantity_left} left`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-emerald-700">{money(deal.deal_price_cents)}</p>
          <p className="text-sm text-stone-400 line-through">{money(deal.original_price_cents)}</p>
          <p className="text-xs font-medium text-emerald-700">
            {percentOff(deal.original_price_cents, deal.deal_price_cents)}% off
          </p>
        </div>
      </Card>
    </Link>
  )
}

export function DealList() {
  const [category, setCategory] = useState<Category | ''>('')
  const { data: deals, error, loading } = useLoad(() => api.deals({ category }), category, 30_000)

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Tonight's deals</h1>
        <p className="text-stone-600">Good food from State College spots, before it goes to waste.</p>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setCategory(f.value)}
            className={`rounded-full px-3 py-1 text-sm ${
              category === f.value ? 'bg-stone-900 text-white' : 'border border-stone-300 bg-white text-stone-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <Loading />}
      <ErrorNote>{error?.message}</ErrorNote>
      {deals?.length === 0 && (
        <p className="py-10 text-center text-stone-500">Nothing live right now. Check back closer to closing time.</p>
      )}
      <div className="space-y-3">
        {deals?.map((d) => (
          <DealCard key={d.id} deal={d} />
        ))}
      </div>
    </>
  )
}
