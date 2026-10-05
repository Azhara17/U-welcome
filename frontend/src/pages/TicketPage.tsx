import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { buttonSecondary, Card, ErrorBox, Header, Page, Pill, Spinner } from '../components/ui'
import { api, ApiError, type Ticket } from '../lib/api'
import { formatCode, formatDayTime } from '../lib/format'
import { useEventStream } from '../lib/useEventStream'

export function TicketPage() {
  const { token } = useParams()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setTicket(await api.ticket(token!))
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'Билет не найден. Проверьте ссылку из письма.' : 'Не удалось загрузить билет.')
    }
  }, [token])

  useEffect(() => { void load() }, [load])
  // Пока страница открыта, статус обновляется сам: например, место из листа ожидания.
  useEventStream(ticket?.eventId, () => void load())

  async function cancel() {
    const text = ticket?.status === 'waitlisted' ? 'Покинуть лист ожидания?' : 'Отказаться от участия? Место перейдёт следующему в очереди.'
    if (!window.confirm(text)) return
    setBusy(true)
    try {
      await api.cancel(token!)
      await load()
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'already_checked_in'
        ? 'Вы уже прошли чекин — отказаться нельзя.'
        : 'Не получилось отказаться. Попробуйте ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  const eventLink = ticket ? `/events/${ticket.eventId}` : '/'
  return (
    <>
      <Header links={[{ to: eventLink, label: 'Событие' }, { to: ticket ? `/organizer/events/${ticket.eventId}` : '/organizer', label: 'Для организаторов' }]} />
      <Page narrow>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Ваш билет</h1>
        {error && <div className="mt-6"><ErrorBox>{error}</ErrorBox></div>}
        {!ticket && !error && <Spinner />}
        {ticket && (
          <div className="mt-6 space-y-6">
            {ticket.status === 'cancelled' ? (
              <Card>
                <Pill tone="gray">Вы отказались от участия</Pill>
                <h2 className="mt-3 text-2xl font-bold text-zinc-900">{ticket.event.title}</h2>
                <p className="mt-2 text-zinc-600">Билет больше не действует. Передумали — <Link to={eventLink} className="text-blue-600 underline">зарегистрируйтесь снова</Link>.</p>
              </Card>
            ) : (
              <TicketCard ticket={ticket} />
            )}

            {ticket.status === 'confirmed' && !ticket.checkedInAt && (
              <div className="flex flex-wrap items-center gap-4">
                <button onClick={cancel} disabled={busy} className={buttonSecondary}>Отказаться от участия</button>
                <span className="text-sm text-zinc-600">Место сразу перейдёт первому из листа ожидания.</span>
              </div>
            )}

            {ticket.status === 'waitlisted' && (
              <Card className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <Pill tone="orange">Лист ожидания · вы №{ticket.waitlistPosition}</Pill>
                  <p className="mt-2 text-zinc-700">Если кто-то откажется, место и билет придут на почту автоматически. Ничего делать не нужно.</p>
                </div>
                <button onClick={cancel} disabled={busy} className={buttonSecondary}>Покинуть очередь</button>
              </Card>
            )}
          </div>
        )}
      </Page>
    </>
  )
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const { event } = ticket
  const confirmed = ticket.status === 'confirmed'
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-lg shadow-zinc-200/60 sm:flex-row">
      <div className="flex-1 p-8">
        {ticket.checkedInAt ? <Pill tone="blue">Чекин пройден</Pill>
          : confirmed ? <Pill tone="blue">Место подтверждено</Pill>
          : <Pill tone="orange">В листе ожидания</Pill>}
        <h2 className="mt-3 text-2xl font-bold text-zinc-900">{event.title}</h2>
        <dl className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Дата" value={formatDayTime(event.startsAt)} />
          <Field label="Место" value={event.location || '—'} />
          <Field label="Участник" value={ticket.email} />
          <Field label="Напоминание" value={ticket.reminderAt ? formatDayTime(ticket.reminderAt) : '—'} />
        </dl>
      </div>
      <div className="flex flex-col justify-center border-l border-dashed border-zinc-600 bg-zinc-900 p-8 text-white sm:w-80">
        {confirmed && ticket.ticketCode ? (
          <>
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Код билета</span>
            <span className="mt-3 font-mono text-4xl font-bold tracking-widest" data-testid="ticket-code">{formatCode(ticket.ticketCode)}</span>
            <p className="mt-6 text-sm text-zinc-300">Покажите код на входе. Он засчитывается один раз.</p>
          </>
        ) : (
          <p className="text-sm text-zinc-300">Код билета появится здесь и придёт на почту, когда освободится место.</p>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="mt-1 break-all font-semibold text-zinc-900">{value}</dd>
    </div>
  )
}
