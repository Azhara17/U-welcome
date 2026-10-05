export interface EventStats { confirmed: number; waitlisted: number; checkedIn: number }

export interface EventInfo {
  id: string
  title: string
  description: string
  location: string
  category: string
  startsAt: string
  capacity: number
}

export type EventWithStats = EventInfo & { stats: EventStats }

export type RegistrationStatus = 'confirmed' | 'waitlisted' | 'cancelled'

export interface Ticket {
  id: string
  eventId: string
  email: string
  status: RegistrationStatus
  ticketCode: string | null
  manageToken: string
  checkedInAt: string | null
  waitlistPosition: number | null
  reminderAt: string | null
  event: EventInfo
}

export interface Participant {
  id: string
  email: string
  status: 'confirmed' | 'waitlisted'
  waitlistPosition: number | null
  registeredAt: string
  checkedInAt: string | null
}

export type ActivityType =
  | 'registered' | 'cancelled' | 'checkin' | 'checkin_repeat' | 'checkin_not_found'
  | 'checkin_cancelled' | 'reminders' | 'rescheduled'

export interface ActivityItem {
  id: number
  type: ActivityType
  payload: Record<string, unknown>
  createdAt: string
}

export type RegisterResponse =
  | { kind: 'created'; ticket: Omit<Ticket, 'event' | 'waitlistPosition' | 'reminderAt'> }
  | { kind: 'existing'; status: RegistrationStatus; resent: boolean }

export type CheckinResponse =
  | { result: 'accepted' | 'already_checked_in'; code: string; email: string; checkedInAt: string }
  | { result: 'cancelled'; code: string; email: string }
  | { result: 'not_found'; code: string }

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? 'request_failed')
  return { status: res.status, body: body as T }
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) })

export const api = {
  events: () => request<EventInfo[]>('/events').then((r) => r.body),
  event: (id: string) => request<EventWithStats>(`/events/${id}`).then((r) => r.body),
  participants: (id: string, q = '') =>
    request<Participant[]>(`/events/${id}/participants${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => r.body),
  activity: (id: string, types?: ActivityType[], limit = 30) =>
    request<ActivityItem[]>(`/events/${id}/activity?limit=${limit}${types ? `&types=${types.join(',')}` : ''}`).then((r) => r.body),

  async register(eventId: string, email: string): Promise<RegisterResponse> {
    const { status, body } = await post<Record<string, unknown>>(`/events/${eventId}/registrations`, { email })
    if (status === 201) return { kind: 'created', ticket: body as never }
    return { kind: 'existing', status: body.status as RegistrationStatus, resent: Boolean(body.resent) }
  },
  ticket: (token: string) => request<Ticket>(`/registrations/${token}`).then((r) => r.body),
  cancel: (token: string) => post<Ticket>(`/registrations/${token}/cancel`).then((r) => r.body),
  resend: (email: string) => post<{ ok: true }>('/registrations/resend', { email }).then((r) => r.body),
  checkin: (eventId: string, code: string) => post<CheckinResponse>(`/events/${eventId}/checkin`, { code }).then((r) => r.body),
  reschedule: (eventId: string, startsAt: Date) =>
    request<EventInfo & { notified: number }>(`/events/${eventId}`, {
      method: 'PATCH', body: JSON.stringify({ startsAt: startsAt.toISOString() }),
    }).then((r) => r.body),
}
