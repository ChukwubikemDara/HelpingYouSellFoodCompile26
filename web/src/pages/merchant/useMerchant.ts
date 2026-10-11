import { useOutletContext } from 'react-router-dom'
import type { Merchant } from '../../types'

// The merchant loaded by MerchantLayout, for any screen nested under it.
export function useMerchant() {
  return useOutletContext<Merchant>()
}
