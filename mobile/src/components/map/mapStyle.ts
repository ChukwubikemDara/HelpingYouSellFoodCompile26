import type { MapStyleElement } from 'react-native-maps';

/** The colour the map sits on while tiles load, and what shows through if they never do. */
export const MAP_PAPER = '#F3F3F3';

/**
 * Google Maps style (Android): plain light grey land, white roads, a pale water tone, no icons, no
 * businesses, no transit. It reads like an illustration of the town instead of a navigation map.
 * Apple Maps (iOS) gets the built-in mutedStandard type instead.
 */
export const MUTED_MAP_STYLE: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: MAP_PAPER }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8A8A8A' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFFFFF' }, { weight: 3 }] },

  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#6B6B6B' }] },

  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#EBEBEB' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: MAP_PAPER }] },

  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ visibility: 'on' }, { color: '#E4E9DD' }],
  },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },

  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E6E6E6' }, { weight: 1 }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9A9A9A' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#FAFAFA' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#DDDDDD' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'geometry', stylers: [{ color: '#FAFAFA' }] },

  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D6E2E1' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9AAAA8' }] },
];

/**
 * Backup base map for Android, switched on only if Google's own tiles have not drawn after a few
 * seconds (for example a rejected key). CARTO's light map is quiet and free to use with attribution.
 */
export const FALLBACK_TILE_URL = 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
export const FALLBACK_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
