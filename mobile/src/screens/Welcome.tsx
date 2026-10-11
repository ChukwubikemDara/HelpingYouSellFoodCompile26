import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, T, type IoniconName } from '../components/ui'
import { useProfile } from '../profile'
import { colors, fonts } from '../theme'

const STEPS: { icon: IoniconName; title: string; body: string }[] = [
  { icon: 'pricetag', title: 'Find tonight’s deals', body: 'Fresh food local spots would rather sell than toss, at around half price.' },
  { icon: 'ticket', title: 'Reserve in two taps', body: 'No card, no account. You get a 4-digit pickup code.' },
  { icon: 'walk', title: 'Pick up and pay there', body: 'Show the code at the counter before closing time.' },
]

// First-launch screen. Shown once, then the app opens straight to the deals.
export function Welcome() {
  const insets = useSafeAreaInsets()
  const { update } = useProfile()

  return (
    <View style={[styles.page, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 20 }]}>
      <View style={{ gap: 14 }}>
        <Text style={styles.wordmark}>
          Last Call<Text style={{ color: colors.marigold }}>.</Text>
        </Text>
        <Text style={styles.headline}>
          Good food,{'\n'}
          <Text style={styles.headlineAccent}>half the price,</Text>
          {'\n'}before it’s gone.
        </Text>
      </View>

      <View style={{ gap: 20 }}>
        {STEPS.map((step) => (
          <View key={step.title} style={styles.step}>
            <View style={styles.stepIcon}>
              <Ionicons name={step.icon} size={20} color={colors.ink} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="heading" style={{ color: colors.paper }}>
                {step.title}
              </T>
              <T style={{ color: '#CFC4B5' }}>{step.body}</T>
            </View>
          </View>
        ))}
      </View>

      <View style={{ gap: 12 }}>
        <Button title="See tonight’s deals" icon="arrow-forward" onPress={() => update({ onboarded: true })} />
        <T variant="small" style={{ textAlign: 'center', color: '#A89C8D' }}>
          State College, PA · Pickup only
        </T>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink, paddingHorizontal: 26, justifyContent: 'space-between' },
  wordmark: { fontFamily: fonts.displayItalic, fontSize: 24, color: colors.paper },
  headline: { fontFamily: fonts.display, fontSize: 42, lineHeight: 46, color: colors.paper },
  headlineAccent: { fontFamily: fonts.displayItalic, color: colors.marigold },
  step: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.marigold,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
