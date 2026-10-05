import { useEffect, useRef, useState } from 'react'
import type { EventWithStats } from './api'

/**
 * Live-снимок события по SSE. Каждое сообщение — полный снимок, поэтому пропуски
 * (обрыв, рестарт сервера) лечатся следующим сообщением; EventSource переподключается сам.
 * onSnapshot — повод перечитать то, чего нет в снимке (участники, лента, билет).
 */
export function useEventStream(eventId: string | undefined, onSnapshot?: (ev: EventWithStats) => void) {
  const [event, setEvent] = useState<EventWithStats | null>(null)
  const [connected, setConnected] = useState(false)
  const cb = useRef(onSnapshot)
  cb.current = onSnapshot

  useEffect(() => {
    if (!eventId) return
    const es = new EventSource(`/api/events/${eventId}/stream`)
    es.addEventListener('snapshot', (msg) => {
      const ev = JSON.parse((msg as MessageEvent<string>).data) as EventWithStats
      setEvent(ev)
      setConnected(true)
      cb.current?.(ev)
    })
    es.onerror = () => setConnected(false)
    return () => es.close()
  }, [eventId])

  return { event, connected }
}
