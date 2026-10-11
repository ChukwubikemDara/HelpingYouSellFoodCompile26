import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { EMPTY_PROFILE, loadProfile, storeProfile, type Profile } from './storage'
import { getToken, setToken } from './session'
import { api } from './api'
import type { Customer } from './types'
interface ProfileContextValue {
  profile: Profile; ready: boolean; signedIn: boolean;
  update: (patch: Partial<Profile>) => void;
  authenticate: (token: string, customer: Customer) => Promise<void>;
  reset: () => Promise<void>;
}
const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState(EMPTY_PROFILE), [ready, setReady] = useState(false), [signedIn, setSignedIn] = useState(false)
  useEffect(() => { void (async () => {
    const saved = await loadProfile(); setProfile(saved)
    const token = await getToken()
    if (token) { try { const c = await api.me(); setProfile({ ...saved, name: c.name, phone: c.phone }); setSignedIn(true) } catch { /* Retry sign-in from Profile when server is reachable. */ } }
    setReady(true)
  })() }, [])
  const update = useCallback((patch: Partial<Profile>) => setProfile(current => { const next = { ...current, ...patch }; void storeProfile(next); return next }), [])
  const authenticate = useCallback(async (token: string, customer: Customer) => { await setToken(token); update({ name: customer.name, phone: customer.phone }); setSignedIn(true) }, [update])
  const reset = useCallback(async () => { await api.signout(); await setToken(null); update({ name: '', phone: '' }); setSignedIn(false) }, [update])
  const value = useMemo(() => ({ profile, ready, signedIn, update, authenticate, reset }), [profile, ready, signedIn, update, authenticate, reset])
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}
export function useProfile() { const value = useContext(ProfileContext); if (!value) throw new Error('ProfileProvider required'); return value }
