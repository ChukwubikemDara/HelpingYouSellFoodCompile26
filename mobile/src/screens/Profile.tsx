import { Ionicons } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '../api'
import { Button, ErrorNote, Field, T, type IoniconName } from '../components/ui'
import { money } from '../format'
import { useLoad } from '../hooks'
import { useProfile } from '../profile'
import { normalizePhone, prettyPhone } from '../storage'
import { colors, fonts, radius } from '../theme'
import type { Reservation } from '../types'

// Where the store portal (../web) is hosted. Unset in a build means the row is hidden.
const PORTAL_URL = process.env.EXPO_PUBLIC_PORTAL_URL

function openPortal() {
  if (!PORTAL_URL) return
  // in-app browser: the store owner stays inside the app and can swipe back
  WebBrowser.openBrowserAsync(`${PORTAL_URL}/merchant`, {
    controlsColor: colors.ember,
    toolbarColor: colors.paper,
  }).catch(() => Alert.alert('Couldn’t open the store portal', 'Check your connection and try again.'))
}

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
      (n, r) => n + ((r.deal.original_price_cents ?? 0) - r.unit_price_cents) * r.quantity,
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
  const { profile, signedIn, authenticate, reset } = useProfile(); const insets = useSafeAreaInsets()
  const [signup, setSignup] = useState(false), [name, setName] = useState(''), [phone, setPhone] = useState(''), [password, setPassword] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true); setError('')
    try {
      const normalized = normalizePhone(phone); if (!normalized) throw new Error('Enter a valid phone number.')
      const result = signup ? await api.signup({ name, phone: normalized, password }) : await api.signin({ phone: normalized, password })
      await authenticate(result.token, result.customer); setPassword('')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const history = useLoad(() => signedIn ? api.myReservations() : Promise.resolve([]), `${signedIn}:${profile.phone}`, 30000)
  const stats = impact(history.data)
  const initial = signedIn ? profile.name.trim().charAt(0).toUpperCase() : ""
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
              {profile.phone ? prettyPhone(profile.phone) : 'Sign in to reserve in one tap.'}
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

        <View style={styles.section}><T variant="eyebrow">YOUR ACCOUNT</T>
    {signedIn ? <><T>{profile.phone}</T><T>Reservations and pickups are linked to your account.</T><Button title="Sign out" busy={busy} onPress={async () => { setBusy(true); try { await reset() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }} /></> : <>
      {signup && <Field label="Name" value={name} onChangeText={setName} autoComplete="given-name" />}
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={signup ? 'new-password' : 'current-password'} hint="At least eight characters when signing up." />
      <Button title={signup ? 'Create account' : 'Sign in'} busy={busy} onPress={submit} />
      <Button title={signup ? 'Already have an account? Sign in' : 'Create an account'} variant="outline" onPress={() => { setSignup(!signup); setError('') }} />
    </>}
    <ErrorNote message={error} />

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

        {!!PORTAL_URL && (
          <View style={styles.section}>
            <T variant="eyebrow">FOR STORES</T>
            <Pressable
              onPress={openPortal}
              accessibilityRole="link"
              accessibilityLabel="I run a store. Open the store portal."
              style={({ pressed }) => [styles.storeRow, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.storeIcon}>
                <Ionicons name="storefront" size={20} color={colors.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <T variant="heading" style={{ color: colors.paper }}>
                  I run a store
                </T>
                <T variant="small" style={{ color: '#CFC4B5' }}>
                  List what’s left tonight and get paid for it.
                </T>
              </View>
              <Ionicons name="arrow-forward" size={18} color={colors.paper} />
            </Pressable>
          </View>
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
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    padding: 16,
  },
  storeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.marigold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  howRowBorder: { borderTopWidth: 1, borderTopColor: colors.line },
})
