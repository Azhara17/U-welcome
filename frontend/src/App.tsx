import { useEffect, useState } from 'react'

type Health = { status: string; db: string }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <main className="mx-auto max-w-xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">U-welcome</h1>
      <p className="mt-2 text-slate-600">Регистрация на мероприятия</p>
      <div className="mt-6 rounded border p-4" data-testid="health">
        {error && <span className="text-red-600">API недоступен: {error}</span>}
        {!error && !health && <span>Проверяем API…</span>}
        {health && (
          <span className={health.status === 'ok' ? 'text-green-700' : 'text-amber-700'}>
            API: {health.status}, БД: {health.db}
          </span>
        )}
      </div>
    </main>
  )
}
