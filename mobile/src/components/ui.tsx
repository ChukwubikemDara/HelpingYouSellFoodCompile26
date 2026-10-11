import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps, ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { colors, fonts, radius } from '../theme'

export type IoniconName = ComponentProps<typeof Ionicons>['name']

const TEXT_VARIANTS = {
  display: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, color: colors.ink },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: colors.ink },
  heading: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.inkSoft },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  // tiny tracked caps: merchant names, section labels
  eyebrow: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1, color: colors.muted },
} satisfies Record<string, TextStyle>

// Every piece of text goes through this so the fonts stay consistent.
export function T({ variant = 'body', style, ...props }: TextProps & { variant?: keyof typeof TEXT_VARIANTS }) {
  return <Text {...props} style={[TEXT_VARIANTS[variant], style]} />
}

interface ButtonProps {
  title: string
  onPress: () => void
  disabled?: boolean
  busy?: boolean
  variant?: 'primary' | 'dark' | 'outline' | 'ghostDanger'
  icon?: IoniconName
  style?: StyleProp<ViewStyle>
}

export function Button({ title, onPress, disabled, busy, variant = 'primary', icon, style }: ButtonProps) {
  const fg = variant === 'outline' ? colors.ink : variant === 'ghostDanger' ? colors.ember : '#fff'
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.ember },
        variant === 'dark' && { backgroundColor: colors.ink },
        variant === 'outline' && { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.line },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  )
}

export function Field({ label, hint, ...input }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <T variant="eyebrow">{label.toUpperCase()}</T>
      <TextInput {...input} accessibilityLabel={label} placeholderTextColor="#B5A999" style={styles.input} />
      {hint ? <T variant="small">{hint}</T> : null}
    </View>
  )
}

export function Pill({
  label,
  icon,
  tone = 'neutral',
}: {
  label: string
  icon?: IoniconName
  tone?: 'neutral' | 'ember' | 'marigold' | 'forest' | 'ink'
}) {
  const tones = {
    neutral: { bg: '#F1E9DC', fg: colors.inkSoft },
    ember: { bg: colors.emberSoft, fg: colors.ember },
    marigold: { bg: colors.marigold, fg: colors.ink },
    forest: { bg: colors.forestSoft, fg: colors.forest },
    ink: { bg: colors.ink, fg: colors.paper },
  }[tone]
  return (
    <View style={[styles.pill, { backgroundColor: tones.bg }]}>
      {icon && <Ionicons name={icon} size={12} color={tones.fg} />}
      <Text style={[styles.pillText, { color: tones.fg }]}>{label}</Text>
    </View>
  )
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Ionicons name="alert-circle" size={18} color={colors.ember} />
      <T style={{ color: colors.ember, flex: 1 }}>{message}</T>
    </View>
  )
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.ember} />
    </View>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: IoniconName
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={colors.ember} />
      </View>
      <T variant="title" style={{ textAlign: 'center' }}>
        {title}
      </T>
      <T style={{ textAlign: 'center' }}>{body}</T>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontFamily: fonts.bold, fontSize: 16 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.ink,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: { fontFamily: fonts.bold, fontSize: 12 },
  error: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    backgroundColor: colors.emberSoft,
    borderRadius: radius.md,
    padding: 12,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper, minHeight: 160 },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 32, paddingTop: 56 },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.emberSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
})
