# Birge — handoff

Дата среза: **2026-11-13**

Этот документ описывает состояние рабочей копии, все выполненные изменения,
команды проверки и следующие шаги. Он предназначен для продолжения работы
с другого аккаунта или компьютера.

## 1. Где лежит проект

Рабочая копия:

```text
C:\Users\User\.gemini\antigravity\scratch\birge-professional\
├── birge\              # frontend: React + Vite PWA
├── birge-backend\      # backend: FastAPI + SQLAlchemy + Alembic
├── docs\
│   ├── HANDOFF.md      # этот файл
│   ├── CHAT_HISTORY.md # краткая история сессии
│   ├── MIGRATIONS.md
│   └── ROADMAP.md
└── .github\workflows\ci.yml
```

Оригиналы, которые **не изменялись**:

```text
C:\Users\User\.gemini\antigravity\scratch\birge\
C:\Users\User\.gemini\antigravity\scratch\birge-backend\
```

Копия специально отделена от оригиналов. В копии нет `.git`, поэтому она
не связана с исходными репозиториями. При переносе на другой компьютер
достаточно скопировать папку `birge-professional` целиком, кроме локальных
`venv`, `node_modules`, `.env*`, `dist` и `*.db` (их лучше пересоздать).

## 2. С чего продолжить

Для нового аккаунта/чата начните с фразы:

> Прочитай `birge-professional/docs/HANDOFF.md`, `docs/CHAT_HISTORY.md` и
> `docs/ROADMAP.md`. Продолжай с незакрытых пунктов P0, не меняя API без
> необходимости.

Дальше работайте только в `birge-professional`; оригинальные папки не трогайте.

## 3. Текущий статус

### P0 — engineering baseline

| Пункт | Статус |
|---|---|
| Отдельная рабочая копия | готово |
| README и `.env.example` | готово |
| Зафиксированные зависимости | готово |
| CI для backend lint/tests и frontend build | готово (workflow создан, но на GitHub ещё не запускался) |
| Удалён мёртвый frontend-код | готово |
| Защита admin/internal endpoints и CORS | готово |
| Серверная загрузка фото | готово (код и тесты; реальный ImgBB не проверялся без ключа) |
| Access/refresh JWT | готово |
| WebSocket tickets | готово |
| Alembic и индексы | готово |
| Backend HTTP-тесты | готово |
| Frontend-тесты | готово |
| Windows-safe UTF-8 | готово |
| Разделение `main.py` | готово (WS/SSE и trip-request вынесены) |
| Разделение `App.jsx` | готово (hooks + storage helper) |

Что уже вынесено из `main.py`:

```text
birge-backend/routers/auth.py     # /auth/*
birge-backend/routers/users.py    # /users/*
birge-backend/routers/trips.py    # /trips/* и платёжные реквизиты
birge-backend/routers/trip_requests.py # /trip-requests/* и SSE
birge-backend/routers/chat.py     # WebSocket-чат поездки
birge-backend/dependencies.py     # get_current_user, get_current_admin
birge-backend/time_utils.py       # время Бишкека
birge-backend/realtime.py         # WebSocket/SSE state + is_trip_participant
```

В `main.py` пока остались:

- отзывы `/reviews/`;
- Telegram webhook `/bot/webhook` и `/internal/get-binding`;
- админский cleanup `/admin/cleanup-trips`;
- lifecycle-задачи и фоновые циклы (напоминания, автоочистка).

### P1/P2

Полный список — в `docs/ROADMAP.md`. Ближайшие production-задачи:

1. Redis Pub/Sub, auth rate limiting и write-лимиты внедрены. `REDIS_URL`
   включает Redis; пустой URL оставляет in-process режим.
2. DB CHECK-ограничения, partial unique index и audit log внедрены.
3. `/health` — liveness, `/ready` — readiness (DB + Redis); ответы содержат
   `X-Request-ID`; JSON-логи включают request id.
4. Sentry SDK подключён к backend и frontend; нужен DSN и проверка событий.
5. Render настраивается вручную по `docs/RUNBOOK.md`; выполнить setup и restore drill.
6. Dependabot, `pip-audit` и gitleaks настроены; нужно проверить в GitHub.

P2: deep links, OpenAPI-типы и accessibility-baseline готовы; дальше
automated axe/visual contrast sweep, i18n, аналитика воронки, ETA/маршруты,
модерация, export/delete данных.

## 4. Проверки, которые проходят

Последний подтверждённый прогон:

```text
backend:
  ruff check .                 -> passed
  pytest -q                    -> 44 passed (Redis multiprocess + write/constraints/audit/readiness/logging/Sentry/trip detail)
frontend:
  npm test                     -> 14 passed (routing + API + date + a11y)
  npm run build                -> passed
  npm run api:types            -> passed (src/types/api.d.ts, 2166 lines)
database:
  alembic upgrade head         -> passed
  alembic check                -> no new upgrade operations
live:
  GET /health                  -> 200
  GET /ready                   -> 200
  GET /openapi.json            -> 200 (31 paths)
```

Команды для повторной проверки (Windows):

```bash
cd C:\Users\User\.gemini\antigravity\scratch\birge-professional\birge-backend
.\venv\Scripts\ruff.exe check .
.\venv\Scripts\python.exe -m pytest -q
.\venv\Scripts\alembic.exe upgrade head
.\venv\Scripts\uvicorn.exe main:app --reload --port 8000
```

```bash
cd C:\Users\User\.gemini\antigravity\scratch\birge-professional\birge
npm test
npm run build
npm run dev
```

