import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DealArt } from '@/components/DealArt';
import {
  goToSignIn,
  isBadParam,
  isReservable,
  loadFailure,
  LoadFailure,
  NotFoundView,
  Price,
  StatusView,
  usePullToRefresh,
} from '@/components/parts';
import {
  Button,
  Divider,
  ErrorNote,
  font,
  goBackOr,
  IconButton,
  IoniconName,
  Pill,
  PressableScale,
  T,
  tap,
  TopBar,
} from '@/components/ui';
import * as api from '@/lib/api';
import type { Deal } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDistance, formatWindow, percentOff, timeLeft } from '@/lib/format';
import { colors, gutter, radius } from '@/lib/theme';
import { useNow } from '@/lib/useNow';

function InfoRow({ icon, label, children }: { icon: IoniconName; label: string; children: ReactNode }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={20} color={colors.muted} style={styles.infoIcon} />
      <View style={styles.infoBody}>
        <T variant="eyebrow">{label}</T>
        {children}
      </View>
    </View>
  );
}

function FollowButton({
  following,
  busy,
  onPress,
}: {
  following: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const fg = following ? colors.ink : colors.white;
  return (
    <PressableScale
      onPress={() => {
        tap('select');
        onPress();
      }}
      disabled={busy}
      scaleTo={0.96}
      accessibilityRole="button"
      accessibilityLabel={following ? 'Unfollow store' : 'Follow store'}
      accessibilityState={{ disabled: busy, busy }}
      style={[styles.followButton, following ? styles.followOn : styles.followOff, busy && { opacity: 0.7 }]}>
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Ionicons name={following ? 'checkmark' : 'add'} size={16} color={fg} />
      )}
      <T variant="label" style={[font('semibold'), { color: fg }]}>
        {following ? 'Following' : 'Follow'}
      </T>
    </PressableScale>
  );
}

