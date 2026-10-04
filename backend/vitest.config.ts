import { defineConfig } from 'vitest/config';

const baseUrl = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/events';
const testUrl = new URL(baseUrl);
testUrl.pathname = '/events_test';

// globalSetup не видит test.env, поэтому выставляем переменные в самом процессе vitest.
process.env.ADMIN_DATABASE_URL = baseUrl;
process.env.DATABASE_URL = testUrl.toString();

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Все файлы работают с одной тестовой БД и чистят её, поэтому последовательно.
    fileParallelism: false,
  },
});
