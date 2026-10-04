import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Если E2E_BASE_URL не задан, сами поднимаем backend и vite.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        { command: 'npm run dev -w backend', cwd: '..', url: 'http://localhost:3000/health', reuseExistingServer: true },
        { command: 'npm run dev', url: baseURL, reuseExistingServer: true },
      ],
})