export default function DealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useNow();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  // Set when a signed-out user taps Follow: we follow once they come back signed in.
  const followAfterSignIn = useRef(false);

  const badLink = isBadParam(id);

  const load = useCallback(async () => {
    if (!id || isBadParam(id)) return;
    try {
      const d = await api.getDeal(id);
      setDeal(d);
      setFailure(null);
    } catch (e) {
      setFailure(loadFailure(e));
    }
  }, [id]);

  const refresh = usePullToRefresh(load);

  const loadFollows = useCallback(async (merchantId: string) => {
    try {
      const res = await api.listFollows();
      setFollowing(res.merchant_ids.includes(merchantId));
    } catch {
      setFollowing(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const merchantId = deal?.merchant_id ?? null;
  const signedIn = !!session;

  const setFollow = useCallback(async (merchant: string, on: boolean) => {
    setFollowBusy(true);
    setFollowError(null);
    try {
      if (on) await api.followMerchant(merchant);
      else await api.unfollowMerchant(merchant);
      setFollowing(on);
    } catch (e) {
      setFollowError(api.errorMessage(e));
    } finally {
      setFollowBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!merchantId) return;
    if (!signedIn) {
      setFollowing(null);
      return;
    }
    if (followAfterSignIn.current) {
      followAfterSignIn.current = false;
      void setFollow(merchantId, true);
    } else {
      void loadFollows(merchantId);
    }
  }, [merchantId, signedIn, loadFollows, setFollow]);

  const onFollowPress = () => {
    if (!deal) return;
    if (!session) {
      followAfterSignIn.current = true;
      goToSignIn();
      return;
    }
    void setFollow(deal.merchant_id, !following);
  };

  const onReservePress = () => {
    if (!deal) return;
    const next = `/reserve/${encodeURIComponent(deal.id)}`;
    if (!session) goToSignIn(next);
    else router.push(next);
  };

  if (!deal) {
    // A link to a deal that is gone (or never was) gets a way out, not a dead end.
    const gone = badLink || failure?.notFound;
    return (
      <View style={styles.screen}>
        <TopBar />
        {gone ? (
          <NotFoundView title="This deal isn’t available" message={failure?.apiMessage} />
        ) : (
          <StatusView
            loading={!failure}
            error={failure?.message}
            onRetry={() => {
              setFailure(null);
              void load();
            }}
          />
        )}
      </View>
    );
  }

  const reservable = isReservable(deal);
  const soldOut = deal.status === 'sold_out' || deal.quantity_left <= 0;
  const pct = percentOff(deal.original_price_cents, deal.deal_price_cents);
  const left = reservable ? timeLeft(now, deal.pickup_end) : '';
  const window = formatWindow(deal.pickup_start, deal.pickup_end);
  const distance = formatDistance(deal.distance_m);
  const heroHeight = Math.round(Math.min(Math.max(width * 0.62, 220), 300)) + insets.top;

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={refresh}
        contentContainerStyle={{ paddingBottom: reservable ? 24 : insets.bottom + 32 }}>
        <View>
          <DealArt deal={deal} size={104} style={{ height: heroHeight }} />
          <IconButton
            icon="chevron-back"
            label="Back"
            onPress={() => goBackOr('/')}
            style={[styles.back, { top: insets.top + 10 }]}
          />
        </View>

        {/* the sheet overlaps the artwork so the page reads as one piece */}
        <View style={styles.sheet}>
          {pct || left || soldOut || (reservable && deal.quantity_left <= 2) ? (
            <View style={styles.badges}>
              {pct ? <Pill tone="marigold" label={`${pct}% off`} /> : null}
              {left ? <Pill tone="neutral" icon="time-outline" label={left} /> : null}
              {reservable && deal.quantity_left <= 2 ? <Pill tone="ember" label={`Only ${deal.quantity_left} left`} /> : null}
              {soldOut ? <Pill label="Sold out" /> : null}
            </View>
          ) : null}

          <View style={styles.head}>
            <T variant="eyebrow" numberOfLines={1}>
              {deal.merchant.name}
            </T>
            <T variant="display">{deal.title}</T>
            <View style={styles.priceSlot}>
              <Price deal={deal} size={26} />
            </View>
            {reservable ? (
              <T variant="small">
                {deal.quantity_left} left · Limit {deal.max_per_customer} per person
              </T>
            ) : null}
          </View>

          <ErrorNote message={failure?.message} />

          {deal.note ? (
            <View style={styles.note}>
              <T variant="lead" style={styles.noteText}>
                “{deal.note}”
              </T>
              <T variant="small">from the store</T>
            </View>
          ) : null}

          <View style={styles.card}>
            <InfoRow icon="bag-handle-outline" label="What you get">
              {deal.items.map((item, i) => (
                <T key={`${item.name}-${i}`} style={styles.infoText}>
                  {item.qty} × {item.name}
                </T>
              ))}
            </InfoRow>
            {window ? (
              <>
                <Divider style={styles.divider} />
                <InfoRow icon="time-outline" label="Pickup window">
                  <T style={styles.infoText}>{window}</T>
                </InfoRow>
              </>
            ) : null}
            {deal.merchant.address || distance ? (
              <>
                <Divider style={styles.divider} />
                <InfoRow icon="location-outline" label="Where">
                  {deal.merchant.address ? <T style={styles.infoText}>{deal.merchant.address}</T> : null}
                  {distance ? <T variant="small">{distance} away</T> : null}
                </InfoRow>
              </>
            ) : null}
            <Divider style={styles.divider} />
            <InfoRow icon="alert-circle-outline" label="Allergens">
              {deal.allergens === null ? (
                <T style={styles.infoText}>Not stated by the store</T>
              ) : deal.allergens.length === 0 ? (
                <T style={styles.infoText}>None listed by the store</T>
              ) : (
                <View style={styles.allergens}>
                  {deal.allergens.map((a) => (
                    <Pill key={a} label={a} />
                  ))}
                </View>
              )}
              <T variant="small">Ask the store if you have an allergy.</T>
            </InfoRow>
          </View>

          <View style={styles.card}>
            <View style={styles.followRow}>
              <View style={styles.followText}>
                <T variant="heading" numberOfLines={1}>
                  {deal.merchant.name}
                </T>
                <T variant="small">
                  {following
                    ? `You get a notification when ${deal.merchant.name} lists a deal.`
                    : `Get a notification when ${deal.merchant.name} lists a deal.`}
                </T>
              </View>
              <FollowButton following={!!following} busy={followBusy} onPress={onFollowPress} />
            </View>
            {followError ? <ErrorNote message={followError} style={styles.followError} /> : null}
          </View>

          {!reservable ? (
            <View style={[styles.card, styles.unavailable]}>
              <T style={styles.centerText}>
                {soldOut ? 'Sold out for now. If someone cancels, it comes back.' : 'No longer available.'}
              </T>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {reservable ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.footerPrice}>
            <Price deal={deal} size={22} strike={false} />
            <T variant="small">Pay in store</T>
          </View>
          <Button
            label={session ? 'Reserve' : 'Sign in to reserve'}
            onPress={onReservePress}
            style={styles.footerButton}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  back: { position: 'absolute', left: gutter },
  sheet: {
    marginTop: -28,
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: gutter,
    paddingTop: 24,
    gap: 22,
  },
  badges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  head: { gap: 4 },
  priceSlot: { marginTop: 8 },
  note: { borderLeftWidth: 2, borderLeftColor: colors.marigold, paddingLeft: 14, gap: 2 },
  noteText: { color: colors.ink },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  infoRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  infoIcon: { width: 22, marginTop: 1 },
  infoBody: { flex: 1, gap: 2 },
  infoText: { ...font('medium'), color: colors.ink },
  divider: { marginVertical: 14 },
  allergens: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 2 },
  followRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  followText: { flex: 1, gap: 2 },
  followError: { marginTop: 12 },
  followButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 104,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
  },
  followOff: { backgroundColor: colors.ink },
  followOn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  unavailable: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: gutter,
    paddingTop: 12,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  footerPrice: { gap: 0 },
  footerButton: { flex: 1 },
});
