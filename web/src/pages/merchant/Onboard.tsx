import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { Button, ErrorNote, Field, Input, inputClass } from '../../components/ui'
import { normalizePhone, storage } from '../../storage'
import type { Category } from '../../types'

export function Onboard() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('bakery')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [closesAt, setClosesAt] = useState('18:00')
  const [existingId, setExistingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizePhone(phone)
    if (!normalized) return setError('Enter a 10 digit US phone number.')
    setError('')
    setBusy(true)
    try {
      const merchant = await api.createMerchant({
        name: name.trim(),
        category,
        address: address.trim(),
        phone: normalized,
        closes_at: closesAt,
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
        <p className="text-stone-600">Tell us about your shop. Takes a minute, no login.</p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <Field label="Business name">
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
        <Field label="Usual closing time" hint="Pickup windows default to ending here.">
          <Input value={closesAt} onChange={(e) => setClosesAt(e.target.value)} type="time" required />
        </Field>
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
