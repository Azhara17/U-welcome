import type { APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'

export const uniqueEmail = (name: string) => `${name}-${randomUUID().slice(0, 8)}@e2e.test`

export async function createEvent(request: APIRequestContext, capacity: number, title = `E2E ${randomUUID().slice(0, 6)}`) {
  // Далеко в будущем: главная ведёт на ближайшее событие, тестовые не должны его заслонять.
  const startsAt = new Date(Date.now() + 90 * 86_400_000).toISOString()
  const res = await request.post('/api/events', { data: { title, startsAt, capacity, location: 'Бишкек', category: 'Тест' } })
  if (!res.ok()) throw new Error(`createEvent: ${res.status()} ${await res.text()}`)
  return (await res.json()) as { id: string; title: string }
}

export async function register(request: APIRequestContext, eventId: string, email: string) {
  const res = await request.post(`/api/events/${eventId}/registrations`, { data: { email } })
  return (await res.json()) as { manageToken: string; ticketCode: string | null; status: string }
}

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'

export async function mailSubjectsTo(request: APIRequestContext, email: string): Promise<string[]> {
  const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
  return ((await res.json()) as { messages: { Subject: string }[] }).messages.map((m) => m.Subject)
}
