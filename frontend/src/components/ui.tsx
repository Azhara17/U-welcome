import type { ReactNode } from 'react'
import { Link } from 'react-router'

export function Header({ badge, links }: { badge?: string; links: { to: string; label: string }[] }) {
  return (
    <header className="mx-auto flex max-w-6xl items-start justify-between px-4 pt-6 sm:px-8 sm:pt-8">
      <div className="flex items-center gap-4">
        <Link to="/" className="text-xl font-bold tracking-tight text-zinc-900">Welcome</Link>
        {badge && <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white">{badge}</span>}
      </div>
      <nav className="flex gap-6 text-sm font-medium">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="text-blue-600 underline underline-offset-2 hover:text-blue-700">{l.label}</Link>
        ))}
      </nav>
    </header>
  )
}

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <main className={`mx-auto px-4 pb-16 pt-8 sm:px-8 ${narrow ? 'max-w-4xl' : 'max-w-6xl'}`}>{children}</main>
}

type Tone = 'blue' | 'orange' | 'gray' | 'red'
const tones: Record<Tone, string> = {
  blue: 'bg-blue-100 text-blue-800',
  orange: 'bg-orange-100 text-orange-800',
  gray: 'bg-zinc-100 text-zinc-700',
  red: 'bg-red-100 text-red-700',
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-6 ${className}`}>{children}</div>
}

export function LiveDot({ connected, label = 'live' }: { connected: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700" title={connected ? 'Обновляется в реальном времени' : 'Переподключаемся…'}>
      <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-zinc-300'}`} />
      {connected ? label : 'переподключаемся…'}
    </span>
  )
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Spinner() {
  return <p className="py-16 text-center text-zinc-500">Загружаем…</p>
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{children}</p>
}

export const buttonPrimary =
  'rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
export const buttonSecondary =
  'rounded-xl border border-zinc-300 bg-white px-6 py-2.5 font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-60'
export const input =
  'w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200'
