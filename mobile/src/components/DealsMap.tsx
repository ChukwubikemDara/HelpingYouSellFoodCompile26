import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, UrlTile } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, PressableScale, T, tap } from '@/components/ui';
import type { Deal } from '@/lib/api';
import { colors, gutter, radius, shadowFloat } from '@/lib/theme';
import { DealCarousel, SHEET_BOTTOM, SHEET_CARD_H, SheetLoading, SheetMessage } from './map/DealCarousel';
import {
  centerFor,
  DOWNTOWN_STATE_COLLEGE,
  framePoints,
  groupStores,
  regionFor,
  type DealsMapProps,
  type Region,
  type Viewport,
} from './map/geo';
import { FALLBACK_ATTRIBUTION, FALLBACK_TILE_URL, MAP_PAPER, MUTED_MAP_STYLE } from './map/mapStyle';
import { FadeIn } from './map/FadeIn';
import { StoreMarker } from './map/PriceMarker';

export { DOWNTOWN_STATE_COLLEGE };

const ANDROID = Platform.OS === 'android';

/** Camera moves can throw while the map is mounting or going away; a missed move is harmless. */
function moveCamera(map: MapView | null, fn: (m: MapView) => void) {
  if (!map) return;
  try {
    fn(map);
  } catch {
    // ignore
  }
}

/**
 * The deals on a full-bleed, muted map: each store is a small price pill, the deals of the
 * selected store are cards you swipe through at the bottom, and the controls float on top.
 *
 * Google Maps on Android (styled with MUTED_MAP_STYLE) and Apple Maps on iOS (mutedStandard); both
 * come with Expo Go, so no API key is needed.
 */
