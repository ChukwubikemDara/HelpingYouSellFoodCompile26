import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../api'
import { Button, ErrorNote, Field, T, type IoniconName } from '../components/ui'
import { money } from '../format'
import { useLoad } from '../hooks'
import { useProfile } from '../profile'
import { normalizePhone, prettyPhone } from '../storage'
import { colors, fonts, radius } from '../theme'
import type { Reservation } from '../types'

const HOW_IT_WORKS: { icon: IoniconName; text: string }[] = [
  { icon: 'pricetag', text: 'Stores list what’s left before closing, at a discount.' },
  { icon: 'ticket', text: 'You reserve and get a 4-digit pickup code.' },
  { icon: 'walk', text: 'Show the code, pay the store, take it home.' },
]

// What this phone has rescued so far: only reservations that were actually collected.
function impact(reservations: Reservation[] | undefined) {
  const picked = (reservations ?? []).filter((r) => r.status === 'picked_up')
  return {
    pickups: picked.length,
    items: picked.reduce((n, r) => n + r.quantity, 0),
    savedCents: picked.reduce(
      (n, r) => n + ((r.deal.original_price_cents ?? 0) - (r.deal.deal_price_cents ?? 0)) * r.quantity,
      0,
    ),
  }
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <T variant="small" style={{ color: '#CFC4B5' }}>
        {label}
      </T>
    </View>
  )
}

export function Profile() {
  const insets = useSafeAreaInsets()
  const { profile, update, reset } = useProfile()
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone ? prettyPhone(profile.phone) : '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // skip the lookup until there is a number to look up
  const history = useLoad(
    () => (profile.phone ? api.myReservations(profile.phone) : Promise.resolve([])),
    profile.phone,
    30_000,
  )
  const stats = impact(history.data)

  const dirty = name.trim() !== profile.name || (normalizePhone(phone) ?? phone) !== profile.phone
  const initial = profile.name.trim().charAt(0).toUpperCase()

  function save() {
    const normalized = normalizePhone(phone)
    if (!name.trim()) return setError('Add the name stores should call out.')
    if (!normalized) return setError('Enter a 10 digit US phone number.')
    setError('')
    update({ name: name.trim(), phone: normalized })
    setPhone(prettyPhone(normalized))
    setSaved(true)
  }

  function confirmClear() {
    Alert.alert(
      'Remove your details?',
      'Your name and number are deleted from this phone. Open reservations stay with the store, but you won’t see them here.',
      [
        { text: 'Keep them', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            reset()
            setName('')
            setPhone('')
            setSaved(false)
          },
        },
      ],
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        style={{ backgroundColor: colors.paper }}
        contentContainerStyle={[styles.page, { paddingTop: insets.top + 12 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.avatar}>
            {initial ? (
              <Text style={styles.avatarText}>{initial}</Text>
            ) : (
              <Ionicons name="person" size={26} color={colors.paper} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <T variant="title">{profile.name || 'Hey there'}</T>
            <T variant="small">
              {profile.phone ? prettyPhone(profile.phone) : 'Add your details once, reserve in one tap.'}
            </T>
          </View>
        </View>

        <View style={styles.impact}>
          <T variant="eyebrow" style={{ color: colors.marigold }}>
            YOUR LAST CALLS
          </T>
          <View style={styles.stats}>
            <Stat value={String(stats.items)} label={stats.items === 1 ? 'item rescued' : 'items rescued'} />
            <View style={styles.statDivider} />
            <Stat value={money(stats.savedCents)} label="saved" />
            <View style={styles.statDivider} />
            <Stat value={String(stats.pickups)} label={stats.pickups === 1 ? 'pickup' : 'pickups'} />
          </View>
        </View>

        <View style={styles.section}>
          <T variant="eyebrow">YOUR DETAILS</T>
          <Field
            label="Name"
            value={name}
            onChangeText={(v) => {
              setName(v)
              setSaved(false)
            }}
            autoComplete="given-name"
            placeholder="Sam"
          />
          <Field
            label="Phone"
            value={phone}
            onChangeText={(v) => {
              setPhone(v)
              setSaved(false)
            }}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="(814) 555-0123"
            hint="Kept on this phone and shared with a store only when you reserve."
          />
          <ErrorNote message={error} />
          <Button
            title={saved && !dirty ? 'Saved' : 'Save details'}
            icon={saved && !dirty ? 'checkmark' : undefined}
            variant="dark"
            disabled={!dirty}
            onPress={save}
          />
        </View>

        <View style={styles.section}>
          <T variant="eyebrow">HOW IT WORKS</T>
          <View style={styles.card}>
            {HOW_IT_WORKS.map((step, i) => (
              <View key={step.text} style={[styles.howRow, i > 0 && styles.howRowBorder]}>
                <Ionicons name={step.icon} size={18} color={colors.ember} />
                <T style={{ flex: 1, color: colors.ink }}>{step.text}</T>
              </View>
            ))}
          </View>
          <T variant="small">Pickup only. No delivery, and no payment in the app.</T>
        </View>

        {(profile.name || profile.phone) && (
          <Button title="Remove my details from this phone" variant="ghostDanger" onPress={confirmClear} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingBottom: 32, gap: 24, backgroundColor: colors.paper },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.ember,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display, fontSize: 26, color: '#fff' },
  impact: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: 20, gap: 14 },
  stats: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, gap: 2 },
  statValue: { fontFamily: fonts.display, fontSize: 28, color: colors.paper },
  statDivider: { width: 1, height: 36, backgroundColor: '#4A4038', marginHorizontal: 12 },
  section: { gap: 12 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
  },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  howRowBorder: { borderTopWidth: 1, borderTopColor: colors.line },
})
