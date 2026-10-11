import type { ComponentProps } from 'react'
import type { MaterialCommunityIcons } from '@expo/vector-icons'
import type { Category } from './types'

// Warm paper, dark ink and one hot accent: closing time at a good bakery,
// not a tech dashboard.
export const colors = {
  paper: '#FAF5EC',
  card: '#FFFFFF',
  ink: '#1E1A16',
  inkSoft: '#4A4038',
  muted: '#6F6358',
  line: '#EBE1D2',
  ember: '#C8401F', // actions and urgency
  emberSoft: '#FBE4DA',
  marigold: '#F2B33D', // discount tags
  marigoldSoft: '#FBEBC6',
  forest: '#1F4B3A', // done / saved
  forestSoft: '#DCEBDD',
}

export const fonts = {
  display: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_600SemiBold_Italic',
  body: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
  mono: 'DMMono_500Medium',
}

export const radius = { sm: 10, md: 16, lg: 24, pill: 999 }

export const shadow = {
  shadowColor: '#3B2A1A',
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
}

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name']

// Stand-in artwork for deals without a photo, tinted by what kind of place it is.
export const categoryArt: Record<Category, { bg: string; fg: string; icon: IconName; label: string }> = {
  bakery: { bg: '#F7E2B0', fg: '#8A5A12', icon: 'food-croissant', label: 'Bakery' },
  cafe: { bg: '#E7D8C9', fg: '#5C3D26', icon: 'coffee', label: 'Cafe' },
  restaurant: { bg: '#F6CDBD', fg: '#8E2F18', icon: 'noodles', label: 'Restaurant' },
}
