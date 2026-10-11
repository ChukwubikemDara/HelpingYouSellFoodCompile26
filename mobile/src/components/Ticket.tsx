import { StyleSheet, Text, View } from 'react-native';

import { font, T } from '@/components/ui';
import type { Reservation, ReservationStatus } from '@/lib/api';
import { formatCents, formatWindow } from '@/lib/format';
import { colors, radius } from '@/lib/theme';

const NOTCH = 20;
const DASHES = 26;

const STUB: Record<ReservationStatus, { label: string; bg: string; fg: string }> = {
  reserved: { label: 'Show at the counter', bg: colors.ink, fg: colors.paper },
  picked_up: { label: 'Picked up', bg: colors.forest, fg: colors.white },
  cancelled: { label: 'Cancelled', bg: colors.stub, fg: colors.inkSoft },
  no_show: { label: 'Not picked up', bg: colors.stub, fg: colors.inkSoft },
};

/** The payment label comes from the API's payment_method; nothing is assumed beyond in_store. */
function payLabel(method: string): string {
  return method === 'in_store' ? 'Pay in store' : 'Total';
}

/** The reservation drawn as a tear-off ticket: details on top, pickup code on the stub. */
export function Ticket({ reservation: r }: { reservation: Reservation }) {
  const stub = STUB[r.status] ?? STUB.cancelled;
  const live = r.status === 'reserved';
  return (
    <View style={styles.ticket}>
      <View style={styles.top}>
        <T variant="eyebrow" numberOfLines={1}>
          {r.deal.merchant.name}
        </T>
        <T variant="title">
          {r.quantity} × {r.deal.title}
        </T>
        <View style={styles.facts}>
          <View style={styles.fact}>
            <T variant="eyebrow">Pickup</T>
            <T variant="heading">{formatWindow(r.deal.pickup_start, r.deal.pickup_end)}</T>
          </View>
          <View style={[styles.fact, styles.factEnd]}>
            <T variant="eyebrow">{payLabel(r.payment_method)}</T>
            <T variant="heading">{formatCents(r.total_cents)}</T>
          </View>
        </View>
        {r.quantity > 1 ? (
          <T variant="small">
            {r.quantity} × {formatCents(r.unit_price_cents)}
          </T>
        ) : null}
        {r.deal.merchant.address ? <T variant="small">{r.deal.merchant.address}</T> : null}
      </View>

      <View style={[styles.stub, { backgroundColor: stub.bg }]}>
        <Text maxFontSizeMultiplier={1.2} style={[font('semibold'), styles.stubLabel, { color: stub.fg }]}>
          {stub.label}
        </Text>
        <Text
          maxFontSizeMultiplier={1.2}
          style={[font('mono'), styles.code, { color: stub.fg }, !live && styles.codeUsed]}
          accessibilityLabel={`Pickup code ${r.pickup_code.split('').join(' ')}`}
          selectable>
          {r.pickup_code}
        </Text>
        <Text maxFontSizeMultiplier={1.2} style={[font('medium'), styles.stubName, { color: stub.fg }]} numberOfLines={1}>
          for {r.customer_name}
        </Text>
        {/* punched notches and the tear line, hung on the stub's top edge so the
            top half can grow with a long title */}
        <View style={styles.seam} pointerEvents="none">
          <View style={[styles.notch, { marginLeft: -NOTCH / 2 }]} />
          <View style={styles.dashes}>
            {Array.from({ length: DASHES }, (_, i) => (
              <View key={i} style={styles.dash} />
            ))}
          </View>
          <View style={[styles.notch, { marginRight: -NOTCH / 2 }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ticket: { borderRadius: radius.lg },
  top: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.line,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 20,
    gap: 6,
  },
  facts: { flexDirection: 'row', marginTop: 8, marginBottom: 2, gap: 12 },
  fact: { flex: 1, gap: 2, minWidth: 0 },
  factEnd: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', alignItems: 'flex-end' },
  stub: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    paddingTop: 20,
    paddingBottom: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 4,
  },
  stubLabel: { fontSize: 13, lineHeight: 18, opacity: 0.8 },
  // The trailing letter space of the last digit is balanced with paddingLeft so the code sits centered.
  code: { fontSize: 56, lineHeight: 70, letterSpacing: 10, paddingLeft: 10 },
  codeUsed: { textDecorationLine: 'line-through', opacity: 0.6 },
  stubName: { fontSize: 14, lineHeight: 20, opacity: 0.8 },
  seam: {
    position: 'absolute',
    top: -NOTCH / 2,
    left: 0,
    right: 0,
    height: NOTCH,
    flexDirection: 'row',
    alignItems: 'center',
  },
  notch: { width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: colors.paper },
  dashes: { flex: 1, flexDirection: 'row', marginHorizontal: 8 },
  dash: { flex: 1, height: 2, marginHorizontal: 2.5, borderRadius: 1, backgroundColor: colors.paper },
});