Если `venv` или `node_modules` отсутствуют на новом компьютере, установите
зависимости по инструкции из корневого `README.md`.

## 5. API и OpenAPI

Проверено, что в OpenAPI присутствуют:

```text
/users/me                 GET, PATCH
/users/{user_id}          GET
/users/me/photo           POST
/users/me/trips           GET
/users/me/active-trip     GET
/users/me/verify          POST
/users/me/scheduled-trips GET

/trips/                        POST
/trips/matches                 GET
/trips/{trip_id}               GET (driver/accepted participant only), DELETE
/trips/{trip_id}/ws-ticket     POST
/trips/{trip_id}/messages      GET, POST
/trips/{trip_id}/status        PATCH
/trips/{trip_id}/panic         POST
/trips/{trip_id}/passengers    GET
/trips/{trip_id}/payment       GET

/trip-requests/                     POST
/trip-requests/incoming/            GET
/trip-requests/{request_id}         PATCH
/trip-requests/status/{trip_id}     GET
/trip-requests/driver-events/{driver_id} GET (SSE)
/trip-requests/events/{requester_id}     GET (SSE)
```

WebSocket `/ws/chat/{trip_id}/{user_id}` зарегистрирован, но в OpenAPI не попадает.

`birge/openapi.json` экспортируется скриптом
`birge-backend/scripts/export_openapi.py` (31 path, 18 schemas), а
`npm run api:types` генерирует `birge/src/types/api.d.ts`. JSDoc в
`birge/src/utils/api.js` использует сгенерированный `Trip`.

Схемы ответов сохранены: `/users/me` → `User`, `/users/{user_id}` →
`UserPublic`, `POST /trips/` → `Trip`.

HTTP-регрессия users лежит в `tests/test_users_http.py` (5 тестов).
HTTP-проверки trips добавлены в `tests/test_api.py`, включая OpenAPI и
сценарий create → matches → status → delete.

## 6. Безопасность и конфигурация

В копии есть локальные, **некоммитимые** файлы:

- `birge-backend/.env` — локальный dev `SECRET_KEY`, SQLite;
- `birge/.env.development.local` — локальный `VITE_API_URL`;
- `.env.production.example` — только шаблон.

Не копируйте production-секреты в репозиторий и не вставляйте их в чат.
Для production нужны как минимум:

```text
ENVIRONMENT=production
SECRET_KEY=<long random>
DATABASE_URL=postgresql://...
ALLOWED_ORIGINS=https://<frontend>
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
ADMIN_PHONES=...
REDIS_URL=redis://<redis-host>:6379/0
```

`IMGBB_API_KEY` нужен только для загрузки фото. Без него endpoint корректно
возвращает `503`.

Frontend production build:

- локальный URL должен быть в `.env.development.local`, **не** в `.env.local`;
- production URL задаётся в `.env.production` или в env хостинга;
- `vite.config.js` намеренно падает, если production `VITE_API_URL` указывает
  на `localhost`, `127.0.0.1` или `0.0.0.0`.

Backend deployment:

- Render настраивается вручную: web service, managed Postgres, Key Value;
- root directory: `birge-backend`; runtime: Python 3;
- web-команда: `uvicorn main:app --host 0.0.0.0 --port $PORT`;
- миграции: `alembic upgrade head` отдельным Pre-Deploy шагом;
- health check: `/ready` (Postgres + Redis);
- используйте платные Postgres/Key Value для production; проверьте plan/region;
- staging — отдельные сервисы, БД, Redis и секреты;
- backup/restore: `docs/RUNBOOK.md`;
- `Procfile` содержит `release: alembic upgrade head`; на Render продублируйте
  это в **Pre-Deploy Command** сервиса.

## 7. Важные оговорки

- Git-репозиторий создан, но remote ещё не настроен; CI на GitHub не запускался.
  Локально те же команды проходят.
- Реальные Telegram, ImgBB, PostgreSQL и Render-сценарии не проверялись.
- Frontend UI вручную не прокликивался; проверены тесты и production build.
- `npm audit`: 6 low/moderate только в dev/build/PWA-цепочке, high/critical нет; `npm audit --omit=dev` — 0.
- `pytest` предупреждает о будущем `httpx2` в Starlette TestClient; это не ошибка.
- Realtime использует Redis Pub/Sub при `REDIS_URL`; без него работает
  in-process fallback для локальной разработки.
- Redis multiprocess-тесты локально используют RESP-заглушку; в CI — реальный
  сервис `redis:7-alpine`. Write-лимиты и Redis Pub/Sub реализованы.

## 8. Следующие шаги

1. P0 закрыт: WS/SSE, trip-request и `App.jsx` разделены.
2. P1-код закрыт: Redis Pub/Sub, rate limiting, write-лимиты, DB constraints,
   audit log, `/ready`, JSON-логи, Sentry SDK и backup/restore runbook.
3. Настроить Render вручную по `docs/RUNBOOK.md`, заполнить секреты,
   проверить `/ready` и провести restore drill.
4. Проверить Dependabot, gitleaks и CI на GitHub после настройки remote.
5. P2: deep links, OpenAPI-типы и accessibility-baseline сделаны; дальше
   axe/visual contrast sweep, i18n, аналитика, ETA/маршруты, модерация,
   export/delete.

Перед изменениями API сначала добавляйте/обновляйте HTTP-регрессионный тест,
затем проверяйте `ruff`, `pytest`, OpenAPI и production frontend build.
