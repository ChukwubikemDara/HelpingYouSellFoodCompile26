import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'

export const colors = {
  bg: '#fafaf9',
  card: '#ffffff',
  border: '#e7e5e4',
  text: '#1c1917',
  muted: '#78716c',
  primary: '#059669',
  primaryDark: '#047857',
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
}

interface ButtonProps {
  title: string
  onPress: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
  style?: StyleProp<ViewStyle>
}

export function Button({ title, onPress, disabled, variant = 'primary', style }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === 'secondary' && { color: colors.text },
          variant === 'danger' && { color: colors.danger },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function Field({ label, hint, ...input }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput {...input} accessibilityLabel={label} placeholderTextColor="#a8a29e" style={styles.input} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={{ color: colors.danger }}>{message}</Text>
    </View>
  )
}

export function Loading() {
  return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
}

const BADGES: Record<string, { bg: string; fg: string }> = {
  reserved: { bg: '#d1fae5', fg: '#065f46' },
  picked_up: { bg: '#e0f2fe', fg: '#075985' },
  cancelled: { bg: '#fee2e2', fg: '#991b1b' },
  no_show: { bg: '#fee2e2', fg: '#991b1b' },
  sold_out: { bg: '#e7e5e4', fg: '#44403c' },
}

export function StatusBadge({ status }: { status: string }) {
  const c = BADGES[status] ?? { bg: '#e7e5e4', fg: '#44403c' }
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={{ color: c.fg, fontSize: 12, fontWeight: '600' }}>{status.replace('_', ' ')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  button: { borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: '#d6d3d1' },
  buttonDanger: { backgroundColor: colors.card, borderWidth: 1, borderColor: '#fca5a5' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  label: { fontSize: 14, fontWeight: '500', color: '#44403c' },
  hint: { fontSize: 12, color: colors.muted },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: '#d6d3d1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    color: colors.text,
  },
  error: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 10,
  },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
})
