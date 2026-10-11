import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ReactElement, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  RefreshControl,
  RefreshControlProps,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, font, IoniconName, ScreenTitle, T } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import type { Deal, ReservationStatus } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { colors, gutter, motion } from '@/lib/theme';

export function isReservable(deal: Deal): boolean {
  return deal.status === 'live' && deal.quantity_left > 0;
}

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  reserved: 'Ready to pick up',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
  no_show: 'Not picked up',
};

// ---------- Navigation helpers ----------

/** Opens sign-in; afterwards the app continues at `next`, or goes back to where the user was. */
export function goToSignIn(next?: string, signUp = false) {
  router.push({ pathname: signUp ? '/signup' : '/signin', params: next ? { next } : {} });
}

/** Back to the Deals tab: pops to it when it is already underneath, pushes it otherwise. */
export function goToDeals() {
  router.dismissTo('/');
}

// ---------- Load failures ----------

const GENERIC_LOAD_ERROR = 'We couldn’t load this just now. Try again in a moment.';

/**
 * Keeps raw status text such as "Something went wrong (HTTP 404)" off the screen. The API client
 * uses it only when the server sent no message of its own; real API messages pass through.
 */
export function tidyError(message: string | null | undefined): string | null {
  if (!message) return null;
  return /\bHTTP \d{3}\b/.test(message) ? GENERIC_LOAD_ERROR : message;
}

export type LoadFailure = {
  /** Safe to show: the API's message when it sent one. */
  message: string;
  /** The thing asked for does not exist (any more): a 404 or NOT_FOUND. */
  notFound: boolean;
  /** The API's own NOT_FOUND message when it says more than "not found". */
  apiMessage: string | null;
};

/** Sorts a failed load into "gone" (show a way out) or "try again". */
export function loadFailure(e: unknown): LoadFailure {
  const notFound = e instanceof ApiError && (e.code === 'NOT_FOUND' || e.status === 404);
  return {
    message: tidyError(errorMessage(e)) ?? GENERIC_LOAD_ERROR,
    notFound,
    apiMessage: e instanceof ApiError && e.code === 'NOT_FOUND' && !/not found/i.test(e.message) ? e.message : null,
  };
}

/** A route param that can only come from a stale or broken link. */
export function isBadParam(value: string | string[] | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return true;
  const s = v.trim().toLowerCase();
  return s === '' || s === 'undefined' || s === 'null';
}

// ---------- Feedback ----------

/** Pull-to-refresh control that keeps spinning until `fn` settles. */
export function usePullToRefresh(fn?: () => Promise<unknown> | unknown): ReactElement<RefreshControlProps> {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fn?.();
    } finally {
      setRefreshing(false);
    }
  }, [fn]);
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.inkSoft}
      colors={[colors.ember]}
      progressBackgroundColor={colors.card}
    />
  );
}

// ---------- Layout ----------

/** Eases its content in once when it first appears: a short fade with a small rise. Skipped when the system asks for less motion. */
export function FadeIn({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Start right away so content never waits on the accessibility query; if the system asks for
    // less motion, jump to the end instead.
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: motion.base + 60,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    run.start();
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (alive && reduce) {
          run.stop();
          progress.setValue(1);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [progress, delay]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}>
      {children}
    </Animated.View>
  );
}

/** Fills the space left under a header and centers its content, nudged up to sit at the optical middle. */
export function Stage({ children, style, ...rest }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...rest} style={[styles.stage, style]}>
      {children}
    </View>
  );
}

/** Icon, title, short body and optional actions, centered as one group. */
export function Notice({
  icon,
  title,
  body,
  children,
}: {
  icon: IoniconName;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.notice}>
      <View style={styles.noticeIcon}>
        <Ionicons name={icon} size={26} color={colors.inkSoft} />
      </View>
      <T variant="title" style={styles.centerText}>
        {title}
      </T>
      {body ? <T style={styles.centerText}>{body}</T> : null}
      {children}
    </View>
  );
}

