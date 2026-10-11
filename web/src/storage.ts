// No accounts in the hackathon build: the browser remembers who you are.

function get(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function set(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode etc: the app still works, it just forgets on reload
  }
}

export const storage = {
  merchantId: () => get('merchant_id'),
  setMerchantId: (id: string) => set('merchant_id', id),
  clearMerchant: () => {
    try {
      localStorage.removeItem('merchant_id')
    } catch {
      // nothing to clear
    }
  },
}

// "(814) 555-0123" -> "+18145550123". Returns null if it isn't a 10 digit US number.
export function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}
