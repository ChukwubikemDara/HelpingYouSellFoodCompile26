import { Ionicons } from '@expo/vector-icons'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../api'
import { Button, EmptyState, ErrorNote, Loading, Pill, T } from '../components/ui'
import { clock, money } from '../format'
import { useLoad } from '../hooks'
import type { TabProps } from '../navigation'
import { useProfile } from '../profile'
import { colors, fonts, radius } from '../theme'
import type { Reservation } from '../types'

const STATUS: Record<Reservation['status'], { label: string; tone: 'ember' | 'forest' | 'neutral' }> = {
  reserved: { label: 'Ready to pick up', tone: 'ember' },
  picked_up: { label: 'Picked up', tone: 'forest' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  no_show: { label: 'Missed', tone: 'neutral' },
}

function Row({ reservation: r, onPress }: { reservation: Reservation; onPress: () => void }) {
  const open = r.status === 'reserved'
  const status = STATUS[r.status]
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${r.quantity} ${r.deal.title} at ${r.deal.merchant.name}, ${status.label}`}
      style={({ pressed }) => [styles.row, !open && { opacity: 0.7 }, pressed && { opacity: 0.85 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <T variant="eyebrow" numberOfLines={1}>
          {r.deal.merchant.name.toUpperCase()}
        </T>
        <T variant="heading" numberOfLines={1} style={{ fontSize: 17 }}>
          {r.quantity} × {r.deal.title}
        </T>
        <T variant="small">
          {open ? `Pick up by ${clock(r.deal.pickup_end)}` : new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ·{' '}
          {money(r.total_cents)}
        </T>
        <Pill label={status.label} tone={status.tone} />
      </View>
      {open ? (
        <View style={styles.code}>
          <Text style={styles.codeLabel}>CODE</Text>
          <Text style={styles.codeText}>{r.pickup_code}</Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      )}
    </Pressable>
  )
}

function List({ phone, onOpen, top }: { phone: string; onOpen: (id: string) => void; top: number }) {
  const { data, error, loading } = useLoad(() => api.myReservations(phone), phone, 10_000)
  if (loading) return <Loading />

  // what you still need to collect first, then history newest first
  const sorted = [...(data ?? [])].sort(
    (a, b) =>
      Number(b.status === 'reserved') - Number(a.status === 'reserved') ||
      Date.parse(b.created_at) - Date.parse(a.created_at),
  )

  return (
    <FlatList
      style={{ backgroundColor: colors.paper }}
      contentContainerStyle={[styles.list, { paddingTop: top }]}
      data={sorted}
      keyExtractor={(r) => r.id}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <T variant="display">My pickups</T>
          <ErrorNote message={error?.message} />
        </View>
      }
      ListEmptyComponent={error ? null : <NothingYet />}
      renderItem={({ item }) => <Row reservation={item} onPress={() => onOpen(item.id)} />}
    />
  )
}

function NothingYet({ onBrowse }: { onBrowse?: () => void }) {
  return (
    <EmptyState
      icon="ticket"
      title="No pickups yet"
      body="Reserve a deal and your ticket shows up here with its pickup code."
    >
      {onBrowse && <Button title="Browse tonight’s deals" onPress={onBrowse} style={{ marginTop: 10 }} />}
    </EmptyState>
  )
}

// Reservations belong to the phone that made them: we only ever look up the
// number saved on this device, never one typed in.
export function Pickups({ navigation }: TabProps<'Pickups'>) {
  const insets = useSafeAreaInsets()
  const { profile } = useProfile()
  const top = insets.top + 12

  if (!profile.phone) {
    return (
      <View style={[styles.empty, { paddingTop: top }]}>
        <T variant="display">My pickups</T>
        <NothingYet onBrowse={() => navigation.navigate('Deals')} />
      </View>
    )
  }
  return <List phone={profile.phone} top={top} onOpen={(id) => navigation.navigate('Reservation', { id })} />
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 18, paddingBottom: 28, gap: 12 },
  empty: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  code: { backgroundColor: colors.ink, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center' },
  codeLabel: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.5, color: colors.paper, opacity: 0.7 },
  codeText: { fontFamily: fonts.mono, fontSize: 22, letterSpacing: 2, color: colors.paper },
})
