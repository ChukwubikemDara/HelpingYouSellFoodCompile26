import { StyleSheet, Text, View } from 'react-native'
import { money, pickupWindow } from '../format'
import { colors, fonts, radius, shadow } from '../theme'
import type { Reservation } from '../types'
import { T } from './ui'

const NOTCH = 22

const STUB: Record<Reservation['status'], { label: string; bg: string; fg: string }> = {
  reserved: { label: 'SHOW AT THE COUNTER', bg: colors.ink, fg: colors.paper },
  picked_up: { label: 'PICKED UP', bg: colors.forest, fg: '#fff' },
  cancelled: { label: 'CANCELLED', bg: '#D9CFC0', fg: colors.inkSoft },
  no_show: { label: 'NOT COLLECTED', bg: '#D9CFC0', fg: colors.inkSoft },
}

// The reservation drawn as a tear-off ticket: details on top, pickup code on the stub.
export function Ticket({ reservation: r }: { reservation: Reservation }) {
  const stub = STUB[r.status]
  const live = r.status === 'reserved'
  return (
    <View style={styles.ticket}>
      <View style={styles.top}>
        <T variant="eyebrow">{r.deal.merchant.name.toUpperCase()}</T>
        <T variant="title">
          {r.quantity} × {r.deal.title}
        </T>
        <View style={styles.facts}>
          <View style={{ flex: 1 }}>
            <T variant="eyebrow">PICKUP</T>
            <T variant="heading">{pickupWindow(r.deal.pickup_start, r.deal.pickup_end)}</T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T variant="eyebrow">PAY IN STORE</T>
            <T variant="heading">{money(r.total_cents)}</T>
          </View>
        </View>
        <T variant="small">{r.deal.merchant.address}</T>
      </View>

      <View style={[styles.stub, { backgroundColor: stub.bg }]}>
        <Text style={[styles.stubLabel, { color: stub.fg }]}>{stub.label}</Text>
        <Text
          style={[styles.code, { color: stub.fg }, !live && styles.codeUsed]}
          accessibilityLabel={`Pickup code ${r.pickup_code.split('').join(' ')}`}
        >
          {r.pickup_code}
        </Text>
        <Text style={[styles.stubName, { color: stub.fg }]}>for {r.customer_name}</Text>
        {/* punched notches and the tear line, hung on the stub's top edge so the
            top half can grow with a long title */}
        <View style={styles.seam} pointerEvents="none">
          <View style={[styles.notch, { marginLeft: -NOTCH / 2 }]} />
          <View style={styles.dashes} />
          <View style={[styles.notch, { marginRight: -NOTCH / 2 }]} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  ticket: { borderRadius: radius.lg, ...shadow },
  top: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 22,
    paddingBottom: 28,
    gap: 6,
  },
  facts: { flexDirection: 'row', marginTop: 10, marginBottom: 4 },
  stub: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 4,
  },
  stubLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 2, opacity: 0.75 },
  code: { fontFamily: fonts.mono, fontSize: 60, lineHeight: 70, letterSpacing: 10, paddingLeft: 10 },
  codeUsed: { textDecorationLine: 'line-through', opacity: 0.6 },
  stubName: { fontFamily: fonts.medium, fontSize: 14, opacity: 0.8 },
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
  dashes: {
    flex: 1,
    marginHorizontal: 8,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.paper,
  },
})
