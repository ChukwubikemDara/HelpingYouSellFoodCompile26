import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, type ReactNode } from 'react';
import { FlatList, NativeScrollEvent, NativeSyntheticEvent, StyleSheet, useWindowDimensions, View } from 'react-native';

import { DealCard } from '@/components/DealCard';
import { Button, T, tap } from '@/components/ui';
import type { Deal } from '@/lib/api';
import { colors, gutter, radius, shadowFloat } from '@/lib/theme';
import { DealCardSkeleton } from './Skeleton';

/** Height the cards take, used to keep the map's own controls clear of them. */
export const SHEET_CARD_H = 116;
/** Gap between the cards and the tab bar. */
export const SHEET_BOTTOM = 14;

const GAP = 12;
// Room around the cards inside the scroll view, so their shadows are not cut off at its edges.
const SHADOW_ROOM = 16;
// How much of the next card peeks in, which tells people they can swipe.
const PEEK = 28;

/**
 * The deals of the map as a row of cards you swipe through. The card in view is the selected deal:
 * `selectedIndex` scrolls to it, and swiping reports the new index through `onIndexChange`.
 */
export function DealCarousel({
  deals,
  selectedIndex,
  onIndexChange,
  now,
  onOpenDeal,
}: {
  deals: Deal[];
  selectedIndex: number;
  onIndexChange: (index: number) => void;
  now: number;
  onOpenDeal: (id: string) => void;
}) {
  const { width } = useWindowDimensions();
  const single = deals.length <= 1;
  const cardW = single ? width - gutter * 2 : width - gutter * 2 - PEEK;
  const step = cardW + GAP;
  const listRef = useRef<FlatList<Deal>>(null);
  // The index the list is showing right now, so we only scroll when the selection really moved.
  const shown = useRef(0);

  useEffect(() => {
    if (selectedIndex < 0 || selectedIndex >= deals.length || selectedIndex === shown.current) return;
    shown.current = selectedIndex;
    listRef.current?.scrollToOffset({ offset: selectedIndex * step, animated: true });
  }, [selectedIndex, step, deals.length]);

  const onSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(Math.max(Math.round(e.nativeEvent.contentOffset.x / step), 0), deals.length - 1);
    if (i === shown.current) return;
    shown.current = i;
    tap('select');
    onIndexChange(i);
  };

  return (
    <FlatList
      ref={listRef}
      data={deals}
      horizontal
      keyExtractor={(d) => d.id}
      showsHorizontalScrollIndicator={false}
      style={styles.list}
      contentContainerStyle={{
        paddingLeft: gutter,
        paddingRight: single ? gutter : gutter + PEEK,
        paddingVertical: SHADOW_ROOM,
      }}
      snapToInterval={step}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      onMomentumScrollEnd={onSettled}
      ItemSeparatorComponent={Gap}
      renderItem={({ item }) => (
        <DealCard compact deal={item} now={now} style={[styles.card, { width: cardW }]} onPress={() => onOpenDeal(item.id)} />
      )}
    />
  );
}

function Gap() {
  return <View style={{ width: GAP }} />;
}

/** A white card floating over the map, for loading, errors and empty states. */
export function SheetCard({ children }: { children: ReactNode }) {
  return <View style={[styles.sheet, styles.card]}>{children}</View>;
}

export function SheetLoading() {
  return (
    <View style={styles.sheetSlot}>
      <DealCardSkeleton compact style={styles.card} />
    </View>
  );
}

export function SheetMessage({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: 'moon' | 'cloud-offline-outline' | 'map-outline';
  title: string;
  body?: string | null;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sheetSlot}>
      <SheetCard>
        <View style={styles.messageRow}>
          <View style={styles.messageIcon}>
            <Ionicons name={icon} size={20} color={colors.inkSoft} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="heading">{title}</T>
            {body ? <T variant="small">{body}</T> : null}
          </View>
        </View>
        {actionLabel && onAction ? <Button label={actionLabel} variant="outline" onPress={onAction} /> : null}
      </SheetCard>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0, marginVertical: -SHADOW_ROOM },
  sheetSlot: { paddingHorizontal: gutter, paddingVertical: SHADOW_ROOM, marginVertical: -SHADOW_ROOM },
  sheet: { padding: 16, gap: 14, minHeight: SHEET_CARD_H },
  // Cards float over the map, so they carry a soft shadow on top of the hairline.
  card: {
    ...shadowFloat,
    shadowOpacity: 0.1,
    elevation: 5,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  messageIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
