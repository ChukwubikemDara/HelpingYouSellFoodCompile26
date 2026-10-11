import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { goToSignIn } from '@/components/parts';
import { Button, IoniconName, T } from '@/components/ui';
import { colors, motion } from '@/lib/theme';

const KEY = 'welcome_seen';

const STEPS: { icon: IoniconName; title: string; body: string }[] = [
  {
    icon: 'pricetag-outline',
    title: 'Find a deal nearby',
    body: 'Prices and pickup times from local spots.',
  },
  { icon: 'ticket-outline', title: 'Reserve in two taps', body: 'You get a 4-digit pickup code.' },
  { icon: 'walk-outline', title: 'Pick up before close', body: 'Show your code at the counter and pay in store.' },
];

async function readSeen(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) === '1';
    return (await SecureStore.getItemAsync(KEY)) === '1';
  } catch {
    return false;
  }
}

async function writeSeen() {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, '1');
    else await SecureStore.setItemAsync(KEY, '1');
  } catch {
    // Not stored: the welcome shows again next launch, nothing else breaks.
  }
}

/** null until read from storage. */
export function useWelcomeSeen(): [boolean | null, () => void] {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void readSeen().then((v) => {
      if (alive) setSeen(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  const markSeen = () => {
    setSeen(true);
    void writeSeen();
  };
  return [seen, markSeen];
}

/** First-launch screen, drawn over the app. Shown once, then the app opens straight to the deals. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  // Short phones tighten the gaps so the sign-in link and the footer line stay on screen.
  const compact = useWindowDimensions().height < 700;
  const enter = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(1)).current;
  const leaving = useRef(false);

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [enter]);

  // Fades the welcome away, then hands over to the app that is already mounted underneath.
  const leave = (beforeFade?: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    beforeFade?.();
    Animated.timing(exit, { toValue: 0, duration: motion.base, useNativeDriver: Platform.OS !== 'web' }).start(onDone);
  };

  // Each block eases in a little after the one above it.
  const reveal = (index: number) => {
    const from = index * 0.16;
    return {
      opacity: enter.interpolate({ inputRange: [from, from + 0.45], outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [
        { translateY: enter.interpolate({ inputRange: [from, from + 0.45], outputRange: [14, 0], extrapolate: 'clamp' }) },
      ],
    };
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.page, { opacity: exit }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never">
        <Animated.View style={reveal(0)}>
          <T variant="title" style={styles.wordmark}>
            Last Call<Text style={{ color: colors.ember }}>.</Text>
          </T>
        </Animated.View>

        <View style={[styles.middle, compact && styles.middleCompact]}>
          <Animated.View style={[{ gap: 14 }, reveal(1)]}>
            <T variant="hero">{'Good food,\nfor less.'}</T>
            <T variant="lead" style={{ maxWidth: 320 }}>
              A limited quantity from local bakeries, cafes and restaurants, at a lower price. Pay in store.
            </T>
          </Animated.View>

          <Animated.View style={[styles.steps, compact && { gap: 14 }, reveal(2)]}>
            {STEPS.map((step) => (
              <View key={step.title} style={styles.step}>
                <View style={styles.stepIcon}>
                  <Ionicons name={step.icon} size={18} color={colors.ink} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <T variant="heading" style={{ fontSize: 15, lineHeight: 21 }}>
                    {step.title}
                  </T>
                  <T variant="small">{step.body}</T>
                </View>
              </View>
            ))}
          </Animated.View>
        </View>

        <Animated.View style={[{ gap: 6 }, reveal(3)]}>
          <Button label="Browse deals" variant="dark" icon="arrow-forward" onPress={() => leave()} />
          <Button label="I have an account" variant="link" onPress={() => leave(() => goToSignIn())} />
          <T variant="small" style={{ textAlign: 'center', marginTop: 2 }}>
            State College, PA · Pay in store
          </T>
        </Animated.View>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.paper },
  content: { flexGrow: 1, paddingHorizontal: 28 },
  wordmark: { fontSize: 19, lineHeight: 26 },
  // Takes the free space between wordmark and buttons and centers the story in it.
  middle: { flex: 1, justifyContent: 'center', gap: 36, paddingVertical: 32 },
  middleCompact: { gap: 24, paddingVertical: 16 },
  steps: { gap: 18 },
  step: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
