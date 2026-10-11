import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { Button, ErrorNote, Field, Input, inputClass } from '../../components/ui'
import { dollarsToCents } from '../../format'
import { normalizePhone, storage } from '../../storage'
import type { Category } from '../../types'

interface MenuRow {
  name: string
  price: string
}

const EMPTY_MENU: MenuRow[] = Array.from({ length: 5 }, () => ({ name: '', price: '' }))

export function Onboard() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('bakery')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [closesAt, setClosesAt] = useState('18:00')
  const [discount, setDiscount] = useState('50')
  const [menu, setMenu] = useState(EMPTY_MENU)
  const [existingId, setExistingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function setRow(index: number, patch: Partial<MenuRow>) {
    setMenu((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizePhone(phone)
    if (!normalized) return setError('Enter a 10 digit US phone number.')
    const pct = Number(discount)
    if (!(pct >= 1 && pct <= 95)) return setError('Default discount should be between 1 and 95%.')
    const filled = menu.filter((row) => row.name.trim() || row.price.trim())
    if (filled.some((row) => !row.name.trim() || !(dollarsToCents(row.price) > 0))) {
      return setError('Each menu item needs both a name and a price.')
    }
    setError('')
    setBusy(true)
    try {
      const merchant = await api.createMerchant({
        name: name.trim(),
        category,
        address: address.trim(),
        phone: normalized,
        closes_at: closesAt,
        default_discount_pct: pct,
        menu_items: filled.map((row) => ({ name: row.name.trim(), price_cents: dollarsToCents(row.price) })),
      })
      storage.setMerchantId(merchant.id)
      navigate('/merchant/new')
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
    }
  }

  function useExisting(e: FormEvent) {
    e.preventDefault()
    if (!existingId.trim()) return
    storage.setMerchantId(existingId.trim())
    navigate('/merchant')
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">List your surplus</h1>
        <p className="text-stone-600">Tell us about your store. Takes a couple of minutes.</p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <Field label="Store name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Type">
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={inputClass}>
            <option value="bakery">Bakery</option>
            <option value="cafe">Cafe</option>
            <option value="restaurant">Restaurant</option>
          </select>
        </Field>
        <Field label="Address">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 College Ave, State College, PA"
            required
          />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="(814) 555-0100" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Closing time" hint="Pickup ends here by default.">
            <Input value={closesAt} onChange={(e) => setClosesAt(e.target.value)} type="time" required />
          </Field>
          <Field label="Default discount (%)" hint="Used when you don't state a price.">
            <Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" required />
          </Field>
        </div>

        <div>
          <span className="block text-sm font-medium text-stone-700">Your regular items</span>
          <span className="mb-2 block text-xs text-stone-500">
            About five things you sell most, with regular prices. We use these to price your listings.
          </span>
          <div className="space-y-2">
            {menu.map((row, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={row.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                  placeholder={i === 0 ? 'Croissant' : 'Item'}
                  aria-label={`Item ${i + 1} name`}
                />
                <Input
                  value={row.price}
                  onChange={(e) => setRow(i, { price: e.target.value })}
                  placeholder="$"
                  inputMode="decimal"
                  className="w-24"
                  aria-label={`Item ${i + 1} price`}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMenu((rows) => [...rows, { name: '', price: '' }])}
            className="mt-2 text-sm font-medium text-emerald-700"
          >
            + Add another
          </button>
        </div>

        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Setting up…' : 'Continue'}
        </Button>
      </form>

      <form onSubmit={useExisting} className="flex items-end gap-2 border-t border-stone-200 pt-4">
        <div className="flex-1">
          <Field label="Already set up? Enter your merchant ID">
            <Input value={existingId} onChange={(e) => setExistingId(e.target.value)} placeholder="m_1" />
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          Open
        </Button>
      </form>
    </>
  )
}
