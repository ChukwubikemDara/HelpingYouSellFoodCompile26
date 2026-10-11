import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import {
  Notice,
  SignInPrompt,
  Stage,
  StatusView,
  TabHeader,
  TabPage,
  tidyError,
  usePullToRefresh,
} from '@/components/parts';
import { ErrorNote, font, IoniconName, Pill, PressableScale, T } from '@/components/ui';
import * as api from '@/lib/api';
import type { AppNotification, NotificationType } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatStamp } from '@/lib/format';
import { openNotificationTarget, useNotifications } from '@/lib/notifications';
import { colors, gutter, radius } from '@/lib/theme';

const ICON: Record<NotificationType, IoniconName> = {
  new_deal: 'pricetag',
  deal_cancelled: 'close-circle',
  pickup_reminder: 'alarm',
};

function Row({ n, onPress }: { n: AppNotification; onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: !n.read }}
      accessibilityHint={n.read ? undefined : 'Unread. Opens it and marks it read.'}
      onPress={onPress}
      style={[styles.row, n.read ? styles.rowRead : styles.rowUnread]}>
      <View style={[styles.icon, n.read && styles.iconRead]}>
        <Ionicons name={ICON[n.type] ?? 'notifications'} size={18} color={n.read ? colors.muted : colors.ember} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <T
            variant="heading"
            numberOfLines={2}
            style={[n.read ? font('medium') : font('semibold'), styles.title, n.read && { color: colors.inkSoft }]}>
            {n.title}
          </T>
          {!n.read ? <View style={styles.dot} accessibilityElementsHidden /> : null}
        </View>
        <T style={n.read ? styles.bodyRead : undefined}>{n.body}</T>
        <T variant="small" style={styles.stamp}>
          {formatStamp(n.created_at)}
        </T>
      </View>
    </PressableScale>
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

export default function NotificationsScreen() {
  const { session } = useAuth();
  const { items, unread, loading, error: rawError, refresh, markRead } = useNotifications();
  const error = tidyError(rawError);
  const [actionError, setActionError] = useState<string | null>(null);
  const signedIn = !!session;
  const pullToRefresh = usePullToRefresh(refresh);

  // Fetch on focus; the provider also polls every 30 s.
  useFocusEffect(
    useCallback(() => {
      if (signedIn) void refresh();
    }, [signedIn, refresh])
  );

  const open = useCallback(
    async (n: AppNotification) => {
      setActionError(null);
      if (!n.read) {
        try {
          await markRead(n.id);
        } catch (e) {
          setActionError(api.errorMessage(e));
        }
      }
      openNotificationTarget(n);
    },
    [markRead]
  );

  if (!session) {
    return (
      <TabPage title="Alerts">
        <SignInPrompt
          icon="notifications-outline"
          title="Hear about new deals"
          message="Sign in to get notifications when stores you follow list a deal."
        />
      </TabPage>
    );
  }

  if ((loading || error) && items.length === 0) {
    return (
      <TabPage title="Alerts">
        <StatusView loading={loading} error={loading ? null : error} onRetry={() => void refresh()} />
      </TabPage>
    );
  }

  if (items.length === 0) {
    return (
      <TabPage title="Alerts" onRefresh={refresh}>
        <Stage>
          <Notice
            icon="notifications-outline"
            title="No alerts yet"
            body="Follow a store on its deal page to hear when it lists something new."
          />
        </Stage>
      </TabPage>
    );
  }

  const shownError = actionError ?? error;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(n) => n.id}
      showsVerticalScrollIndicator={false}
      refreshControl={pullToRefresh}
      ItemSeparatorComponent={Gap}
      ListHeaderComponent={
        <View>
          <TabHeader
            title="Alerts"
            subtitle={unread === 0 ? 'You’re all caught up' : undefined}
            right={unread > 0 ? <Pill tone="ember" label={`${unread} unread`} /> : null}
          />
          {shownError ? <ErrorNote message={shownError} style={styles.listError} /> : null}
        </View>
      }
      renderItem={({ item }) => <Row n={item} onPress={() => void open(item)} />}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { paddingHorizontal: gutter, paddingBottom: 32 },
  gap: { height: 10 },
  listError: { marginBottom: 14 },
  row: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowUnread: { backgroundColor: colors.card },
  rowRead: { backgroundColor: 'transparent' },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.emberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconRead: { backgroundColor: colors.neutralSoft },
  body: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ember },
  bodyRead: { color: colors.muted },
  stamp: { marginTop: 2 },
});
