# История рабочей сессии

Дата: **2026-11-13**

Это не дословный экспорт интерфейса, а сохранённая структурированная история
запросов, решений и результатов. Полный контекст проекта — в
`docs/HANDOFF.md`.

## Участники и цель

Пользователь попросил профессионально доработать проект **Birge** (карпулинг
в Бишкеке), не изменяя оригинальные папки. Все изменения должны были идти в
отдельной копии, с проверками и отчётом на русском.

## Хронология

### 1. Профессионализация и отдельная копия

Запрос:

> Прочитать глобальные протоколы, начать внедрение, сохранить исправленную
> версию в другую папку и не трогать оригинал.

Сделано:

- создана копия `birge-professional` рядом с оригиналами;
- оригинальные `birge` и `birge-backend` оставлены без изменений;
- добавлены README, roadmap, migration guide, CI, `.env.example`;
- зависимости зафиксированы;
- удалён мёртвый frontend-код;
- добавлены security guards, CORS из env, refresh JWT, WS tickets,
  серверная загрузка фото;
- внедрён Alembic, baseline и миграция индексов;
- добавлены backend/frontend-тесты;
- исправлен Windows-баг с cp1251 и эмодзи в `print()`.

### 2. Production build, Procfile и первый роутер

Запрос:

> Исправить production-сборку, чтобы она не брала локальный `VITE_API_URL`
> из `.env.local`; вынести `alembic upgrade head` из web-команды Procfile;
> начать выносить роутеры из `main.py`.

Сделано:

- `.env.local` переименован в `.env.development.local`;
- в `vite.config.js` добавлен fail-fast для localhost в production;
- production build проверен: локального URL в `dist` нет;
- dev build по-прежнему использует локальный URL;
- Procfile разделён на `release:` и `web:`;
- создан `routers/auth.py`;
- созданы `config.py`, `dependencies.py`, `time_utils.py`;
- OpenAPI и backend-тесты проверены.

### 3. Проверка статуса P0

Запрос:

> Из P0 всё сделал?

Ответ: нет. 13 пунктов из 14 закрыты, разделение `main.py`/`App.jsx`
оставалось частичным. Отмечены оговорки: CI не запускался на GitHub,
ImgBB/Telegram не проверялись реально, production deploy не выполнялся.

### 4. Users-роутер

Запрос:

> Вынести users-роутер в `routers/users.py`, сохранить API, прогнать тесты
> и проверить OpenAPI.

Сделано:

- создан `routers/users.py` с 8 операциями;
- создан `dependencies.py` для общих auth-зависимостей;
- создан `time_utils.py` для времени Бишкека;
- из `main.py` удалён users-блок;
- обновлены unit-тесты и OpenAPI-тест;
- проверены все users-пути, методы и схемы `User`/`UserPublic`;
- живой `/health` и `/openapi.json` — 200.

### 5. HTTP-регрессия users и trips-роутер

Запрос:

> Добавить HTTP-регрессионные тесты для users-роутов, затем вынести
> trips-роутер, сохранив поведение API.

Сделано:

- добавлен `tests/test_users_http.py` на 5 тестов, покрывающих все 8
  users-операций;
- создан `routers/trips.py` с 10 операциями (поездки, чат, платёжные реквизиты);
- создан `realtime.py` с WebSocket/SSE managers и `is_trip_participant`;
- `main.py` сокращён примерно с 2074 до 1383 строк;
- обновлены импорты тестов;
- добавлены OpenAPI- и HTTP-проверки trips;
- итог: **29 backend-тестов passed**, ruff passed, живые `/health` и
  `/openapi.json` — 200.

### 6. Сохранение контекста

Запрос:

> Сохранить чат и всё сделанное в папку, чтобы продолжить с другого аккаунта,
> и указать, куда сохранена копия Birge.

Сделано:

- создан этот файл;
- создан `docs/HANDOFF.md` с полным состоянием, командами и следующими шагами;
- в README добавлена ссылка на handoff;
- секреты и ключи в документы не включались.

### 7. Закрытие P0: роуты и hooks

Запрос:

> Прочитай `docs/HANDOFF.md`, `docs/CHAT_HISTORY.md` и `docs/ROADMAP.md`.
> Продолжай с незакрытых пунктов P0, не меняя API без необходимости.

Сделано:

