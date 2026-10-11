import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, View } from 'react-native';

import { DealCard } from '@/components/DealCard';
import { Button, EmptyState, T } from '@/components/ui';
import { colors, gutter } from '@/lib/theme';
import { DOWNTOWN_STATE_COLLEGE, type DealsMapProps } from './map/geo';
import { DealListSkeleton } from './map/Skeleton';

export { DOWNTOWN_STATE_COLLEGE };

// react-native-maps has no web support. In a browser the map tab shows the deals as a list.
export function DealsMap({ deals, now, onOpenDeal, status, error, onRetry, header, emptyBody }: DealsMapProps) {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      {header}
      <View style={styles.body}>
        <View style={styles.note}>
          <Ionicons name="map-outline" size={16} color={colors.muted} />
          <T variant="small">The map is available in the phone app.</T>
        </View>
        {status === 'loading' ? <DealListSkeleton count={3} /> : null}
        {status === 'error' ? (
          <View style={styles.state}>
            <T style={{ textAlign: 'center' }}>{error}</T>
            <Button label="Try again" variant="outline" icon="refresh" onPress={onRetry} />
          </View>
        ) : null}
        {status === 'ready' && deals && deals.length === 0 ? (
          <EmptyState icon="moon" title="No deals right now" body={emptyBody} />
        ) : null}
        {status === 'ready' && deals
          ? deals.map((d) => <DealCard key={d.id} deal={d} now={now} onPress={() => onOpenDeal(d.id)} />)
          : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.paper },
  content: { flexGrow: 1, paddingBottom: 32 },
  body: { paddingHorizontal: gutter, gap: 12, paddingTop: 12 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  state: { gap: 12, paddingVertical: 24 },
});
