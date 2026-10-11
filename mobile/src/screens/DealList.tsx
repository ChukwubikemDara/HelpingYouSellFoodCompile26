import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { useState } from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../api'
import { DealCard, HeroDealCard } from '../components/DealCard'
import { EmptyState, ErrorNote, Loading, T } from '../components/ui'
import { greeting } from '../format'
import { useLoad, useNow } from '../hooks'
import type { TabProps } from '../navigation'
import { useProfile } from '../profile'
import { categoryArt, colors, fonts, radius } from '../theme'
import type { Category } from '../types'

const CATEGORIES: Category[] = ['bakery', 'cafe', 'restaurant']

export function DealList({ navigation }: TabProps<'Deals'>) {
  const insets = useSafeAreaInsets()
  const { profile } = useProfile()
  const now = useNow()
  const [category, setCategory] = useState<Category | ''>('')
  const [refreshing, setRefreshing] = useState(false)
  const { data: deals, error, loading, reload } = useLoad(() => api.deals(category), category, 30_000)

  async function refresh() {
    setRefreshing(true)
    await reload()
    setRefreshing(false)
  }

  // the feed arrives soonest-ending first; lead with the first one you can still get
  const hero = deals?.find((d) => d.status === 'live')
  const rest = deals?.filter((d) => d.id !== hero?.id) ?? []
  const liveCount = deals?.filter((d) => d.status === 'live').length ?? 0
  const firstName = profile.name.split(' ')[0]
  const open = (id: string) => navigation.navigate('Deal', { id })

  return (
    <FlatList
      style={{ backgroundColor: colors.paper }}
      contentContainerStyle={[styles.list, { paddingTop: insets.top + 12 }]}
      data={rest}
      keyExtractor={(d) => d.id}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ember} />}
      ListHeaderComponent={
        <View style={{ gap: 18 }}>
          <View style={styles.topRow}>
            <View style={styles.location}>
              <Ionicons name="location" size={14} color={colors.ember} />
              <T variant="small" style={{ fontFamily: fonts.bold, color: colors.ink }}>
                State College, PA
              </T>
            </View>
            <T variant="small">
              {greeting(now)}
              {firstName ? `, ${firstName}` : ''}
            </T>
          </View>

          <View style={{ gap: 4 }}>
            <Text style={styles.headline}>
              Tonight’s <Text style={styles.headlineAccent}>last call</Text>
            </Text>
            {deals && (
              <T>
                {liveCount === 0
                  ? 'Nothing up for grabs right now.'
                  : `${liveCount} ${liveCount === 1 ? 'deal' : 'deals'} up for grabs before closing.`}
              </T>
            )}
          </View>

          {/* bleeds to the screen edges so a fourth chip scrolls instead of wrapping */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chips}
          >
            <Chip label="All" active={category === ''} onPress={() => setCategory('')} />
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={categoryArt[c].label}
                icon={categoryArt[c].icon}
                active={category === c}
                onPress={() => setCategory(c)}
              />
            ))}
          </ScrollView>

          {loading && <Loading />}
          <ErrorNote message={error?.message} />

          {hero && (
            <View style={{ gap: 10 }}>
              <T variant="eyebrow">ENDING SOONEST</T>
              <HeroDealCard deal={hero} now={now} onPress={() => open(hero.id)} />
            </View>
          )}
          {rest.length > 0 && <T variant="eyebrow">{hero ? 'MORE NEARBY' : 'SOLD OUT FOR NOW'}</T>}
        </View>
      }
      ListEmptyComponent={
        deals && !hero ? (
          <EmptyState
            icon="moon"
            title="All quiet for now"
            body="Stores usually post in the hour or two before closing. Pull down to check again."
          />
        ) : null
      }
      renderItem={({ item }) => <DealCard deal={item} now={now} onPress={() => open(item.id)} />}
    />
  )
}

function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string
  icon?: (typeof categoryArt)[Category]['icon']
  active: boolean
  onPress: () => void
}) {
  const fg = active ? colors.paper : colors.inkSoft
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      {icon && <MaterialCommunityIcons name={icon} size={15} color={fg} />}
      <Text style={[styles.chipText, { color: fg }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 18, paddingBottom: 28, gap: 12 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  location: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headline: { fontFamily: fonts.display, fontSize: 36, lineHeight: 40, color: colors.ink },
  headlineAccent: { fontFamily: fonts.displayItalic, color: colors.ember },
  chipScroll: { marginHorizontal: -18 },
  chips: { flexDirection: 'row', gap: 8, paddingHorizontal: 18 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 13 },
})
