import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { Button, ErrorNote, Field, inputClass } from '../../components/ui'
import { saveDraftExtras } from './draftExtras'
import { useMerchant } from './useMerchant'

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('Could not read that photo'))
    reader.readAsDataURL(file)
  })
}

export function NewDeal() {
  const merchant = useMerchant()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<File | undefined>()
  const [busy, setBusy] = useState<'assistant' | 'manual' | undefined>()
  const [error, setError] = useState('')
  const [unreadable, setUnreadable] = useState(false)

  function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    setPhoto(e.target.files?.[0])
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() && !photo) return setError('Describe what is left or add a photo.')
    setError('')
    setUnreadable(false)
    setBusy('assistant')
    try {
      const drafts = await api.createDrafts(merchant.id, {
        text: text.trim() || undefined,
        photo_base64: photo ? await readAsBase64(photo) : undefined,
      })
      if (drafts.length === 0) {
        // the assistant couldn't read it: fall back to the manual form
        setBusy(undefined)
        return setUnreadable(true)
      }
      drafts.forEach(saveDraftExtras)
      const ids = drafts.map((d) => d.deal.id)
      // one draft per product: walk the merchant through them in order
      navigate(`/merchant/deals/${ids[0]}` + (ids.length > 1 ? `?queue=${ids.join(',')}` : ''))
    } catch (err) {
      setBusy(undefined)
      setError((err as Error).message)
    }
  }

  async function manual() {
    setError('')
    setBusy('manual')
    try {
      const deal = await api.createBlankDraft(merchant.id)
      navigate(`/merchant/deals/${deal.id}`)
    } catch (err) {
      setBusy(undefined)
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-2xl font-bold">What's left today?</h1>
      <Field label="Tell us in your own words" hint="We'll draft one listing per product for you to check.">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="6 croissants, 3 baguettes, closing at 6"
          className={inputClass}
        />
      </Field>
      <Field label="Or snap a photo of the case">
        <input type="file" accept="image/*" capture="environment" onChange={pickPhoto} className="text-sm" />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      {unreadable && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          We couldn't work out a listing from that. Try rewording it, or fill in the form yourself.
        </p>
      )}
      <Button type="submit" disabled={!!busy} className="w-full">
        {busy === 'assistant' ? 'Drafting your listing… (a few seconds)' : 'Draft my listing'}
      </Button>
      <Button type="button" variant="secondary" disabled={!!busy} onClick={manual} className="w-full">
        {busy === 'manual' ? 'Opening form…' : 'Fill in the form myself'}
      </Button>
      <p className="text-center text-xs text-stone-500">Nothing goes live until you approve it.</p>
    </form>
  )
}
