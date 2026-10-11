import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api'
import { Button, Card, ErrorNote, Field, Input, inputClass, Loading, StatusBadge } from '../../components/ui'
import { dollarsToCents, fromLocalInput, money, toLocalInput } from '../../format'
import { useLoad } from '../../hooks'
import type { Deal, Draft } from '../../types'
import { loadDraftExtras } from './draftExtras'

const COMMON_ALLERGENS = ['wheat', 'milk', 'egg', 'soy', 'peanuts', 'tree nuts', 'sesame', 'fish', 'shellfish']

interface FormState {
  title: string
  original: string
  price: string
  quantity: string
  maxPerCustomer: string
  pickupStart: string
  pickupEnd: string
  allergens: string[] | null
  note: string
  kind: Deal['kind']
}

function toForm(deal: Deal): FormState {
  return {
    title: deal.title,
    original: (deal.original_price_cents / 100).toFixed(2),
    price: (deal.deal_price_cents / 100).toFixed(2),
    quantity: String(deal.quantity_total),
    maxPerCustomer: String(deal.max_per_customer),
    pickupStart: toLocalInput(deal.pickup_start),
    pickupEnd: toLocalInput(deal.pickup_end),
    allergens: deal.allergens,
    note: deal.note ?? '',
    kind: deal.kind,
  }
}

// Same rules the backend enforces on publish, checked here so the merchant sees them early.
function validate(f: FormState) {
  const original = dollarsToCents(f.original)
  const price = dollarsToCents(f.price)
  const errors: string[] = []
  if (!f.title.trim()) errors.push('Add a title.')
  if (!(price > 0) || !(original > 0)) errors.push('Enter both prices.')
  else if (price >= original) errors.push('The deal price has to be lower than the original price.')
  if (!(Number(f.quantity) >= 1)) errors.push('Quantity must be at least 1.')
  if (!(Number(f.maxPerCustomer) >= 1)) errors.push('Limit per customer must be at least 1.')
  if (!f.pickupStart || !f.pickupEnd) errors.push('Set the pickup window.')
  else if (new Date(f.pickupEnd) <= new Date(f.pickupStart)) errors.push('Pickup has to end after it starts.')
  else if (new Date(f.pickupEnd) <= new Date()) errors.push('Pickup has to end in the future.')
  if (f.allergens === null) errors.push('Answer the allergen question (choose "None" if there are none).')
  return errors
}

