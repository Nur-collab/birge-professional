# Birge — handoff

Дата среза: **2026-11-27**

Этот документ описывает текущее состояние рабочей копии, проверки и следующие
шаги. Он предназначен для продолжения работы с другого аккаунта или компьютера.

## 1. Где лежит проект

```text
C:\Users\User\.gemini\antigravity\scratch\birge-professional\
├── birge\              # React + Vite PWA
├── birge-backend\      # FastAPI + SQLAlchemy + Alembic
├── .backups\           # локальные зашифрованные дампы; в git не попадают
├── docs\
│   ├── HANDOFF.md      # этот файл
│   ├── RUNBOOK.md      # staging, backup and restore
│   ├── MIGRATIONS.md
│   └── ROADMAP.md
└── .github\workflows\ci.yml
```

Оригиналы `..\birge\` и `..\birge-backend\` не изменяются. Рабочая копия —
отдельный репозиторий `Nur-collab/birge-professional`, ветка `main`.

Локальные `venv`, `node_modules`, `.env*`, `dist`, `*.db` и `.backups` при
переносе не копируются в git; их нужно пересоздать или перенести отдельно.

## 2. С чего продолжить

> Прочитай `birge-professional/docs/HANDOFF.md`, `docs/RUNBOOK.md` и
> `docs/ROADMAP.md`. Продолжай с незакрытых пунктов, не меняя API без
> необходимости и не коммитя секреты.

Дальше работайте только в `birge-professional`.

## 3. Текущий статус

### Production

| Компонент | Фактическое значение |
| --- | --- |
| Frontend | https://birge-professional.vercel.app |
| Backend | https://birge-api.onrender.com |
| Git HEAD | `1255702` (`Add automated axe WCAG 2.1 AA audit, contrast fixes, and full RU/KY i18n`) |
| Vercel production | `Ready`, commit `1255702` (`https://birge-professional.vercel.app` → 200) |
| Render web | `birge-api` (`srv-dbs1hjrl550s73f6np5g`), free, Oregon, root `birge-backend` |
| Последний backend-деплой | `dep-dc4irdei0phs73ad4df0` — `live`, commit `1255702` (rotation, 2026-11-27) |
| Postgres | `birge-postgres` (`dpg-dbs1f6afngtc73bfaju0-a`), PostgreSQL **18.6**, free, 8894 kB; default credential `birge_app_20261127` |
| Postgres expiry | **2026-12-14 08:11 UTC** — free-база будет удалена |
| Postgres plan | free; до 13.12 upgrade до paid `0.1c-256mb` ($6/мес), in-place |
| Credential rotation | 2026-11-27; старый default деактивирован; подробности RUNBOOK §10 |
| Backup | `.backups/birge-20261127-1255.dump.gpg` + checksum + manifest |
| Key Value | `birge-redis`, free 25 MB, persistence off |
| Alembic revision | `a7f1c3e8b9d2` (head) |
| Health / readiness | `/health` — 200, `/ready` — 200 после прогрева |
| Health check path в Render | `/health` (liveness; переключено с `/ready` 2026-11-27); `/ready` проверяется после deploy и вручную |
| Sentry backend | `SENTRY_DSN` задан; в логах `sentry.initialized`, environment `production` |
| Sentry frontend | `VITE_SENTRY_DSN` задан в Vercel Production/Preview; `SENTRY_AUTH_TOKEN` — Production |
| CORS | `ALLOWED_ORIGINS=https://birge-professional.vercel.app` |
| Telegram | `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` заданы; webhook зарегистрирован |

Free-план: web засыпает после простоя (первый запрос может занять 20+ секунд),
Pre-Deploy недоступен, миграции выполняются в start command. У Postgres нет
PITR/автобэкапов, база удаляется 14.12.2026. Решение: поднять существующую
`birge-postgres` in-place до paid `0.1c-256mb` ($6/мес) до 13.12; переезд
на Neon отменён — RUNBOOK §11.

### Engineering baseline

| Пункт | Статус |
| --- | --- |
| CI backend lint/tests + frontend build | готово; `CI` и `Security` зелёные на `1255702` |
| Backend tests | **95 passed**, `ruff` чист |
| Frontend tests | **45 passed** (12 файлов) + **9 E2E passed** (`@axe-core/playwright` WCAG 2.1 AA, SSE, login), production build проходит |
| Локализация & A11y | Полное `ru`/`ky` покрытие (`i18n.js` + `<html lang>` sync) и контраст/ARIA-метки без нарушений |
| OpenAPI | 40 paths; `openapi.json` и `src/types/api.d.ts` без drift |
| Dependency audit | `npm audit --omit=dev` — 0; `pip-audit` — без известных уязвимостей |
| Secret scan | в git только `.env.example`/`.env.production.example` |
| Access/refresh JWT | готово; refresh — HttpOnly cookie, CSRF, rotation/replay detection |
| WebSocket/SSE tickets | готово; revocation через `token_version` |
| Redis rate limiting/PubSub | готово; без `REDIS_URL` — in-process fallback |
| DB constraints/audit log | готово |
| Разделение `main.py` | `main.py` — 260 строк; routers вынесены |
| Backup/restore | зашифрованный дамп и restore drill на PostgreSQL 18.6 выполнены 2026-11-27 |

