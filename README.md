# U-welcome: регистрация на мероприятия

Сервис регистрации на события: регистрация по email, лист ожидания, билеты с кодом, чекин, экран организатора с live-счётчиками.

## Как запустить

Нужен Docker (Docker Desktop) и, для локальной разработки и тестов, Node.js 22+.

### Всё в docker

```bash
docker compose up -d --build --wait
```

| Сервис | URL |
|---|---|
| Приложение (nginx + SPA, `/api` → backend) | http://localhost:8080 |
| Backend API | http://localhost:3000/health |
| Mailpit (входящие письма) | http://localhost:8025 |
| Postgres | `localhost:5432`, `app` / `app`, база `events` |

Данные Postgres и Mailpit лежат в именованных volume и переживают `docker compose down` / `up`. Полный сброс: `docker compose down -v`.

### Локальная разработка

```bash
cp .env.example .env
docker compose up -d postgres mailpit
npm install
npm run dev:backend    # http://localhost:3000
npm run dev:frontend   # http://localhost:5173, /api проксируется на :3000
```

### Тесты

```bash
docker compose up -d postgres         # backend-тесты ходят в реальную БД
npm test                              # vitest (backend)
npx -w frontend playwright install chromium   # один раз
npm run test:e2e -w frontend          # сам поднимет backend и vite
E2E_BASE_URL=http://localhost:8080 npm run test:e2e -w frontend   # против docker
```

## Что сделано

- [x] Каркас: docker compose (postgres, mailpit, backend, frontend), backend с `/health` (проверяет БД), frontend показывает статус API, тесты vitest + playwright smoke
- [x] Backend: события, регистрация по email, лист ожидания, отказ с автоматическим переходом из листа ожидания
- [x] Письма через pg-boss → Mailpit: билет / лист ожидания, место освободилось, напоминание за сутки (ровно одно), перенос события

### API (backend, через фронт — с префиксом `/api`)

| Метод | Путь | Что делает |
|---|---|---|
| `POST` | `/events` | создать событие `{ title, description?, startsAt, capacity }` |
| `GET` | `/events`, `/events/:id` | список / событие со счётчиками `{ confirmed, waitlisted, checkedIn }` |
| `POST` | `/events/:id/registrations` | `{ email }` → `201` (место или лист ожидания, с `ticketCode` и `manageToken`), повтор → `200 { alreadyRegistered, status }` |
| `GET` | `/registrations/:manageToken` | билет: статус, код, событие |
| `POST` | `/registrations/:manageToken/cancel` | отказ; первый из листа ожидания получает место и письмо; повтор безопасен |
| `PATCH` | `/events/:id` | перенос `{ startsAt }`, письмо всем участникам (с местом и в листе ожидания) |

## Как проверить инварианты

| Инвариант | Тест |
|---|---|
| Повторная регистрация не создаёт второго места | `backend/test/registration.test.ts` (подряд и 10 параллельных), страховка в БД: `backend/test/schema.test.ts` |
| Отказ → первый из листа ожидания получает место и письмо | место: `backend/test/cancellation.test.ts`; письмо: `backend/test/reminders.test.ts`, `backend/test/emails.test.ts` |
| Гонка за последнее место | `backend/test/registration.test.ts`: 2 на 1 место, 5 на последнее, 20 на 5 |
| Ровно одно напоминание за сутки | `backend/test/reminders.test.ts` (повторные и 5 параллельных сканеров, дубль задачи) |
| Чекин один раз, live-счётчик | — |
| Перенос события → письмо всем | `backend/test/reschedule.test.ts` |
| Две вкладки, перезапуск сервера | перезапуск с письмом в очереди: `backend/test/restart.test.ts` (реальный Mailpit); две вкладки — шаг с UI |

## Что не работает / не сделано

_Честный список, обновляется по ходу работы._

- Письмо может уйти дважды, если процесс упадёт ровно между отправкой в SMTP и записью в журнал (см. DECISIONS.md).
- Чекин, live-счётчик (SSE), перенос события, экраны UI не сделаны.
- Нет авторизации организатора: создать событие и смотреть счётчики может любой. В задании это не требуется; если останется время, добавлю простой ключ организатора.
- `npm audit`: 4 moderate в dev-зависимости `drizzle-kit` (старый esbuild), в рантайм не попадают. См. DECISIONS.md.
- Линтера нет: не входит в заданный стек.
