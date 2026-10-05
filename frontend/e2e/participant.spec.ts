import { expect, test } from '@playwright/test'
import { createEvent, mailSubjectsTo, register, uniqueEmail } from './helpers.js'

test('регистрация → билет с кодом и письмо; повторная регистрация не создаёт второго места; отказ', async ({ page, request }) => {
  const ev = await createEvent(request, 5)
  const email = uniqueEmail('aidana')

  await page.goto(`/events/${ev.id}`)
  await expect(page.getByTestId('free-seats')).toHaveText('5')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()

  await expect(page).toHaveURL(/\/tickets\//)
  await expect(page.getByText('Место подтверждено')).toBeVisible()
  await expect(page.getByTestId('ticket-code')).toHaveText(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/)
  await expect.poll(() => mailSubjectsTo(request, email), { timeout: 15_000 }).toContain(`Ваш билет: ${ev.title}`)

  // Повторная регистрация тем же email.
  await page.goto(`/events/${ev.id}`)
  await expect(page.getByTestId('free-seats')).toHaveText('4')
  await page.getByPlaceholder('you@example.com').fill(email.toUpperCase())
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(page.getByRole('status')).toContainText('Вы уже зарегистрированы')
  await expect(page.getByTestId('free-seats')).toHaveText('4')

  // «Мой билет» помнит билет в этом браузере.
  await page.getByRole('link', { name: 'Мой билет' }).click()
  await page.getByRole('link', { name: ev.title }).click()

  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Отказаться от участия' }).click()
  await expect(page.getByText('Вы отказались от участия')).toBeVisible()
})

test('лист ожидания: место освобождается — открытая страница билета обновляется сама', async ({ page, request }) => {
  const ev = await createEvent(request, 1)
  const first = await register(request, ev.id, uniqueEmail('first'))
  const email = uniqueEmail('waiting')

  await page.goto(`/events/${ev.id}`)
  await expect(page.getByTestId('free-seats')).toHaveText('0')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByRole('button', { name: 'Встать в лист ожидания' }).click()
  await expect(page.getByText('Лист ожидания · вы №1')).toBeVisible()

  // Первый отказывается (через API, как будто из другого браузера).
  await request.post(`/api/registrations/${first.manageToken}/cancel`)

  await expect(page.getByText('Место подтверждено')).toBeVisible()
  await expect(page.getByTestId('ticket-code')).toBeVisible()
  await expect.poll(() => mailSubjectsTo(request, email), { timeout: 15_000 }).toContain(`Место освободилось: ${ev.title}`)
})