- создан `routers/trip_requests.py`: POST/GET/PATCH заявок, статус и оба SSE-стрима;
- создан `routers/chat.py`: WebSocket `/ws/chat/{trip_id}/{user_id}`;
- `main.py` сокращён с 1383 до ~900 строк; в нём остались reviews, Telegram/internal, admin cleanup и lifecycle;
- `App.jsx` сокращён с 812 до 418 строк; логика вынесена в `src/hooks/*` и `src/utils/tripStorage.js`;
- API-пути, методы и response-модели не менялись;
- добавлены OpenAPI-проверки trip-request путей, HTTP-сценарий заявки и проверка регистрации WS;
- проверки: ruff passed, pytest 31 passed, npm test 6 passed, npm run build passed, /health 200, /openapi.json 200.

### 8. P1: Redis rate limiting и Pub/Sub

Запрос:

> Продолжай по `.agents/MEMORY.md`: начни P1 с Redis rate limiting и Pub/Sub
> для SSE/WebSocket, не меняя API. Сначала добавь тесты на многопроцессное
> поведение и обнови память по итогам.

Сделано:

- добавлен `rate_limit.py`: общий Redis-счётчик с in-process fallback;
- auth `send-code`/`verify-code` переведены на общий лимитер, API не изменён;
- `realtime.py` получил Redis Pub/Sub для SSE и WebSocket-чата;
- локальные WS/SSE-менеджеры остаются в каждом воркере, Redis разносит события;
- добавлены 3 многопроцессных теста: общий rate limit, SSE и WS между процессами;
- локально тесты используют RESP-заглушку, в CI — реальный `redis:7-alpine`;
- проверки: ruff passed, pytest **35 passed**, OpenAPI 30 путей, `/health` 200.

### 9. P1: write-лимиты, DB constraints, audit log, probes

Запрос:

> да делай следующие шаги

Сделано:

- write-эндпоинты trips, trip-requests, users и reviews переведены на общие
  per-user лимиты (`user:<id>:<action>`); auth остаётся на per-IP лимитах;
- добавлены CHECK-ограничения для seats, seats_taken, price_per_seat и rating;
- добавлен partial unique index `uq_trip_requests_active` для одной
  pending/accepted заявки на пару `(trip_id, requester_id)`;
- добавлен `audit_logs`: изменения статуса поездки/заявки, удаление поездки,
  доступ к платёжным реквизитам (без самих реквизитов в details);
- миграция `3b8e4c1d9f2a` нормализует legacy-данные, затем добавляет constraints;
  проверены upgrade, downgrade и повторный upgrade на копии SQLite;
- добавлены `/ready` (DB + Redis) и `X-Request-ID` на всех HTTP-ответах;
- проверки: ruff passed, pytest **39 passed**, `alembic check` без расхождений,
  `/health` и `/ready` — 200, OpenAPI 31 путь;
- frontend не менялся; baseline 6 tests + production build остаётся в силе.

### 10. Phase A: structured logs, supply chain, Redis compose

Запрос:

> Начни Phase A: structured logs с request_id, Dependabot, pip-audit/secret
> scanning и compose для Redis.

Сделано:

- добавлен `logging_config.py`: JSON/text formatter, `request_id` ContextVar и
  logging filter; middleware пишет `request.complete`/`request.failed` с
  method, path, status_code и duration_ms;
- `X-Request-ID` теперь попадает в каждую запись лога и в ответ;
- `python-jose` заменён на `PyJWT 2.15.1`, `python-multipart` обновлён до
  `0.0.32`; `pip-audit` больше не находит известных уязвимостей;
- добавлены `pip-audit==2.10.1`, `.github/dependabot.yml`,
  `.github/workflows/security.yml` (pip-audit + gitleaks) и шаг audit в CI;
- добавлен `compose.yaml` с Redis 7 и healthcheck;
- проверки: ruff passed, pytest **41 passed**, `pip-audit` clean, YAML
  конфигов парсится, frontend baseline не менялся.

### 11. Sentry: опциональный backend + frontend

Запрос:

> Продолжи дальше.

Сделано:

- добавлен `sentry_config.py`: Sentry включается только при `SENTRY_DSN`,
  `send_default_pii=False`, тела запросов не отправляются, sample rate 0.05;
- backend вызывает `init_sentry()` после настройки логов;
- добавлен `@sentry/react` с ленивой загрузкой: без `VITE_SENTRY_DSN` SDK
  не импортируется и не делает сетевых запросов;
