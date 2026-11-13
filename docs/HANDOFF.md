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

1. Redis Pub/Sub для SSE/WebSocket (сейчас состояние в памяти одного процесса).
2. Redis rate limiting для auth/write-эндпоинтов.
3. Sentry, структурные логи и request id.
4. Readiness/liveness probes.
5. Staging, backup/restore drill.
6. Dependabot, `pip-audit`, secret scanning.

P2: React Router/deep links, TypeScript/OpenAPI-типы, accessibility, i18n,
аналитика воронки, ETA/коридоры маршрутов, модерация, export/delete данных.

## 4. Проверки, которые проходят

Последний подтверждённый прогон:

```text
backend:
  ruff check .                 -> passed
  pytest -q                    -> 31 passed
frontend:
  npm test                     -> 6 passed
  npm run build                -> passed
database:
  alembic upgrade head         -> passed
  alembic check                -> no new upgrade operations
live:
  GET /health                  -> 200
  GET /openapi.json            -> 200 (30 paths)
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
/trips/{trip_id}/ws-ticket     POST
/trips/{trip_id}/messages      GET, POST
/trips/{trip_id}/status        PATCH
/trips/{trip_id}               DELETE
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
```

`IMGBB_API_KEY` нужен только для загрузки фото. Без него endpoint корректно
возвращает `503`.

Frontend production build:

- локальный URL должен быть в `.env.development.local`, **не** в `.env.local`;
- production URL задаётся в `.env.production` или в env хостинга;
- `vite.config.js` намеренно падает, если production `VITE_API_URL` указывает
  на `localhost`, `127.0.0.1` или `0.0.0.0`.

Backend deployment:

- web-команда: `uvicorn main:app --host 0.0.0.0 --port $PORT`;
- миграции: `alembic upgrade head` отдельным release/Pre-Deploy шагом;
- `Procfile` содержит `release: alembic upgrade head`; на Render продублируйте
  это в **Pre-Deploy Command** сервиса.

## 7. Важные оговорки

- CI workflow создан, но ещё не запускался на GitHub: в копии нет `.git`/remote.
- Реальные Telegram, ImgBB, PostgreSQL и Render-сценарии не проверялись.
- Frontend UI вручную не прокликивался; проверены тесты и production build.
- `npm audit`: 6 low/moderate в build/PWA-цепочке, high/critical нет.
- `pytest` предупреждает о будущем `httpx2` в Starlette TestClient; это не ошибка.
- Realtime остаётся single-process; не масштабировать на несколько воркеров
  без Redis Pub/Sub.

## 8. Следующие шаги

1. P0 закрыт: WS/SSE, trip-request и `App.jsx` разделены.
2. Перейти к P1: Redis Pub/Sub, rate limiting, observability, staging/backup.
3. После этого — P2 product/UX.

Перед изменениями API сначала добавляйте/обновляйте HTTP-регрессионный тест,
затем проверяйте `ruff`, `pytest`, OpenAPI и production frontend build.
