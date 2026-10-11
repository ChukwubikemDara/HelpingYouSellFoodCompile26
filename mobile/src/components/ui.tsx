import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ComponentProps, ReactNode, Ref, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, FontName, fonts, gutter, radius, shadow, space, touchMin } from '@/lib/theme';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];
export type MciName = ComponentProps<typeof MaterialCommunityIcons>['name'];

let fontsAvailable = false;

/** Set once by the root layout; falls back to the system font when the custom fonts did not load. */
export function setFontsAvailable(v: boolean) {
  fontsAvailable = v;
}

// includeFontPadding: false drops Android's extra top/bottom font padding so text sits where the
// lineHeight says it does. Together with line heights of at least ~1.25x nothing clips.
const FALLBACK: Record<FontName, TextStyle> = {
  display: { fontWeight: '600', includeFontPadding: false },
  displayItalic: { fontWeight: '600', includeFontPadding: false },
  body: { fontWeight: '400', includeFontPadding: false },
  medium: { fontWeight: '500', includeFontPadding: false },
  semibold: { fontWeight: '600', includeFontPadding: false },
  bold: { fontWeight: '600', includeFontPadding: false },
  mono: { fontWeight: '500', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), includeFontPadding: false },
};

/** The font as a style. Evaluated at render time so the system-font fallback applies. */
export function font(name: FontName): TextStyle {
  return fontsAvailable ? { fontFamily: fonts[name], includeFontPadding: false } : FALLBACK[name];
}

// ---------- Feedback ----------

/** A short, quiet haptic. Never throws, does nothing on web. */
export function tap(kind: 'light' | 'select' | 'success' = 'light') {
  if (Platform.OS === 'web') return;
  try {
    if (kind === 'select') void Haptics.selectionAsync().catch(() => {});
    else if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // Haptics are a nicety; ignore any failure.
  }
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Scale while pressed. 1 disables the scale. */
  scaleTo?: number;
  /** Opacity while pressed. */
  pressedOpacity?: number;
};

/** Pressable that eases down a touch while pressed. Use it for cards and tappable rows. */
export function PressableScale({
  style,
  children,
  scaleTo = 0.975,
  pressedOpacity = 1,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const [down, setDown] = useState(false);
  const animate = (to: number) =>
    Animated.spring(scale, { toValue: to, speed: 60, bounciness: 0, useNativeDriver: Platform.OS !== 'web' }).start();
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        if (!disabled) {
          setDown(true);
          animate(scaleTo);
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setDown(false);
        animate(1);
        onPressOut?.(e);
      }}
      style={[style, down && pressedOpacity !== 1 ? { opacity: pressedOpacity } : null, { transform: [{ scale }] }]}>
      {children}
    </AnimatedPressable>
  );
}

// ---------- Text ----------

// Sizes are paired with line heights of at least 1.25x so descenders never clip on Android.
const VARIANTS = {
  hero: { font: 'display', style: { fontSize: 38, lineHeight: 47, letterSpacing: -1, color: colors.ink } },
  display: { font: 'display', style: { fontSize: 30, lineHeight: 38, letterSpacing: -0.7, color: colors.ink } },
  title: { font: 'display', style: { fontSize: 22, lineHeight: 29, letterSpacing: -0.35, color: colors.ink } },
  heading: { font: 'bold', style: { fontSize: 16, lineHeight: 22, letterSpacing: -0.1, color: colors.ink } },
  lead: { font: 'body', style: { fontSize: 17, lineHeight: 26, color: colors.inkSoft } },
  body: { font: 'body', style: { fontSize: 15, lineHeight: 22, color: colors.inkSoft } },
  small: { font: 'body', style: { fontSize: 13, lineHeight: 19, color: colors.muted } },
  label: { font: 'medium', style: { fontSize: 13, lineHeight: 18, color: colors.inkSoft } },
  // small quiet label in sentence case: store names, section labels
  eyebrow: { font: 'semibold', style: { fontSize: 13, lineHeight: 18, color: colors.muted } },
} satisfies Record<string, { font: FontName; style: TextStyle }>;

export type Variant = keyof typeof VARIANTS;