- `ErrorBoundary` отправляет исключения через `captureException`;
- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` и
  `VITE_SENTRY_*` добавлены в env-шаблоны и README;
- проверки: backend **43 passed**, pip-audit clean, frontend 6 passed,
  production build passed, `npm audit --omit=dev` — 0 уязвимостей.

### 12. Ручной Render и runbook для staging/backups

Запрос:

> продолжай теперь.

Сделано:

- Render Blueprints (`render.yaml`, `render.staging.yaml`) были добавлены,
  но по следующему запросу удалены: IaC в проекте не используется;
- `docs/RUNBOOK.md` переведён на ручную настройку Render: web service,
  managed Postgres, Key Value, `/ready`, pre-deploy `alembic upgrade head`;
- в runbook описаны отдельные staging-ресурсы, PITR (3/7 дней в зависимости
  от workspace), логические бэкапы, quarterly restore drill и rollback rules.

### 13. P2 deep links

Запрос:

> работай дальше.

Сделано:

- добавлен `react-router-dom` и `BrowserRouter`;
- маршруты `/`, `/matches`, `/scheduled`, `/profile`, `/settings`, `/history`,
  `/trips/:id`;
- deep link `/trips/:id` загружает поездку через новый participant-only
  `GET /trips/{trip_id}`; посторонним отдаётся 404, телефоны и платёжные
  реквизиты не добавляются в response;
- для Vercel добавлен `birge/vercel.json` с SPA rewrite;
- active trip сохраняет приоритет на bare `/`, `/scheduled` канонизируется в
  `/trips/:id`;
- добавлены тесты маршрутов; backend **44 passed**, frontend **10 passed**,
  production build и deep-link HTTP 200 проверены.

### 14. P2 OpenAPI-типы

Запрос:

> продолжай.

Сделано:

- backend-скрипт `scripts/export_openapi.py` детерминированно пишет
  `birge/openapi.json` (31 path, 18 schemas);
- добавлен `openapi-typescript` и команда `npm run api:types`;
- сгенерирован `src/types/api.d.ts` (2166 строк) и подключён через JSDoc к
  `api.getTrip`; runtime-бандл не меняется;
- CI проверяет drift `openapi.json` и `api.d.ts`;
- обновлены README/ROADMAP/HANDOFF/MEMORY.

### 15. P2 accessibility baseline

Запрос:

> делай.

Сделано:

- добавлены skip-link, маршрутный focus на `<main>`, глобальный focus-ring и
  `prefers-reduced-motion`;
- кликабельные `div` заменены на нативные кнопки/ссылки: бренд, аватар,
  карточка авто, предупреждение водителя;
- form labels связаны через `htmlFor`/`id`, ошибки получили `role="alert"` и
  `aria-describedby`;
- `AddressInput` стал combobox: ArrowUp/ArrowDown/Enter/Escape,
  `aria-activedescendant`, listbox/option;
- ReviewModal и TripRequestModal получили `role="dialog"`, Escape, начальный
  focus и focus trap; toast/live-region состояния размечены;
- icon-only кнопки получили `aria-label`; обновлены контрастные text/focus
  токены и текст на светлых модалках;
- добавлены 3 a11y-теста; frontend **14 passed** в 6 файлах, build passed.

## Ключевые решения

- Все правки — только в `birge-professional`.
- API-пути и response-модели сохраняются; изменения проверяются HTTP-тестами
  и OpenAPI.
- Схема БД управляется Alembic, без `create_all` в production.
- Access-токен 60 минут, refresh 30 дней; WS использует отдельный ticket.
- CORS — явный allowlist из env.
- Админские операции — только по `ADMIN_PHONES`.
- Internal sync endpoint выключен по умолчанию.
- ImgBB-ключ живёт только на backend.
- Production frontend не должен содержать localhost.
- Realtime использует Redis Pub/Sub при `REDIS_URL`; иначе in-process fallback.

## Что осталось

- P0 закрыт: WS/SSE, trip-request и `App.jsx` разделены;
- в `main.py` остались reviews, Telegram/internal, admin cleanup и lifecycle;
- P1: Redis Pub/Sub, auth/write rate limiting, DB constraints, audit log,
  `/ready`, JSON-логи и request id готовы; supply-chain проверки настроены;
- Sentry SDK готов; нужен DSN/project и проверка событий;
- Render настраивается вручную; backup/restore runbook готов;
- дальше выполнить Render setup, restore drill и проверить workflows на GitHub;
- P2 deep links, OpenAPI-типы и accessibility-baseline готовы; дальше
  automated axe/visual contrast sweep, i18n, аналитика, ETA/маршруты,
  модерация, export/delete;
- P2 — см. `docs/ROADMAP.md`.
