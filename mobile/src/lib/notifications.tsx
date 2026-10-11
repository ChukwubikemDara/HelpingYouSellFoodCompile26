// In-app notifications, polled as the contract describes: on focus and every 30 s,
// with ?since=, raising a local notification (expo-notifications) for each item that
// was not there before. Remote push is not used.

import Constants, { ExecutionEnvironment } from 'expo-constants';
import type * as NotificationsModule from 'expo-notifications';
import { router } from 'expo-router';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import * as api from './api';
import type { AppNotification } from './api';
import { useAuth } from './auth';

export const POLL_MS = 30000;

let notificationsModule: typeof NotificationsModule | null | undefined;

// expo-notifications throws on import inside Expo Go on Android (remote push was removed there),
// which breaks every route that imports this file. Load it lazily and treat system notifications
// as unavailable there; the in-app list and unread count keep working.
function getNotifications(): typeof NotificationsModule | null {
  if (notificationsModule !== undefined) return notificationsModule;
  const expoGoAndroid = Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  if (expoGoAndroid) {
    notificationsModule = null;
    return null;
  }
  try {
    const mod = require('expo-notifications') as typeof NotificationsModule;
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        // On Android, false here also hides the heads-up banner.
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    notificationsModule = mod;
  } catch {
    notificationsModule = null;
  }
  return notificationsModule;
}

type Ctx = {
  items: AppNotification[];
  unread: number;
  /** True until the first fetch for this session finished. */
  loading: boolean;
  error: string | null;
  /** Full fetch (no since); also picks up read state changes. */
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
};

const NotificationsContext = createContext<Ctx | null>(null);

function newestCreatedAt(list: AppNotification[]): string | undefined {
  let best: string | undefined;
  let bestMs = -Infinity;
  for (const n of list) {
    const ms = Date.parse(n.created_at);
    if (!Number.isNaN(ms) && ms > bestMs) {
      bestMs = ms;
      best = n.created_at;
    }
  }
  return best;
}

function sortNewestFirst(list: AppNotification[]): AppNotification[] {
  return [...list].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

let permissionAsked = false;

async function ensurePermission(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Deals and reservations',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (permissionAsked || !current.canAskAgain) return false;
    permissionAsked = true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

async function raiseLocal(list: AppNotification[]) {
  if (list.length === 0) return;
  const Notifications = getNotifications();
  if (!Notifications) return;
  const allowed = await ensurePermission();
  if (!allowed) return;
  // Oldest first, so the newest ends up on top of the system list.
  for (const n of [...list].reverse()) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: n.title,
          body: n.body,
          data: { notification_id: n.id, deal_id: n.deal_id, reservation_id: n.reservation_id },
        },
        trigger: null,
      });
    } catch {
      // Showing the system notification is best effort; the in-app list has the item.
    }
  }
}

export function openNotificationTarget(n: { deal_id: string | null; reservation_id: string | null }) {
  if (n.reservation_id) router.push(`/reservation/${encodeURIComponent(n.reservation_id)}`);
  else if (n.deal_id) router.push(`/deal/${encodeURIComponent(n.deal_id)}`);
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const token = session?.token ?? null;

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-session polling state. `seen` holds every id already shown; the first fetch is the
  // baseline and raises nothing, so opening the app does not replay old notifications.
  const state = useRef({ token: null as string | null, baselineDone: false, seen: new Set<string>(), since: undefined as string | undefined, busy: false });

  const absorb = useCallback((fetched: AppNotification[], replace: boolean) => {
    const s = state.current;
    const fresh = fetched.filter((n) => !s.seen.has(n.id));
    fetched.forEach((n) => s.seen.add(n.id));
    const newest = newestCreatedAt(fetched);
    if (newest && (!s.since || Date.parse(newest) > Date.parse(s.since))) s.since = newest;
    setItems((prev) => {
      if (replace) return sortNewestFirst(fetched);
      const byId = new Map(prev.map((n) => [n.id, n]));
      fetched.forEach((n) => byId.set(n.id, n));
      return sortNewestFirst([...byId.values()]);
    });
    if (s.baselineDone) void raiseLocal(fresh);
    s.baselineDone = true;
  }, []);

  const fetchFull = useCallback(async () => {
    const forToken = state.current.token;
    if (!forToken) return;
    try {
      const res = await api.listNotifications();
      if (state.current.token !== forToken) return;
      absorb(res.notifications, true);
      setError(null);
    } catch (e) {
      if (state.current.token === forToken) setError(api.errorMessage(e));
    } finally {
      if (state.current.token === forToken) setLoading(false);
    }
  }, [absorb]);

  const poll = useCallback(async () => {
    const s = state.current;
    if (!s.token || s.busy) return;
    s.busy = true;
    try {
      if (!s.baselineDone || !s.since) {
        await fetchFull();
        return;
      }
      const forToken = s.token;
      const res = await api.listNotifications(s.since);
      if (state.current.token !== forToken) return;
      absorb(res.notifications, false);
      setError(null);
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      s.busy = false;
    }
  }, [absorb, fetchFull]);

  // Reset on sign-in / sign-out, then poll every 30 s and whenever the app comes to the foreground.
  useEffect(() => {
    state.current = { token, baselineDone: false, seen: new Set(), since: undefined, busy: false };
    setItems([]);
    setError(null);
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void ensurePermission();
    void poll();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void poll();
    }, POLL_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void poll();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [token, poll]);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await api.markNotificationRead(id);
    } catch (e) {
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
      throw e;
    }
  }, []);

  // Tapping a system notification opens what it is about.
  useEffect(() => {
    const Notifications = getNotifications();
    if (!Notifications) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { notification_id?: string; deal_id?: string | null; reservation_id?: string | null }
        | undefined;
      if (!data) return;
      if (data.notification_id && state.current.token) void markRead(data.notification_id).catch(() => {});
      openNotificationTarget({ deal_id: data.deal_id ?? null, reservation_id: data.reservation_id ?? null });
    });
    return () => sub.remove();
  }, [markRead]);

  const value = useMemo<Ctx>(
    () => ({
      items,
      unread: items.filter((n) => !n.read).length,
      loading,
      error,
      refresh: fetchFull,
      markRead,
    }),
    [items, loading, error, fetchFull, markRead]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): Ctx {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}
