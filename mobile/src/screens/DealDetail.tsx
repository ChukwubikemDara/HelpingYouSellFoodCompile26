import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, ApiError } from '../api'
import { DealArt } from '../components/DealArt'
import { Button, ErrorNote, Loading, Pill, T, type IoniconName } from '../components/ui'
import { money, percentOff, pickupWindow, timeLeft } from '../format'
import { useLoad, useNow } from '../hooks'
import type { StackProps } from '../navigation'
import { useProfile } from '../profile'
import { prettyPhone } from '../storage'
import { colors, fonts, radius, shadow } from '../theme'
import type { Deal } from '../types'

function InfoRow({ icon, label, children }: { icon: IoniconName; label: string; children: ReactNode }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={18} color={colors.ink} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="eyebrow">{label}</T>
        {children}
      </View>
    </View>
  )
}

export function DealDetail({ route, navigation }: StackProps<'Deal'>) {
  const { id } = route.params
  const insets = useSafeAreaInsets()
  const now = useNow()
  const { profile, signedIn } = useProfile()
  const { data: deal, error, loading, reload } = useLoad(() => api.deal(id), id)

  const name = profile.name
  const phone = profile.phone ? prettyPhone(profile.phone) : ''
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  if (loading) return <Loading />
  if (!deal) {
    return (
      <View style={[styles.missing, { paddingTop: insets.top + 60 }]}>
        <ErrorNote message={error?.message ?? 'Deal not found'} />
        <Button title="Back to deals" variant="outline" onPress={() => navigation.goBack()} />
      </View>
    )
  }

  const live = deal.status === 'live'
  const max = Math.min(deal.quantity_left ?? 0, deal.max_per_customer)
  const saving = ((deal.original_price_cents ?? 0) - (deal.deal_price_cents ?? 0)) * quantity

  async function reserve(d: Deal) {
    if (!signedIn) { navigation.navigate('Tabs', { screen: 'Profile' }); return }
    setFormError('')
    setBusy(true) // stays disabled on success: we leave this screen
    try {
      const r = await api.reserve({
        deal_id: d.id,
        quantity,
      })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      navigation.replace('Reservation', { id: r.id })
    } catch (err) {
      setBusy(false)
      setFormError((err as Error).message)
      if (err instanceof ApiError && (err.code === 'SOLD_OUT' || err.code === 'DEAL_NOT_LIVE')) void reload()
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View>
          <DealArt deal={deal} size={110} style={{ height: 250 + insets.top }} />
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            style={[styles.back, { top: insets.top + 10 }]}
          >
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
        </View>

        {/* the sheet overlaps the artwork so the page reads as one piece */}
        <View style={styles.sheet}>
          <View style={styles.badges}>
            <Pill tone="marigold" label={`${percentOff(deal.original_price_cents, deal.deal_price_cents)}% off`} />
            {live && <Pill tone="ink" icon="time" label={timeLeft(now, deal.pickup_end)} />}
            {live && (deal.quantity_left ?? 0) <= 2 && <Pill tone="ember" label={`Only ${deal.quantity_left} left`} />}
            {deal.status === 'sold_out' && <Pill label="Sold out" />}
          </View>

          <View style={{ gap: 4 }}>
            <T variant="eyebrow">{deal.merchant.name.toUpperCase()}</T>
            <T variant="display">{deal.title}</T>
            <View style={styles.priceRow}>
              <Text style={styles.price}>{money(deal.deal_price_cents)}</Text>
              <Text style={styles.was}>{money(deal.original_price_cents)}</Text>
            </View>
          </View>

          {deal.note ? (
            <View style={styles.note}>
              <Text style={styles.noteText}>“{deal.note}”</Text>
              <T variant="small">from the store</T>
            </View>
          ) : null}

          <View style={styles.card}>
            <InfoRow icon="bag-handle" label="WHAT YOU GET">
              {deal.items.map((item) => (
                <T key={item.name} style={styles.infoText}>
                  {item.qty} × {item.name}
                </T>
              ))}
            </InfoRow>
            <View style={styles.divider} />
            <InfoRow icon="time" label="PICKUP WINDOW">
              <T style={styles.infoText}>{pickupWindow(deal.pickup_start, deal.pickup_end)}</T>
            </InfoRow>
            <View style={styles.divider} />
            <InfoRow icon="location" label="WHERE">
              <T style={styles.infoText}>{deal.merchant.address}</T>
            </InfoRow>
            <View style={styles.divider} />
            <InfoRow icon="alert-circle" label="ALLERGENS">
              {deal.allergens === null ? (
                <T style={styles.infoText}>Not provided. Ask the store.</T>
              ) : deal.allergens.length === 0 ? (
                <T style={styles.infoText}>None listed by the store</T>
              ) : (
                <View style={styles.allergens}>
                  {deal.allergens.map((a) => (
                    <Pill key={a} label={a} />
                  ))}
                </View>
              )}
            </InfoRow>
          </View>

          {live && (
            <View style={{ gap: 12 }}>
              <T variant="eyebrow">PICKING UP AS</T>
              <View style={styles.identity}><T variant="heading">{signedIn ? name : 'Sign in from Profile to reserve'}</T><T variant="small">{signedIn ? phone : 'Browse deals without an account.'}</T></View>
              <ErrorNote message={formError} />
            </View>
          )}

          {!live && (
            <View style={styles.card}>
              <T style={{ textAlign: 'center' }}>
                {deal.status === 'sold_out'
                  ? 'Sold out for now. If someone cancels, it comes back.'
                  : 'This deal has ended.'}
              </T>
            </View>
          )}
        </View>
      </ScrollView>

      {live && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => setQuantity(quantity - 1)}
              disabled={quantity <= 1}
              accessibilityRole="button"
              accessibilityLabel="One fewer"
              hitSlop={8}
              style={[styles.stepButton, quantity <= 1 && { opacity: 0.35 }]}
            >
              <Ionicons name="remove" size={20} color={colors.ink} />
            </Pressable>
            <Text style={styles.quantity} accessibilityLabel={`Quantity ${quantity}`}>
              {quantity}
            </Text>
            <Pressable
              onPress={() => setQuantity(quantity + 1)}
              disabled={quantity >= max}
              accessibilityRole="button"
              accessibilityLabel="One more"
              hitSlop={8}
              style={[styles.stepButton, quantity >= max && { opacity: 0.35 }]}
            >
              <Ionicons name="add" size={20} color={colors.ink} />
            </Pressable>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Button
              title={`Reserve · ${money(quantity * (deal.deal_price_cents ?? 0))}`}
              busy={busy}
              onPress={() => reserve(deal)}
            />
            <T variant="small" style={{ textAlign: 'center' }}>
              You save {money(saving)} · pay at the store
            </T>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  missing: { flex: 1, backgroundColor: colors.paper, padding: 20, gap: 16 },
  back: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  sheet: {
    marginTop: -28,
    backgroundColor: colors.paper,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 20,
  },
  badges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 6 },
  price: { fontFamily: fonts.display, fontSize: 34, color: colors.ember },
  was: { fontFamily: fonts.body, fontSize: 18, color: colors.muted, textDecorationLine: 'line-through' },
  note: { borderLeftWidth: 3, borderLeftColor: colors.marigold, paddingLeft: 14, gap: 2 },
  noteText: { fontFamily: fonts.displayItalic, fontSize: 18, lineHeight: 24, color: colors.ink },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  infoRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.marigoldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: { fontFamily: fonts.medium, color: colors.ink },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 14, marginLeft: 48 },
  allergens: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display, fontSize: 18, color: colors.paper },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: 12,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  stepper: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  stepButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  quantity: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, minWidth: 18, textAlign: 'center' },
})
