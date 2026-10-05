import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { BanIcon, CheckCircleIcon, SearchIcon, WarningIcon } from '../components/icons'
import { buttonPrimary, Card, ErrorBox, Header, LiveDot, Page, Spinner } from '../components/ui'
import { api, type ActivityItem, type ActivityType } from '../lib/api'
import { formatCode, formatTime } from '../lib/format'
import { useEventStream } from '../lib/useEventStream'

const CHECK_TYPES: ActivityType[] = ['checkin', 'checkin_repeat', 'checkin_not_found', 'checkin_cancelled']

export function CheckinPage() {
  const { id } = useParams()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checks, setChecks] = useState<ActivityItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // «Последние проверки» берём из общей ленты: одинаковы на всех входах и после перезагрузки.
  const reload = useCallback(() => {
    if (id) void api.activity(id, CHECK_TYPES, 10).then(setChecks).catch(() => {})
  }, [id])
  const { event, connected } = useEventStream(id, reload)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true); setError(null)
    try {
      await api.checkin(id!, code)
      setCode('')
      reload()
    } catch {
      setError('Не удалось проверить код. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <>
      <Header links={[{ to: `/organizer/events/${id}`, label: '← К панели организатора' }]} />
      <Page narrow>
        {!event ? <Spinner /> : (
          <div className="mx-auto max-w-2xl">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-zinc-500">{event.title}</p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight">Чекин на входе</h1>
              </div>
              <div className="text-right">
                <LiveDot connected={connected} label="Пришло" />
                <p className="text-3xl font-bold"><span data-testid="checkin-counter">{event.stats.checkedIn}</span><span className="text-lg font-semibold text-zinc-500"> / {event.stats.confirmed}</span></p>
              </div>
            </div>

            <Card className="mt-6 shadow-lg shadow-zinc-200/60">
              <form onSubmit={submit}>
                <label htmlFor="code" className="mb-3 block text-sm font-semibold">Код билета</label>
                <div className="flex gap-3">
                  <input id="code" ref={inputRef} autoFocus autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder="НАПРИМЕР, JV7K-2Q94"
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 font-mono text-xl uppercase tracking-widest placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  <button type="submit" className={buttonPrimary} disabled={busy}>Отметить</button>
                </div>
                <p className="mt-3 text-xs text-zinc-600">Сканер можно заменить вводом кода с клавиатуры.</p>
              </form>
              {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
            </Card>

            <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-zinc-500">Последние проверки</h2>
            <ul className="mt-3 space-y-3" data-testid="recent-checks">
              {checks.map((c) => <CheckRow key={c.id} item={c} />)}
              {checks.length === 0 && <li className="text-sm text-zinc-500">Проверок пока не было</li>}
            </ul>
          </div>
        )}
      </Page>
    </>
  )
}

function CheckRow({ item }: { item: ActivityItem }) {
  const p = item.payload as { code?: string; email?: string; checkedInAt?: string }
  const code = formatCode(p.code ?? '')
  const variants: Record<string, { cls: string; icon: ReactNode; title: string; text: string }> = {
    checkin: { cls: 'bg-blue-100 text-blue-900', icon: <CheckCircleIcon />, title: 'Билет принят', text: `${code} · ${p.email}` },
    checkin_repeat: {
      cls: 'bg-orange-100 text-orange-900', icon: <WarningIcon />, title: 'Уже отмечен',
      text: `${code} прошёл чекин в ${p.checkedInAt ? formatTime(p.checkedInAt) : '—'}. Повторно не засчитан.`,
    },
    checkin_not_found: { cls: 'bg-white text-zinc-900', icon: <SearchIcon />, title: 'Код не найден', text: `${code} — проверьте код или найдите участника по email.` },
    checkin_cancelled: { cls: 'bg-red-50 text-red-900', icon: <BanIcon />, title: 'Билет отменён', text: `${code} · ${p.email} — участник отказался от участия.` },
  }
  const v = variants[item.type]!
  return (
    <li className={`flex items-center gap-4 rounded-2xl p-5 ${v.cls}`}>
      <span className="shrink-0">{v.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{v.title}</p>
        <p className="break-words text-sm opacity-90">{v.text}</p>
      </div>
      <span className="font-mono text-sm font-semibold">{formatTime(item.createdAt)}</span>
    </li>
  )
}