/** Every piece of text goes through this so the fonts stay consistent. */
export function T({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  const v = VARIANTS[variant];
  return <Text maxFontSizeMultiplier={1.25} {...props} style={[font(v.font), v.style, style]} />;
}

// ---------- Buttons ----------

type ButtonVariant = 'primary' | 'dark' | 'outline' | 'ghostDanger' | 'link';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IoniconName;
  disabled?: boolean;
  /** Request in flight: the button is disabled and shows a spinner. */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'primary', icon, disabled, busy, style, accessibilityHint }: ButtonProps) {
  const inactive = !!disabled || !!busy;
  if (variant === 'link') {
    return (
      <PressableScale
        onPress={onPress}
        disabled={inactive}
        scaleTo={0.97}
        pressedOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        hitSlop={8}
        style={[styles.link, inactive && { opacity: 0.4 }, style]}>
        <T variant="heading" style={{ color: colors.ember, fontSize: 15 }}>
          {label}
        </T>
      </PressableScale>
    );
  }
  const v = variant;
  const fg = v === 'outline' ? colors.ink : v === 'ghostDanger' ? colors.ember : colors.white;
  return (
    <PressableScale
      onPress={() => {
        if (v === 'primary' || v === 'dark') tap('light');
        onPress();
      }}
      disabled={inactive}
      scaleTo={0.97}
      pressedOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: !!busy }}
      accessibilityHint={accessibilityHint}
      style={[
        styles.button,
        v === 'primary' && { backgroundColor: colors.ember },
        v === 'dark' && { backgroundColor: colors.ink },
        v === 'outline' && styles.outline,
        inactive && { opacity: busy ? 0.7 : 0.45 },
        style,
      ]}>
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text maxFontSizeMultiplier={1.2} style={[font('bold'), styles.buttonText, { color: fg }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** Round icon button: back, close. */
export function IconButton({
  icon,
  label,
  onPress,
  style,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      style={[styles.iconButton, style]}>
      <Ionicons name={icon} size={21} color={colors.ink} />
    </PressableScale>
  );
}

export function goBackOr(fallback: string) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}

/** Top of a stack screen: round back button and an optional title, inside the safe area. */
export function TopBar({ title, icon = 'chevron-back', onBack }: { title?: string; icon?: IoniconName; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
      <IconButton icon={icon} label={icon === 'close' ? 'Close' : 'Back'} onPress={onBack ?? (() => goBackOr('/'))} />
      {title ? (
        <T variant="heading" numberOfLines={1} style={styles.topBarTitle}>
          {title}
        </T>
      ) : null}
    </View>
  );
}

/** Large calm title at the top of a tab screen, with an optional quiet subtitle. */
export function ScreenTitle({ children, right, subtitle }: { children: ReactNode; right?: ReactNode; subtitle?: string }) {
  return (
    <View style={styles.screenTitle}>
      <View style={{ flex: 1, gap: 4 }}>
        <T variant="display">{children}</T>
        {subtitle ? <T variant="small">{subtitle}</T> : null}
      </View>
      {right}
    </View>
  );
}

// ---------- Inputs ----------

type FieldProps = TextInputProps & {
  label: string;
  hint?: string;
  /** Shown under the field in place of the hint; also tints the border. */
  error?: string | null;
  inputRef?: Ref<TextInput>;
};

export function Field({ label, hint, error, inputRef, onFocus, onBlur, secureTextEntry, style, editable, ...input }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const secret = !!secureTextEntry;
  return (
    <View style={[{ gap: 6 }, style as StyleProp<ViewStyle>]}>
      <T variant="label">{label}</T>
      <View
        style={[
          styles.inputWrap,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          editable === false && { opacity: 0.6 },
        ]}>
        <TextInput
          ref={inputRef}
          placeholderTextColor={colors.placeholder}
          accessibilityLabel={label}
          selectionColor={colors.ember}
          cursorColor={colors.ember}
          {...input}
          editable={editable}
          secureTextEntry={secret && !revealed}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[font('medium'), styles.input]}
        />
        {secret ? (
          <Pressable
            onPress={() => setRevealed((r) => !r)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            style={styles.reveal}>
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <T variant="small" style={{ color: colors.emberDeep }} accessibilityRole="alert">
          {error}
        </T>
      ) : hint ? (
        <T variant="small">{hint}</T>
      ) : null}
    </View>
  );
}

// ---------- Pills and chips ----------

export type PillTone = 'neutral' | 'ember' | 'marigold' | 'forest' | 'ink';

const PILL_TONES: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.neutralSoft, fg: colors.inkSoft },
  ember: { bg: colors.emberSoft, fg: colors.emberDeep },
  marigold: { bg: colors.marigold, fg: colors.ink },
  forest: { bg: colors.forestSoft, fg: colors.forest },
  ink: { bg: colors.ink, fg: colors.paper },
};

