import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../api'
import { Button, Card, ErrorNote, Field, Input, inputClass, Loading, StatusBadge } from '../../components/ui'
import { dollarsToCents, fromLocalInput, money, toLocalInput } from '../../format'
import { useLoad } from '../../hooks'
import type { Deal, DealItem, Draft } from '../../types'
import { loadDraftExtras } from './draftExtras'
import { useMerchant } from './useMerchant'

const COMMON_ALLERGENS = ['wheat', 'milk', 'egg', 'soy', 'peanuts', 'tree nuts', 'sesame', 'fish', 'shellfish']

interface FormState {
  title: string
  items: DealItem[]
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

const dollars = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2))

function toForm(deal: Deal): FormState {
  return {
    title: deal.title,
    items: deal.items,
    original: dollars(deal.original_price_cents),
    price: dollars(deal.deal_price_cents),
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
function validate(f: FormState, deal: Deal) {
  const original = dollarsToCents(f.original)
  const price = dollarsToCents(f.price)
  const sold = deal.quantity_total - deal.quantity_left
  const errors: string[] = []
  if (!f.title.trim()) errors.push('Add a title.')
  if (!(price > 0) || !(original > 0)) errors.push('Enter both prices.')
  else if (price >= original) errors.push('The deal price has to be lower than the regular price.')
  if (!(Number(f.quantity) >= 1)) errors.push('Quantity must be at least 1.')
  else if (Number(f.quantity) < sold) errors.push(`${sold} already reserved, quantity can't go below that.`)
  if (!(Number(f.maxPerCustomer) >= 1)) errors.push('Limit per customer must be at least 1.')
  if (!f.pickupStart || !f.pickupEnd) errors.push('Set the pickup window.')
  else if (new Date(f.pickupEnd) <= new Date(f.pickupStart)) errors.push('Pickup has to end after it starts.')
  else if (new Date(f.pickupEnd) <= new Date()) errors.push('Pickup has to end in the future.')
  if (f.allergens === null) errors.push('Confirm allergens (choose "None" if there are none).')
  return errors
}

function Editor({ deal, extras }: { deal: Deal; extras: Draft | undefined }) {
  const merchant = useMerchant()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [form, setForm] = useState(() => toForm(deal))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsPlan, setNeedsPlan] = useState(merchant.plan_status !== 'active')
  const billing = useLoad(() => api.billingLinks(), 'billing')

  const isDraft = deal.status === 'draft'
  // once live, only quantity, pickup end and the note can change
  const locked = !isDraft

  // when the assistant made several drafts, step through them in order
  const queue = params.get('queue')?.split(',') ?? []
  const position = queue.indexOf(deal.id)
  const nextId = position >= 0 ? queue[position + 1] : undefined
  const afterSave = nextId ? `/merchant/deals/${nextId}?queue=${queue.join(',')}` : '/merchant'

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  // highlight what the assistant couldn't fill, until the merchant fills it
  const flag = (field: string, empty: boolean) =>
    extras?.missing_fields.includes(field) && empty ? 'border-amber-400! bg-amber-50!' : ''
  const problems = validate(form, deal)

  function toggleAllergen(a: string) {
    const current = form.allergens ?? []
    set('allergens', current.includes(a) ? current.filter((x) => x !== a) : [...current, a])
  }

  function setItem(index: number, patch: Partial<DealItem>) {
    set(
      'items',
      form.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    )
  }

  async function save(publish: boolean) {
    setBusy(true)
    setError('')
    try {
      const editableWhenLive = {
        quantity_total: Number(form.quantity),
        pickup_end: fromLocalInput(form.pickupEnd),
        note: form.note.trim() || null,
      }
      const price = dollarsToCents(form.price)
      const original = dollarsToCents(form.original)
      await api.updateDeal(
        deal.id,
        locked
          ? editableWhenLive
          : {
              ...editableWhenLive,
              title: form.title.trim(),
              items: form.items.filter((i) => i.name.trim()),
              original_price_cents: Number.isNaN(original) || !form.original ? null : original,
              deal_price_cents: Number.isNaN(price) || !form.price ? null : price,
              max_per_customer: Number(form.maxPerCustomer),
              pickup_start: fromLocalInput(form.pickupStart),
              allergens: form.allergens,
              kind: form.kind,
            },
      )
      if (publish) await api.publishDeal(deal.id)
      navigate(afterSave)
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
      if (err instanceof ApiError && err.code === 'PLAN_REQUIRED') setNeedsPlan(true)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{isDraft ? 'Check your listing' : 'Edit live deal'}</h1>
        <StatusBadge status={deal.status} />
      </div>

      {position >= 0 && queue.length > 1 && (
        <p className="text-sm text-stone-600">
          Draft {position + 1} of {queue.length}
        </p>
      )}

      {isDraft && extras && (
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

      {locked && (
        <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">
          This deal is live, so price and items are locked. You can change quantity, pickup end time and the note.
        </p>
      )}

      <Field label="Title">
        <Input value={form.title} onChange={(e) => set('title', e.target.value)} disabled={locked} />
      </Field>

      <div>
        <span className="mb-1 block text-sm font-medium text-stone-700">What one unit contains</span>
        <div className="space-y-2">
          {form.items.map((item, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={String(item.qty)}
                onChange={(e) => setItem(i, { qty: Number(e.target.value.replace(/\D/g, '')) || 1 })}
                inputMode="numeric"
                className="w-16 text-center"
                aria-label="Quantity in one unit"
                disabled={locked}
              />
              <Input
                value={item.name}
                onChange={(e) => setItem(i, { name: e.target.value })}
                placeholder="Item name"
                aria-label="Item name"
                disabled={locked}
              />
              {!locked && (
                <button
                  type="button"
                  onClick={() =>
                    set(
                      'items',
                      form.items.filter((_, j) => j !== i),
                    )
                  }
                  className="px-2 text-stone-500"
                  aria-label="Remove item"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {!locked && (
            <button
              type="button"
              onClick={() => set('items', [...form.items, { name: '', qty: 1 }])}
              className="text-sm font-medium text-emerald-700"
            >
              + Add item
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Regular price ($)">
          <Input
            value={form.original}
            onChange={(e) => set('original', e.target.value)}
            inputMode="decimal"
            disabled={locked}
            className={flag('original_price_cents', !form.original)}
          />
        </Field>
        <Field label="Deal price ($)">
          <Input
            value={form.price}
            onChange={(e) => set('price', e.target.value)}
            inputMode="decimal"
            disabled={locked}
            className={flag('deal_price_cents', !form.price)}
          />
        </Field>
        <Field label="Units available">
          <Input value={form.quantity} onChange={(e) => set('quantity', e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Limit per customer">
          <Input
            value={form.maxPerCustomer}
            onChange={(e) => set('maxPerCustomer', e.target.value)}
            inputMode="numeric"
            disabled={locked}
          />
        </Field>
      </div>

      <Field label="Pickup from">
        <Input
          type="datetime-local"
          value={form.pickupStart}
          onChange={(e) => set('pickupStart', e.target.value)}
          disabled={locked}
        />
      </Field>
      <Field label="Pickup until">
        <Input type="datetime-local" value={form.pickupEnd} onChange={(e) => set('pickupEnd', e.target.value)} />
      </Field>

      {isDraft && (
        <Field label="Kind" hint="Surplus = end of day leftovers. Timed = a slow-hour special.">
          <select
            value={form.kind}
            onChange={(e) => set('kind', e.target.value as Deal['kind'])}
            className={inputClass}
          >
            <option value="surplus">Surplus</option>
            <option value="timed">Timed</option>
          </select>
        </Field>
      )}

      <div
        className={`rounded-xl border p-3 ${
          form.allergens === null ? 'border-amber-400 bg-amber-50' : 'border-stone-200 bg-white'
        }`}
      >
        <p className="text-sm font-medium text-stone-700">
          Allergens {form.allergens === null && <span className="text-amber-700">· needs your answer</span>}
        </p>
        {isDraft && <p className="mb-2 text-xs text-stone-500">Only you can confirm this. Required before publishing.</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {COMMON_ALLERGENS.map((a) => (
            <button
              key={a}
              type="button"
              disabled={locked}
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
            disabled={locked}
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
      {isDraft && needsPlan && (
        <Card className="text-sm">
          You need a plan before you can publish.{' '}
          {billing.data && (
            <a
              href={billing.data.pricing_url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-emerald-700 underline"
            >
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
            {busy ? 'Working…' : nextId ? 'Approve & next' : 'Approve & publish'}
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
  if (deal.status !== 'draft' && deal.status !== 'live' && deal.status !== 'sold_out') {
    return <ErrorNote>This deal has ended and can no longer be edited.</ErrorNote>
  }
  // key: remount with fresh form state when stepping to the next draft
  return <Editor key={deal.id} deal={deal} extras={loadDraftExtras(deal.id)} />
}
