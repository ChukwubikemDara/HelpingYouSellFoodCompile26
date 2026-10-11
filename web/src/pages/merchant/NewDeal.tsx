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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    setPhoto(e.target.files?.[0])
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() && !photo) return setError('Describe what is left or add a photo.')
    setError('')
    setBusy(true)
    try {
      const draft = await api.createDraft(merchant.id, {
        text: text.trim() || undefined,
        photo_base64: photo ? await readAsBase64(photo) : undefined,
      })
      saveDraftExtras(draft)
      navigate(`/merchant/deals/${draft.deal.id}`)
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-2xl font-bold">What's left today?</h1>
      <Field label="Tell us in your own words" hint="We'll turn it into a listing for you to check.">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="6 croissants and a tray of blueberry muffins, closing at 6"
          className={inputClass}
        />
      </Field>
      <Field label="Or snap a photo of the case">
        <input type="file" accept="image/*" capture="environment" onChange={pickPhoto} className="text-sm" />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Drafting your listing… (a few seconds)' : 'Draft my listing'}
      </Button>
    </form>
  )
}
