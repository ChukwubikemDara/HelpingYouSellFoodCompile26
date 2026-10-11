// Customer session: token in expo-secure-store (localStorage on web), sent as a
// bearer token by lib/api. The token does not expire (contract v0.6), so the session
// lasts until sign-out or until the API answers 401 UNAUTHORIZED to a request that carried it.

import * as SecureStore from 'expo-secure-store';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import * as api from './api';
import type { Customer } from './api';

const TOKEN_KEY = 'customer_token';
const CUSTOMER_KEY = 'customer_profile';

export type Session = { token: string; customer: Customer | null };

type AuthContextValue = {
  /** False until the stored session has been read at launch. */
  ready: boolean;
  session: Session | null;
  signIn: (phone: string, password: string) => Promise<void>;
  signUp: (name: string, phone: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads GET /customers/me (e.g. to learn about `blocked`). */
  refreshMe: () => Promise<void>;
  /** The API's CUSTOMER_BLOCKED message, once a reserve attempt returned it. */
  blockedMessage: string | null;
  setBlockedMessage: (m: string | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// expo-secure-store has no web implementation, so the web build keeps the session in
// localStorage. Private browsing or blocked storage can make it throw or be missing:
// then the session still works until the tab closes.
const IS_WEB = Platform.OS === 'web';

async function storeSet(key: string, value: string | null) {
  try {
    if (IS_WEB) {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } else if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Storage unavailable: the session still works until the app closes.
  }
}

async function storeGet(key: string): Promise<string | null> {
  try {
    if (IS_WEB) return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  // Current token, updated synchronously (state updates land a render later).
  const tokenRef = useRef<string | null>(null);

  const clear = useCallback(async () => {
    tokenRef.current = null;
    api.setAuthToken(null);
    setSession(null);
    setBlockedMessage(null);
    await storeSet(TOKEN_KEY, null);
    await storeSet(CUSTOMER_KEY, null);
  }, []);

  const save = useCallback(async (token: string, customer: Customer) => {
    tokenRef.current = token;
    api.setAuthToken(token);
    setSession({ token, customer });
    setBlockedMessage(null);
    await storeSet(TOKEN_KEY, token);
    await storeSet(CUSTOMER_KEY, JSON.stringify(customer));
  }, []);

  const refreshMe = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const customer = await api.getMe();
      if (tokenRef.current !== token) return; // signed out or switched meanwhile
      setSession({ token, customer });
      await storeSet(CUSTOMER_KEY, JSON.stringify(customer));
    } catch {
      // 401 is handled by the unauthorized handler; other errors keep the stored profile.
    }
  }, []);

  // A request that carried our token got 401 UNAUTHORIZED: the token is no longer valid.
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      void clear();
    });
    return () => api.setUnauthorizedHandler(null);
  }, [clear]);

  // Restore the session at launch.
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await storeGet(TOKEN_KEY);
      const raw = await storeGet(CUSTOMER_KEY);
      let customer: Customer | null = null;
      if (raw) {
        try {
          customer = JSON.parse(raw) as Customer;
        } catch {
          customer = null;
        }
      }
      if (!alive) return;
      if (token) {
        tokenRef.current = token;
        api.setAuthToken(token);
        setSession({ token, customer });
      }
      setReady(true);
      if (token) void refreshMe();
    })();
    return () => {
      alive = false;
    };
  }, [refreshMe]);

  const signIn = useCallback(
    async (phone: string, password: string) => {
      const res = await api.signIn({ phone, password });
      await save(res.token, res.customer);
    },
    [save]
  );

  const signUp = useCallback(
    async (name: string, phone: string, password: string) => {
      const res = await api.signUp({ name, phone, password });
      await save(res.token, res.customer);
    },
    [save]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      signIn,
      signUp,
      signOut: clear,
      refreshMe,
      blockedMessage,
      setBlockedMessage,
    }),
    [ready, session, signIn, signUp, clear, refreshMe, blockedMessage]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
