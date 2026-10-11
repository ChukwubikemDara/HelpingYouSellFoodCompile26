import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { EMPTY_PROFILE, loadProfile, storeProfile, type Profile } from './storage'

interface ProfileContextValue {
  profile: Profile
  ready: boolean // false until the saved profile has been read from the phone
  update: (patch: Partial<Profile>) => void
  reset: () => void
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState(EMPTY_PROFILE)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void loadProfile().then((saved) => {
      setProfile(saved)
      setReady(true)
    })
  }, [])

  const update = useCallback((patch: Partial<Profile>) => {
    setProfile((current) => {
      const next = { ...current, ...patch }
      void storeProfile(next)
      return next
    })
  }, [])

  // keeps `onboarded` so clearing your details doesn't replay the welcome screen
  const reset = useCallback(() => update({ name: '', phone: '' }), [update])

  const value = useMemo(() => ({ profile, ready, update, reset }), [profile, ready, update, reset])
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  const value = useContext(ProfileContext)
  if (!value) throw new Error('useProfile must be used inside ProfileProvider')
  return value
}
