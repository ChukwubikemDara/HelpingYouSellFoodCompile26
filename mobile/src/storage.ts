import AsyncStorage from '@react-native-async-storage/async-storage'

// No accounts: the phone remembers the name and number used to reserve.

export interface Customer {
  name: string
  phone: string
}

export async function loadCustomer(): Promise<Customer> {
  try {
    const raw = await AsyncStorage.getItem('customer')
    if (raw) return JSON.parse(raw) as Customer
  } catch {
    // unreadable: treat as a new phone
  }
  return { name: '', phone: '' }
}

export async function saveCustomer(customer: Customer) {
  try {
    await AsyncStorage.setItem('customer', JSON.stringify(customer))
  } catch {
    // the reservation still went through, we just won't prefill next time
  }
}

// "(814) 555-0123" -> "+18145550123". Returns null if it isn't a 10 digit US number.
export function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}
