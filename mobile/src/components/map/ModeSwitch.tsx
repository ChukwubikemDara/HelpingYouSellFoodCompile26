import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';

import { tap } from '@/components/ui';
import { colors, radius, shadowFloat } from '@/lib/theme';

export type DealsMode = 'list' | 'map';

const SEG_W = 46;
const SEG_H = 36;
const PAD = 3;

/** List or map, with a thumb that slides between the two. `floating` adds the shadow needed over a map. */
export function ModeSwitch({
  mode,
  onChange,
  floating = false,
}: {
  mode: DealsMode;
  onChange: (m: DealsMode) => void;
  floating?: boolean;
}) {
  const x = useRef(new Animated.Value(mode === 'map' ? 1 : 0)).current;
  useEffect(() => {
    const anim = Animated.spring(x, {
      toValue: mode === 'map' ? 1 : 0,
      tension: 240,
      friction: 24,
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start();
    return () => anim.stop();
  }, [mode, x]);

  return (
    <View style={[styles.track, floating ? styles.floating : styles.flat]} accessibilityRole="tablist">
      <Animated.View
        pointerEvents="none"
        style={[styles.thumb, { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, SEG_W] }) }] }]}
      />
      {(['list', 'map'] as const).map((m) => {
        const on = mode === m;
        return (
          <Pressable
            key={m}
            onPress={() => {
              if (!on) {
                tap('select');
                onChange(m);
              }
            }}
            accessibilityRole="tab"
            accessibilityLabel={m === 'list' ? 'List' : 'Map'}
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 6, bottom: 6 }}
            style={styles.seg}>
            <Ionicons name={m === 'list' ? 'list' : 'map'} size={19} color={on ? colors.paper : colors.inkSoft} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: PAD,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  flat: { borderWidth: 1, borderColor: colors.line },
  floating: { ...shadowFloat, shadowOpacity: 0.12, elevation: 5 },
  thumb: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    width: SEG_W,
    height: SEG_H,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },
  seg: { width: SEG_W, height: SEG_H, alignItems: 'center', justifyContent: 'center' },
});
