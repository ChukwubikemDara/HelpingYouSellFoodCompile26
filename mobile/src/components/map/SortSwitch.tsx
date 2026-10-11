import { Pressable, StyleSheet, Text, View } from 'react-native';

import { font, tap } from '@/components/ui';
import type { DealSort } from '@/lib/api';
import { colors, radius } from '@/lib/theme';

const OPTIONS: { sort: DealSort; label: string }[] = [
  { sort: 'discount', label: 'Best deals' },
  { sort: 'distance', label: 'Nearest' },
  { sort: 'ending', label: 'Ending soon' },
];

/** What the list is ordered by, as a short heading above it. */
export const SORT_HEADING: Record<DealSort, string> = {
  discount: 'Biggest discount',
  distance: 'Nearest first',
  ending: 'Ending soonest',
};

/**
 * Best deals / Nearest / Ending soon. "Nearest" is switched off until the phone has shared its location.
 */
export function SortSwitch({
  sort,
  onPick,
  nearestEnabled,
}: {
  sort: DealSort;
  onPick: (s: DealSort) => void;
  nearestEnabled: boolean;
}) {
  return (
    <View style={styles.track} accessibilityRole="tablist" accessibilityLabel="Sort deals">
      {OPTIONS.map((o) => {
        const on = sort === o.sort;
        const disabled = o.sort === 'distance' && !nearestEnabled;
        return (
          <Pressable
            key={o.sort}
            disabled={disabled}
            onPress={() => {
              if (on) return;
              tap('select');
              onPick(o.sort);
            }}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityHint={disabled ? 'Turn on location to sort by distance' : undefined}
            accessibilityState={{ selected: on, disabled }}
            style={[styles.seg, on && styles.segOn, disabled && styles.segDisabled]}>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
              style={[font('bold'), styles.label, { color: on ? colors.paper : colors.inkSoft }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    padding: 3,
    gap: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  seg: {
    flex: 1,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segOn: { backgroundColor: colors.ink },
  segDisabled: { opacity: 0.4 },
  label: { fontSize: 14, lineHeight: 19 },
});