### Auth flow

Основной вход — Telegram-first:

```text
POST /auth/telegram-challenge        -> challenge_id, verifier, telegram_url
POST /auth/telegram-challenge/status -> pending | bot_started | verified | expired
POST /auth/telegram-challenge/complete -> access token + refresh cookie
```

Legacy-флоу по коду сохранён для привязанных номеров:

```text
POST /auth/send-code   -> нейтральный ответ, код доставляется Telegram-ботом
POST /auth/verify-code -> access token + refresh cookie
```

`send-code` не раскрывает, привязан ли номер, и удаляет код, если доставка
невозможна. Оба флоу используют per-IP лимиты; IP берётся из
`x-auth-client-ip` только при валидной подписи Vercel-прокси.

### Структура backend

```text
routers/auth.py           # /auth/*, cookies, CSRF, Telegram challenge
routers/users.py          # /users/*
routers/trips.py          # /trips/*
routers/trip_requests.py  # /trip-requests/*, SSE
routers/chat.py           # WebSocket-чат
routers/reviews.py        # /reviews/
routers/bot.py            # /bot/webhook, /internal/get-binding
routers/admin.py          # /admin/cleanup-trips
trip_maintenance.py       # cleanup_stale_trips, reminder_loop
realtime.py               # WebSocket/SSE state
sentry_config.py          # init_sentry, auth-proxy alert
rate_limit.py             # Redis/in-process limiter
```

## 4. Проверки, которые проходят

Последний подтверждённый прогон (2026-11-27, HEAD `1255702`):

```text
backend:
  ruff check .                 -> passed
  pytest -q                    -> 95 passed
frontend:
  npm test                     -> 45 passed (12 files)
  npm run build                -> passed
  npm run e2e                  -> 9 passed (включая a11y.spec.js на PG 16.2)
  npm run api:types            -> без diff
database:
  alembic current              -> a7f1c3e8b9d2 (head)
  OpenAPI export               -> без diff (40 paths)
live:
  GET https://birge-professional.vercel.app -> 200 (Ready)
  GET https://birge-api.onrender.com/health -> 200
  GET https://birge-api.onrender.com/ready  -> 200
  /openapi.json                             -> 404 by design (docs disabled in production)
sentry:
  Render logs                               -> sentry.initialized, environment=production
```

`/openapi.json` в production намеренно отключён; контракт экспортируется
скриптом `birge-backend/scripts/export_openapi.py` и проверяется в CI.

## 5. API и OpenAPI

`birge/openapi.json` — закоммиченный контракт (40 paths). После изменения
backend-схем:

```bash
cd birge-backend
./venv/Scripts/python.exe scripts/export_openapi.py
cd ../birge
npm run api:types
```

Основные группы:

```text
/auth/*        send-code, verify-code, telegram-challenge, status, complete,
               login-code, exchange-code, refresh, logout
/users/*       me (GET/PATCH/DELETE), me/export, me/photo, me/verify, me/trips,
               me/active-trip, me/scheduled-trips, {user_id}
/trips/*       create, matches, detail, delete, status, passengers, payment,
               messages, panic, ws-ticket
/trip-requests/* create, incoming, update, status, SSE, sse-ticket
/reviews/      create/list
/health        liveness
/ready         readiness (DB + optional Redis)
```

WebSocket `/ws/chat/{trip_id}/{user_id}` в OpenAPI не попадает.

## 6. Backup и restore (2026-11-27)

Актуальный артефакт:

```text
.backups/birge-20261127-1255.dump.gpg          # 8.5 KB, GPG AES256
.backups/birge-20261127-1255.dump.gpg.sha256   # 95932ff4...
.backups/birge-20261127-1255.manifest.txt
```

Параметры:

- источник: `birge_production`, PostgreSQL 18.6, 8894 kB;
- plaintext SHA-256: `9fd9f46e22f6c9845c863b82b0916796c55da9d338f2f0604111f625ecb958cb`;
- encrypted SHA-256: `95932ff4958a6355271b92132d6063bd3c219f4711593d515b75032f9f0e7369`;
- revision: `a7f1c3e8b9d2`;
- counts: `users=2, trips=2, trip_requests=1, chat_messages=3, reviews=2,
  telegram_bindings=2, refresh_sessions=7, audit_logs=7, sms_codes=2,
  login_codes=0, telegram_auth_challenges=0`, остальные таблицы пустые;
- пароль шифрования: `birge-20261115-1103.key` (baseline key, escrow в Google
  Password Manager);
- plaintext-дамп после шифрования и проверки расшифровки удалён.

Restore drill:

- выполнен в отдельной временной базе PostgreSQL 18.6 (официальные EDB
  binaries), `pg_restore`/`psql` 18.6;
- фильтрация `transaction_timeout` не понадобилась: source и target — PG18.6;
- `pg_restore` exit 0; `alembic current` = `a7f1c3e8b9d2` (head),
  `alembic check` — `No new upgrade operations detected`; все counts совпали;
  `/ready` вернул `{"status":"ready"}`;