export function DealsMap({
  deals,
  coords,
  now,
  onOpenDeal,
  status,
  error,
  onRetry,
  onShowList,
  fitKey,
  header,
  emptyBody,
}: DealsMapProps) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const regionRef = useRef<Region | null>(null);

  const [size, setSize] = useState({ width: window.width, height: Math.max(window.height - 140, 400) });
  // Until the header reports its real height: status bar, 8 of air, the 42px control row, 10, the 36px chips.
  const [headerH, setHeaderH] = useState(insets.top + 96);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  // Android draws the light CARTO base map from the start: Google tiles are unreliable in Expo Go,
  // and the light style reads cleaner under the price pins.
  const [backupTiles, setBackupTiles] = useState(ANDROID);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { stores, located, missing } = useMemo(() => groupStores(deals ?? []), [deals]);
  const selectedIndex = Math.max(
    0,
    located.findIndex((d) => d.id === selectedId)
  );
  const selected: Deal | undefined = located[selectedIndex];
  const selectedStoreId = selected?.merchant_id ?? null;

  // What the floating header and the card carousel cover, so the map frames things in the clear part.
  const vp = useMemo<Viewport>(
    () => ({
      width: size.width,
      height: size.height,
      padTop: headerH + 8,
      padBottom: SHEET_CARD_H + SHEET_BOTTOM + 28,
      padX: 56,
      padded: ANDROID,
    }),
    [size.width, size.height, headerH]
  );
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const locatedRef = useRef(located);
  locatedRef.current = located;
  const selectedStoreRef = useRef(selectedStoreId);
  selectedStoreRef.current = selectedStoreId;

  const [initialRegion] = useState<Region>(() => regionFor(framePoints(stores, coords), vp));

  // Frame the stores once the map and the deals are both there, and again when the category changes.
  const needFit = useRef(true);
  const lastStore = useRef<string | null>(null);
  useEffect(() => {
    needFit.current = true;
  }, [fitKey]);
  useEffect(() => {
    if (!ready || deals === null || !needFit.current) return;
    needFit.current = false;
    const r = regionFor(framePoints(stores, coords), vpRef.current);
    regionRef.current = r;
    // Framing already shows the selected store, so the pan below must not fight it.
    lastStore.current = selectedStoreRef.current;
    moveCamera(mapRef.current, (m) => m.animateToRegion(r, 450));
  }, [ready, deals, stores, coords]);

  // Glide to the store of the card in view (only keeps the zoom the person chose).
  useEffect(() => {
    if (!ready || selectedStoreId === null) return;
    if (lastStore.current === null) {
      lastStore.current = selectedStoreId;
      return;
    }
    if (lastStore.current === selectedStoreId) return;
    lastStore.current = selectedStoreId;
    const store = stores.find((s) => s.id === selectedStoreId);
    if (!store) return;
    const delta = regionRef.current?.latitudeDelta ?? initialRegion.latitudeDelta;
    const center = centerFor(store.place, delta, vpRef.current);
    moveCamera(mapRef.current, (m) => m.animateCamera({ center }, { duration: 380 }));
  }, [selectedStoreId, ready, stores, initialRegion]);

  // If the map never reports ready, say so instead of leaving an empty page. The cards still work.
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setMapFailed(true), 9000);
    return () => clearTimeout(t);
  }, [ready]);

  // Android: if Google's tiles have not drawn after a few seconds, lay a backup base map over them.
  useEffect(() => {
    if (!ANDROID || !ready || loaded || backupTiles) return;
    const t = setTimeout(() => setBackupTiles(true), 7000);
    return () => clearTimeout(t);
  }, [ready, loaded, backupTiles]);

  const onSelectStore = useCallback((storeId: string) => {
    if (selectedStoreRef.current === storeId) return;
    const first = locatedRef.current.find((d) => d.merchant_id === storeId);
    if (!first) return;
    tap('select');
    setSelectedId(first.id);
  }, []);

  const recenter = () => {
    tap('light');
    const target = coords ? { latitude: coords.lat, longitude: coords.lng } : DOWNTOWN_STATE_COLLEGE;
    const r = regionFor([target], vpRef.current);
    regionRef.current = r;
    moveCamera(mapRef.current, (m) => m.animateToRegion(r, 450));
  };

  let note: { text: string; action?: () => void } | null = null;
  if (mapFailed && !ready) note = { text: 'The map could not load. Your deals are below.' };
  else if (status === 'ready' && error) note = { text: error };
  else if (status === 'ready' && located.length > 0 && missing > 0) {
    note = {
      text: `${missing} ${missing === 1 ? 'deal is' : 'deals are'} not on the map. See the list`,
      action: onShowList,
    };
  }

  let sheet: ReactNode;
  let sheetKind: string;
  if (status === 'loading') {
    sheetKind = 'loading';
    sheet = <SheetLoading />;
  } else if (status === 'error') {
    sheetKind = 'error';
    sheet = (
      <SheetMessage
        icon="cloud-offline-outline"
        title="Couldn’t load deals"
        body={error}
        actionLabel="Try again"
        onAction={onRetry}
      />
    );
  } else if (deals && deals.length === 0) {
    sheetKind = 'empty';
    sheet = <SheetMessage icon="moon" title="No deals right now" body={emptyBody} />;
  } else if (located.length === 0) {
    sheetKind = 'nomap';
    sheet = (
      <SheetMessage
        icon="map-outline"
        title="Not on the map yet"
        body="These deals have no map location. They are in the list."
        actionLabel="See the list"
        onAction={onShowList}
      />
    );
  } else {
    sheetKind = 'cards';
    sheet = (
      <DealCarousel
        deals={located}
        selectedIndex={selectedIndex}
        onIndexChange={(i) => setSelectedId(located[i]?.id ?? null)}
        now={now}
        onOpenDeal={onOpenDeal}
      />
    );
  }

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) => (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1 ? prev : { width, height }));
      }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        accessibilityLabel="Map of deals near you"
        provider={ANDROID ? PROVIDER_GOOGLE : undefined}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        customMapStyle={ANDROID ? MUTED_MAP_STYLE : undefined}
        userInterfaceStyle="light"
        initialRegion={initialRegion}
        mapPadding={ANDROID ? { top: vp.padTop, bottom: vp.padBottom, left: 0, right: 0 } : undefined}
        minZoomLevel={10}
        maxZoomLevel={19}
        showsUserLocation={!!coords}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        showsBuildings={false}
        showsTraffic={false}
        showsCompass={false}
        showsScale={false}
        showsIndoors={false}
        toolbarEnabled={false}
        zoomControlEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        moveOnMarkerPress={false}
        onMapReady={() => setReady(true)}
        onMapLoaded={() => setLoaded(true)}
        onRegionChangeComplete={(r) => {
          regionRef.current = r;
        }}>
        {backupTiles ? <UrlTile urlTemplate={FALLBACK_TILE_URL} maximumZ={19} zIndex={1} tileSize={256} shouldReplaceMapContent /> : null}
        {stores.map((s) => (
          <StoreMarker key={s.id} store={s} selected={s.id === selectedStoreId} onSelect={onSelectStore} />
        ))}
      </MapView>

      <View
        style={styles.top}
        pointerEvents="box-none"
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setHeaderH((prev) => (Math.abs(prev - h) < 3 ? prev : h));
        }}>
        <FadeIn rise={false} pointerEvents="box-none">
          {header}
        </FadeIn>
      </View>

      {note ? (
        <View style={[styles.noteWrap, { top: headerH + 6 }]} pointerEvents="box-none">
          {note.action ? (
            <PressableScale onPress={note.action} accessibilityRole="button" accessibilityLabel={note.text} style={styles.note}>
              <Text maxFontSizeMultiplier={1.2} style={[font('medium'), styles.noteText]} numberOfLines={2}>
                {note.text}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.muted} />
            </PressableScale>
          ) : (
            <View style={styles.note} accessibilityRole="alert">
              <Text maxFontSizeMultiplier={1.2} style={[font('medium'), styles.noteText]} numberOfLines={2}>
                {note.text}
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {backupTiles ? (
        <View style={styles.attribution} pointerEvents="none">
          <T variant="small" style={styles.attributionText}>
            {FALLBACK_ATTRIBUTION}
          </T>
        </View>
      ) : null}

      <View style={styles.bottom} pointerEvents="box-none">
        <View style={styles.fabRow} pointerEvents="box-none">
          <PressableScale
            onPress={recenter}
            scaleTo={0.92}
            accessibilityRole="button"
            accessibilityLabel={coords ? 'Center the map on my location' : 'Center the map on downtown State College'}
            style={styles.fab}>
            <Ionicons name={coords ? 'locate' : 'navigate-outline'} size={21} color={colors.ink} />
          </PressableScale>
        </View>
        <FadeIn key={sheetKind} rise={false} pointerEvents="box-none">
          {sheet}
        </FadeIn>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MAP_PAPER },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  noteWrap: { position: 'absolute', left: gutter, right: gutter, alignItems: 'center' },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...shadowFloat,
    shadowOpacity: 0.1,
    elevation: 4,
  },
  noteText: { fontSize: 13, lineHeight: 18, color: colors.inkSoft, flexShrink: 1 },
  attribution: { position: 'absolute', right: gutter + 56, bottom: SHEET_BOTTOM + SHEET_CARD_H + 26 },
  attributionText: { fontSize: 10, lineHeight: 14 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: SHEET_BOTTOM },
  // The carousel brings 16px of room around its cards for their shadows, so this sits 12px above them.
  fabRow: { alignItems: 'flex-end', paddingHorizontal: gutter, marginBottom: -4 },
  fab: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadowFloat,
    shadowOpacity: 0.12,
    elevation: 5,
  },
});
