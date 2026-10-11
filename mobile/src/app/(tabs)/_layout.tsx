import { Ionicons } from '@expo/vector-icons';
import Tabs from 'expo-router/js-tabs';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, IoniconName, tap } from '@/components/ui';
import { useNotifications } from '@/lib/notifications';
import { colors } from '@/lib/theme';

const ICONS: Record<string, [active: IoniconName, idle: IoniconName]> = {
  index: ['pricetag', 'pricetag-outline'],
  reservations: ['bag-handle', 'bag-handle-outline'],
  notifications: ['notifications', 'notifications-outline'],
  account: ['person', 'person-outline'],
};

export default function TabsLayout() {
  const { unread } = useNotifications();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      // A light tick when switching tabs.
      screenListeners={{ tabPress: () => tap('select') }}
      screenOptions={({ route }) => ({
        // Every tab draws its own title inside the safe area.
        headerShown: false,
        // A short cross-fade between tabs instead of an abrupt swap.
        animation: 'fade',
        // Never ride up above the keyboard.
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { ...font('semibold'), fontSize: 11, lineHeight: 15, letterSpacing: 0.1 },
        tabBarStyle: {
          backgroundColor: colors.paper,
          borderTopColor: colors.line,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
          shadowOpacity: 0,
          height: 58 + insets.bottom,
          paddingTop: 6,
        },
        tabBarIcon: ({ focused, color }) => {
          const pair = ICONS[route.name];
          return pair ? <Ionicons name={pair[focused ? 0 : 1]} size={23} color={color} /> : null;
        },
        sceneStyle: { backgroundColor: colors.paper },
      })}>
      <Tabs.Screen name="index" options={{ title: 'Deals' }} />
      <Tabs.Screen name="reservations" options={{ title: 'Pickups' }} />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarAccessibilityLabel: unread > 0 ? `Notifications, ${unread} unread` : 'Notifications',
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.ember, color: colors.white, ...font('semibold') },
        }}
      />
      <Tabs.Screen name="account" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
