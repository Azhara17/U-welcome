import { expect, test } from '@playwright/test'

test('главная открывается и показывает статус API', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'U-welcome' })).toBeVisible()
  await expect(page.getByTestId('health')).toHaveText('API: ok, БД: ok')
})
