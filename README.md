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
| Приложение (nginx + SPA, `/api` → backend) | http://localhost:8080 — страница ближайшего события |
| Панель организатора | http://localhost:8080/organizer |
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
npm install
docker compose up -d postgres mailpit # backend-тесты ходят в реальную БД (своя база events_test) и в Mailpit
npm test                              # vitest (backend)
npx -w frontend playwright install chromium   # один раз
npm run test:e2e -w frontend          # сам поднимет backend и vite (Mailpit из compose нужен для проверки писем)
E2E_BASE_URL=http://localhost:8080 E2E_DOCKER=1 npm run test:e2e -w frontend   # против docker, включая тест перезапуска backend
```

## Что сделано

- [x] Каркас: docker compose (postgres, mailpit, backend, frontend), backend с `/health` (проверяет БД), frontend показывает статус API, тесты vitest + playwright smoke
- [x] Backend: события, регистрация по email, лист ожидания, отказ с автоматическим переходом из листа ожидания
- [x] Письма через pg-boss → Mailpit: билет / лист ожидания, место освободилось, напоминание за сутки (ровно одно), перенос события
- [x] Чекин по коду (один раз), лента событий, live-обновления через SSE (LISTEN/NOTIFY)
- [x] Демо-событие при первом запуске (`SEED_DEMO=false`, чтобы отключить)
- [x] Экраны по макету: страница события, билет, «Мой билет», панель организатора (участники, лента, перенос), чекин

### Экраны

| Путь | Экран |
|---|---|
| `/events/:id` | событие: live «свободные места», регистрация |
| `/tickets/:token` | билет: код, отказ / выход из очереди; статус обновляется сам (место из листа ожидания) |
| `/my-ticket` | билеты, запомненные в этом браузере, + повторная отправка на email |
| `/organizer/events/:id` | панель организатора: счётчики live, участники с поиском, лента событий, перенос |
| `/organizer/events/:id/checkin` | чекин по коду, общие «последние проверки» |

### API (backend, через фронт — с префиксом `/api`)

| Метод | Путь | Что делает |
|---|---|---|
| `POST` | `/events` | создать событие `{ title, description?, startsAt, capacity }` |
| `GET` | `/events`, `/events/:id` | список / событие со счётчиками `{ confirmed, waitlisted, checkedIn }` |
| `POST` | `/events/:id/registrations` | `{ email }` → `201` (место или лист ожидания, с `ticketCode` и `manageToken`), повтор → `200 { alreadyRegistered, status }` |
| `GET` | `/registrations/:manageToken` | билет: статус, код, событие |
| `POST` | `/registrations/:manageToken/cancel` | отказ; первый из листа ожидания получает место и письмо; повтор безопасен |
| `PATCH` | `/events/:id` | перенос `{ startsAt }`, письмо всем участникам (с местом и в листе ожидания) |
| `GET` | `/events/:id/stream` | SSE: снимок события со счётчиками сразу и после каждого изменения |
| `POST` | `/events/:id/checkin` | `{ code }` → `accepted` / `already_checked_in` / `cancelled` / `not_found` |
| `GET` | `/events/:id/participants?q=` | участники (с местом, затем лист ожидания с номерами), поиск по email |
| `GET` | `/events/:id/activity?types=&limit=` | лента событий |
| `POST` | `/registrations/resend` | `{ email }` → повторно отправить билеты (не чаще раза в 10 мин), всегда `202` |

## Как проверить инварианты

| Инвариант | Тест |
|---|---|
| Повторная регистрация не создаёт второго места | `backend/test/registration.test.ts` (подряд и 10 параллельных), страховка в БД: `backend/test/schema.test.ts` |
| Отказ → первый из листа ожидания получает место и письмо | место: `backend/test/cancellation.test.ts`; письмо: `backend/test/reminders.test.ts`, `backend/test/emails.test.ts` |
| Гонка за последнее место | `backend/test/registration.test.ts`: 2 на 1 место, 5 на последнее, 20 на 5 |
| Ровно одно напоминание за сутки | `backend/test/reminders.test.ts` (повторные и 5 параллельных сканеров, дубль задачи) |
| Чекин один раз, live-счётчик | `backend/test/checkin.test.ts` (10 параллельных чекинов), `backend/test/stream.test.ts` (два потока, обрыв LISTEN), UI: `frontend/e2e/organizer.spec.ts` |
| Перенос события → письмо всем | `backend/test/reschedule.test.ts` |
| Две вкладки, перезапуск сервера | две вкладки: `frontend/e2e/organizer.spec.ts`, `frontend/e2e/participant.spec.ts`; перезапуск: `backend/test/restart.test.ts` (письмо в очереди), `frontend/e2e/restart.spec.ts` (`docker compose restart backend` при открытой панели) |

## Что не работает / не сделано

_Честный список, обновляется по ходу работы._

- Письмо может уйти дважды, если процесс упадёт ровно между отправкой в SMTP и записью в журнал (см. DECISIONS.md).
- Создание события — только через API (`POST /events`), экрана нет: в макете его нет.
- e2e-тесты создают события в той же БД, что и приложение (на +90 дней, чтобы не заслонять ближайшее событие на главной). Отдельной e2e-базы нет.
- Письма доходят с задержкой до ~5 с (интервал опроса очереди pg-boss).
- Время везде показывается в часовом поясе площадки (`Asia/Bishkek`), а не браузера. Часовой пояс задан константой на фронте и `DISPLAY_TIMEZONE` на бэке, а не полем события.
- Нет авторизации организатора: создать, перенести событие и смотреть счётчики может любой. В задании не требуется, сознательно не делаю.
- `npm audit`: 4 moderate в dev-зависимости `drizzle-kit` (старый esbuild), в рантайм не попадают. См. DECISIONS.md.
- Линтера нет: не входит в заданный стек.
