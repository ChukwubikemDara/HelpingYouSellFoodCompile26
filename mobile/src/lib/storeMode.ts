import { Platform } from 'react-native';
import { router } from 'expo-router';

// The merchant portal. A signed-in merchant is redirected from /signin to /today by the portal itself.
// Override with EXPO_PUBLIC_PORTAL_URL (for a staging portal); no other screen needs to know the host.
export const PORTAL_URL =
  (process.env.EXPO_PUBLIC_PORTAL_URL ?? '').trim() || 'https://main.d19grvvand435u.amplifyapp.com/signin';

/**
 * Switch to store mode. In the app that is a full-screen route showing the portal;
 * on the web there is no app shell to stay inside, so the portal opens in the same tab.
 */
export function openStoreMode() {
  if (Platform.OS === 'web') {
    window.location.href = PORTAL_URL;
    return;
  }
  router.push('/store-mode');
}
