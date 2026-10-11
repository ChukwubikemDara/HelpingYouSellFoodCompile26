import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'dark' | 'secondary' | 'danger'
}

const VARIANTS = {
  primary: 'bg-ember text-white hover:bg-ember/90',
  dark: 'bg-ink text-paper hover:bg-ink/90',
  secondary: 'bg-card text-ink border-[1.5px] border-line hover:bg-line/40',
  danger: 'text-ember hover:bg-ember-soft',
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`min-h-13 rounded-2xl px-5 font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${className}`}
    />
  )
}

// small tracked caps, used for field labels and section headings
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`block text-[11px] font-bold tracking-[0.1em] text-muted uppercase ${className}`}>{children}</span>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <Eyebrow className="mb-1.5">{label}</Eyebrow>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-2xl border-[1.5px] border-line bg-card px-4 py-3 font-medium text-ink outline-none placeholder:text-[#B5A999] focus:border-ink disabled:bg-line/40 disabled:text-muted'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-2xl bg-ember-soft px-4 py-3 text-sm font-medium text-ember">
      {children}
    </p>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-ember" />
      {label}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line bg-card p-4 ${className}`}>{children}</div>
}

const BADGE_COLORS: Record<string, string> = {
  live: 'bg-forest-soft text-forest',
  reserved: 'bg-ember-soft text-ember',
  picked_up: 'bg-forest-soft text-forest',
  draft: 'bg-marigold text-ink',
  sold_out: 'bg-ink text-paper',
  expired: 'bg-line text-ink-soft',
  cancelled: 'bg-line text-ink-soft',
  no_show: 'bg-line text-ink-soft',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${BADGE_COLORS[status] ?? 'bg-line text-ink-soft'}`}
    >
      {status.replace('_', ' ')}
    </span>
  )
}
