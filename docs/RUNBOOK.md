# Staging, backups and restore drill

## 0. Текущий production-деплой

Срез: **2026-11-27**. Git HEAD `1255702`; Vercel production `Ready` на
`1255702` (`https://birge-professional.vercel.app` → HTTP 200).
Последний backend-деплой Render — `dep-dc4irdei0phs73ad4df0` live,
commit `1255702` (2026-11-27, credential rotation).

| Компонент | Фактическое значение |
| --- | --- |
| Frontend | https://birge-professional.vercel.app |
| Backend | https://birge-api.onrender.com |
| Render web service | `birge-api` (`srv-dbs1hjrl550s73f6np5g`), free, Oregon, root `birge-backend` |
| Postgres | `birge-postgres` (`dpg-dbs1f6afngtc73bfaju0-a`), PostgreSQL **18.6**, free, 8894 kB; default credential `birge_app_20261127` |
| Postgres expiry | **2026-12-14 08:11 UTC** — free-база будет удалена |
| Credential rotation | 2026-11-27; старый default деактивирован; подробности §10 |
| Key Value | `birge-redis`, free 25 MB, persistence off |
| Alembic revision | `a7f1c3e8b9d2` (head) |
| Health / readiness | `https://birge-api.onrender.com/health`, `https://birge-api.onrender.com/ready` |
| Health check path в Render | `/health` (переключено с `/ready` 2026-11-27); `/ready` проверять после deploy и вручную |
| CORS | `ALLOWED_ORIGINS=https://birge-professional.vercel.app` |
| Telegram | `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` заданы; webhook зарегистрирован |
| Sentry | backend `SENTRY_DSN` задан, в логах `sentry.initialized`; frontend `VITE_SENTRY_DSN` и `SENTRY_AUTH_TOKEN` заданы |
| Backup | `.backups/birge-20261127-1255.dump.gpg` (AES256) + checksum + manifest |

Текущий деплой использует free-план Render. Pre-Deploy Command недоступен,
поэтому start command: `alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port $PORT`.
Free Postgres не имеет PITR/автобэкапов и будет удалён 14.12.2026. До этой
даты `birge-postgres` поднимается in-place до paid `0.1c-256mb` ($6/мес;
PITR 3 дня). Free Key Value имеет 25 MB и не сохраняет данные при рестарте;
web-сервис засыпает после простоя (первый запрос может занять 20+ секунд).
Переезд на другую managed-БД не планируется; подробности — §11.

Runbook for the manual Render setup. Render Blueprints/IaC are intentionally not
used in this repository; the backend, Postgres and Key Value resources are
created in the Render Dashboard.

## 1. Environment map

| Environment | Branch | Web service | Database | Redis | Frontend |
| --- | --- | --- | --- | --- | --- |
| Production | `main` | `birge-api` | `birge-postgres` | `birge-redis` | Vercel production |
| Staging | `staging` | `birge-api-staging` | `birge-postgres-staging` | `birge-redis-staging` | Vercel preview/staging |

Production and staging must never share `DATABASE_URL`, `REDIS_URL`,
`SECRET_KEY`, Telegram bot tokens or Sentry projects.

## 2. First Render setup

1. Push the repository to GitHub and protect `main`.
2. Create the production **Web Service** in Render:
   - repository: this repo; branch: `main`;
   - root directory: `birge-backend`;
   - runtime: Python 3;
   - build command: `pip install -r requirements.txt`;
   - start command (free): `alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port $PORT`;
   - plan: free for the current deployment; paid (`starter` or higher) if
     Pre-Deploy and zero-downtime deploys are required;
   - health check path: пустой (TCP) или `/health`; не `/ready`;
   - pre-deploy command: unavailable on free; migrations run in the start command.
3. Create **Postgres**:
   - name: `birge-postgres`;
   - database: `birge_production`; user: generated default credential (e.g. `birgepostgres_2mdy_user`);
   - region: same as the web service;
   - plan: free for the current deployment (no PITR); use paid `basic-256mb` or higher for production;
   - networking: clear the external IP allow list so only Render's private
     network can connect.
