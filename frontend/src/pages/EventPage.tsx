import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { CalendarIcon, PinIcon } from '../components/icons'
import { buttonPrimary, Card, ErrorBox, Header, input, LiveDot, Page, Pill, ProgressBar, Spinner } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatEventDateLong } from '../lib/format'
import { saveTicket } from '../lib/myTickets'
import { useEventStream } from '../lib/useEventStream'

const features = [
  { title: 'Билет на почту', text: 'Сразу после регистрации, с уникальным кодом' },
  { title: 'Напоминание', text: 'Одно письмо за сутки до начала' },
  { title: 'Чекин по коду', text: 'На входе билет отмечается один раз' },
]

export function EventPage() {
  const { id } = useParams()
  const { event, connected } = useEventStream(id)

  return (
    <>
      <Header links={[{ to: '/my-ticket', label: 'Мой билет' }, { to: `/organizer/events/${id}`, label: 'Для организаторов' }]} />
      <Page>
        {!event ? <Spinner /> : (
          <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
            <section>
              {event.category && <Pill tone="blue">{event.category.toUpperCase()}</Pill>}
              <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-zinc-900 sm:text-5xl">{event.title}</h1>
              <ul className="mt-6 space-y-2 font-semibold text-zinc-900">
                <li className="flex items-center gap-3"><span className="text-zinc-500"><CalendarIcon /></span>{formatEventDateLong(event.startsAt)}</li>
                {event.location && <li className="flex items-center gap-3"><span className="text-zinc-500"><PinIcon /></span>{event.location}</li>}
              </ul>
              {event.description && <p className="mt-4 text-lg text-zinc-700">{event.description}</p>}
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {features.map((f) => (
                  <Card key={f.title} className="p-5">
                    <h3 className="font-semibold text-zinc-900">{f.title}</h3>
                    <p className="mt-2 text-sm text-zinc-600">{f.text}</p>
                  </Card>
                ))}
              </div>
            </section>
            <RegistrationCard event={event} connected={connected} />
          </div>
        )}
      </Page>
    </>
  )
}

function RegistrationCard({ event, connected }: { event: NonNullable<ReturnType<typeof useEventStream>['event']>; connected: boolean }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const free = Math.max(0, event.capacity - event.stats.confirmed)
  const started = new Date(event.startsAt) <= new Date()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setNotice(null); setError(null)
    try {
      const res = await api.register(event.id, email)
      if (res.kind === 'created') {
        saveTicket({ token: res.ticket.manageToken, eventId: event.id, eventTitle: event.title })
        navigate(`/tickets/${res.ticket.manageToken}`)
        return
      }
      setNotice(res.resent
        ? 'Вы уже зарегистрированы — мы отправили билет на почту ещё раз.'
        : 'Вы уже зарегистрированы — билет у вас на почте. Повторно отправим не раньше чем через 10 минут.')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      setError(code === 'validation_error' ? 'Проверьте email.'
        : code === 'event_already_started' ? 'Регистрация закрыта: событие уже началось.'
        : 'Не получилось зарегистрироваться. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside>
      <Card className="shadow-lg shadow-zinc-200/60">
        <div className="flex items-start justify-between">
          <span className="font-semibold text-zinc-900">Свободные места</span>
          <LiveDot connected={connected} />
        </div>
        <p className="mt-1 flex items-baseline gap-3">
          <span className="text-5xl font-bold text-zinc-900" data-testid="free-seats">{free}</span>
          <span className="font-semibold text-zinc-500">из {event.capacity}</span>
        </p>
        <div className="mt-3"><ProgressBar value={event.stats.confirmed} max={event.capacity} /></div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-zinc-900">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" className={input} disabled={started} />
          </label>
          <button type="submit" className={`${buttonPrimary} w-full`} disabled={busy || started}>
            {started ? 'Регистрация закрыта' : free > 0 ? 'Зарегистрироваться' : 'Встать в лист ожидания'}
          </button>
        </form>
        {notice && <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900" role="status">{notice}</p>}
        {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
        <p className="mt-4 text-xs leading-relaxed text-zinc-600">
          Один email — одно место. Если вы уже зарегистрированы, мы повторно отправим билет на почту, а не создадим новый.
        </p>

        <hr className="my-5 border-zinc-200" />
        <Pill tone="orange">Если места закончатся</Pill>
        <p className="mt-2 text-sm text-zinc-700">
          Вы попадёте в лист ожидания. Освободилось место — первый в очереди получает его и билет на почту автоматически.
        </p>
      </Card>
    </aside>
  )
}
