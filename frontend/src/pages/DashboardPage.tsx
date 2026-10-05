import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { buttonPrimary, buttonSecondary, Card, ErrorBox, Header, input, LiveDot, Page, Pill, ProgressBar, Spinner } from '../components/ui'
import { api, ApiError, type ActivityItem, type ActivityType, type EventWithStats, type Participant } from '../lib/api'
import { activityText } from '../lib/activityText'
import { dateToZonedInput, EVENT_TZ, formatEventDateLong, formatFeedTime, formatShortDay, formatTime, zonedInputToDate } from '../lib/format'
import { useEventStream } from '../lib/useEventStream'

// В ленте организатора — то, что требует внимания; отдельные регистрации видны в таблице.
const FEED_TYPES: ActivityType[] = ['cancelled', 'checkin', 'checkin_repeat', 'checkin_not_found', 'checkin_cancelled', 'reminders', 'rescheduled']

export function DashboardPage() {
  const { id } = useParams()
  const [participants, setParticipants] = useState<Participant[]>([])
  const [feed, setFeed] = useState<ActivityItem[]>([])
  const [query, setQuery] = useState('')
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const queryRef = useRef(query)
  queryRef.current = query

  const reload = useCallback(() => {
    if (!id) return
    void api.participants(id, queryRef.current).then(setParticipants).catch(() => {})
    void api.activity(id, FEED_TYPES, 20).then(setFeed).catch(() => {})
  }, [id])

  // Снимок по SSE — сигнал перечитать участников и ленту (в самом потоке их нет).
  const { event, connected } = useEventStream(id, reload)

  useEffect(() => {
    const t = setTimeout(reload, 200)
    return () => clearTimeout(t)
  }, [query, reload])

  if (!event) return (<><Header badge="Организатор" links={[]} /><Page><Spinner /></Page></>)

  const { stats } = event
  const next = participants.find((p) => p.waitlistPosition === 1)
  const pct = stats.confirmed ? Math.round((stats.checkedIn / stats.confirmed) * 100) : 0

  return (
    <>
      <Header badge="Организатор" links={[{ to: `/events/${event.id}`, label: 'Страница события' }]} />
      <Page>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{event.title}</h1>
            <p className="mt-1 font-semibold text-zinc-500">{formatEventDateLong(event.startsAt)} · лимит {event.capacity} мест</p>
          </div>
          <div className="flex gap-3">
            <button className={buttonSecondary} onClick={() => setRescheduleOpen(true)}>Перенести событие</button>
            <Link to={`/organizer/events/${event.id}/checkin`} className={buttonPrimary}>Открыть чекин</Link>
          </div>
        </div>

        <div className="mt-6"><LiveDot connected={connected} label="Обновляется в реальном времени" /></div>

        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <Card>
            <p className="text-sm text-zinc-600">Зарегистрировано</p>
            <p className="mt-2"><span className="text-4xl font-bold" data-testid="stat-registered">{stats.confirmed}</span><span className="font-semibold text-zinc-500"> / {event.capacity}</span></p>
            <div className="mt-3"><ProgressBar value={stats.confirmed} max={event.capacity} /></div>
          </Card>
          <Card>
            <p className="text-sm text-zinc-600">Лист ожидания</p>
            <p className="mt-2 text-4xl font-bold text-orange-800" data-testid="stat-waitlist">{stats.waitlisted}</p>
            <p className="mt-2 text-sm text-zinc-600">{next ? `Следующий: ${next.email}` : 'Очередь пуста'}</p>
          </Card>
          <Card>
            <p className="text-sm text-zinc-600">Пришло</p>
            <p className="mt-2 text-4xl font-bold" data-testid="stat-checkedin">{stats.checkedIn}</p>
            <p className="mt-2 text-sm text-zinc-600">{pct}% от зарегистрированных</p>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          <Card className="overflow-hidden" padding="p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
              <h2 className="text-lg font-bold">Участники</h2>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по email" className={`${input} max-w-56 py-2 text-sm`} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <tr><th className="px-6 py-3">Участник</th><th className="px-3 py-3">Статус</th><th className="px-3 py-3">Регистрация</th><th className="px-3 py-3">Чекин</th></tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <tr key={p.id} className="border-b border-zinc-100 last:border-0">
                      <td className="px-6 py-3 font-semibold text-zinc-900">{p.email}</td>
                      <td className="px-3 py-3"><StatusPill p={p} /></td>
                      <td className="px-3 py-3 text-zinc-700">{formatShortDay(p.registeredAt)}</td>
                      <td className="px-3 py-3 font-mono text-zinc-700">{p.checkedInAt ? formatTime(p.checkedInAt) : '—'}</td>
                    </tr>
                  ))}
                  {participants.length === 0 && (
                    <tr><td colSpan={4} className="px-6 py-8 text-center text-zinc-500">{query ? 'Никого не нашли' : 'Пока никто не зарегистрировался'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="self-start">
            <h2 className="text-lg font-bold">Лента событий</h2>
            <ul className="mt-4 space-y-4" data-testid="activity-feed">
              {feed.map((a) => (
                <li key={a.id} className="grid grid-cols-[48px_1fr] gap-3 text-sm">
                  <span className="font-mono text-xs font-semibold text-zinc-500">{formatFeedTime(a.createdAt)}</span>
                  <span className="break-words text-zinc-800">{activityText(a)}</span>
                </li>
              ))}
              {feed.length === 0 && <li className="text-sm text-zinc-500">Пока ничего не произошло</li>}
            </ul>
          </Card>
        </div>
      </Page>
      {rescheduleOpen && <RescheduleDialog event={event} onClose={() => setRescheduleOpen(false)} />}
    </>
  )
}

function StatusPill({ p }: { p: Participant }) {
  if (p.status === 'waitlisted') return <Pill tone="orange">Ожидание · №{p.waitlistPosition}</Pill>
  if (p.checkedInAt) return <Pill tone="blue">Чекин пройден</Pill>
  return <Pill tone="gray">Место подтверждено</Pill>
}

function RescheduleDialog({ event, onClose }: { event: EventWithStats; onClose: () => void }) {
  const [value, setValue] = useState(dateToZonedInput(event.startsAt))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await api.reschedule(event.id, zonedInputToDate(value))
      setDone(res.notified)
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'starts_at_in_past' ? 'Новая дата должна быть в будущем.'
        : err instanceof ApiError && err.code === 'event_already_started' ? 'Событие уже началось — перенос невозможен.'
        : 'Не получилось перенести событие.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Перенести событие">
      <Card className="w-full max-w-md">
        <h2 className="text-xl font-bold">Перенести событие</h2>
        {done !== null ? (
          <>
            <p className="mt-3 text-zinc-700">Готово. Письмо о переносе отправлено участникам: {done}.</p>
            <button className={`${buttonPrimary} mt-6 w-full`} onClick={onClose}>Закрыть</button>
          </>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">Новые дата и время ({EVENT_TZ})</span>
              <input type="datetime-local" required value={value} onChange={(e) => setValue(e.target.value)} className={input} />
            </label>
            <p className="text-sm text-zinc-600">Все участники — с местом и из листа ожидания — получат письмо с новой датой.</p>
            {error && <ErrorBox>{error}</ErrorBox>}
            <div className="flex gap-3">
              <button type="button" className={`${buttonSecondary} flex-1`} onClick={onClose}>Отмена</button>
              <button type="submit" className={`${buttonPrimary} flex-1`} disabled={busy}>Перенести</button>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}
