import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';
import { PORTAL_URL } from '@/lib/storeMode';
import { colors } from '@/lib/theme';

/** On the web there is no app shell to stay inside, so store mode is the portal in the same tab. */
export function StoreWebView() {
  useEffect(() => {
    window.location.href = PORTAL_URL;
  }, []);
  return (
    <View style={styles.screen}>
      <T variant="small">Opening store mode…</T>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
});
