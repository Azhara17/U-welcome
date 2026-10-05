import { expect, test } from '@playwright/test'
import { createEvent, mailSubjectsTo, register, uniqueEmail } from './helpers.js'

test('две вкладки: чекин в одной — счётчик в другой обновляется без перезагрузки; билет засчитывается один раз', async ({ context, request }) => {
  const ev = await createEvent(request, 3)
  const dashboard = await context.newPage()
  const checkin = await context.newPage()
  const publicPage = await context.newPage()
  await dashboard.goto(`/organizer/events/${ev.id}`)
  await checkin.goto(`/organizer/events/${ev.id}/checkin`)
  await publicPage.goto(`/events/${ev.id}`)
  await expect(dashboard.getByTestId('stat-checkedin')).toHaveText('0')
  await expect(publicPage.getByTestId('free-seats')).toHaveText('3')

  // Регистрация где-то ещё: обе вкладки видят её сразу.
  const email = uniqueEmail('guest')
  const reg = await register(request, ev.id, email)
  await expect(dashboard.getByTestId('stat-registered')).toHaveText('1')
  await expect(dashboard.getByRole('cell', { name: email })).toBeVisible()
  await expect(publicPage.getByTestId('free-seats')).toHaveText('2')

  // Чекин с клавиатуры: строчными и с дефисом.
  const typed = `${reg.ticketCode!.slice(0, 4)}-${reg.ticketCode!.slice(4)}`.toLowerCase()
  await checkin.getByLabel('Код билета').fill(typed)
  await checkin.getByRole('button', { name: 'Отметить' }).click()
  await expect(checkin.getByTestId('recent-checks').getByText('Билет принят')).toBeVisible()
  await expect(checkin.getByTestId('checkin-counter')).toHaveText('1')
  await expect(dashboard.getByTestId('stat-checkedin')).toHaveText('1')

  // Повторный чекин того же билета.
  await checkin.getByLabel('Код билета').fill(reg.ticketCode!)
  await checkin.getByRole('button', { name: 'Отметить' }).click()
  await expect(checkin.getByTestId('recent-checks').getByText('Уже отмечен')).toBeVisible()
  await expect(dashboard.getByTestId('activity-feed')).toContainText('Повторный чекин')
  await expect(dashboard.getByTestId('stat-checkedin')).toHaveText('1')

  // Второй вход (ещё одна вкладка чекина) видит те же последние проверки.
  const checkin2 = await context.newPage()
  await checkin2.goto(`/organizer/events/${ev.id}/checkin`)
  await expect(checkin2.getByTestId('recent-checks').getByText('Уже отмечен')).toBeVisible()
  await expect(checkin2.getByTestId('checkin-counter')).toHaveText('1')
})

test('перенос события из панели организатора: письмо участникам', async ({ page, request }) => {
  const ev = await createEvent(request, 2)
  const email = uniqueEmail('moved')
  await register(request, ev.id, email)

  await page.goto(`/organizer/events/${ev.id}`)
  await page.getByRole('button', { name: 'Перенести событие' }).click()
  await page.getByLabel(/Новые дата и время/).fill('2030-03-15T19:00')
  await page.getByRole('dialog').getByRole('button', { name: 'Перенести' }).click()
  await expect(page.getByText('Письмо о переносе отправлено участникам: 1')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByText(/^Пт, 15 марта 2030 · 19:00 · лимит 2 мест$/)).toBeVisible()
  await expect(page.getByTestId('activity-feed')).toContainText('Событие перенесено на Пт, 15 марта 2030 · 19:00, письма: 1')

  await expect.poll(() => mailSubjectsTo(request, email), { timeout: 15_000 }).toContain(`Событие перенесено: ${ev.title}`)
})
