import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
const KEY = 'hysf_customer_token'
export async function getToken(): Promise<string | null> {
  return Platform.OS === 'web' ? sessionStorage.getItem(KEY) : SecureStore.getItemAsync(KEY)
}
export async function setToken(token: string | null) {
  if (Platform.OS === 'web') { if (token) sessionStorage.setItem(KEY, token); else sessionStorage.removeItem(KEY); return }
  if (token) await SecureStore.setItemAsync(KEY, token); else await SecureStore.deleteItemAsync(KEY)
}
