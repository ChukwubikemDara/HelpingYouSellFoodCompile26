import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { DealArt } from '@/components/DealArt';
import { font, PressableScale, T } from '@/components/ui';
import type { Deal } from '@/lib/api';
import { formatCents, formatDistance, formatUntil, percentOff, timeLeft } from '@/lib/format';
import { colors, radius } from '@/lib/theme';

export function isSoldOut(deal: Deal): boolean {
  return deal.status === 'sold_out' || deal.quantity_left <= 0;
}

function stockLabel(deal: Deal): string {
  if (isSoldOut(deal)) return 'Sold out';
  return deal.quantity_left <= 2 ? `Only ${deal.quantity_left} left` : `${deal.quantity_left} left`;
}

function scarce(deal: Deal): boolean {
  return !isSoldOut(deal) && deal.quantity_left <= 2;
}

function a11yLabel(deal: Deal): string {
  return [deal.title, `at ${deal.merchant.name}`, formatCents(deal.deal_price_cents), stockLabel(deal), formatDistance(deal.distance_m)]
    .filter(Boolean)
    .join(', ');
}

/** "0.3 mi · 42 min left". Falls back to "until 6:00 PM" when no countdown applies. */
export function metaLine(deal: Deal, now: number): string {
  const distance = formatDistance(deal.distance_m);
  const left = isSoldOut(deal) ? '' : timeLeft(now, deal.pickup_end);
  return [distance, left || formatUntil(deal.pickup_end)].filter(Boolean).join(' · ');
}

/** The deal price with the original struck through. Either price can be missing. */
export function PriceLine({ deal, size = 20, color = colors.ink }: { deal: Deal; size?: number; color?: string }) {
  const wasSize = Math.max(13, Math.round(size * 0.62));
  return (
    <View style={styles.priceRow}>
      <Text
        maxFontSizeMultiplier={1.2}
        style={[
          font('bold'),
          { fontSize: size, lineHeight: Math.round(size * 1.3), letterSpacing: size >= 24 ? -0.5 : -0.2, color },
        ]}>
        {formatCents(deal.deal_price_cents)}
      </Text>
      {deal.original_price_cents !== null ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={[font('body'), styles.was, { fontSize: wasSize, lineHeight: Math.round(wasSize * 1.4) }]}>
          {formatCents(deal.original_price_cents)}
        </Text>
      ) : null}
    </View>
  );
}

type Props = {
  deal: Deal;
  now: number;
  onPress: () => void;
  /** Hide the store name when the surrounding screen already shows it. */
  showStore?: boolean;
  /** A slightly smaller card for the map's carousel. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** One deal as a calm white card: picture, store, title, how close and how long, price. */
export function DealCard({ deal, now, onPress, showStore = true, compact = false, style }: Props) {
  const soldOut = isSoldOut(deal);
  const pct = soldOut ? null : percentOff(deal.original_price_cents, deal.deal_price_cents);
  const meta = metaLine(deal, now);
  const art = compact ? 76 : 88;
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel(deal)}
      style={[styles.card, soldOut && styles.soldOut, style]}>
      <View>
        <DealArt deal={deal} size={compact ? 28 : 32} style={{ width: art, height: art, borderRadius: radius.md }} />
        {pct ? (
          <View style={styles.badge}>
            <Text maxFontSizeMultiplier={1.15} style={[font('bold'), styles.badgeText]}>
              -{pct}%
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        {showStore ? (
          <T variant="eyebrow" numberOfLines={1}>
            {deal.merchant.name}
          </T>
        ) : null}
        <T variant="heading" numberOfLines={compact ? 1 : 2} style={styles.title}>
          {deal.title}
        </T>
        {meta ? (
          <T variant="small" numberOfLines={1}>
            {meta}
          </T>
        ) : null}
        <View style={styles.footer}>
          <PriceLine deal={deal} size={compact ? 18 : 19} />
          <T variant="small" numberOfLines={1} style={scarce(deal) ? [font('bold'), styles.scarce] : undefined}>
            {stockLabel(deal)}
          </T>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
  },
  soldOut: { opacity: 0.6 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 17, lineHeight: 23 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 },
  badge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, lineHeight: 15, color: colors.emberDeep },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 },
  was: { color: colors.muted, textDecorationLine: 'line-through' },
  scarce: { color: colors.emberDeep },
});
