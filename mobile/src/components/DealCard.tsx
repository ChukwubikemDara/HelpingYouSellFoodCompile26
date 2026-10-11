import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { clock, money, percentOff, timeLeft } from '../format'
import { colors, fonts, radius, shadow } from '../theme'
import type { Deal } from '../types'
import { DealArt } from './DealArt'
import { Pill, T } from './ui'

interface Props {
  deal: Deal
  now: number
  onPress: () => void
}

function stockLabel(deal: Deal) {
  if (deal.status === 'sold_out') return 'Sold out'
  return deal.quantity_left <= 2 ? `Only ${deal.quantity_left} left` : `${deal.quantity_left} left`
}

function a11yLabel(deal: Deal) {
  return `${deal.title} at ${deal.merchant.name}, ${money(deal.deal_price_cents)}, ${stockLabel(deal)}`
}

function Price({ deal, large }: { deal: Deal; large?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
      <Text style={[styles.price, large && { fontSize: 26 }]}>{money(deal.deal_price_cents)}</Text>
      <Text style={styles.was}>{money(deal.original_price_cents)}</Text>
    </View>
  )
}

// The big card at the top of the feed: the deal that ends soonest.
export function HeroDealCard({ deal, now, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel(deal)}
      style={({ pressed }) => [styles.hero, pressed && styles.pressed]}
    >
      <DealArt deal={deal} size={72} style={styles.heroArt} />
      <View style={styles.heroBadges}>
        <Pill tone="ink" icon="time" label={timeLeft(now, deal.pickup_end)} />
        <Pill tone="marigold" label={`${percentOff(deal.original_price_cents, deal.deal_price_cents)}% off`} />
      </View>
      <View style={styles.heroBody}>
        <T variant="eyebrow">{deal.merchant.name.toUpperCase()}</T>
        <T variant="title" numberOfLines={1}>
          {deal.title}
        </T>
        <View style={styles.heroFooter}>
          <Price deal={deal} large />
          <Pill tone={deal.quantity_left <= 2 ? 'ember' : 'neutral'} label={stockLabel(deal)} />
        </View>
      </View>
    </Pressable>
  )
}

export function DealCard({ deal, now, onPress }: Props) {
  const soldOut = deal.status === 'sold_out'
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel(deal)}
      style={({ pressed }) => [styles.row, soldOut && { opacity: 0.55 }, pressed && styles.pressed]}
    >
      <View>
        <DealArt deal={deal} size={34} style={styles.rowArt} />
        {!soldOut && (
          <View style={styles.rowTag}>
            <Text style={styles.rowTagText}>-{percentOff(deal.original_price_cents, deal.deal_price_cents)}%</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="eyebrow" numberOfLines={1}>
          {deal.merchant.name.toUpperCase()}
        </T>
        <T variant="heading" numberOfLines={1} style={{ fontSize: 17 }}>
          {deal.title}
        </T>
        <View style={styles.rowMeta}>
          <Ionicons name="time-outline" size={13} color={colors.muted} />
          <T variant="small">
            {soldOut ? `Until ${clock(deal.pickup_end)}` : `${timeLeft(now, deal.pickup_end)} · by ${clock(deal.pickup_end)}`}
          </T>
        </View>
        <View style={styles.rowFooter}>
          <Price deal={deal} />
          <T variant="small" style={!soldOut && deal.quantity_left <= 2 ? styles.scarce : undefined}>
            {stockLabel(deal)}
          </T>
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.95 },
  hero: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', ...shadow },
  heroArt: { height: 168 },
  heroBadges: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroBody: { padding: 18, gap: 4 },
  heroFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  row: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowArt: { width: 92, height: 92, borderRadius: radius.md },
  rowTag: {
    position: 'absolute',
    top: -6,
    left: -6,
    backgroundColor: colors.marigold,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    transform: [{ rotate: '-6deg' }],
  },
  rowTagText: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowFooter: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 },
  price: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  was: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, textDecorationLine: 'line-through' },
  scarce: { color: colors.ember, fontFamily: fonts.bold },
})
