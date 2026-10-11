import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

export const REFRESH_MS = 30000;

/**
 * Runs `fn` when the screen gains focus, when the app returns to the foreground while the
 * screen is focused, and every `intervalMs` while it stays focused.
 */
export function useFocusPoll(fn: () => unknown, intervalMs: number = REFRESH_MS) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useFocusEffect(
    useCallback(() => {
      void fnRef.current();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void fnRef.current();
      }, intervalMs);
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') void fnRef.current();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [intervalMs])
  );
}
