import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Chip } from '@/components/ui';
import type { MerchantCategory } from '@/lib/api';
import { categoryArt, colors, gutter, radius, shadow } from '@/lib/theme';

const CATEGORIES: MerchantCategory[] = ['bakery', 'cafe', 'restaurant'];

/**
 * The category filter. Bleeds to the screen edges so a fourth chip scrolls instead of wrapping.
 * `floating` gives each chip a faint shadow so it stays readable over the map.
 */
export function CategoryChips({
  category,
  onPick,
  floating = false,
}: {
  category: MerchantCategory | null;
  onPick: (c: MerchantCategory | null) => void;
  floating?: boolean;
}) {
  const wrap = floating ? styles.chipShadow : undefined;
  // Narrow phones drop the icons so all four chips fit without scrolling.
  const showIcons = useWindowDimensions().width >= 390;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.scroll, floating && styles.scrollFloating]}
      contentContainerStyle={[styles.content, floating && styles.contentFloating]}>
      <View style={wrap}>
        <Chip label="All" active={category === null} onPress={() => onPick(null)} />
      </View>
      {CATEGORIES.map((c) => (
        <View key={c} style={wrap}>
          <Chip label={categoryArt[c].label} mci={showIcons ? categoryArt[c].icon : undefined} active={category === c} onPress={() => onPick(c)} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -gutter, flexGrow: 0 },
  // room above and below so the shadows are not cut off by the scroll view
  scrollFloating: { marginVertical: -8 },
  content: { flexDirection: 'row', gap: 8, paddingHorizontal: gutter },
  contentFloating: { paddingVertical: 8 },
  chipShadow: { borderRadius: radius.pill, backgroundColor: colors.card, ...shadow, shadowOpacity: 0.1 },
});
