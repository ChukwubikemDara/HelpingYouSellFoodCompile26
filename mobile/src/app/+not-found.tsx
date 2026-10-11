import { Redirect, usePathname } from 'expo-router';

/**
 * Any URL that matches no screen (a stale deep link, a reopened path after a reload) lands here.
 * Instead of an error page the app quietly opens the deals.
 */
export default function NotFound() {
  const pathname = usePathname();
  if (__DEV__) console.warn(`No screen for "${pathname}"; opening the deals instead.`);
  return <Redirect href="/" />;
}
