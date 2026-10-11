import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { Button, Card, colors, ErrorNote, Loading, StatusBadge } from '../components/ui'
import { clock, money, pickupWindow } from '../format'
import { useLoad, useNow } from '../hooks'
import type { ScreenProps } from '../navigation'
import type { Reservation } from '../types'

const HEADLINES: Record<Reservation['status'], string> = {
  reserved: "You're set!",
  picked_up: 'Picked up. Enjoy!',
  cancelled: 'Reservation cancelled',
  no_show: 'Pickup window missed',
}

export function ReservationScreen({ route, navigation }: ScreenProps<'Reservation'>) {
  const { id } = route.params
  // poll so the screen flips to "picked up" when the store enters the code
  const { data: r, error, loading, setData } = useLoad(() => api.reservation(id), id, 10_000)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const now = useNow()

  async function act(fn: (id: string) => Promise<Reservation>) {
    setBusy(true)
    setActionError('')
    try {
      setData(await fn(id))
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

  if (loading) return <Loading />
  if (!r) {
    return (
      <View style={styles.page}>
        <ErrorNote message={error?.message ?? 'Reservation not found'} />
      </View>
    )
  }

  const open = r.status === 'reserved'
  const beforeWindow = now < Date.parse(r.deal.pickup_start)
  const windowOver = now > Date.parse(r.deal.pickup_end)
  const storeCancelled = r.status === 'cancelled' && r.deal.status === 'cancelled'

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>{storeCancelled ? 'The store cancelled this deal' : HEADLINES[r.status]}</Text>
        <StatusBadge status={r.status} />
      </View>

      {open && (
        <Card style={{ alignItems: 'center' }}>
          <Text style={styles.muted}>Show this code at the counter</Text>
          <Text style={styles.code} accessibilityLabel={`Pickup code ${r.pickup_code.split('').join(' ')}`}>
            {r.pickup_code}
          </Text>
          <Text style={styles.muted}>
            {r.customer_name} · {r.quantity} × {r.deal.title}
          </Text>
        </Card>
      )}

      <Card style={{ gap: 4 }}>
        <Text style={styles.heading}>{r.deal.merchant.name}</Text>
        <Text style={styles.body}>{r.deal.merchant.address}</Text>
        <Text style={styles.body}>Pickup {pickupWindow(r.deal.pickup_start, r.deal.pickup_end)}</Text>
        <Text style={styles.body}>
          {r.quantity} × {r.deal.title}
        </Text>
        <Text style={styles.heading}>
          {money(r.total_cents)} · {r.payment_method === 'in_store' ? 'pay at the store' : r.payment_method}
        </Text>
      </Card>

      {r.status === 'no_show' && (
        <Text style={styles.muted}>Two missed pickups block this phone from reserving again.</Text>
      )}

      <ErrorNote message={actionError} />

      {open && (
        <View style={{ gap: 8 }}>
          <Button
            title="I picked it up"
            disabled={busy || beforeWindow || windowOver}
            onPress={() => act(api.confirmPickup)}
          />
          {beforeWindow && (
            <Text style={[styles.muted, { textAlign: 'center' }]}>
              You can confirm once pickup opens at {clock(r.deal.pickup_start)}.
            </Text>
          )}
          {windowOver ? (
            <Text style={[styles.muted, { textAlign: 'center' }]}>
              The pickup window has ended. If you collected it, the store can still enter your code.
            </Text>
          ) : (
            <Button title="Cancel reservation" variant="danger" disabled={busy} onPress={confirmCancel} />
          )}
        </View>
      )}

      <Button title="Browse more deals" variant="secondary" onPress={() => navigation.popToTop()} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, backgroundColor: colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, flexShrink: 1 },
  code: { fontSize: 52, fontWeight: '700', letterSpacing: 12, marginVertical: 8, color: colors.text },
  heading: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, color: '#44403c' },
  muted: { fontSize: 14, color: colors.muted },
})
