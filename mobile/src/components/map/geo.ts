// Pure helpers for the map: grouping deals by store and working out what the camera should show.
// No native imports here, so the web build can share the types.

import type { ReactNode } from 'react';

import { isSoldOut } from '@/components/DealCard';
import type { Deal, DealMerchant } from '@/lib/api';
import { formatCents } from '@/lib/format';

/** Downtown State College (College Ave and Allen St), used when nothing else tells us where to look. */
export const DOWNTOWN_STATE_COLLEGE = { latitude: 40.7944, longitude: -77.8611 };

export type Place = { latitude: number; longitude: number };
export type Coords = { lat: number; lng: number };

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type DealsMapProps = {
  /** null until the first answer arrives. */
  deals: Deal[] | null;
  coords: Coords | null;
  now: number;
  onOpenDeal: (id: string) => void;
  /** 'loading' before the first answer, 'error' when it failed with nothing to show. */
  status: 'loading' | 'error' | 'ready';
  /** The API's message for a failed load. */
  error: string | null;
  onRetry: () => void;
  /** Switches back to the list. */
  onShowList: () => void;
  /** Changes with the category filter; the map re-frames once the new deals arrive. */
  fitKey: string;
  /** Controls drawn over the top of the map (location, list or map switch, categories). */
  header: ReactNode;
  /** Shown when there are no deals at all. */
  emptyBody: string;
};

export type Store = {
  id: string;
  name: string;
  place: Place;
  /** This store's deals in the order the API sent them. */
  deals: Deal[];
  /** The text on the price pill: the cheapest deal that can still be reserved. */
  label: string;
  soldOut: boolean;
};

function hasPlace(d: Deal): boolean {
  const m: DealMerchant | undefined = d.merchant;
  return !!m && typeof m.lat === 'number' && typeof m.lng === 'number' && Number.isFinite(m.lat) && Number.isFinite(m.lng);
}

/** "$4" for whole dollars, "$4.50" otherwise: short enough for a map pill. */
export function shortPrice(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  return cents % 100 === 0 ? `$${cents / 100}` : formatCents(cents);
}

/**
 * Groups deals by store. `located` is every deal that can be placed on the map, in the API's order
 * (that is the order of the card carousel); `missing` counts the deals that have no coordinates.
 */
export function groupStores(deals: Deal[]): { stores: Store[]; located: Deal[]; missing: number } {
  const byId = new Map<string, Store>();
  const located: Deal[] = [];
  let missing = 0;
  for (const d of deals) {
    if (!hasPlace(d)) {
      missing += 1;
      continue;
    }
    located.push(d);
    const existing = byId.get(d.merchant_id);
    if (existing) existing.deals.push(d);
    else {
      byId.set(d.merchant_id, {
        id: d.merchant_id,
        name: d.merchant.name,
        place: { latitude: d.merchant.lat as number, longitude: d.merchant.lng as number },
        deals: [d],
        label: '',
        soldOut: false,
      });
    }
  }
  const stores = [...byId.values()];
  for (const s of stores) {
    const open = s.deals.filter((d) => !isSoldOut(d) && d.deal_price_cents !== null);
    const best = open.reduce<Deal | null>(
      (a, d) => (a === null || (d.deal_price_cents as number) < (a.deal_price_cents as number) ? d : a),
      null
    );
    s.soldOut = s.deals.every(isSoldOut);
    s.label = shortPrice((best ?? s.deals[0]).deal_price_cents) || 'Deal';
  }
  return { stores, located, missing };
}

// ---------- Camera ----------

const R = 6371000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function metersBetween(a: Place, b: Place): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Viewport = {
  width: number;
  height: number;
  /** Space covered by the floating header, in px. */
  padTop: number;
  /** Space covered by the card carousel, in px. */
  padBottom: number;
  padX: number;
  /**
   * true when the native map already treats padTop and padBottom as its padding (Google Maps via
   * mapPadding): regions are then fitted into the padded area. false: the camera works on the whole
   * view, so the center is nudged to sit in the middle of the uncovered part.
   */
  padded: boolean;
};

/**
 * The region that shows every point inside the uncovered part of the view.
 * Longitude degrees are narrower than latitude degrees by cos(latitude), hence the correction.
 */
export function regionFor(points: Place[], vp: Viewport, minLngDelta = 0.012, maxLngDelta = 0.6): Region {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latitude = (minLat + maxLat) / 2;
  const longitude = (minLng + maxLng) / 2;
  const cos = Math.max(Math.cos(rad(latitude)), 0.2);

  const visW = Math.max(vp.width - 2 * vp.padX, 120);
  const visH = Math.max(vp.height - vp.padTop - vp.padBottom, 120);
  const lngSpan = Math.max(maxLng - minLng, 1e-6);
  const latSpan = Math.max(maxLat - minLat, 1e-6);

  // Pixels per degree of longitude at which everything fits, kept between the allowed zooms.
  let s = Math.min(visW / lngSpan, (visH * cos) / latSpan);
  s = Math.min(s, visW / minLngDelta);
  s = Math.max(s, visW / maxLngDelta);

  // The region has to be as big as what the native map will fit it into: the whole width, and
  // either the padded height (Google, which fits regions into its padded area) or the whole height.
  const w = vp.width;
  const h = vp.padded ? visH : vp.height;
  const shift = vp.padded ? 0 : (((vp.padBottom - vp.padTop) / 2) * cos) / s;
  return { latitude: latitude - shift, longitude, latitudeDelta: (h * cos) / s, longitudeDelta: w / s };
}

/** The camera center that puts `place` in the middle of the uncovered part (only needed when not padded). */
export function centerFor(place: Place, latitudeDelta: number, vp: Viewport): Place {
  if (vp.padded || vp.height <= 0) return place;
  return {
    latitude: place.latitude - (((vp.padBottom - vp.padTop) / 2) / vp.height) * latitudeDelta,
    longitude: place.longitude,
  };
}

/** What to frame: every store, plus the user when they are close enough to matter. */
export function framePoints(stores: Store[], coords: Coords | null): Place[] {
  const user: Place | null = coords ? { latitude: coords.lat, longitude: coords.lng } : null;
  if (stores.length === 0) return [user ?? DOWNTOWN_STATE_COLLEGE];
  const pts = stores.map((s) => s.place);
  if (user) {
    const center: Place = {
      latitude: pts.reduce((a, p) => a + p.latitude, 0) / pts.length,
      longitude: pts.reduce((a, p) => a + p.longitude, 0) / pts.length,
    };
    if (metersBetween(user, center) < 6000) pts.push(user);
  }
  return pts;
}