export function Pill({ label, icon, tone = 'neutral' }: { label: string; icon?: IoniconName; tone?: PillTone }) {
  const t = PILL_TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text maxFontSizeMultiplier={1.2} style={[font('bold'), styles.pillText, { color: t.fg }]}>
        {label}
      </Text>
    </View>
  );
}

export function Chip({
  label,
  icon,
  mci,
  active,
  disabled,
  onPress,
}: {
  label: string;
  icon?: IoniconName;
  mci?: MciName;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const fg = active ? colors.paper : colors.inkSoft;
  return (
    <PressableScale
      onPress={() => {
        tap('select');
        onPress();
      }}
      disabled={disabled}
      scaleTo={0.95}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled: !!disabled }}
      style={[styles.chip, active && styles.chipActive, disabled && { opacity: 0.45 }]}>
      {mci ? <MaterialCommunityIcons name={mci} size={15} color={fg} /> : null}
      {icon ? <Ionicons name={icon} size={15} color={fg} /> : null}
      <Text maxFontSizeMultiplier={1.2} style={[font('bold'), styles.chipText, { color: fg }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

// ---------- States ----------

export function ErrorNote({ message, style }: { message?: string | null; style?: StyleProp<ViewStyle> }) {
  if (!message) return null;
  return (
    <View style={[styles.error, style]} accessibilityRole="alert">
      <Ionicons name="alert-circle" size={18} color={colors.ember} />
      <T style={{ color: colors.emberDeep, flex: 1 }}>{message}</T>
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <ActivityIndicator color={colors.muted} />
      <T variant="small">Loading</T>
    </View>
  );
}

/** Centered in the space it is given; short states sit in the middle of the screen, not under the header. */
export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: IoniconName;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.inkSoft} />
      </View>
      <T variant="title" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {body ? <T style={{ textAlign: 'center', maxWidth: 300 }}>{body}</T> : null}
      {children}
    </View>
  );
}

/** Loading, or a failed first load with the API's message and "Try again". */
export function StateView({
  loading,
  error,
  empty,
  onRetry,
  children,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: string | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  if (loading) return <Loading />;
  if (error) {
    return (
      <View style={styles.state}>
        <ErrorNote message={error} />
        {onRetry ? <Button label="Try again" variant="outline" icon="refresh" onPress={onRetry} /> : null}
      </View>
    );
  }
  if (empty) {
    return (
      <EmptyState icon="moon" title="Nothing here yet" body={empty}>
        {children}
      </EmptyState>
    );
  }
  return null;
}

/** White rounded card with a hairline border. Pass onPress to make it a tappable card that eases down when pressed. */
export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  if (onPress) {
    return (
      <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={[styles.card, style]}>
        {children}
      </PressableScale>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A hairline rule. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }, style]} />;
}

export const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  outline: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  buttonText: { fontSize: 16, lineHeight: 22, letterSpacing: -0.1, textAlignVertical: 'center' },
  link: { minHeight: touchMin, justifyContent: 'center', alignSelf: 'center', paddingHorizontal: space.s },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  topBarTitle: { flex: 1 },
  screenTitle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    minHeight: 54,
  },
  inputFocused: { borderColor: colors.ink },
  inputError: { borderColor: colors.ember },
  input: {
    flex: 1,
    height: 52,
    paddingHorizontal: 16,
    paddingVertical: 0,
    fontSize: 16,
    color: colors.ink,
    textAlignVertical: 'center',
    // The wrapper draws the focus ring; the browser's own outline would double it on web.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  reveal: { height: 52, width: 48, alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: { fontSize: 12, lineHeight: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 13, lineHeight: 18 },
  error: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: colors.emberSoft,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.paper,
    minHeight: 240,
  },
  empty: {
    flex: 1,
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
    paddingVertical: 32,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  state: { flex: 1, minHeight: 240, justifyContent: 'center', padding: gutter, gap: space.m, backgroundColor: colors.paper },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
});
