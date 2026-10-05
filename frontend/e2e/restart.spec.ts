import { execSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { createEvent, register, uniqueEmail } from './helpers.js'

// Только против docker compose: перезапускает контейнер backend.
test.skip(!process.env.E2E_DOCKER, 'нужен E2E_DOCKER=1 и стек в docker compose')

test('перезапуск backend: данные на месте, открытая панель переподключается и снова обновляется live', async ({ page, request }) => {
  test.setTimeout(120_000)
  const ev = await createEvent(request, 3)
  const a = await register(request, ev.id, uniqueEmail('before'))

  await page.goto(`/organizer/events/${ev.id}`)
  await expect(page.getByTestId('stat-registered')).toHaveText('1')

  execSync('docker compose restart backend', { cwd: '..', stdio: 'inherit' })
  await expect.poll(async () => (await request.get('/api/health')).status(), { timeout: 60_000 }).toBe(200)

  // Данные пережили рестарт.
  const reloaded = await request.get(`/api/events/${ev.id}`)
  expect((await reloaded.json()).stats.confirmed).toBe(1)

  // Та же вкладка (без перезагрузки) снова получает live-обновления.
  await request.post(`/api/events/${ev.id}/checkin`, { data: { code: a.ticketCode } })
  await expect(page.getByTestId('stat-checkedin')).toHaveText('1', { timeout: 15_000 })
})
