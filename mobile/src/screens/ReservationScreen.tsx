import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../api'
import { Ticket } from '../components/Ticket'
import { Button, ErrorNote, Loading, T } from '../components/ui'
import { clock } from '../format'
import { useLoad, useNow } from '../hooks'
import type { StackProps } from '../navigation'
import { colors } from '../theme'
import type { Reservation } from '../types'

const COPY: Record<Reservation['status'], { title: string; body: string }> = {
  reserved: { title: 'It’s yours.', body: 'Head over during the pickup window and show this ticket at the counter.' },
  picked_up: { title: 'Enjoy!', body: 'Picked up. Thanks for keeping good food out of the bin.' },
  cancelled: { title: 'Cancelled', body: 'Your units went back on sale for someone else.' },
  no_show: { title: 'Missed it', body: 'This one wasn’t collected. Two missed pickups block this phone from reserving.' },
}

export function ReservationScreen({ route, navigation }: StackProps<'Reservation'>) {
  const { id } = route.params
  const insets = useSafeAreaInsets()
  // poll so the ticket flips to "picked up" the moment the store enters the code
  const { data: r, error, loading, setData } = useLoad(() => api.reservation(id), id, 10_000)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const now = useNow()

  async function act(fn: (id: string) => Promise<Reservation>, celebrate = false) {
    setBusy(true)
    setActionError('')
    try {
      setData(await fn(id))
      if (celebrate) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function confirmCancel() {
    Alert.alert('Cancel this reservation?', 'Your units go back on sale.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel reservation', style: 'destructive', onPress: () => void act(api.cancelReservation) },
    ])
  }

  const close = () => navigation.navigate('Tabs', { screen: 'Pickups' })

  if (loading) return <Loading />
  if (!r) {
    return (
      <View style={[styles.page, { paddingTop: insets.top + 60 }]}>
        <ErrorNote message={error?.message ?? 'Reservation not found'} />
        <Button title="Close" variant="outline" onPress={close} />
      </View>
    )
  }

  const open = r.status === 'reserved'
  const beforeWindow = now < Date.parse(r.deal.pickup_start)
  const windowOver = now > Date.parse(r.deal.pickup_end ?? '')
  const storeCancelled = r.status === 'cancelled' && r.deal.status === 'cancelled'
  const copy = storeCancelled
    ? { title: 'Deal cancelled', body: `${r.deal.merchant.name} had to cancel this one. Nothing to pay.` }
    : COPY[r.status]

  return (
    <ScrollView
      style={{ backgroundColor: colors.paper }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={styles.close}>
        <Ionicons name="close" size={22} color={colors.ink} />
      </Pressable>

      <View style={{ gap: 6 }}>
        <T variant="display">{copy.title}</T>
        <T>{copy.body}</T>
      </View>

      <Ticket reservation={r} />

      <ErrorNote message={actionError} />

      {open && (
        <View style={{ gap: 10 }}>
          <Button
            title="I picked it up"
            icon="checkmark-circle"
            variant="dark"
            busy={busy}
            disabled={beforeWindow || windowOver}
            onPress={() => act(api.confirmPickup, true)}
          />
          {beforeWindow && (
            <T variant="small" style={{ textAlign: 'center' }}>
              You can confirm once pickup opens at {clock(r.deal.pickup_start)}.
            </T>
          )}
          {windowOver ? (
            <T variant="small" style={{ textAlign: 'center' }}>
              The pickup window has ended. Pickup confirmation is now closed.
            </T>
          ) : (
            <Button title="Cancel reservation" variant="ghostDanger" disabled={busy} onPress={confirmCancel} />
          )}
        </View>
      )}

      {!open && <Button title="Find another deal" variant="outline" onPress={() => navigation.navigate('Tabs', { screen: 'Deals' })} />}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: colors.paper, paddingHorizontal: 20, gap: 22 },
  close: {
    alignSelf: 'flex-end',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