4. Create **Key Value**:
   - name: `birge-redis`;
   - region: same as the web service;
   - plan: free `25mb` for the current deployment; `256mb` for production;
   - eviction policy: `volatile-lru`;
   - persistence: off (rate limits and Pub/Sub are ephemeral);
   - networking: internal connections only.
5. Add the web-service environment variables:

   ```text
   ENVIRONMENT=production
   PYTHON_VERSION=3.12
   SECRET_KEY=<generate a long random value>
   DATABASE_URL=<Postgres internal connection string>
   REDIS_URL=<Key Value internal connection string>
   ALLOWED_ORIGINS=https://<frontend-origin>
   AUTH_COOKIE_PATH=/api/auth
   AUTH_PROXY_SECRET=<random; must equal Vercel ORIGIN_SECRET; production startup fails without it>
   TELEGRAM_BOT_TOKEN=<production bot token>
   TELEGRAM_WEBHOOK_SECRET=<random webhook secret>
   TELEGRAM_ADMIN_CHAT_ID=<optional>
   ADMIN_PHONES=<comma-separated admin phones>
   IMGBB_API_KEY=<optional; photo upload is disabled without it>
   SENTRY_DSN=<set; enables Sentry; empty logs CRITICAL in production>
   SENTRY_ENVIRONMENT=production
   SENTRY_TRACES_SAMPLE_RATE=0.05
   LOG_LEVEL=INFO
   INTERNAL_SYNC_ENABLED=false
   ```

   Generate `SECRET_KEY` locally with:

   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

   Do not put these values in `.env.example`, the repository or chat.

   В текущем деплое `TELEGRAM_BOT_TOKEN` задан, webhook зарегистрирован на
   `https://birge-api.onrender.com/bot/webhook`; `TELEGRAM_WEBHOOK_SECRET`
   также задан. Повторная настройка и проверка описаны в §3.
6. Confirm both probes:

   ```bash
   curl -fsS https://<backend-host>/health
   curl -fsS https://<backend-host>/ready
   ```

   `/ready` checks Postgres and, when configured, Redis. В текущем Render
   `healthCheckPath` пустой — оставить TCP/`/health`; не ставить `/ready`
   в Render health check; проверять его после deploy и вручную (§11).
7. Set the frontend API URL to the backend host and add the exact frontend
   origin to `ALLOWED_ORIGINS`. Redeploy the backend after changing CORS.
   Auth uses a same-origin proxy: keep the Vercel rewrite
   `/api/auth/:path*` → `https://birge-api.onrender.com/auth/:path*` before the
   SPA catch-all, and leave `AUTH_COOKIE_PATH=/api/auth` in production. This
   makes the refresh cookie first-party; do not replace it with a direct
   cross-site `SameSite=None` cookie. Vite proxies the same `/api/auth` path in
   development and preview, so local and production exercise one cookie path.

   The same `vercel.json` must inject a signed proxy header on that rewrite
   (`routes` + `transforms`, `x-auth-proxy-secret` from `ORIGIN_SECRET`).
   Set `ORIGIN_SECRET` in Vercel (Preview and Production) and the identical
   value as `AUTH_PROXY_SECRET` on Render. Production calls
   `require_auth_proxy_secret()` at import: an empty value logs CRITICAL and
   raises `RuntimeError`, so the deploy fails instead of silently putting all
   visitors into one shared Cloudflare rate-limit bucket.

   Per-IP auth limits read `x-auth-client-ip` only when the request carries
   that secret. Vercel Routing Middleware (`proxy.js`) sets it from the
   edge-sanitized visitor address; do not read `X-Forwarded-For`, because
   Vercel forwards a caller-supplied value on external rewrites. A direct
   request to Render cannot forge the header: it has no secret, so the backend
   keys it by the Cloudflare-set `CF-Connecting-IP`. CGNAT addresses
   (`100.64.0.0/10`, common for mobile operators) are kept as valid visitor
   buckets. Do not key these limits on `CF-Connecting-IP` alone: behind the
   Vercel proxy it is the shared edge address.

   The first unsigned proxied request in a process also sends a Sentry event
   (`level=error`, fingerprint `auth-proxy-missing-origin-secret`, tag
   `auth.proxy=unsigned`), so a missing `ORIGIN_SECRET` is not visible only in
   Render logs. Configure a Sentry alert rule on that tag (or on error-level
   issues) if the project does not already notify on new issues. Without
   `SENTRY_DSN` the event is a no-op, so production `init_sentry()` logs
   CRITICAL at startup: a disabled alert is visible in Render logs instead of
   failing silently.
