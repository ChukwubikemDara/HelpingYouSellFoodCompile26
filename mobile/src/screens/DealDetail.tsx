import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { api, ApiError } from '../api'
import { Button, Card, colors, ErrorNote, Field, Loading } from '../components/ui'
import { money, percentOff, pickupWindow } from '../format'
import { useLoad } from '../hooks'
import type { ScreenProps } from '../navigation'
import { loadCustomer, normalizePhone, saveCustomer } from '../storage'
import type { Deal } from '../types'

function ReserveForm({ deal, onStale, onReserved }: { deal: Deal; onStale: () => void; onReserved: (id: string) => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // prefill from the last reservation made on this phone
  useEffect(() => {
    void loadCustomer().then((c) => {
      setName((current) => current || c.name)
      setPhone((current) => current || c.phone)
    })
  }, [])

  const max = Math.min(deal.quantity_left, deal.max_per_customer)

  async function submit() {
    const normalized = normalizePhone(phone)
    if (!name.trim()) return setError('Enter your name so the store knows who is picking up.')
    if (!normalized) return setError('Enter a 10 digit US phone number.')
    setError('')
    setBusy(true) // stays disabled on success: we leave this screen
    try {
      const r = await api.reserve({
        deal_id: deal.id,
        quantity,
        customer_name: name.trim(),
        customer_phone: normalized,
      })
      await saveCustomer({ name: name.trim(), phone: normalized })
      onReserved(r.id)
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
      if (err instanceof ApiError && (err.code === 'SOLD_OUT' || err.code === 'DEAL_NOT_LIVE')) onStale()
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Field label="Name" value={name} onChangeText={setName} autoComplete="given-name" textContentType="givenName" />
      <Field
        label="Phone"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="(814) 555-0123"
        hint="So the store can match your pickup. No account needed."
      />
      <View style={{ gap: 4 }}>
        <Text style={styles.label}>Quantity</Text>
        <View style={styles.stepper}>
          <Button title="−" variant="secondary" disabled={quantity <= 1} onPress={() => setQuantity(quantity - 1)} />
          <Text style={styles.quantity}>{quantity}</Text>
          <Button title="+" variant="secondary" disabled={quantity >= max} onPress={() => setQuantity(quantity + 1)} />
        </View>
        <Text style={styles.hint}>Limit {deal.max_per_customer} per customer</Text>
      </View>
      <ErrorNote message={error} />
      <Button
        title={busy ? 'Reserving…' : `Reserve · ${money(quantity * (deal.deal_price_cents ?? 0))}`}
        disabled={busy}
        onPress={submit}
      />
      <Text style={[styles.hint, { textAlign: 'center' }]}>No payment in the app. Pay the store when you pick up.</Text>
    </View>
  )
}

export function DealDetail({ route, navigation }: ScreenProps<'Deal'>) {
  const { id } = route.params
  const { data: deal, error, loading, reload } = useLoad(() => api.deal(id), id)

  if (loading) return <Loading />
  if (!deal) {
    return (
      <View style={styles.page}>
        <ErrorNote message={error?.message ?? 'Deal not found'} />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text style={styles.merchant}>{deal.merchant.name.toUpperCase()}</Text>
          <Text style={styles.title}>{deal.title}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{money(deal.deal_price_cents)}</Text>
            <Text style={styles.was}>{money(deal.original_price_cents)}</Text>
            <Text style={styles.off}>{percentOff(deal.original_price_cents, deal.deal_price_cents)}% off</Text>
          </View>
        </View>

        <Card style={{ gap: 12 }}>
          <View>
            <Text style={styles.heading}>What you get</Text>
            {deal.items.map((item) => (
              <Text key={item.name} style={styles.body}>
                {item.qty} × {item.name}
              </Text>
            ))}
          </View>
          <View>
            <Text style={styles.heading}>Pickup</Text>
            <Text style={styles.body}>{pickupWindow(deal.pickup_start, deal.pickup_end)}</Text>
            <Text style={styles.body}>{deal.merchant.address}</Text>
          </View>
          <View>
            <Text style={styles.heading}>Allergens</Text>
            <Text style={styles.body}>
              {deal.allergens === null
                ? 'Not provided, ask the store'
                : deal.allergens.length
                  ? deal.allergens.join(', ')
                  : 'None listed'}
            </Text>
          </View>
          {deal.note ? <Text style={[styles.body, { fontStyle: 'italic' }]}>“{deal.note}”</Text> : null}
        </Card>

        {deal.status === 'live' ? (
          <>
            <Text style={styles.body}>{deal.quantity_left} left</Text>
            <ReserveForm
              deal={deal}
              onStale={reload}
              onReserved={(reservationId) => navigation.replace('Reservation', { id: reservationId })}
            />
          </>
        ) : (
          <Card>
            <Text style={[styles.body, { textAlign: 'center' }]}>
              {deal.status === 'sold_out'
                ? 'Sold out. Check back, a cancellation may free one up.'
                : 'No longer available.'}
            </Text>
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, backgroundColor: colors.bg },
  merchant: { fontSize: 11, letterSpacing: 0.5, color: colors.muted },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 },
  price: { fontSize: 22, fontWeight: '700', color: colors.primaryDark },
  was: { fontSize: 16, color: '#a8a29e', textDecorationLine: 'line-through' },
  off: { fontSize: 14, fontWeight: '600', color: colors.primaryDark },
  heading: { fontSize: 14, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, color: '#44403c' },
  label: { fontSize: 14, fontWeight: '500', color: '#44403c' },
  hint: { fontSize: 12, color: colors.muted },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  quantity: { fontSize: 20, fontWeight: '600', minWidth: 24, textAlign: 'center' },
})
