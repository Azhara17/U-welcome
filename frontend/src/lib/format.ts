// Время события показываем в часовом поясе площадки, а не браузера.
export const EVENT_TZ = 'Asia/Bishkek'

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ru-RU', { timeZone: EVENT_TZ, ...opts })
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** «Чт, 15 октября 2026 · 19:00» */
export function formatEventDateLong(iso: string): string {
  const d = new Date(iso)
  const weekday = capitalize(fmt({ weekday: 'short' }).format(d))
  return `${weekday}, ${fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(d).replace(' г.', '')} · ${formatTime(iso)}`
}

/** «15 октября, 19:00» */
export const formatDayTime = (iso: string) =>
  `${fmt({ day: 'numeric', month: 'long' }).format(new Date(iso))}, ${formatTime(iso)}`

/** «12 окт» */
export const formatShortDay = (iso: string) => fmt({ day: 'numeric', month: 'short' }).format(new Date(iso)).replace('.', '')

/** «19:04» */
export const formatTime = (iso: string) => fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

/** Для ленты: время сегодня, «Вчера» или дата. */
export function formatFeedTime(iso: string, now = new Date()): string {
  const day = (d: Date) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const d = new Date(iso)
  if (day(d) === day(now)) return formatTime(iso)
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return 'Вчера'
  return formatShortDay(iso)
}

/** JV7K2Q94 → JV7K-2Q94 */
export const formatCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code)

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** Значение <input type="datetime-local"> во времени площадки → Date. */
export function zonedInputToDate(value: string, timeZone = EVENT_TZ): Date {
  const [datePart, timePart] = value.split('T')
  const [y, m, d] = datePart!.split('-').map(Number)
  const [hh, mm] = timePart!.split(':').map(Number)
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!)
  return new Date(guess - tzOffsetMs(new Date(guess), timeZone))
}

/** Date → значение для <input type="datetime-local"> во времени площадки. */
export function dateToZonedInput(iso: string, timeZone = EVENT_TZ): string {
  const d = new Date(iso)
  const local = new Date(d.getTime() + tzOffsetMs(d, timeZone))
  return local.toISOString().slice(0, 16)
}
