import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { Card, colors, ErrorNote, Loading, StatusBadge } from '../components/ui'
import { clock, money } from '../format'
import { useLoad } from '../hooks'
import type { ScreenProps } from '../navigation'
import { loadCustomer } from '../storage'

function List({ phone, onOpen }: { phone: string; onOpen: (id: string) => void }) {
  const { data, error, loading } = useLoad(() => api.myReservations(phone), phone, 10_000)

  if (loading) return <Loading />
  const newestFirst = [...(data ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.list}
      data={newestFirst}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={<ErrorNote message={error?.message} />}
      ListEmptyComponent={error ? null : <Empty />}
      renderItem={({ item: r }) => (
        <Pressable onPress={() => onOpen(r.id)} accessibilityRole="button">
          <Card style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {r.quantity} × {r.deal.title}
              </Text>
              <Text style={styles.meta}>
                {r.deal.merchant.name} · by {clock(r.deal.pickup_end)} · {money(r.total_cents)}
              </Text>
            </View>
            <StatusBadge status={r.status} />
          </Card>
        </Pressable>
      )}
    />
  )
}

function Empty() {
  return <Text style={styles.empty}>No reservations on this phone yet.</Text>
}

// Reservations belong to the phone that made them: we only ever look up the
// number saved when reserving here, never one typed in.
export function MyReservations({ navigation }: ScreenProps<'MyReservations'>) {
  const [phone, setPhone] = useState<string | undefined>()

  // re-read on focus so a reservation made a moment ago shows up
  useFocusEffect(
    useCallback(() => {
      void loadCustomer().then((c) => setPhone(c.phone))
    }, []),
  )

  if (phone === undefined) return <Loading />
  if (!phone) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Empty />
      </View>
    )
  }
  return <List phone={phone} onOpen={(id) => navigation.navigate('Reservation', { id })} />
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 14, color: colors.muted, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40 },
})
