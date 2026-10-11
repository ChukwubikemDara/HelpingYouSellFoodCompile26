import AsyncStorage from '@react-native-async-storage/async-storage'

// No accounts: the phone remembers the name and number used to reserve.

export interface Profile {
  name: string
  phone: string // normalized, "+18145550123", or '' if not given yet
  onboarded: boolean
}

export const EMPTY_PROFILE: Profile = { name: '', phone: '', onboarded: false }

const KEY = 'customer'

export async function loadProfile(): Promise<Profile> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (raw) return { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) }
  } catch {
    // unreadable: treat as a new phone
  }
  return EMPTY_PROFILE
}

export async function storeProfile(profile: Profile) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(profile))
  } catch {
    // still usable this session, it just won't be remembered
  }
}

// "(814) 555-0123" -> "+18145550123". Returns null if it isn't a 10 digit US number.
export function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

// "+18145550123" -> "(814) 555-0123"
export function prettyPhone(phone: string) {
  const d = phone.replace(/\D/g, '').slice(-10)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone
}
