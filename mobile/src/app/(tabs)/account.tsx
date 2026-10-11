import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { goToSignIn, Notice, Stage, TabHeader, TabPage, usePullToRefresh } from '@/components/parts';
import { Button, Divider, font, IoniconName, PressableScale, T } from '@/components/ui';
import * as api from '@/lib/api';
import { USE_FIXTURES } from '@/lib/api';
import type { Reservation } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatCents, formatPhone } from '@/lib/format';
import { openStoreMode } from '@/lib/storeMode';
import { colors, gutter, radius } from '@/lib/theme';

const HOW_IT_WORKS: { icon: IoniconName; text: string }[] = [
  { icon: 'pricetag-outline', text: 'Stores list a limited quantity.' },
  { icon: 'ticket-outline', text: 'You reserve and get a pickup code.' },
  { icon: 'bag-check-outline', text: 'Show the code and pay in store.' },
];

/** Only reservations that were actually picked up count. */
function impact(reservations: Reservation[] | null) {
  const picked = (reservations ?? []).filter((r) => r.status === 'picked_up');
  return {
    pickups: picked.length,
    savedCents: picked.reduce(
      (n, r) => n + Math.max(0, ((r.deal.original_price_cents ?? r.unit_price_cents) - r.unit_price_cents) * r.quantity),
      0
    ),
  };
}

/** Row for store owners: opens store mode, the merchant portal inside the app. */
function StoreModeRow() {
  return (
    <PressableScale
      onPress={openStoreMode}
      accessibilityRole="button"
      accessibilityLabel="Switch to store mode. Run a bakery, cafe or restaurant? List what’s left of today’s batch in one message."
      scaleTo={0.98}
      style={styles.storesRow}>
      <View style={styles.storesIcon}>
        <Ionicons name="storefront-outline" size={20} color={colors.inkSoft} />
      </View>
      <View style={styles.storesText}>
        <T variant="heading">Switch to store mode</T>
        <T variant="small">Run a bakery, cafe or restaurant? List what’s left of today’s batch in one message.</T>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </PressableScale>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text
        maxFontSizeMultiplier={1.2}
        style={[font('display'), styles.statValue]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}>
        {value}
      </Text>
      <T variant="small" numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

export default function AccountScreen() {
  const { session, signOut } = useAuth();
  const customer = session?.customer ?? null;
  const [history, setHistory] = useState<Reservation[] | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const token = session?.token ?? null;

  const loadHistory = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.listReservations();
      setHistory(res.reservations);
    } catch {
      // The totals are a nicety; the profile works without them.
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      if (!token) {
        setHistory(null);
        return;
      }
      void loadHistory();
    }, [token, loadHistory])
  );

  const refresh = usePullToRefresh(loadHistory);

  if (!session) {
    return (
      <TabPage title="Profile">
        <Stage>
          <Notice
            icon="person-outline"
            title="Sign in to reserve"
            body="Browse deals without an account. Sign in to reserve, follow stores and get notifications.">
            <View style={styles.actions}>
              <Button label="Sign in" onPress={() => goToSignIn()} />
              <Button label="Create an account" variant="outline" onPress={() => goToSignIn(undefined, true)} />
            </View>
          </Notice>
        </Stage>
        <View style={styles.storesWrap}>
          <StoreModeRow />
        </View>
      </TabPage>
    );
  }

  const stats = impact(history);
  const initial = customer?.name?.trim().charAt(0).toUpperCase() ?? '';

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.page}
      refreshControl={refresh}
      showsVerticalScrollIndicator={false}>
      <TabHeader title="Profile" />

      <View style={styles.identity}>
        <View style={styles.avatar}>
          {initial ? (
            <Text maxFontSizeMultiplier={1.2} style={[font('display'), styles.avatarText]}>{initial}</Text>
          ) : (
            <Ionicons name="person" size={24} color={colors.paper} />
          )}
        </View>
        <View style={styles.identityText}>
          <T variant="title" numberOfLines={1}>
            {customer?.name ?? 'Signed in'}
          </T>
          {customer ? <T variant="small">{formatPhone(customer.phone)}</T> : null}
        </View>
      </View>

      <View style={styles.section}>
        <T variant="eyebrow">So far</T>
        <View style={[styles.card, styles.stats]}>
          <Stat value={String(stats.pickups)} label={stats.pickups === 1 ? 'pickup' : 'pickups'} />
          <View style={styles.statDivider} />
          <Stat value={formatCents(stats.savedCents)} label="saved" />
        </View>
      </View>

      <View style={styles.section}>
        <T variant="eyebrow">How it works</T>
        <View style={styles.card}>
          {HOW_IT_WORKS.map((step, i) => (
            <View key={step.text}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.howRow}>
                <Ionicons name={step.icon} size={20} color={colors.inkSoft} />
                <T style={styles.howText}>{step.text}</T>
              </View>
            </View>
          ))}
        </View>
        <T variant="small">Pickup only. You pay in store, never in the app.</T>
      </View>

      <StoreModeRow />

      <Button label="Sign out" variant="outline" icon="log-out-outline" busy={signingOut} onPress={() => void onSignOut()} />

      {USE_FIXTURES ? (
        <View style={styles.sample}>
          <Ionicons name="flask-outline" size={16} color={colors.muted} />
          <T variant="small" style={{ flex: 1 }}>
            Showing sample data. Set EXPO_PUBLIC_API_URL to use the live service.
          </T>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  page: { paddingHorizontal: gutter, paddingBottom: 40, gap: 28 },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: -4 },
  identityText: { flex: 1, gap: 2 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 24, lineHeight: 32, color: colors.paper },
  section: { gap: 12 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
  },
  stats: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 24, lineHeight: 32, color: colors.ink },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: colors.line },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  howText: { flex: 1, color: colors.ink },
  storesWrap: { paddingHorizontal: gutter, paddingBottom: 28 },
  storesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 64,
  },
  storesIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storesText: { flex: 1, gap: 2 },
  sample: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.neutralSoft,
    borderRadius: radius.md,
    padding: 12,
  },
});
