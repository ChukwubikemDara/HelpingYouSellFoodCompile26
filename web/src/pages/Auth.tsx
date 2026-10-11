import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Button, ErrorNote, Field, Input } from '../components/ui'
import { normalizePhone, storage } from '../storage'
export function Auth() {
  const location = useLocation(), navigate = useNavigate()
  const customer = location.pathname.startsWith('/customer/')
  const signup = location.pathname.endsWith('signup')
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const next = new URLSearchParams(location.search).get('next')
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      if (customer) {
        const normalized = normalizePhone(phone)
        if (!normalized) throw new Error('Enter your phone number in E.164 or US format.')
        const result = signup ? await api.customerSignup({ name, phone: normalized, password }) : await api.customerSignin({ phone: normalized, password })
        storage.setAccount(result.token, result.customer)
        navigate(next?.startsWith('/') && !next.startsWith('//') ? next : '/my', { replace: true })
      } else {
        if (signup) await api.merchantSignup({ email, password }); else await api.merchantSignin({ email, password })
        const { merchant } = await api.me()
        navigate(merchant ? '/merchant' : '/merchant/onboard', { replace: true })
      }
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const base = customer ? '/customer/' : '/'
  return <>
    <h1 className="text-2xl font-bold">{customer ? 'Customer' : 'Business'} {signup ? 'sign up' : 'sign in'}</h1>
    <form onSubmit={submit} className="space-y-3">
      {customer && signup && <Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} required /></Field>}
      {customer ? <Field label="Phone"><Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} required /></Field> : <Field label="Email"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>}
      <Field label="Password"><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={signup ? 8 : undefined} autoComplete={signup ? 'new-password' : 'current-password'} required /></Field>
      <ErrorNote>{error}</ErrorNote><Button disabled={busy} type="submit">{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</Button>
    </form>
    <Link className="text-emerald-700" to={`${base}${signup ? 'signin' : 'signup'}${location.search}`}>{signup ? 'Already have an account? Sign in' : 'Create an account'}</Link>
  </>
}
export function Signout() {
  const navigate = useNavigate(); const [error, setError] = useState('')
  return <><Button onClick={async () => { try { await api.merchantSignout(); navigate('/signin') } catch (e) { setError((e as Error).message) } }}>Sign out of your business</Button><ErrorNote>{error}</ErrorNote></>
}
