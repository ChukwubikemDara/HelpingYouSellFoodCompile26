import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';

import { Button, EmptyState, goBackOr, PressableScale, T } from '@/components/ui';
import { PORTAL_URL } from '@/lib/storeMode';
import { colors, gutter } from '@/lib/theme';

// Pages where the portal's own back would only bounce between sign-in and Today,
// so back leaves store mode from there.
const PORTAL_HOME = /^\/(today|signin)\/?$/;
const WEB_SCHEMES = /^(https?|about|data|blob):/i;

function pathOf(url: string): string {
  const m = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(url);
  return m?.[1] ?? '/';
}

/**
 * Store mode: the merchant portal full screen, under a slim "Back to Last Call" bar.
 * Cookies and storage persist, so a merchant stays signed in between visits.
 */
export function StoreWebView() {
  const insets = useSafeAreaInsets();
  const web = useRef<WebView>(null);
  const [nav, setNav] = useState({ url: PORTAL_URL, canGoBack: false });
  // The first page has not finished loading yet (full-area spinner), then a small spinner while navigating.
  const [firstLoad, setFirstLoad] = useState(true);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Pull to refresh only when the page is scrolled to the top, so it never fights page scrolling.
  const [atTop, setAtTop] = useState(true);

  const leave = useCallback(() => goBackOr('/account'), []);
  const insideHistory = nav.canGoBack && !PORTAL_HOME.test(pathOf(nav.url));

  // Android hardware back goes back inside the portal first, and leaves store mode from its first page.
  const insideRef = useRef(insideHistory);
  insideRef.current = insideHistory;
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (insideRef.current && !failed) {
          web.current?.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [failed])
  );

  const retry = useCallback(() => {
    setFailed(false);
    setFirstLoad(true);
    setLoading(true);
    web.current?.reload();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    web.current?.reload();
    // The load events end the spinner; this is only a backstop.
    setTimeout(() => setRefreshing(false), 2500);
  }, []);

  const onNavigationStateChange = useCallback((e: WebViewNavigation) => {
    setNav({ url: e.url, canGoBack: e.canGoBack });
  }, []);

  // tel:, mailto:, maps and the like open in their own apps instead of failing inside the page.
  const onShouldStart = useCallback((req: { url: string }) => {
    if (WEB_SCHEMES.test(req.url)) return true;
    void Linking.openURL(req.url).catch(() => {});
    return false;
  }, []);

  const view = (
    <WebView
      ref={web}
      source={{ uri: PORTAL_URL }}
      style={styles.web}
      // Sessions and the portal's own storage survive between visits.
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      // The portal's photo picker: file inputs open the camera or library.
      allowFileAccess
      mediaCapturePermissionGrantType="grant"
      allowsInlineMediaPlayback
      // Swipe back and forward inside the portal (iOS), pull to refresh (iOS; Android is wrapped below).
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled={Platform.OS === 'ios'}
      nestedScrollEnabled
      setSupportMultipleWindows={false}
      onNavigationStateChange={onNavigationStateChange}
      onShouldStartLoadWithRequest={onShouldStart}
      onLoadProgress={(e) => setLoading(e.nativeEvent.progress < 1)}
      onLoadEnd={() => {
        setFirstLoad(false);
        setLoading(false);
        setRefreshing(false);
      }}
      onError={() => {
        setFailed(true);
        setFirstLoad(false);
        setLoading(false);
        setRefreshing(false);
      }}
      onScroll={(e) => setAtTop(e.nativeEvent.contentOffset.y <= 0)}
    />
  );

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <View style={[styles.bar, { paddingTop: insets.top }]}>
        <PressableScale
          onPress={leave}
          scaleTo={0.97}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back to Last Call"
          style={styles.back}>
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
          <T variant="heading" numberOfLines={1} style={styles.backText}>
            Back to Last Call
          </T>
        </PressableScale>
        {loading && !firstLoad ? <ActivityIndicator size="small" color={colors.muted} /> : null}
        <View style={styles.storeIcon} accessibilityElementsHidden importantForAccessibility="no">
          <Ionicons name="storefront-outline" size={18} color={colors.inkSoft} />
        </View>
      </View>

      <View style={styles.body}>
        {Platform.OS === 'android' ? (
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.fill}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                enabled={atTop}
                colors={[colors.ember]}
                progressBackgroundColor={colors.card}
              />
            }>
            {view}
          </ScrollView>
        ) : (
          view
        )}

        {firstLoad && !failed ? (
          <View style={styles.cover} accessibilityRole="progressbar" accessibilityLabel="Loading">
            <ActivityIndicator color={colors.muted} />
            <T variant="small">Opening store mode…</T>
          </View>
        ) : null}

        {failed ? (
          <View style={styles.cover}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn’t open store mode"
              body="Check your connection and try again.">
              <Button label="Try again" variant="outline" icon="refresh" onPress={retry} style={styles.retry} />
            </EmptyState>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: gutter - 6,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.paper,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, flexShrink: 1, paddingRight: 8 },
  backText: { fontSize: 16, lineHeight: 22 },
  storeIcon: {
    marginLeft: 'auto',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  fill: { flex: 1 },
  web: { flex: 1, backgroundColor: colors.paper },
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.paper,
  },
  retry: { marginTop: 12, minWidth: 180 },
});
