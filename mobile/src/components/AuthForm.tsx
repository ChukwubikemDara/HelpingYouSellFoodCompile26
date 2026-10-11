import { router, useLocalSearchParams } from 'expo-router';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  LayoutAnimation,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ErrorNote, Field, goBackOr, IconButton, T, tap } from '@/components/ui';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toE164 } from '@/lib/format';
import { colors } from '@/lib/theme';

const MIN_PASSWORD = 8;

/** Room kept between the focused field and the keyboard, for the hint, error and button under it. */
const ROOM_ABOVE_KEYBOARD = 120;

/** "8145550123" typed in any shape -> "(814) 555-0123" as the person types. */
function formatTyping(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

type FieldErrors = { name?: string; phone?: string; password?: string };

/**
 * Sign in and sign up share one form and switch in place, so the typed phone number survives.
 * After success the app continues where the user was.
 */
export function AuthForm({ mode: initialMode }: { mode: 'signin' | 'signup' }) {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { signIn, signUp } = useAuth();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // The form hangs from a fixed gap under the header, so it never shifts when an error or hint appears.
  // Short phones (under 720pt) keep a small gap so the create-account button stays above the fold.
  const topGap = windowHeight < 720 ? 24 : Math.round(Math.min(140, windowHeight * 0.13));

  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const nameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const focusedRef = useRef<TextInput | null>(null);
  const keyboardTop = useRef<number | null>(null);

  const isSignUp = mode === 'signup';

  // ---------- Keep the focused field above the keyboard ----------

  const ensureVisible = useCallback(() => {
    const input = focusedRef.current;
    const top = keyboardTop.current;
    if (!input || top === null) return;
    input.measureInWindow((_x, y, _w, h) => {
      const limit = top - ROOM_ABOVE_KEYBOARD;
      const floor = insets.top + 72; // below the header
      if (y + h > limit) {
        scrollRef.current?.scrollTo({ y: scrollY.current + (y + h - limit), animated: true });
      } else if (y < floor) {
        scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current - (floor - y)), animated: true });
      }
    });
  }, [insets.top]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e: KeyboardEvent) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(ensureVisible, 120);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [ensureVisible]);

  const onFocusField = (ref: RefObject<TextInput | null>) => () => {
    focusedRef.current = ref.current;
    // Moving between fields keeps the keyboard up, so no keyboard event follows.
    if (keyboardTop.current !== null) setTimeout(ensureVisible, 60);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  };

  // ---------- Actions ----------

  const continueAfterAuth = () => {
    const target = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null;
    if (target) router.replace(target as never);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const clearErrors = () => {
    setError(null);
    setErrorCode(null);
    setFieldErrors({});
  };

  const submit = async () => {
    if (busy) return;
    clearErrors();
    const trimmedName = name.trim();
    const e164 = toE164(phone);

    const problems: FieldErrors = {};
    if (isSignUp && !trimmedName) problems.name = 'Enter your name.';
    if (!e164) problems.phone = 'Enter a 10-digit US phone number.';
    if (password.length < MIN_PASSWORD) problems.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (problems.name || problems.phone || problems.password) {
      setFieldErrors(problems);
      const first = problems.name ? nameRef : problems.phone ? phoneRef : passwordRef;
      first.current?.focus();
      return;
    }

    Keyboard.dismiss();
    setBusy(true);
    try {
      if (isSignUp) await signUp(trimmedName, e164 as string, password);
      else await signIn(e164 as string, password);
      tap('success');
      continueAfterAuth();
    } catch (e) {
      setError(api.errorMessage(e));
      setErrorCode(e instanceof api.ApiError ? e.code : null);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (to: 'signin' | 'signup') => {
    if (busy || to === mode) return;
    LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
    clearErrors();
    setMode(to);
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <IconButton icon="close" label="Close" onPress={() => goBackOr('/')} />
        <T variant="heading" style={styles.wordmark}>
          Last Call<Text style={{ color: colors.ember }}>.</Text>
        </T>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingTop: topGap, paddingBottom: insets.bottom + 20 + (keyboardHeight > 0 ? 96 : 0) },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        <View style={styles.main}>
          <View style={{ gap: 10 }}>
            <T variant="display">{isSignUp ? 'Create an account' : 'Welcome back'}</T>
            <T variant="body" style={{ color: colors.muted }}>
              {isSignUp
                ? 'Your name and phone go on your pickup ticket, so the store knows who is collecting.'
                : 'Use the phone number and password you signed up with.'}
            </T>
          </View>

          <View style={{ gap: 16 }}>
            {isSignUp ? (
              <Field
                label="Name"
                inputRef={nameRef}
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }));
                }}
                error={fieldErrors.name}
                placeholder="Sam"
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
                onSubmitEditing={() => phoneRef.current?.focus()}
                onFocus={onFocusField(nameRef)}
                editable={!busy}
              />
            ) : null}
            <Field
              label="Phone"
              inputRef={phoneRef}
              error={fieldErrors.phone}
              value={phone}
              onChangeText={(v) => {
                setPhone(formatTyping(v));
                if (fieldErrors.phone) setFieldErrors((f) => ({ ...f, phone: undefined }));
              }}
              placeholder="(814) 555-0123"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              onFocus={onFocusField(phoneRef)}
              editable={!busy}
            />
            <Field
              label="Password"
              inputRef={passwordRef}
              hint={isSignUp && !fieldErrors.password ? `At least ${MIN_PASSWORD} characters` : undefined}
              error={fieldErrors.password}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
              }}
              placeholder={isSignUp ? 'Create a password' : 'Your password'}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              onFocus={onFocusField(passwordRef)}
              editable={!busy}
            />
          </View>

          <View style={{ gap: 12 }}>
            <ErrorNote message={error} />
            {errorCode === 'ACCOUNT_EXISTS' ? (
              <Button label="Sign in instead" variant="outline" onPress={() => switchMode('signin')} />
            ) : null}
            <Button
              label={isSignUp ? 'Create account' : 'Sign in'}
              icon="arrow-forward"
              onPress={() => void submit()}
              busy={busy}
            />
            <View style={styles.switchRow}>
              <T variant="small">{isSignUp ? 'Already have an account?' : 'New to Last Call?'}</T>
              <Button
                label={isSignUp ? 'Sign in' : 'Create an account'}
                variant="link"
                onPress={() => switchMode(isSignUp ? 'signin' : 'signup')}
                disabled={busy}
              />
            </View>
          </View>
        </View>

        <View style={styles.spacerBottom} />

        <T variant="small" style={styles.footnote}>
          You pay in store when you pick up, never in the app.
        </T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.paper,
    zIndex: 1,
  },
  headerSpacer: { width: 40 },
  wordmark: { flex: 1, textAlign: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  spacerBottom: { flex: 1, minHeight: 28 },
  main: { gap: 28 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, flexWrap: 'wrap' },
  footnote: { textAlign: 'center' },
});