8. Webhook обычно регистрируется автоматически при старте backend. Ручная
   регистрация и полная проверка Telegram-входа описаны в §3.

   ```bash
   curl -fsS "https://api.telegram.org/bot<token>/setWebhook" \
     --data-urlencode "url=https://<backend-host>/bot/webhook" \
     --data-urlencode "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

## 3. Вход через Telegram

Вход по коду и Telegram-first challenge работают только после привязки номера
к Telegram-боту. Токен бота — секрет; не коммитьте его и не вставляйте в чат.

В текущем деплое `TELEGRAM_BOT_TOKEN` задан, webhook зарегистрирован на
`https://birge-api.onrender.com/bot/webhook`, `TELEGRAM_WEBHOOK_SECRET` задан.
Успешная доставка требует привязки номера через `@BirgeAuthBot`.

### 3.1 Привязка номера

1. Получите токен у @BotFather, если настраиваете нового бота.
2. Render Dashboard → `birge-api` → **Environment** → добавьте
   `TELEGRAM_BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET` (секрет можно сгенерировать
   кнопкой **Generate**).
3. Нажмите **Save, rebuild, and deploy**. При старте backend сам вызывает
   `setWebhook` для `https://birge-api.onrender.com/bot/webhook`.
4. Откройте `@BirgeAuthBot` → `/start` → **«Поделиться номером»**. Бот
   подтверждает привязку; `/status` показывает номер и профиль.

### 3.2 Telegram-first вход

1. Браузер создаёт challenge:

   ```bash
   curl -sS -X POST https://birge-professional.vercel.app/api/auth/telegram-challenge \
     -H 'Content-Type: application/json' \
     -H 'Origin: https://birge-professional.vercel.app'
   ```

   Ответ содержит `challenge_id`, `verifier`, `telegram_url`, `expires_in`.
2. Пользователь открывает `telegram_url` и подтверждает контакт в боте.
3. Браузер опрашивает статус:

   ```bash
   curl -sS -X POST https://birge-professional.vercel.app/api/auth/telegram-challenge/status \
     -H 'Content-Type: application/json' \
     --data '{"challenge_id":"...","verifier":"..."}'
   ```

   Статусы: `pending`, `bot_started`, `verified`, `expired`.
4. После `verified` браузер завершает вход:

   ```bash
   curl -sS -X POST https://birge-professional.vercel.app/api/auth/telegram-challenge/complete \
     -H 'Content-Type: application/json' \
     -H 'Origin: https://birge-professional.vercel.app' \
     --data '{"challenge_id":"...","verifier":"...","name":"Имя"}'
   ```

   Успешный ответ содержит `access_token` и `csrf_token`; refresh-токен
   приходит только в `HttpOnly` cookie `birge_refresh`.

### 3.3 Legacy-флоу по коду

Для уже привязанного номера сохранён старый вход:

```bash
curl -i -X POST https://birge-professional.vercel.app/api/auth/send-code \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://birge-professional.vercel.app' \
  --data '{"phone":"+996700000000"}'
```

Ожидаем 200 и нейтральный ответ; код приходит в Telegram. Наличие привязки
проверяйте по сообщению в боте, а не по ответу API: production намеренно не
раскрывает `tg_linked` и канал доставки.

```bash
curl -i -X POST https://birge-professional.vercel.app/api/auth/verify-code \
  -H 'Content-Type: application/json' \
  --data '{"phone":"+996700000000","code":"123456"}'
```

Успешный ответ содержит `access_token` и `csrf_token`; refresh остаётся в
`HttpOnly` cookie. `POST /api/auth/refresh` требует `X-CSRF-Token`, совпадающий
с cookie `birge_csrf`.

### 3.4 Webhook

Проверка без вывода токена:

```bash
curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | python -m json.tool
```

Ожидаем URL нового backend, `pending_update_count: 0` и отсутствие
`last_error_message`. Запрос без `X-Telegram-Bot-Api-Secret-Token` должен
вернуть 403:

