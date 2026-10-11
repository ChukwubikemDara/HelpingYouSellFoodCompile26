import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FadeIn,
  isBadParam,
  loadFailure,
  LoadFailure,
  NotFoundView,
  SignInPrompt,
  StatusView,
  usePullToRefresh,
} from '@/components/parts';
import { Ticket } from '@/components/Ticket';
import { Button, Card, ErrorNote, goBackOr, Pill, T, tap, TopBar } from '@/components/ui';
import * as api from '@/lib/api';
import type { Reservation } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatPhone } from '@/lib/format';
import { colors, gutter } from '@/lib/theme';
import { useFocusPoll } from '@/lib/useFocusPoll';

function headline(r: Reservation): { title: string; body: string } {
  if (r.status === 'cancelled' && r.deal.status === 'cancelled') {
    return { title: 'Deal cancelled', body: `${r.deal.merchant.name} had to cancel this one. Nothing to pay.` };
  }
  switch (r.status) {
    case 'reserved':
      return { title: 'It’s yours.', body: 'Show this ticket at the counter before the pickup window ends, then pay in store.' };
    case 'picked_up':
      return { title: 'Enjoy.', body: 'Marked as picked up. Thanks for choosing a local spot.' };
    case 'cancelled':
      return { title: 'Cancelled', body: 'The items went back to the store for someone else to reserve.' };
    case 'no_show':
      return { title: 'Missed it', body: 'This one was not picked up in time.' };
    default:
      return { title: 'Reservation', body: '' };
  }
}

/** Copy per payment_method; the value comes from the API and is not assumed. */
function paymentLine(method: string): string {
  if (method === 'in_store') return 'Pay in store when you pick up. Nothing is charged in the app.';
  return `Payment: ${method}`;
}

export default function ReservationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'pickup' | 'cancel' | null>(null);
  const statusRef = useRef<Reservation['status'] | null>(null);
  const signedIn = !!session;
  const badLink = isBadParam(id);

  const fetchReservation = useCallback(async () => {
    if (!id || !signedIn || isBadParam(id)) return;
    try {
      const r = await api.getReservation(id);
      statusRef.current = r.status;
      setReservation(r);
      setFailure(null);
    } catch (e) {
      setFailure(loadFailure(e));
    }
  }, [id, signedIn]);

  // Polling only matters while the reservation is open; a finished one does not change.
  const load = useCallback(async () => {
    if (statusRef.current && statusRef.current !== 'reserved') return;
    await fetchReservation();
  }, [fetchReservation]);

  // Refresh on focus and every 30 s while the reservation is open.
  useFocusPoll(load);
  const refresh = usePullToRefresh(fetchReservation);

  const apply = (r: Reservation) => {
    statusRef.current = r.status;
    setReservation(r);
  };

  const confirmPickup = async () => {
    if (!reservation) return;
    setBusy('pickup');
    setActionError(null);
    try {
      apply(await api.confirmPickup(reservation.id));
      tap('success');
    } catch (e) {
      setActionError(api.errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    if (!reservation) return;
    const doCancel = async () => {
      setBusy('cancel');
      setActionError(null);
      try {
        apply(await api.cancelReservation(reservation.id));
      } catch (e) {
        setActionError(api.errorMessage(e));
      } finally {
        setBusy(null);
      }
    };
    const title = 'Cancel this reservation?';
    const body = 'The items go back to the store for someone else to reserve.';
    // Alert.alert with buttons does nothing on web, so the browser's confirm dialog asks there.
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(`${title}\n\n${body}`)) void doCancel();
      return;
    }
    Alert.alert(title, body, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel reservation', style: 'destructive', onPress: () => void doCancel() },
    ]);
  };

  const back = () => goBackOr('/reservations');

  if (!session) {
    return (
      <View style={styles.screen}>
        <TopBar onBack={back} />
        <SignInPrompt message="Sign in to see this reservation." />
      </View>
    );
  }

  if (!reservation) {
    const gone = badLink || failure?.notFound;
    return (
      <View style={styles.screen}>
        <TopBar onBack={back} />
        {gone ? (
          <NotFoundView
            title="We can’t find that pickup"
            message={failure?.apiMessage}
            actionLabel="Back to pickups"
            onAction={() => router.dismissTo('/reservations')}
          />
        ) : (
          <StatusView
            loading={!failure}
            error={failure?.message}
            onRetry={() => {
              setFailure(null);
              void fetchReservation();
            }}
          />
        )}
      </View>
    );
  }

  const r = reservation;
  const open = r.status === 'reserved';
  const copy = headline(r);
  const allergens = r.deal.allergens;

  return (
    <View style={styles.screen}>
      <TopBar onBack={back} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        refreshControl={refresh}
        showsVerticalScrollIndicator={false}>
        <ErrorNote message={failure?.message} />

        <FadeIn>
          <View style={styles.headline}>
            <T variant="display">{copy.title}</T>
            {copy.body ? <T>{copy.body}</T> : null}
          </View>
        </FadeIn>

        <FadeIn delay={90}>
          <Ticket reservation={r} />
        </FadeIn>

        <FadeIn delay={180}>
          <View style={styles.rest}>
            <T variant="small" style={styles.centerText}>
              {paymentLine(r.payment_method)}
            </T>

            <ErrorNote message={actionError} />

            {open ? (
              <View style={styles.actions}>
                <Button
                  label="I picked it up"
                  icon="checkmark-circle"
                  variant="dark"
                  onPress={confirmPickup}
                  busy={busy === 'pickup'}
                  disabled={busy !== null}
                />
                <Button
                  label="Cancel reservation"
                  variant="ghostDanger"
                  onPress={cancel}
                  busy={busy === 'cancel'}
                  disabled={busy !== null}
                />
              </View>
            ) : (
              <Button label="Find another deal" variant="outline" onPress={() => router.dismissTo('/')} />
            )}

            <Card style={styles.allergenCard}>
              <T variant="eyebrow">Allergens</T>
              {allergens === null ? (
                <T style={styles.ink}>Not stated by the store</T>
              ) : allergens.length === 0 ? (
                <T style={styles.ink}>None listed by the store</T>
              ) : (
                <View style={styles.allergens}>
                  {allergens.map((a) => (
                    <Pill key={a} label={a} />
                  ))}
                </View>
              )}
              <T variant="small">Ask the store if you have an allergy.</T>
            </Card>

            <T variant="small" style={styles.centerText}>
              Reserved by {r.customer_name}, {formatPhone(r.customer_phone)}
            </T>
          </View>
        </FadeIn>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: gutter, paddingTop: 4, gap: 18 },
  headline: { gap: 6 },
  rest: { gap: 24 },
  centerText: { textAlign: 'center' },
  actions: { gap: 6 },
  allergenCard: { gap: 8 },
  ink: { color: colors.ink },
  allergens: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
