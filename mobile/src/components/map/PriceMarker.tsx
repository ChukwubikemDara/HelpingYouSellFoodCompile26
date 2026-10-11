import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { font } from '@/components/ui';
import { colors } from '@/lib/theme';
import type { Store } from './geo';

const PILL_H = 30;
const TAIL = 9;
// The pill plus the lower half of the tail; the tip of the tail sits on the store.
const ROOT_H = PILL_H + 7;

/**
 * A store on the map: a small white price pill with a tail, ember when selected. The pill is a
 * view, which the map turns into a picture. It keeps watching the view for a moment after each
 * change (selection, price) and then stops, because watching forever is slow on Android.
 */
export const StoreMarker = memo(function StoreMarker({
  store,
  selected,
  onSelect,
}: {
  store: Store;
  selected: boolean;
  onSelect: (storeId: string) => void;
}) {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const t = setTimeout(() => setTracking(false), 1000);
    return () => clearTimeout(t);
  }, [selected, store.label, store.soldOut]);

  const fill = selected ? colors.ember : colors.white;
  const edge = selected ? colors.ember : '#D4D4D4';
  const textColor = selected ? colors.white : store.soldOut ? colors.muted : colors.ink;

  return (
    <Marker
      coordinate={store.place}
      onPress={() => onSelect(store.id)}
      tracksViewChanges={tracking}
      anchor={{ x: 0.5, y: 1 }}
      centerOffset={{ x: 0, y: -ROOT_H / 2 }}
      zIndex={selected ? 10 : 1}
      accessibilityLabel={`${store.name}, ${store.soldOut ? 'sold out' : store.label}`}>
      {/* collapsable={false}: Android must not flatten these views away before the map draws them */}
      <View collapsable={false} style={styles.root}>
        <View collapsable={false} style={[styles.pill, { backgroundColor: fill, borderColor: edge }]}>
          <Text maxFontSizeMultiplier={1.1} style={[font('bold'), styles.label, { color: textColor }]} numberOfLines={1}>
            {store.label}
          </Text>
        </View>
        <View collapsable={false} style={[styles.tail, { backgroundColor: fill, borderColor: edge }]} />
      </View>
    </Marker>
  );
});

const styles = StyleSheet.create({
  root: { height: ROOT_H, alignItems: 'center', paddingHorizontal: 2 },
  pill: {
    height: PILL_H,
    minWidth: 44,
    paddingHorizontal: 11,
    borderRadius: PILL_H / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, lineHeight: 18, textAlignVertical: 'center' },
  // A rotated square, half hidden behind the pill, so only the lower point shows.
  tail: {
    position: 'absolute',
    top: PILL_H - TAIL / 2 - 0.5,
    width: TAIL,
    height: TAIL,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    transform: [{ rotate: '45deg' }],
  },
});
