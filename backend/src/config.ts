import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url().default('postgres://app:app@localhost:5432/events'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().default('U-welcome <noreply@u-welcome.local>'),
  // Публичный адрес фронтенда: для ссылок в письмах.
  APP_URL: z.string().url().default('http://localhost:8080'),
  // Часовой пояс, в котором показываем время события в письмах.
  DISPLAY_TIMEZONE: z.string().default('UTC'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
