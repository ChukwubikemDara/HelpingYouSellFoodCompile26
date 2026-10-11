import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import type { Deal } from '@/lib/api';
import { artFor, motion } from '@/lib/theme';

/**
 * The deal's photo when the store sent one (and it loads), otherwise a softly tinted block with
 * the category's glyph so cards never look empty. `size` is the glyph size; the block's own size
 * comes from `style`. The glyph stays underneath a photo, so the block is never blank while the
 * photo loads.
 */
export function DealArt({ deal, size, style }: { deal: Deal; size: number; style?: StyleProp<ViewStyle> }) {
  const art = artFor(deal.merchant?.category);
  const [failed, setFailed] = useState(false);
  const photo = deal.photo_url && !failed ? deal.photo_url : null;
  return (
    <View
      style={[styles.art, { backgroundColor: art.bg }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {/* an oversized ghost glyph adds depth, but only on blocks big enough to carry it */}
      {size >= 80 ? (
        <MaterialCommunityIcons
          name={art.icon}
          size={size * 2.4}
          color={art.fg}
          style={[styles.ghost, { right: -size * 0.5, bottom: -size * 0.7 }]}
        />
      ) : null}
      <MaterialCommunityIcons name={art.icon} size={size} color={art.fg} style={styles.glyph} />
      {photo ? (
        <Image
          source={{ uri: photo }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={motion.base}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ghost: { position: 'absolute', opacity: 0.1 },
  glyph: { opacity: 0.9 },
});
