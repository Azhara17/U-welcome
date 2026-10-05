import type { ActivityItem } from './api'
import { formatCode, formatEventDateLong } from './format'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Текст строки ленты. Формулировки без рода: пол участника по email неизвестен. */
export function activityText(a: ActivityItem): string {
  const p = a.payload
  const code = formatCode(str(p.code))
  switch (a.type) {
    case 'registered':
      return p.status === 'waitlisted' ? `${str(p.email)} — в листе ожидания` : `${str(p.email)} — регистрация`
    case 'cancelled': {
      const promoted = Array.isArray(p.promoted) ? (p.promoted as string[]) : []
      if (p.wasStatus === 'waitlisted') return `${str(p.email)} — выход из листа ожидания`
      return promoted.length
        ? `${str(p.email)} — отказ. Место передано ${promoted.join(', ')} из листа ожидания, билет отправлен`
        : `${str(p.email)} — отказ. Место свободно`
    }
    case 'checkin':
      return `${str(p.email)} — чекин пройден`
    case 'checkin_repeat':
      return `Повторный чекин ${code} отклонён`
    case 'checkin_not_found':
      return `Код ${code} не найден`
    case 'checkin_cancelled':
      return `Чекин по отменённому билету ${code} отклонён`
    case 'reminders':
      return `Напоминание за сутки отправлено ${String(p.count)} участникам`
    case 'rescheduled':
      return `Событие перенесено на ${formatEventDateLong(str(p.to))}, письма: ${String(p.notified)}`
  }
}

