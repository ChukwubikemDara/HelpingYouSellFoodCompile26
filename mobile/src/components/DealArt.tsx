import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { categoryArt } from '../theme'
import type { Deal } from '../types'

// The deal's photo when the store sent one, otherwise a tinted block with the
// category's glyph so cards never look empty.
export function DealArt({ deal, size, style }: { deal: Deal; size: number; style?: StyleProp<ViewStyle> }) {
  const art = categoryArt[deal.merchant.category]
  return (
    <View style={[styles.art, { backgroundColor: art.bg }, style]} accessibilityElementsHidden>
      {deal.photo_url ? (
        <Image source={{ uri: deal.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <>
          {/* oversized ghost glyph behind the main one gives the block some depth */}
          <MaterialCommunityIcons
            name={art.icon}
            size={size * 2.4}
            color={art.fg}
            style={[styles.ghost, { right: -size * 0.5, bottom: -size * 0.7 }]}
          />
          <MaterialCommunityIcons name={art.icon} size={size} color={art.fg} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ghost: { position: 'absolute', opacity: 0.12 },
})
