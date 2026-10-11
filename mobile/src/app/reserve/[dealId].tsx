import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DealArt } from '@/components/DealArt';
import {
  isBadParam,
  isReservable,
  loadFailure,
  LoadFailure,
  NotFoundView,
  SignInPrompt,
  StatusView,
} from '@/components/parts';
import { Button, ErrorNote, font, PressableScale, T, tap, TopBar } from '@/components/ui';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { Deal } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatCents, formatWindow } from '@/lib/format';
import { colors, gutter, radius } from '@/lib/theme';

// Shown only when GET /customers/me says blocked but no reserve attempt has returned the API's message yet.
const BLOCKED_FALLBACK = 'This account can no longer reserve.';

export default function ReserveScreen() {
  const { dealId } = useLocalSearchParams<{ dealId: string }>();
  const { session, refreshMe, blockedMessage, setBlockedMessage } = useAuth();
  const insets = useSafeAreaInsets();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const badLink = isBadParam(dealId);

  const load = useCallback(async () => {
    if (!dealId || isBadParam(dealId)) return;
    try {
      const d = await api.getDeal(dealId);
      setDeal(d);
      setFailure(null);
      const max = Math.max(1, Math.min(d.quantity_left, d.max_per_customer));
      setQuantity((q) => Math.min(Math.max(q, 1), max));
    } catch (e) {
      setFailure(loadFailure(e));
    }
  }, [dealId]);

  const signedIn = !!session;
  useFocusEffect(
    useCallback(() => {
      void load();
      if (signedIn) void refreshMe();
    }, [load, refreshMe, signedIn])
  );

  // Reserving slides up from the bottom, like a sheet; the close button brings it back down.
  const options = <Stack.Screen options={{ animation: 'slide_from_bottom' }} />;

  if (!session) {
    return (
      <View style={styles.screen}>
        {options}
        <TopBar title="Reserve" icon="close" />
        <SignInPrompt title="Sign in to reserve" message="Your name and phone go on the pickup ticket." />
      </View>
    );
  }

  if (!deal) {
    const gone = badLink || failure?.notFound;
    return (
      <View style={styles.screen}>
        {options}
        <TopBar title="Reserve" icon="close" />
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

  const blocked = blockedMessage ?? (session.customer?.blocked ? BLOCKED_FALLBACK : null);
  const max = Math.max(0, Math.min(deal.quantity_left, deal.max_per_customer));
  const reservable = isReservable(deal) && max >= 1;
  const unit = deal.deal_price_cents ?? 0;
  const saving =
    deal.original_price_cents !== null && deal.deal_price_cents !== null
      ? Math.max(0, (deal.original_price_cents - deal.deal_price_cents) * quantity)
      : 0;

  const reserve = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createReservation({ deal_id: deal.id, quantity });
      tap('success');
      router.replace(`/reservation/${encodeURIComponent(r.id)}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CUSTOMER_BLOCKED') {
        setBlockedMessage(e.message);
      } else {
        setError(api.errorMessage(e));
        if (e instanceof ApiError && (e.code === 'SOLD_OUT' || e.code === 'DEAL_NOT_LIVE' || e.code === 'VALIDATION')) {
          void load();
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const step = (delta: number) => {
    tap('select');
    setQuantity((q) => Math.min(Math.max(1, q + delta), Math.max(1, max)));
  };

  const showForm = !blocked && reservable;

  return (
    <View style={styles.screen}>
      {options}
      <TopBar title="Reserve" icon="close" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.summary}>
          <DealArt deal={deal} size={30} style={styles.art} />
          <View style={styles.summaryText}>
            <T variant="eyebrow" numberOfLines={1}>
              {deal.merchant.name}
            </T>
            <T variant="heading" numberOfLines={2} style={styles.summaryTitle}>
              {deal.title}
            </T>
            <T variant="small">{formatCents(unit)} each</T>
            <T variant="small" numberOfLines={2}>
              Pickup {formatWindow(deal.pickup_start, deal.pickup_end)}
            </T>
          </View>
        </View>

        {blocked ? (
          <View style={styles.middle}>
            <ErrorNote message={blocked} style={styles.fullWidth} />
          </View>
        ) : !reservable ? (
          <View style={styles.middle}>
            <T style={styles.centerText}>
              {deal.status === 'live' || deal.status === 'sold_out' ? 'Sold out' : 'No longer available.'}
            </T>
          </View>
        ) : (
          <>
            {/* the quantity sits in the middle of the space between the deal and the total */}
            <View style={styles.middle}>
              <T variant="eyebrow">How many</T>
              <View style={styles.stepper}>
                <StepButton icon="remove" label="One fewer" disabled={busy || quantity <= 1} onPress={() => step(-1)} />
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={[font('display'), styles.quantity]}
                  accessibilityLabel={`Quantity ${quantity}`}
                  accessibilityLiveRegion="polite">
                  {quantity}
                </Text>
                <StepButton icon="add" label="One more" disabled={busy || quantity >= max} onPress={() => step(1)} />
              </View>
              <T variant="small" style={styles.centerText}>
                {deal.quantity_left} left · Limit {deal.max_per_customer} per person
              </T>
            </View>

            <View style={styles.totalCard}>
              <View style={styles.totalRow}>
                <T>Total</T>
                <Text maxFontSizeMultiplier={1.2} style={[font('display'), styles.total]}>{formatCents(unit * quantity)}</Text>
              </View>
              {saving > 0 ? (
                <View style={styles.totalRow}>
                  <T variant="small">You save</T>
                  <T variant="small" style={[font('semibold'), { color: colors.forest }]}>
                    {formatCents(saving)}
                  </T>
                </View>
              ) : null}
              <View style={styles.payRow}>
                <Ionicons name="storefront-outline" size={16} color={colors.muted} />
                <T variant="small" style={{ flex: 1 }}>
                  Pay in store when you pick up. Nothing is charged in the app.
                </T>
              </View>
              <View style={styles.payRow}>
                <Ionicons name="time-outline" size={16} color={colors.muted} />
                <T variant="small" style={{ flex: 1 }}>
                  We remind you 30 minutes before pickup ends. Can't make it? Cancel before then. Two missed pickups pause reserving.
                </T>
              </View>
            </View>

            <ErrorNote message={error} />
          </>
        )}
      </ScrollView>

      {showForm ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Button label={`Reserve · ${formatCents(unit * quantity)}`} onPress={reserve} busy={busy} />
        </View>
      ) : null}
    </View>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={[styles.stepButton, disabled && { opacity: 0.35 }]}>
      <Ionicons name={icon} size={24} color={colors.ink} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { flexGrow: 1, paddingHorizontal: gutter, paddingTop: 8, paddingBottom: 24, gap: 20 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  art: { width: 72, height: 72, borderRadius: radius.md },
  summaryText: { flex: 1, gap: 2 },
  summaryTitle: { fontSize: 17, lineHeight: 23 },
  middle: { flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 16 },
  fullWidth: { alignSelf: 'stretch' },
  centerText: { textAlign: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  stepButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantity: { fontSize: 56, lineHeight: 70, color: colors.ink, minWidth: 72, textAlign: 'center' },
  totalCard: {
    gap: 10,
    padding: 16,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { fontSize: 26, lineHeight: 34, color: colors.ink },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: 12,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
});
