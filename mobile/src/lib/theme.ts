import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { MerchantCategory } from './api';

// Last Call visual language: plain white, quiet ink, neutral light greys for surfaces and hairlines,
// and one ember accent used sparingly. Calm and restrained: lots of air, a single sans family.

export const colors = {
  paper: '#FFFFFF', // every screen background
  card: '#FAFAFA', // cards and inputs: a hair off white, edged by a hairline
  ink: '#171717',
  inkSoft: '#404040',
  muted: '#737373',
  line: '#E5E5E5',
  ember: '#C2410C', // actions and urgency
  emberDeep: '#9A3412', // text on emberSoft
  emberSoft: '#FCEAE0',
  marigold: '#E9B44C', // discount tags
  marigoldSoft: '#FAF0D4',
  forest: '#1F4B3A', // done / saved
  forestSoft: '#DDEBE0',
  neutralSoft: '#F2F2F2', // quiet fills: icon circles, pills, skeletons
  stub: '#E5E5E5',
  placeholder: '#A3A3A3',
  onInk: '#D4D4D4', // secondary text on an ink background
  onInkFaint: '#A3A3A3',
  inkLine: '#404040',
  white: '#FFFFFF',
  scrim: 'rgba(23, 23, 23, 0.32)',
} as const;

export type ColorName = keyof typeof colors;

// One family: DM Sans. Display and "bold" are the same calm semibold so nothing shouts.
// The italic key stays for older callers but is upright on purpose.
export const fonts = {
  display: 'DMSans_600SemiBold',
  displayItalic: 'DMSans_600SemiBold',
  body: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_600SemiBold',
  mono: 'DMMono_500Medium',
} as const;

export type FontName = keyof typeof fonts;

export const radius = { xs: 8, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

export const space = { xs: 4, s: 8, m: 16, l: 24, xl: 40 } as const;

/** Side padding of every screen. */
export const gutter = 20;

export const touchMin = 44;

/** Vertical rhythm between the blocks of a screen. */
export const rhythm = { tight: 8, base: 16, section: 28, screen: 40 } as const;

// Soft, low shadows. Hairline borders do most of the separating.
export const shadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

/** For things that float over content: sheets, map controls, pills over a map. */
export const shadowFloat = {
  shadowColor: '#000000',
  shadowOpacity: 0.14,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
} as const;

/** Standard timings so every transition feels related. */
export const motion = { fast: 140, base: 240, slow: 420 } as const;

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type CategoryArt = { bg: string; fg: string; icon: IconName; label: string };

// Stand-in artwork for deals without a photo, tinted by what kind of place it is.
export const categoryArt: Record<MerchantCategory, CategoryArt> = {
  bakery: { bg: '#F6E6BF', fg: '#8A5A12', icon: 'food-croissant', label: 'Bakery' },
  cafe: { bg: '#E9DDD0', fg: '#5C3D26', icon: 'coffee', label: 'Cafe' },
  restaurant: { bg: '#F5D6C8', fg: '#8E2F18', icon: 'noodles', label: 'Restaurant' },
};

const FALLBACK_ART: CategoryArt = { bg: '#EFEFEF', fg: '#737373', icon: 'storefront-outline', label: 'Store' };

/** Never undefined, even if the API sends a category this build does not know. */
export function artFor(category: string | null | undefined): CategoryArt {
  return (category && categoryArt[category as MerchantCategory]) || FALLBACK_ART;
}
