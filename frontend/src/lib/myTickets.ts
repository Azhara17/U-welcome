// «Мой билет»: браузер помнит ссылки на свои билеты. Только удобство: если хранилище
// недоступно или очищено, ссылка на билет есть в письме.
const KEY = 'uwelcome.tickets'

export interface SavedTicket { token: string; eventId: string; eventTitle: string; savedAt: string }

export function loadTickets(): SavedTicket[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedTicket[]
  } catch {
    return []
  }
}

export function saveTicket(t: Omit<SavedTicket, 'savedAt'>) {
  try {
    const rest = loadTickets().filter((x) => x.token !== t.token)
    localStorage.setItem(KEY, JSON.stringify([{ ...t, savedAt: new Date().toISOString() }, ...rest].slice(0, 20)))
  } catch {
    /* приватный режим и т.п.: просто не запоминаем */
  }
}
