import { expect, test } from '@playwright/test'

test('главная открывает ближайшее событие', async ({ page, request }) => {
  expect((await request.get('/api/health')).ok()).toBe(true)
  await page.goto('/')
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/)
  await expect(page.getByTestId('free-seats')).toBeVisible()
})
