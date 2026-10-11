import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { colors, radius } from '@/lib/theme';

/** Fades its children in and out slowly: a calm stand-in while the first answer is on its way. */
export function Pulse({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}

function Bar({ width, height = 12 }: { width: number | `${number}%`; height?: number }) {
  return <View style={{ width, height, borderRadius: height / 2, backgroundColor: colors.neutralSoft }} />;
}

/** Same footprint as a DealCard so the list does not jump when the real cards arrive. */
export function DealCardSkeleton({ compact = false, style }: { compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const art = compact ? 76 : 88;
  return (
    <Pulse>
      <View
        style={[styles.card, style]}
        accessibilityLabel="Loading deals"
        accessibilityRole="progressbar"
        importantForAccessibility="yes">
        <View style={{ width: art, height: art, borderRadius: radius.md, backgroundColor: colors.neutralSoft }} />
        <View style={styles.lines}>
          <Bar width="38%" height={10} />
          <Bar width="82%" height={14} />
          <Bar width="52%" height={10} />
          <Bar width="30%" height={14} />
        </View>
      </View>
    </Pulse>
  );
}

/** A few skeleton cards, as many as fit a first screen. */
export function DealListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: count }, (_, i) => (
        <DealCardSkeleton key={i} />
      ))}
    </View>
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
  lines: { flex: 1, gap: 9 },
});
