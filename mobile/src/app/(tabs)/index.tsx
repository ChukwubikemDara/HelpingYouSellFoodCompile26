import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DealCard, isSoldOut } from '@/components/DealCard';
import { DealsMap } from '@/components/DealsMap';
import { CategoryChips } from '@/components/map/CategoryChips';
import { FadeIn } from '@/components/map/FadeIn';
import { type DealsMode, ModeSwitch } from '@/components/map/ModeSwitch';
import { SORT_HEADING, SortSwitch } from '@/components/map/SortSwitch';
import { DealListSkeleton } from '@/components/map/Skeleton';
import { useGeocodedDeals } from '@/components/map/useGeocodedDeals';
import { Button, EmptyState, ErrorNote, font, Pill, ScreenTitle, T } from '@/components/ui';
import * as api from '@/lib/api';
import type { Deal, DealSort, MerchantCategory } from '@/lib/api';
import { categoryArt, colors, gutter, radius, shadowFloat } from '@/lib/theme';
import { useFocusPoll } from '@/lib/useFocusPoll';
import { useNow } from '@/lib/useNow';

type Coords = { lat: number; lng: number };

const EMPTY_COPY = 'Most go up in the late afternoon.';
// How long the deal list waits for the phone's location before showing deals without it.
const LOCATION_WAIT_MS = 2500;
// A pull to refresh never flashes by faster than this.
const MIN_REFRESH_MS = 600;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** Asks for foreground location once; null when denied or unavailable. */
async function getCoords(): Promise<Coords | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    // Both lookups are time-boxed so a slow location provider never holds up the deal list.
    const last = await withTimeout(
      Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null),
      3000
    );
    const pos =
      last ?? (await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 10000));
    if (!pos) return null;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function DealsScreen() {
  const insets = useSafeAreaInsets();
  const now = useNow();
  const [mode, setMode] = useState<DealsMode>('list');
  const [category, setCategory] = useState<MerchantCategory | null>(null);
  // Best deals first unless the shopper picks another order. Nearest needs the phone's location.
  const [pickedSort, setPickedSort] = useState<DealSort>('discount');
  const [coords, setCoords] = useState<Coords | null>(null);
  // The location lookup has finished (granted or not), so "turn on location" is a fair thing to say.
  const [locationSettled, setLocationSettled] = useState(false);
  // Deals load once the location is known, or after a short wait, whichever comes first.
  const [canLoad, setCanLoad] = useState(false);
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  const categoryRef = useRef(category);
  categoryRef.current = category;
  // Nearest falls back to Best deals if the location is ever missing.
  const sort: DealSort = pickedSort === 'distance' && !coords ? 'discount' : pickedSort;
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const canLoadRef = useRef(canLoad);
  canLoadRef.current = canLoad;
  // The request in flight (so polls and refreshes share it instead of piling up) and a counter so
  // a stale answer for a previous category or location never replaces the current one.
  const inFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (alive) setCanLoad(true);
    }, LOCATION_WAIT_MS);
    void getCoords().then((c) => {
      if (!alive) return;
      setCoords(c);
      setLocationSettled(true);
      setCanLoad(true);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const load = useCallback((): Promise<void> => {
    if (!canLoadRef.current) return Promise.resolve();
    const c = coordsRef.current;
    const cat = categoryRef.current;
    const sortBy = sortRef.current;
    const key = `${cat ?? 'all'}:${sortBy}:${c ? 'near' : 'any'}`;
    if (inFlight.current?.key === key) return inFlight.current.promise;
    const mine = ++seq.current;
    const promise: Promise<void> = (async () => {
      try {
        // Location is sent whenever we have it, so every sort comes back with distances.
        const res = await api.listDeals({
          ...(c ? { lat: c.lat, lng: c.lng } : {}),
          sort: sortBy,
          category: cat ?? undefined,
        });
        if (mine !== seq.current) return;
        setDeals(res.deals);
        setError(null);
      } catch (e) {
        if (mine === seq.current) setError(api.errorMessage(e));
      }
    })().finally(() => {
      if (inFlight.current?.promise === promise) inFlight.current = null;
    });
    inFlight.current = { key, promise };
    return promise;
  }, []);

  // Load as soon as we can, and again when the location, the category or the order changes.
  useEffect(() => {
    if (canLoad) void load();
  }, [canLoad, coords, category, sort, load]);

  // Refresh on focus and every 30 s.
  useFocusPoll(load);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), sleep(MIN_REFRESH_MS)]);
    setRefreshing(false);
  }, [load]);

  const retry = useCallback(() => {
    setError(null);
    setDeals(null);
    void load();
  }, [load]);

  const pickCategory = useCallback(
    (c: MerchantCategory | null) => {
      if (c === category) return;
      setDeals(null);
      setError(null);
      setCategory(c);
    },
    [category]
  );

  const pickSort = useCallback(
    (s: DealSort) => {
      if (s === sort) return;
      setDeals(null);
      setError(null);
      setPickedSort(s);
    },
    [sort]
  );

  const openDeal = useCallback((id: string) => router.push(`/deal/${encodeURIComponent(id)}`), []);
  const showList = useCallback(() => setMode('list'), []);

  // Stores that came without coordinates are placed from their address, but only the map needs that.
  const mapDeals = useGeocodedDeals(mode === 'map' ? deals : null);

  const showLocationLine = locationSettled && !coords;
  const initialLoading = deals === null && !error;
  const liveCount = deals?.filter((d) => !isSoldOut(d) && d.status === 'live').length ?? 0;
  const emptyBody = category ? `No ${categoryArt[category].label.toLowerCase()} deals at the moment. Try another category.` : EMPTY_COPY;

  if (mode === 'map') {
    const header = (
      <View style={[styles.mapHeader, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.mapTopRow} pointerEvents="box-none">
          <View style={styles.locationPill} accessibilityRole="text" accessibilityLabel="State College, Pennsylvania">
            <Ionicons name="location" size={16} color={colors.ember} />
            <Text maxFontSizeMultiplier={1.15} style={[font('bold'), styles.locationText]}>
              State College
            </Text>
          </View>
          <ModeSwitch mode={mode} onChange={setMode} floating />
        </View>
        <CategoryChips category={category} onPick={pickCategory} floating />
      </View>
    );
    return (
      <View style={styles.screen}>
        <DealsMap
          deals={mapDeals}
          coords={coords}
          now={now}
          onOpenDeal={openDeal}
          status={initialLoading ? 'loading' : deals === null ? 'error' : 'ready'}
          error={error}
          onRetry={retry}
          onShowList={showList}
          fitKey={category ?? 'all'}
          header={header}
          emptyBody={emptyBody}
        />
      </View>
    );
  }

  const subtitle =
    deals === null
      ? 'State College, PA'
      : liveCount === 0
        ? 'No deals right now'
        : `${liveCount} ${liveCount === 1 ? 'deal' : 'deals'} in State College`;

  const listHeader = (
    <View>
      <View style={[styles.titleBlock, { paddingTop: insets.top + 20 }]}>
        <ScreenTitle right={<ModeSwitch mode={mode} onChange={setMode} />} subtitle={subtitle}>
          Deals
        </ScreenTitle>
      </View>
      <CategoryChips category={category} onPick={pickCategory} />
      <View style={styles.sortRow}>
        <SortSwitch sort={sort} onPick={pickSort} nearestEnabled={!!coords} />
      </View>
      {api.USE_FIXTURES || showLocationLine ? (
        <View style={styles.metaRow}>
          {api.USE_FIXTURES ? <Pill label="Sample data" /> : null}
          {showLocationLine ? (
            <View style={styles.metaNote}>
              <Ionicons name="navigate-outline" size={14} color={colors.muted} />
              <T variant="small" style={{ flexShrink: 1 }}>
                Turn on location to sort by distance.
              </T>
            </View>
          ) : null}
        </View>
      ) : null}
      {deals ? <ErrorNote message={error} style={styles.refreshError} /> : null}
      {deals && deals.length > 0 ? (
        <T variant="eyebrow" style={styles.sectionLabel}>
          {SORT_HEADING[sort]}
        </T>
      ) : (
        <View style={styles.headerGap} />
      )}
    </View>
  );

  // Short states fill what is left under the header and sit a little above its middle.
  let empty: ReactElement;
  if (deals === null && !error) empty = <DealListSkeleton count={4} />;
  else if (deals === null) {
    empty = (
      <View style={styles.stage}>
        <EmptyState icon="cloud-offline-outline" title="Couldn’t load deals" body={error ?? undefined}>
          <Button label="Try again" variant="outline" icon="refresh" onPress={retry} style={styles.retry} />
        </EmptyState>
      </View>
    );
  } else {
    empty = (
      <View style={styles.stage}>
        <EmptyState icon="moon" title="No deals right now" body={emptyBody} />
      </View>
    );
  }

  return (
    <FadeIn style={styles.screen}>
      <FlatList
        style={styles.screen}
        contentContainerStyle={styles.list}
        data={deals ?? []}
        keyExtractor={(d) => d.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={Gap}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.inkSoft}
            colors={[colors.ember]}
            progressBackgroundColor={colors.card}
            progressViewOffset={insets.top}
          />
        }
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        renderItem={({ item }) => <DealCard deal={item} now={now} onPress={() => openDeal(item.id)} />}
      />
      {/* keeps cards from sliding under the clock and battery when the list scrolls */}
      <View pointerEvents="none" style={[styles.statusScrim, { height: insets.top }]} />
    </FadeIn>
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  // flexGrow lets a short state (empty, error) take the rest of the screen and sit in its middle
  list: { flexGrow: 1, paddingHorizontal: gutter, paddingBottom: 32 },
  gap: { height: 12 },
  titleBlock: { paddingBottom: 18 },
  sortRow: { marginTop: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  metaNote: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  refreshError: { marginTop: 14 },
  sectionLabel: { marginTop: 18, marginBottom: 12 },
  headerGap: { height: 18 },
  retry: { marginTop: 12, minWidth: 180 },
  stage: { flex: 1, paddingBottom: 48 },
  statusScrim: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.paper },
  mapHeader: { paddingHorizontal: gutter, gap: 10 },
  mapTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    ...shadowFloat,
    shadowOpacity: 0.12,
    elevation: 5,
  },
  locationText: { fontSize: 14, lineHeight: 20, color: colors.ink },
});
