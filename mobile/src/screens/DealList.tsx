import { useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { api } from '../api'
import { Card, colors, ErrorNote, Loading } from '../components/ui'
import { clock, money, percentOff } from '../format'
import { useLoad } from '../hooks'
import type { ScreenProps } from '../navigation'
import type { Category, Deal } from '../types'

const FILTERS: { value: Category | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'bakery', label: 'Bakery' },
  { value: 'cafe', label: 'Cafe' },
  { value: 'restaurant', label: 'Restaurant' },
]

function DealCard({ deal, onPress }: { deal: Deal; onPress: () => void }) {
  const soldOut = deal.status === 'sold_out'
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${deal.title}, ${deal.merchant.name}`}>
      <Card style={[styles.card, soldOut && { opacity: 0.55 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.merchant}>{deal.merchant.name.toUpperCase()}</Text>
          <Text style={styles.title} numberOfLines={1}>
            {deal.title}
          </Text>
          <Text style={styles.meta}>
            Pick up by {clock(deal.pickup_end)} · {soldOut ? 'Sold out' : `${deal.quantity_left} left`}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.price}>{money(deal.deal_price_cents)}</Text>
          <Text style={styles.was}>{money(deal.original_price_cents)}</Text>
          <Text style={styles.off}>{percentOff(deal.original_price_cents, deal.deal_price_cents)}% off</Text>
        </View>
      </Card>
    </Pressable>
  )
}

export function DealList({ navigation }: ScreenProps<'Deals'>) {
  const [category, setCategory] = useState<Category | ''>('')
  const [refreshing, setRefreshing] = useState(false)
  const { data: deals, error, loading, reload } = useLoad(() => api.deals(category), category, 30_000)

  async function refresh() {
    setRefreshing(true)
    await reload()
    setRefreshing(false)
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.list}
      data={deals ?? []}
      keyExtractor={(d) => d.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={styles.tagline}>Good food from State College spots, before it goes to waste.</Text>
          <View style={styles.filters}>
            {FILTERS.map((f) => {
              const active = category === f.value
              return (
                <Pressable
                  key={f.value}
                  onPress={() => setCategory(f.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={{ color: active ? '#fff' : '#44403c' }}>{f.label}</Text>
                </Pressable>
              )
            })}
          </View>
          {loading && <Loading />}
          <ErrorNote message={error?.message} />
        </View>
      }
      ListEmptyComponent={
        deals ? <Text style={styles.empty}>Nothing live right now. Check back closer to closing time.</Text> : null
      }
      renderItem={({ item }) => <DealCard deal={item} onPress={() => navigation.navigate('Deal', { id: item.id })} />}
    />
  )
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  tagline: { color: colors.muted, fontSize: 15 },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#d6d3d1',
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  card: { flexDirection: 'row', gap: 12 },
  merchant: { fontSize: 11, letterSpacing: 0.5, color: colors.muted },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  meta: { fontSize: 14, color: colors.muted, marginTop: 2 },
  price: { fontSize: 18, fontWeight: '700', color: colors.primaryDark },
  was: { fontSize: 14, color: '#a8a29e', textDecorationLine: 'line-through' },
  off: { fontSize: 12, fontWeight: '600', color: colors.primaryDark },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40 },
})
