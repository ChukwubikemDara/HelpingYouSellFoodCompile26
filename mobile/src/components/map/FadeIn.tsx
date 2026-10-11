import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleProp, ViewStyle } from 'react-native';

import { motion } from '@/lib/theme';

/** Eases its children in on mount (a short fade and a small rise), used when switching list and map. */
export function FadeIn({
  children,
  style,
  delay = 0,
  rise = true,
  pointerEvents,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
  /** false: fade only, which is what to use around a map (a moving map view can flicker on Android). */
  rise?: boolean;
  /** 'box-none' when the children float over something that must stay touchable. */
  pointerEvents?: 'auto' | 'box-none';
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(t, {
      toValue: 1,
      delay,
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start();
    return () => anim.stop();
  }, [t, delay]);
  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[
        style,
        { opacity: t },
        rise ? { transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] } : null,
      ]}>
      {children}
    </Animated.View>
  );
}