function Editor({ deal, extras }: { deal: Deal; extras: Draft | undefined }) {
  const navigate = useNavigate()
  const [form, setForm] = useState(() => toForm(deal))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsPlan, setNeedsPlan] = useState(false)
  const [pricingUrl, setPricingUrl] = useState('')

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const missing = (field: string) => extras?.missing_fields.includes(field) ?? false
  const problems = validate(form)
  const isDraft = deal.status === 'draft'

  function toggleAllergen(a: string) {
    const current = form.allergens ?? []
    set('allergens', current.includes(a) ? current.filter((x) => x !== a) : [...current, a])
  }

  async function save(publish: boolean) {
    setBusy(true)
    setError('')
    setNeedsPlan(false)
    try {
      await api.updateDeal(deal.id, {
        title: form.title.trim(),
        original_price_cents: dollarsToCents(form.original),
        deal_price_cents: dollarsToCents(form.price),
        quantity_total: Number(form.quantity),
        max_per_customer: Number(form.maxPerCustomer),
        pickup_start: fromLocalInput(form.pickupStart),
        pickup_end: fromLocalInput(form.pickupEnd),
        allergens: form.allergens,
        note: form.note.trim() || null,
        kind: form.kind,
      })
      if (publish) await api.publishDeal(deal.id)
      navigate('/merchant')
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
      if (err instanceof ApiError && err.code === 'PLAN_REQUIRED') {
        setNeedsPlan(true)
        api.billingLinks().then(
          (links) => setPricingUrl(links.pricing_url),
          () => {},
        )
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{isDraft ? 'Check your listing' : 'Edit listing'}</h1>
        <StatusBadge status={deal.status} />
      </div>

      {extras && (
        <Card className="space-y-1 bg-amber-50 text-sm">
          <p>{extras.agent_notes}</p>
          <p className="text-stone-700">
            Estimate: about <strong>{money(extras.estimate.expected_recovered_cents)}</strong> recovered from{' '}
            {extras.estimate.units} units, versus {money(extras.estimate.if_discarded_cents)} if discarded.
          </p>
          <p className="text-xs text-stone-500">
            Assumes {Math.round(extras.estimate.assumed_sell_through * 100)}% sell. That is an assumption, not a
            forecast.
          </p>
        </Card>
      )}

      <Field label="Title">
        <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Original price ($)">
          <Input value={form.original} onChange={(e) => set('original', e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Deal price ($)">
          <Input value={form.price} onChange={(e) => set('price', e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Units available">
          <Input value={form.quantity} onChange={(e) => set('quantity', e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Limit per customer">
          <Input
            value={form.maxPerCustomer}
            onChange={(e) => set('maxPerCustomer', e.target.value)}
            inputMode="numeric"
          />
        </Field>
      </div>

      <Field label="Pickup from">
        <Input type="datetime-local" value={form.pickupStart} onChange={(e) => set('pickupStart', e.target.value)} />
      </Field>
      <Field label="Pickup until">
        <Input type="datetime-local" value={form.pickupEnd} onChange={(e) => set('pickupEnd', e.target.value)} />
      </Field>

      <Field label="Kind" hint="Surplus = end of day leftovers. Timed = a slow-hour special.">
        <select value={form.kind} onChange={(e) => set('kind', e.target.value as Deal['kind'])} className={inputClass}>
          <option value="surplus">Surplus</option>
          <option value="timed">Timed</option>
        </select>
      </Field>

      <div
        className={`rounded-xl border p-3 ${
          form.allergens === null ? 'border-amber-400 bg-amber-50' : 'border-stone-200 bg-white'
        }`}
      >
        <p className="text-sm font-medium text-stone-700">
          Allergens {missing('allergens') && form.allergens === null && <span className="text-amber-700">· needed</span>}
        </p>
        <p className="mb-2 text-xs text-stone-500">Only you can answer this. Required before publishing.</p>
        <div className="flex flex-wrap gap-2">
          {COMMON_ALLERGENS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => toggleAllergen(a)}
              className={`rounded-full px-3 py-1 text-sm ${
                form.allergens?.includes(a) ? 'bg-stone-900 text-white' : 'border border-stone-300 bg-white'
              }`}
            >
              {a}
            </button>
          ))}
          <button
            type="button"
            onClick={() => set('allergens', [])}
            className={`rounded-full px-3 py-1 text-sm ${
              form.allergens?.length === 0 ? 'bg-emerald-600 text-white' : 'border border-stone-300 bg-white'
            }`}
          >
            None
          </button>
        </div>
      </div>

      <Field label="Note for customers (optional)">
        <Input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Baked this morning." />
      </Field>

      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-amber-800">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <ErrorNote>{error}</ErrorNote>
      {needsPlan && (
        <Card className="text-sm">
          You need a plan before you can publish.{' '}
          {pricingUrl && (
            <a href={pricingUrl} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline">
              Choose a plan
            </a>
          )}
        </Card>
      )}

      {isDraft ? (
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => save(false)} className="flex-1">
            Save draft
          </Button>
          <Button disabled={busy || problems.length > 0} onClick={() => save(true)} className="flex-1">
            {busy ? 'Working…' : 'Publish'}
          </Button>
        </div>
      ) : (
        <Button disabled={busy || problems.length > 0} onClick={() => save(false)} className="w-full">
          Save changes
        </Button>
      )}
    </div>
  )
}

export function DealEditor() {
  const { id = '' } = useParams()
  const { data: deal, error, loading } = useLoad(() => api.deal(id), id)

  if (loading) return <Loading />
  if (!deal) return <ErrorNote>{error?.message ?? 'Deal not found'}</ErrorNote>
  // key: remount with fresh form state if the route switches to another deal
  return <Editor key={deal.id} deal={deal} extras={loadDraftExtras(deal.id)} />
}