- production не изменялся.

Доступ к production БД был открыт только на время дампа: временный IP добавлен
и сразу удалён; `ipAllowList` снова пуст. После upgrade Render Postgres до
paid-плана повторить restore в отдельную временную базу — RUNBOOK §11.

Внешняя копия (Google Drive/другое private storage) с этой машины не
загружалась. Нужно скопировать `.gpg`, `.sha256` и manifest в private storage,
а ключ хранить отдельно.

## 7. Безопасность и конфигурация

Production-секреты задаются только в Render/Vercel, не в git и не в чате.
Обязательные/важные переменные:

```text
ENVIRONMENT=production
SECRET_KEY=<long random>
PII_ENCRYPTION_KEY=<long random; не ротировать без re-encryption>
OTP_HASH_KEY=<optional separate random key>
DATABASE_URL=<Render Postgres internal DSN; при upgrade не меняется>
ALLOWED_ORIGINS=https://birge-professional.vercel.app
AUTH_COOKIE_PATH=/api/auth
AUTH_PROXY_SECRET=<same value as Vercel ORIGIN_SECRET>
TELEGRAM_BOT_TOKEN=<production bot token>
TELEGRAM_WEBHOOK_SECRET=<random webhook secret>
ADMIN_PHONES=<comma-separated admin phones>
REDIS_URL=<Render Key Value>
SENTRY_DSN=<set; enables backend Sentry>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.05
LOG_LEVEL=INFO
INTERNAL_SYNC_ENABLED=false
```

Vercel:

```text
VITE_API_URL=https://birge-api.onrender.com
VITE_SENTRY_DSN=<public DSN>
VITE_SENTRY_ENVIRONMENT=production
SENTRY_AUTH_TOKEN=<secret, source map upload>
ORIGIN_SECRET=<same as AUTH_PROXY_SECRET>
```

`AUTH_PROXY_SECRET` обязателен в production: без него backend падает на старте.
Пустой `SENTRY_DSN` даёт CRITICAL в логах, но не роняет деплой.

- **Credential rotation 2026-11-27:** default `birge_app_20261127`; старый
  `birgepostgres_csld_user` удалён/деактивирован; `DATABASE_URL` обновлён,
  deploy `dep-dc4irdei0phs73ad4df0` live, `/ready` 200, allowlist `[]`.
  Пароли и connection strings в репозиторий/доки не попадали.

## 8. Риски и следующие шаги

P0:

1. **Postgres удаляется 14.12.2026.** До 13.12 поднять существующую
   `birge-postgres` in-place до paid `0.1c-256mb` ($6/мес); переезд на Neon
   отменён. Свежий encrypted dump и restore drill на PG18.6 уже есть;
   после upgrade проверить `/ready`, counts и PITR — RUNBOOK §11.
2. Для Render `healthCheckPath` оставлять `/health` (переключено с `/ready` 2026-11-27); `/ready` проверять после deploy и вручную.
3. Проверить в Sentry alert rule на `auth.proxy=unsigned` и на новые issues;
   подтвердить доставку тестового уведомления.

P1:

- задать `VITE_SENTRY_RELEASE`/release из `VERCEL_GIT_COMMIT_SHA`, чтобы source
  maps совпадали с событиями;
- не включать частый внешний uptime-мониторинг без необходимости: он
  создаёт лишний трафик и шум; Sentry/логи + ручная проверка;
- решить, нужен ли fallback входа для пользователей без Telegram;
- staging с отдельными БД/Redis/секретами;
- разбить крупные модули: **выполнено 2026-11-27** (`Login.jsx` 1723→163 строки в `screens/login/*`; `api.js` 790→30 строк фасад над `utils/api/{client,auth,users,trips,chat}.js`; все 19 JSX `<style>`-блоков вынесены в `.css`);
- Build Filters на Render настроены (`paths: birge-backend/**`, `ignoredPaths`: `tests/**`, `scripts/**`, `requirements-dev.txt`, `requirements-e2e.txt`, `**/*.md`) в дополнение к `rootDir: birge-backend`.

P2 (остаток из `docs/ROADMAP.md`; базовый WCAG audit, полное `ru`/`ky` i18n и экспорт/удаление аккаунта закрыты):

- воронка поиск → заявка → принятие → поездка → отзыв;
- ETA/коридоры, повторяющиеся поездки, политика отмен;
- модерация/жалобы/support.

## 9. Полезные команды

```bash
# backend
cd birge-backend
./venv/Scripts/python.exe -m pytest -q
./venv/Scripts/python.exe -m ruff check .
./venv/Scripts/python.exe -m alembic current

# frontend
cd birge
npm test
npm run build
npm run api:types

# production probes
curl -fsS https://birge-api.onrender.com/health
curl -fsS https://birge-api.onrender.com/ready

# Render CLI
render whoami
render services
render deploys list srv-dbs1hjrl550s73f6np5g -o json
render logs --resources srv-dbs1hjrl550s73f6np5g --limit 200
```

Перед изменением API сначала добавьте/обновите HTTP-регрессионный тест, затем
проверьте `ruff`, `pytest`, OpenAPI и production frontend build.
