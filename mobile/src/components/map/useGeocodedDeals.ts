import * as Location from 'expo-location';
import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import type { Deal } from '@/lib/api';
import type { Place } from './geo';

// Stores that came without coordinates are looked up from their street address with the phone's
// own geocoder. Answers are kept for the session, including "not found", so each address is
// asked about once.
const found = new Map<string, Place | null>();
const asking = new Set<string>();

const MAX_PER_PASS = 12;

function hasPlace(d: Deal): boolean {
  const m = d.merchant;
  return typeof m?.lat === 'number' && typeof m?.lng === 'number' && Number.isFinite(m.lat) && Number.isFinite(m.lng);
}

/** The address to look up: this app only serves State College, so a bare street address gets the town. */
function queryFor(address: string | null | undefined): string | null {
  const a = (address ?? '').trim();
  // Placeholder text such as "..." is not an address.
  if (a.replace(/[^A-Za-z0-9]/g, '').length < 5) return null;
  return /state college|,\s*pa\b/i.test(a) ? a : `${a}, State College, PA`;
}

/**
 * Fills in `merchant.lat` and `merchant.lng` for deals whose store has an address but no
 * coordinates, so they can still be pinned on the map. Pass null to do nothing.
 */
export function useGeocodedDeals(deals: Deal[] | null): Deal[] | null {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!deals || Platform.OS === 'web') return;
    const todo = new Map<string, string>();
    for (const d of deals) {
      if (hasPlace(d)) continue;
      const q = queryFor(d.merchant?.address);
      if (q && !found.has(q) && !asking.has(q)) todo.set(q, q);
    }
    if (todo.size === 0) return;
    void (async () => {
      for (const q of [...todo.keys()].slice(0, MAX_PER_PASS)) {
        asking.add(q);
        try {
          const hit = (await Location.geocodeAsync(q))[0];
          found.set(q, hit ? { latitude: hit.latitude, longitude: hit.longitude } : null);
        } catch {
          // No geocoder on this phone, or it refused: leave the store off the map.
          found.set(q, null);
        }
        asking.delete(q);
        setVersion((v) => v + 1);
      }
    })();
  }, [deals]);

  return useMemo(() => {
    if (!deals) return deals;
    return deals.map((d) => {
      if (hasPlace(d)) return d;
      const q = queryFor(d.merchant?.address);
      const place = q ? found.get(q) : null;
      return place ? { ...d, merchant: { ...d.merchant, lat: place.latitude, lng: place.longitude } } : d;
    });
    // `version` is the signal that the lookups above have new answers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, version]);
}