/** Loading, or a failed load with the API's message and "Try again", centered in the space it has. */
export function StatusView({
  loading,
  error,
  onRetry,
}: {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <Stage accessibilityLabel="Loading" accessibilityRole="progressbar">
        <ActivityIndicator color={colors.ember} />
      </Stage>
    );
  }
  if (!error) return null;
  return (
    <Stage>
      <Notice icon="cloud-offline-outline" title="Couldn’t load this" body={error}>
        {onRetry ? (
          <View style={styles.actions}>
            <Button label="Try again" variant="outline" icon="refresh" onPress={onRetry} />
          </View>
        ) : null}
      </Notice>
    </Stage>
  );
}

/** What the user sees when a link points at something that is gone, instead of a dead end. */
export function NotFoundView({
  title,
  message,
  actionLabel = 'Back to deals',
  onAction = goToDeals,
}: {
  title: string;
  message?: string | null;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Stage>
      <Notice icon="compass-outline" title={title} body={message ?? 'It may have ended, or the link is out of date.'}>
        <View style={styles.actions}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      </Notice>
    </Stage>
  );
}

/** Shown where sign-in is required; `next` is where to continue after signing in. */
export function SignInPrompt({
  message,
  next,
  title = 'Sign in to continue',
  icon = 'lock-closed',
}: {
  message: string;
  next?: string;
  title?: string;
  icon?: IoniconName;
}) {
  return (
    <Stage>
      <Notice icon={icon} title={title} body={message}>
        <View style={styles.actions}>
          <Button label="Sign in" onPress={() => goToSignIn(next)} />
          <Button label="Create an account" variant="outline" onPress={() => goToSignIn(next, true)} />
        </View>
      </Notice>
    </Stage>
  );
}

/** Large title at the top of a tab, below the status bar. */
export function TabHeader({
  title,
  right,
  subtitle,
  padded = false,
}: {
  title: string;
  right?: ReactNode;
  subtitle?: string;
  padded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabHeader, { paddingTop: insets.top + 20 }, padded && { paddingHorizontal: gutter }]}>
      <ScreenTitle right={right} subtitle={subtitle}>
        {title}
      </ScreenTitle>
    </View>
  );
}

/**
 * A tab whose body is short: a header and one centered state (signed out, loading, empty, error).
 * Pulls to refresh when `onRefresh` is given.
 */
export function TabPage({
  title,
  right,
  onRefresh,
  children,
}: {
  title: string;
  right?: ReactNode;
  onRefresh?: () => Promise<unknown> | unknown;
  children: ReactNode;
}) {
  const refresh = usePullToRefresh(onRefresh);
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      refreshControl={onRefresh ? refresh : undefined}
      alwaysBounceVertical
      showsVerticalScrollIndicator={false}>
      <TabHeader title={title} right={right} padded />
      {children}
    </ScrollView>
  );
}

// ---------- Price ----------

/** Deal price with the original struck through. Either price can be missing. */
export function Price({
  deal,
  size = 20,
  color = colors.ink,
  strike = true,
}: {
  deal: Deal;
  size?: number;
  color?: string;
  /** Show the original price struck through next to the deal price. */
  strike?: boolean;
}) {
  return (
    <View style={styles.priceRow}>
      <Text
        maxFontSizeMultiplier={1.2}
        style={[font('display'), { fontSize: size, lineHeight: Math.round(size * 1.3), color }]}>
        {formatCents(deal.deal_price_cents)}
      </Text>
      {strike && deal.original_price_cents !== null ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={[font('body'), styles.was, wasSize(size)]}>
          {formatCents(deal.original_price_cents)}
        </Text>
      ) : null}
    </View>
  );
}

function wasSize(size: number) {
  const fontSize = Math.max(13, Math.round(size * 0.55));
  return { fontSize, lineHeight: Math.round(fontSize * 1.35) };
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 56,
  },
  notice: { alignItems: 'center', gap: 10, width: '100%', maxWidth: 340 },
  noticeIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  centerText: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 12 },
  tabHeader: { paddingBottom: 18 },
  page: { flex: 1, backgroundColor: colors.paper },
  pageContent: { flexGrow: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  was: { color: colors.muted, textDecorationLine: 'line-through' },
});