```bash
curl -i -X POST https://birge-api.onrender.com/bot/webhook \
  -H 'Content-Type: application/json' --data '{}'
```

Если webhook не зарегистрировался автоматически:

```bash
curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  --data-urlencode "url=https://birge-api.onrender.com/bot/webhook" \
  --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Если использовать тот же токен, что у старого `birge-backend`, webhook
переедет на новый сервис. Для параллельной работы нужен отдельный бот/токен.

## 4. Staging

Create a second web service, Postgres and Key Value using the same steps, but:

- connect the web service to the `staging` branch;
- use `birge-api-staging`, `birge-postgres-staging` and
  `birge-redis-staging`;
- use a separate `SECRET_KEY`, database, Redis instance and Telegram bot;
- set `ENVIRONMENT=staging`, `SENTRY_ENVIRONMENT=staging`;
- point `ALLOWED_ORIGINS` at the staging frontend;
- keep `INTERNAL_SYNC_ENABLED=false` unless a test explicitly needs it.

Do not point staging at production data. A staging restore drill may use a
temporary copy, but production credentials must not be copied into staging.

## 5. Backup policy

### 5.1 Текущее ограничение

`birge-postgres` — free: автоматических бэкапов и PITR нет; база будет удалена
**2026-12-14 08:11 UTC**. Пока не выполнен upgrade, делайте ручной `pg_dump` и
храните зашифрованный дамп вне Render. Внешний доступ к БД закрыт; для дампа
временно добавьте свой IP в allow-list и сразу удалите правило.

Render continuously backs up **paid** Postgres instances for point-in-time
recovery (PITR):

- Hobby workspace: 3-day recovery window.
- Pro or higher: 7-day recovery window.
- Free Postgres: no PITR.
- PITR cannot restore to within 10 minutes of the current time.
- A restore creates a new database; the original is untouched.

### 5.2 Фактический бэкап 2026-11-27

| Поле | Значение |
| --- | --- |
| Файл | `.backups/birge-20261127-1255.dump.gpg` |
| Формат | PostgreSQL custom dump, `pg_dump` 18.6 |
| Источник | `birge_production`, PostgreSQL 18.6, 8894 kB |
| Alembic revision | `a7f1c3e8b9d2` |
| Plaintext SHA-256 | `9fd9f46e22f6c9845c863b82b0916796c55da9d338f2f0604111f625ecb958cb` |
| Encrypted SHA-256 | `95932ff4958a6355271b92132d6063bd3c219f4711593d515b75032f9f0e7369` |
| Шифрование | GPG symmetric AES256, passphrase в `birge-20261115-1103.key` |
| Restore | PostgreSQL 18.6 local, `pg_restore`/`psql` 18.6, exit 0, counts matched, `/ready` 200 |
| Внешняя копия | не загружена с этой машины; скопировать `.gpg`, `.sha256`, manifest в private storage |

Counts: `users=2, trips=2, trip_requests=1, chat_messages=3, reviews=2,
telegram_bindings=2, refresh_sessions=7, audit_logs=7, sms_codes=2,
login_codes=0, telegram_auth_challenges=0`.

Plaintext-дамп после шифрования и проверки расшифровки удалён. Ключ хранится
отдельно от зашифрованного дампа (baseline key уже занесён в Google Password
Manager); не коммитьте ни дамп, ни ключ. Restore выполнен без фильтра
`transaction_timeout`: source и target — PostgreSQL 18.6.

### 5.3 Как сделать следующий внешний дамп

1. Убедитесь, что установлен клиент PostgreSQL **не старше** сервера (сейчас
   сервер 18.6; подойдёт `pg_dump` 18.x). Встроенный `pgserver` 16.2 для дампа
   с сервера 18 не подходит.
2. Получите external connection string через CLI, не печатая его:

   ```bash
   umask 077
   render pg get birge-postgres --include-sensitive-connection-info -o json      > /tmp/birge-pg.json
   # извлеките connectionInfo.externalConnectionString в защищённый файл;
   # не выводите JSON/URL на экран и удалите /tmp/birge-pg.json после
   ```

   Не запускайте `render pg get` без redirect: флаг
   `--include-sensitive-connection-info` печатает пароль в stdout.
3. Временно добавьте текущий IP:

   ```bash
   IP=$(curl -sS https://api.ipify.org)
   render pg update birge-postgres \
     --ip-allow-list "cidr=$IP/32,description=temp-backup-$(date -u +%Y%m%d)" \
     --confirm
   ```

4. Снимите дамп и сразу закройте доступ (даже при ошибке):

   ```bash
   pg_dump "$DATABASE_URL" \
     --format=custom --no-owner --no-acl \
     --file "birge-$(date -u +%Y%m%d-%H%M).dump"
   render pg update birge-postgres --clear-ip-allow-list --confirm
   ```

   Проверьте, что `ipAllowList` снова пуст.
5. Зафиксируйте plaintext SHA-256, зашифруйте и проверьте расшифровку:

   ```bash
   sha256sum birge-YYYYMMDD-HHMM.dump
   gpg --batch --pinentry-mode loopback --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 \
     --passphrase-file birge-20261115-1103.key \
     --output birge-YYYYMMDD-HHMM.dump.gpg birge-YYYYMMDD-HHMM.dump
   sha256sum birge-YYYYMMDD-HHMM.dump.gpg
   gpg --batch --pinentry-mode loopback --decrypt --passphrase-file birge-20261115-1103.key \
     --output /tmp/verify.dump birge-YYYYMMDD-HHMM.dump.gpg
   cmp birge-YYYYMMDD-HHMM.dump /tmp/verify.dump
   ```

6. Удалите plaintext и `/tmp/verify.dump`, создайте manifest с counts,
   revision, checksums и результатом restore drill.
7. Скопируйте `.gpg`, `.sha256` и manifest в private off-site storage; ключ
   храните отдельно.

### 5.4 Перед миграцией или рисковой операцией

1. Render Dashboard → Postgres → **Recovery** (для paid) → создать on-demand
   backup.
2. Записать timestamp и Alembic revision в deployment notes.
3. Для free-базы — сделать внешний дамп по §5.3.

## 6. Restore drill

Never test a restore against production. Use a temporary database or a recovery
instance and point only staging at it.

### 6.1 Выполнено 2026-11-27

- временная локальная PostgreSQL 18.6 (официальные EDB binaries),
  `pg_restore`/`psql` 18.6;
- фильтрация `transaction_timeout` не понадобилась: source и target — PG18.6;
- restore exit 0; `alembic current` = `a7f1c3e8b9d2` (head);
  `alembic check` — `No new upgrade operations detected`;
- counts совпали с production: users=2, trips=2, trip_requests=1,
  chat_messages=3, reviews=2, telegram_bindings=2, refresh_sessions=7,
  audit_logs=7, sms_codes=2, login_codes=0, telegram_auth_challenges=0;
- backend поднят против восстановленной БД, `/ready` вернул
  `{"status":"ready"}`;
- production не изменялся.

Drill выполнен на целевой версии PostgreSQL. После upgrade Render Postgres
до paid-плана повторить restore в отдельную временную базу и проверить
`/ready`; upgrade не меняет версию PG18.6 (§11).

### 6.2 Повтор drill на свободной БД

1. Создайте временную базу (локально или отдельный Render instance). Не
   указывайте на production.
2. Восстановите дамп:

   ```bash
   pg_restore --no-owner --no-acl --clean --if-exists \
     -d "$RESTORE_DATABASE_URL" birge-YYYYMMDD-HHMM.dump
   ```

   Для PG16 и дампа PG18 удалите только строку `SET transaction_timeout = 0;`
   либо используйте сервер 18.
3. Проверьте:

   ```bash
   cd birge-backend
   DATABASE_URL="$RESTORE_DATABASE_URL" alembic current
   DATABASE_URL="$RESTORE_DATABASE_URL" alembic check
   ```

4. Сравните counts основных таблиц с production snapshot и проверьте
   `audit_logs`, `alembic_version`.
5. Запустите backend против восстановленной БД с `ENVIRONMENT=test`, пустыми
   `REDIS_URL`/Telegram/Sentry и проверьте `/ready` и read-only запрос
   (`/users/me` после логина или `/health` + `/ready`).
6. Запишите timestamp, длительность, checksum и любые расхождения. Удалите
   временную БД.

### 6.3 Paid PITR

1. В Render Postgres → **Recovery** запустить PITR на timestamp до инцидента;
   новый instance назвать `birge-restore-YYYYMMDD`.
2. Дождаться available и взять internal connection string.
3. Направить временный staging/one-off job на recovery DB; production не
   менять.
4. Проверить `/ready`, login, read-only trips, counts и `audit_logs`.
5. При реальном восстановлении обновить production `DATABASE_URL`, redeploy,
   повторить smoke checks, старый instance держать до приёмки.

## 7. Migration and rollback rules

- Migrations run through Render **Pre-Deploy Command** on paid; on the current free deployment they run in the start command:
  `alembic upgrade head`.
- Do not run migrations concurrently from multiple web instances.
- Roll back application code through Render's deploy history; do not edit an
  applied Alembic revision.
- If a migration caused data loss, stop writes, take a logical backup if
  possible, and use PITR to a timestamp before the migration. Reconcile the
  Alembic revision after restoring.
- A staging restore drill must pass before a production migration that changes
  or drops existing data.

## 8. Verification checklist

- [x] Production использует отдельные БД, Redis и секреты; staging ещё не поднят.
- [ ] Staging создан с отдельными БД/Redis/секретами.
- [x] Внешний доступ к Postgres закрыт; временный IP для дампа удалён,
      `ipAllowList` пуст.
- [x] `/health` проходит; Render `healthCheckPath` переключён на `/health`; `/ready` проверяется после deploy и вручную.
- [ ] Telegram `getWebhookInfo` без `last_error_message`; `/bot/webhook` без
      secret возвращает 403.
- [ ] Привязанный номер получает код; `/auth/send-code` возвращает 200 с
      нейтральным ответом без `tg_linked`/канала доставки.
- [ ] Telegram-first: `/auth/telegram-challenge` → `status=verified` →
      `/complete` выдаёт сессию; expired/consumed challenge отклоняется.
- [ ] В login response нет `refresh_token`; `birge_refresh` — `HttpOnly`,
      `Secure`, `SameSite=Lax`, `Path=/api/auth`.
- [ ] `Set-Cookie` доходит через Vercel `/api/auth` без изменений.
- [ ] `POST /api/auth/refresh` без `X-CSRF-Token` — 403; с валидным — 200 и
      ротация cookie.
- [ ] Перезагрузка SPA восстанавливает сессию через refresh без доступа JS к
      refresh token.
- [ ] Vercel `ORIGIN_SECRET` = Render `AUTH_PROXY_SECRET`; поддельный
      `X-Forwarded-For` не сбрасывает лимит; direct Render с поддельным
      `x-auth-client-ip` без подписи не сбрасывает bucket.
- [ ] Два клиента за одним Vercel edge имеют независимые лимиты.
- [ ] CGNAT (`100.64.0.0/10`) лимитируется по адресу.
- [x] Логический бэкап снят, зашифрован, checksum записан.
- [x] Restore в не-production БД проверен; revision/counts/`/ready` совпали.
- [ ] Внешняя копия `.gpg` + checksum + manifest загружена в private storage.
- [ ] Sentry alert на `auth.proxy=unsigned` и на новые issues проверен
      тестовым уведомлением.
- [ ] Задан `VITE_SENTRY_RELEASE`/release из commit SHA для source maps.
- [ ] `ALLOWED_ORIGINS` совпадает с production frontend.

Render setup, secret entry и paid PITR restore требуют dashboard access и
остаются ручными шагами.

## 9. Postgres paid upgrade before 2026-12-14

`birge-postgres` — free instance, будет удалён **2026-12-14 08:11 UTC**. PITR
и автоматических бэкапов нет. Решение: **не переезжать на другую БД**, а
поднять существующий instance in-place до paid `0.1c-256mb` — **$6/мес**.
Hobby workspace остаётся бесплатным; Render Pro не требуется.

### Статус на 2026-11-27

- [x] Baseline dump снят, зашифрован, restore drill на PostgreSQL 18.6 прошёл
  (§5.2, §6.1).
- [ ] Paid plan `0.1c-256mb` включён; PITR 3 дня активно.
- [ ] Внешняя копия дампа загружена в private storage.
- [ ] Daily encrypted dumps и weekly restore drill настроены.
- [ ] Upgrade проверен на production: `/ready`, counts, PITR.
- [ ] Production больше не зависит от free-базы после upgrade.

### Current path: Render Postgres paid in-place

- план: `0.1c-256mb`, **$6/мес**, 0.1 CPU / 256 MB RAM, 100 connections;
- включён 1 GB SSD; дополнительное storage — $0.30/GB/мес;
- **PITR 3 дня** на Hobby; logical exports хранятся 7 дней;
- database, hostname и `DATABASE_URL` не меняются;
- при смене compute plan Render кратко останавливает БД — окно на несколько
  минут; данные сохраняются;
- 256 MB RAM — тот же размер, что у free; для текущей нагрузки этого
  достаточно, при росте — `0.5c-1g` ($19/мес).

### Timeline

| Dates | Action |
| --- | --- |
| 2026-11-27 | Свежий dump, restore drill на PG18.6 и credential rotation — **выполнено**. |
| 28 Nov–5 Dec | Подтвердить оплату/карту; сверить цену $6 и текущий storage; подготовить off-site копию. |
| 6–10 Dec | Render Dashboard → Postgres → Plan → Compute: `0.1c-256mb`; дождаться `Available`. |
| После upgrade | `/health`, `/ready`, counts, login/refresh, PITR; ежедневный encrypted dump. |
| 13 Dec | **Hard stop:** upgrade должен быть завершён. |
| 14 Dec, 08:11 UTC | Free DB удаляется; production уже на paid `birge-postgres`. |

Targets: **RPO ≤ 24 часа** для off-site dump; PITR даёт восстановление на
точку внутри 3 дней. **RTO ≤ 2 часа** (restore + smoke).

### Baseline dump and restore

Актуальный артефакт и команды — §5.2–§5.3. Кратко:

```bash
# 1. temporary IP in Render allow-list
# 2. pg_dump 18.6
pg_dump "$RENDER_OLD_DATABASE_URL" --format=custom --no-owner --no-acl \
  --file "birge-$(date -u +%Y%m%d-%H%M).dump"

# 3. remove IP immediately
render pg update birge-postgres --clear-ip-allow-list --confirm

# 4. checksum + encrypt
sha256sum birge-YYYYMMDD-HHMM.dump
gpg --batch --pinentry-mode loopback --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 \
  --passphrase-file birge-20261115-1103.key \
  --output birge-YYYYMMDD-HHMM.dump.gpg birge-YYYYMMDD-HHMM.dump
```

Verify: restore exits 0, `alembic_version` matches production, core tables have
the same counts, `/ready` passes against the restored database, and a read-only
trip/login query succeeds. Record dump timestamp, SHA-256, counts and duration in
the manifest.

### Security rules

- Encrypt dumps before storing them off Render; restrict backup location; never
  commit dumps, checksums, manifests or keys.
- Keep Postgres external access blocked outside the short dump window.
- Do not run migrations concurrently from multiple instances.
- Alert on backup failure, `/ready` failure and Sentry error spikes.
- Test the restore path before 13 Dec.
- Do not put Render DSNs/passwords in docs, git, chat or shell history.

## 10. Credential rotation — 2026-11-27

Ротация выполнена после того, как старый default DSN попал в диагностический
вывод. Пароли и connection strings в этом документе не хранятся.

| Поле | Значение |
| --- | --- |
| Причина | старый default credential считался скомпрометированным |
| Новый default | `birge_app_20261127` |
| Старый default | `birgepostgres_csld_user` удалён из Render; original user деактивирован, его объекты сохранены |
| `DATABASE_URL` | обновлён на нового пользователя, internal host Render |
| Deploy | `dep-dc4irdei0phs73ad4df0` — `live`, commit `1255702` |
| Проверка | `/ready` → 200; новый пользователь входит как `birge`, 12/12 таблиц имеют SELECT/INSERT/UPDATE/DELETE, 11/11 sequences — USAGE |
| IP allowlist | `[]`; временный доступ закрыт |
| Секреты | новые credentials только в Render; в git/доки/чат не попадали |

Порядок будущей ротации:

1. Render Dashboard → Postgres → Info → Credential Rotation → **+ New default
   credential**.
2. До переключения проверить новым подключением `SELECT 1`, доступ к таблицам и
   последовательностям; не менять `DATABASE_URL` вслепую.
3. Обновить `DATABASE_URL` у `birge-api`, выполнить deploy, проверить `/ready`
   и read-only запрос.
4. Убедиться, что у старого пользователя `openConnections = 0`, затем удалить
   его. Render деактивирует original user, но сохраняет принадлежащие ему
   объекты.
5. Не совмещать ротацию с изменением compute plan Postgres. Держать свежий
   encrypted dump до и после.

## 11. Render Postgres paid upgrade (in place)

**Статус: запланировано; тариф пока не включён.** Решение 2026-11-27:
переезд на Neon отменён. `birge-postgres` поднимается in-place до paid
`0.1c-256mb` за **$6/мес** до удаления free-базы 14.12.2026.

### 11.1 Решение и стоимость

| Параметр | Значение |
| --- | --- |
| План | `0.1c-256mb` |
| Цена | **$6/мес** (+ налоги); Hobby workspace — $0 |
| Compute | 0.1 CPU, 256 MB RAM, 100 connections |
| Storage | 1 GB SSD включён; далее $0.30/GB/мес |
| PITR | 3 дня на Hobby; 7 дней только на Pro (+$25/мес) |
| Logical exports | 7 дней |
| Простой при upgrade | несколько минут; данные и DSN сохраняются |
| Free DB | удаляется 14.12.2026 08:11 UTC |

Переезд не нужен: меняется только compute plan. `DATABASE_URL`, hostname,
пользователь и пароль остаются прежними; backend deploy не требуется.
PITR 3 дня — достаточный минимум; daily encrypted dump всё равно нужен для
off-site копии и защиты от потери аккаунта.

### 11.2 Порядок upgrade

1. **Preflight:** проверить, что в Render привязана карта и доступен billing;
   сверить цену `0.1c-256mb` в Dashboard.
2. Снять свежий encrypted dump по §5.3; проверить checksum и manifest.
3. Render Dashboard → `birge-postgres` → **Plan** → **Compute** → выбрать
   `0.1c-256mb` → Review → **Update compute**.
4. Дождаться статуса `Available`; простой — несколько минут.
5. Проверить `/health` и `/ready`; counts, `alembic current`, login/refresh,
   read-only trips/users. Убедиться, что `DATABASE_URL` не изменился.
6. Открыть **Recovery** и убедиться, что PITR доступен (3 дня). Сделать
   on-demand logical export и скачать его.
7. Оставить daily encrypted dump + weekly restore; off-site copy — до 13.12.

### 11.3 Acceptance criteria

- [ ] В Render Plan показывает paid `0.1c-256mb`; expiry/free-ограничение ушло.
- [ ] `/health` 200, `/ready` 200; counts и `alembic current` совпадают.
- [ ] `DATABASE_URL` не менялся; backend deploy не потребовался.
- [ ] PITR 3 дня доступен; logical export создаётся и скачивается.
- [ ] Свежий encrypted dump и off-site copy есть; ключ хранится отдельно.
- [ ] Free DB не удалена до подтверждения upgrade.

### 11.4 Риски

| Риск | Решение |
| --- | --- |
| Нет карты/оплаты | оформить до 13.12; иначе free DB удалится 14.12 |
| Краткий простой при upgrade | выполнить в низкий трафик; окно несколько минут |
| 256 MB RAM недостаточно | `0.5c-1g` $19/мес; текущей нагрузке хватает 256 MB |
| PITR только 3 дня | daily encrypted dump + off-site; при необходимости Pro 7 дней |
| Нет HA/SLA на $6 | принять для текущего этапа; критичный рост — отдельный paid-план |
| Ошибка после upgrade | вернуть compute plan/использовать dump; не удалять `birge-postgres` до проверки |

### 11.5 Что не делать

- Не создавать Neon project и не менять `DATABASE_URL`: переезд отменён.
- Не удалять `birge-postgres` до подтверждения paid-плана и проверки.
- Не включать Render Pro без необходимости: для PITR 3 дня достаточно Hobby.
- Не класть DSN/пароли в git, docs, issue или чат.
- Не ставить `/ready` в Render health check.
