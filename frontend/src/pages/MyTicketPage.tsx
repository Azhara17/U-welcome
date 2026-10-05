import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { buttonPrimary, Card, Header, input, Page } from '../components/ui'
import { api } from '../lib/api'
import { loadTickets } from '../lib/myTickets'

export function MyTicketPage() {
  const tickets = loadTickets()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    await api.resend(email).catch(() => {})
    setSent(true)
  }

  return (
    <>
      <Header links={[{ to: '/', label: 'Событие' }]} />
      <Page narrow>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Мой билет</h1>
        {tickets.length > 0 && (
          <Card className="mt-6">
            <h2 className="font-semibold text-zinc-900">Билеты в этом браузере</h2>
            <ul className="mt-3 space-y-2">
              {tickets.map((t) => (
                <li key={t.token}><Link to={`/tickets/${t.token}`} className="text-blue-600 underline">{t.eventTitle}</Link></li>
              ))}
            </ul>
          </Card>
        )}
        <Card className="mt-6">
          <h2 className="font-semibold text-zinc-900">Ссылка на билет есть в письме</h2>
          <p className="mt-1 text-sm text-zinc-600">Не можете найти письмо? Укажите email — отправим билет ещё раз (не чаще раза в 10 минут).</p>
          {sent ? (
            <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-900" role="status">
              Если этот email зарегистрирован на предстоящие события, мы отправили на него билет.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={input} />
              <button type="submit" className={buttonPrimary}>Отправить</button>
            </form>
          )}
        </Card>
      </Page>
    </>
  )
}
