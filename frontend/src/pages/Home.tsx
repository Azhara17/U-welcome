import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { Header, Page, Spinner } from '../components/ui'
import { api, type EventInfo } from '../lib/api'

/** Ближайшее предстоящее событие (или последнее прошедшее). */
export function pickEvent(events: EventInfo[]): EventInfo | undefined {
  const now = Date.now()
  const upcoming = events.filter((e) => new Date(e.startsAt).getTime() > now)
    .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))
  return upcoming[0] ?? events[0]
}

export function Home({ organizer = false }: { organizer?: boolean }) {
  const [target, setTarget] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    api.events().then((evs) => setTarget(pickEvent(evs)?.id ?? null)).catch(() => setTarget(null))
  }, [])

  if (target) return <Navigate to={organizer ? `/organizer/events/${target}` : `/events/${target}`} replace />
  return (
    <>
      <Header links={[]} />
      <Page>{target === undefined ? <Spinner /> : <p className="py-16 text-center text-zinc-600">Событий пока нет.</p>}</Page>
    </>
  )
}
