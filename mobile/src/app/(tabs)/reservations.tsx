import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';

import {
  Notice,
  SignInPrompt,
  Stage,
  STATUS_LABEL,
  StatusView,
  TabHeader,
  TabPage,
  tidyError,
  usePullToRefresh,
} from '@/components/parts';
import { Button, ErrorNote, font, Pill, PillTone, PressableScale, T } from '@/components/ui';
import * as api from '@/lib/api';
import type { Reservation, ReservationStatus } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatCents, formatStamp, formatUntil } from '@/lib/format';
import { colors, gutter, radius } from '@/lib/theme';
import { useFocusPoll } from '@/lib/useFocusPoll';

const TONE: Record<ReservationStatus, PillTone> = {
  reserved: 'ember',
  picked_up: 'forest',
  cancelled: 'neutral',
  no_show: 'neutral',
};

type PickupSection = { key: 'open' | 'past'; title: string; data: Reservation[] };

function Row({ reservation: r, onPress }: { reservation: Reservation; onPress: () => void }) {
  const open = r.status === 'reserved';
  const when = open ? formatUntil(r.deal.pickup_end) : formatStamp(r.created_at);
  const meta = [open && when ? `Pick up ${when}` : when, formatCents(r.total_cents)].filter(Boolean).join(' · ');
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${r.quantity} ${r.deal.title} at ${r.deal.merchant.name}, ${STATUS_LABEL[r.status]}`}
      style={[styles.row, !open && styles.rowPast]}>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <T variant="eyebrow" numberOfLines={1} style={styles.rowStore}>
            {r.deal.merchant.name}
          </T>
          {!open ? <Pill label={STATUS_LABEL[r.status]} tone={TONE[r.status] ?? 'neutral'} /> : null}
        </View>
        <T variant="heading" numberOfLines={2} style={styles.rowTitle}>
          {r.quantity} × {r.deal.title}
        </T>
        <T variant="small" numberOfLines={2}>
          {meta}
        </T>
      </View>
      {open ? (
        <View style={styles.code}>
          <Text maxFontSizeMultiplier={1.2} style={[font('semibold'), styles.codeLabel]}>Code</Text>
          <Text maxFontSizeMultiplier={1.2} style={[font('mono'), styles.codeText]}>{r.pickup_code}</Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      )}
    </PressableScale>
  );
}

export default function ReservationsScreen() {
  const { session } = useAuth();
  const token = session?.token ?? null;
  const [list, setList] = useState<Reservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    if (loadedFor.current !== token) {
      loadedFor.current = token;
      setList(null);
    }
    try {
      const res = await api.listReservations();
      if (loadedFor.current !== token) return;
      setList(res.reservations);
      setError(null);
    } catch (e) {
      setError(tidyError(api.errorMessage(e)));
    }
  }, [token]);

  useFocusPoll(load);
  const refresh = usePullToRefresh(load);

  // What you still need to pick up first, then history newest first.
  const sections = useMemo<PickupSection[]>(() => {
    const newestFirst = (a: Reservation, b: Reservation) => Date.parse(b.created_at) - Date.parse(a.created_at);
    const all = list ?? [];
    const open = all.filter((r) => r.status === 'reserved').sort(newestFirst);
    const past = all.filter((r) => r.status !== 'reserved').sort(newestFirst);
    const out: PickupSection[] = [];
    if (open.length) out.push({ key: 'open', title: 'Ready to pick up', data: open });
    if (past.length) out.push({ key: 'past', title: 'History', data: past });
    return out;
  }, [list]);

  if (!session) {
    return (
      <TabPage title="Pickups">
        <SignInPrompt
          icon="bag-handle-outline"
          title="Sign in to see your pickups"
          message="Your reservations and pickup codes show up here."
        />
      </TabPage>
    );
  }

  if (list === null) {
    return (
      <TabPage title="Pickups">
        <StatusView
          loading={!error}
          error={error}
          onRetry={() => {
            setError(null);
            void load();
          }}
        />
      </TabPage>
    );
  }

  if (list.length === 0) {
    return (
      <TabPage title="Pickups" onRefresh={load}>
        <Stage>
          <Notice
            icon="bag-handle-outline"
            title="No pickups yet"
            body="Reserve a deal and your ticket shows up here with its pickup code.">
            <View style={styles.action}>
              <Button label="Browse deals" onPress={() => router.navigate('/')} />
            </View>
          </Notice>
          {error ? <ErrorNote message={error} style={styles.emptyError} /> : null}
        </Stage>
      </TabPage>
    );
  }

  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={styles.list}
      sections={sections}
      keyExtractor={(r) => r.id}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      refreshControl={refresh}
      ListHeaderComponent={
        <View>
          <TabHeader title="Pickups" />
          {error ? <ErrorNote message={error} style={styles.listError} /> : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <T variant="eyebrow" style={[styles.sectionLabel, section.key === 'past' && sections.length > 1 && styles.sectionGap]}>
          {section.title}
        </T>
      )}
      ItemSeparatorComponent={Gap}
      renderItem={({ item }) => (
        <Row reservation={item} onPress={() => router.push(`/reservation/${encodeURIComponent(item.id)}`)} />
      )}
    />
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { paddingHorizontal: gutter, paddingBottom: 32 },
  gap: { height: 10 },
  sectionLabel: { marginBottom: 10 },
  sectionGap: { marginTop: 26 },
  listError: { marginBottom: 14 },
  emptyError: { marginTop: 18, alignSelf: 'stretch' },
  action: { alignSelf: 'stretch', marginTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  rowPast: { backgroundColor: 'transparent' },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 17, lineHeight: 23 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  rowStore: { flex: 1 },
  code: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  codeLabel: { fontSize: 12, lineHeight: 16, color: colors.paper, opacity: 0.75 },
  codeText: { fontSize: 22, lineHeight: 28, letterSpacing: 1, color: colors.paper },
});
