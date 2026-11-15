# Staging, backups and restore drill

## 0. Текущий production-деплой

Срез: **2026-11-15**.

| Компонент | Фактическое значение |
| --- | --- |
| Frontend | https://birge-professional.vercel.app |
| Backend | https://birge-api.onrender.com |
| Render web service | `birge-api`, free, Oregon, root `birge-backend` |
| Postgres | `birge-postgres`, free, удалится 2026-12-14 |
| Key Value | `birge-redis`, free 25 MB, persistence off |
| Health / readiness | `https://birge-api.onrender.com/health`, `https://birge-api.onrender.com/ready` |
| CORS | `ALLOWED_ORIGINS=https://birge-professional.vercel.app` |
| Telegram | `TELEGRAM_BOT_TOKEN` задан; webhook зарегистрирован |

Текущий деплой использует free-план Render. Pre-Deploy Command недоступен,
поэтому start command: `alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port $PORT`.
Free Postgres не имеет PITR/автобэкапов и будет удалён 14.12.2026; free
Key Value имеет 25 MB и не сохраняет данные при рестарте; web-сервис
засыпает после простоя. Для production без этих ограничений нужен платный план.

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
   - health check path: `/ready`;
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
   PYTHON_VERSION=3.10.4
   SECRET_KEY=<generate a long random value>
   DATABASE_URL=<Postgres internal connection string>
   REDIS_URL=<Key Value internal connection string>
   ALLOWED_ORIGINS=https://<frontend-origin>
   TELEGRAM_BOT_TOKEN=<production bot token>
   TELEGRAM_WEBHOOK_SECRET=<random webhook secret>
   TELEGRAM_ADMIN_CHAT_ID=<optional>
   ADMIN_PHONES=<comma-separated admin phones>
   IMGBB_API_KEY=<optional; photo upload is disabled without it>
   SENTRY_DSN=<optional; empty disables Sentry>
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

   `/ready` checks Postgres and, when configured, Redis.
7. Set the frontend API URL to the backend host and add the exact frontend
   origin to `ALLOWED_ORIGINS`. Redeploy the backend after changing CORS.
8. Webhook обычно регистрируется автоматически при старте backend. Ручная
   регистрация и полная проверка Telegram-входа описаны в §3.

   ```bash
   curl -fsS "https://api.telegram.org/bot<token>/setWebhook" \
     --data-urlencode "url=https://<backend-host>/bot/webhook" \
     --data-urlencode "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

## 3. Включение входа через Telegram

Вход по коду работает только после привязки номера к Telegram-боту. Токен
бота — секрет; не коммитьте его и не вставляйте в чат.

На 2026-11-15 токен уже добавлен в Render, webhook зарегистрирован на
`https://birge-api.onrender.com/bot/webhook`; успешная доставка кода ещё
требует привязки номера через `@BirgeAuthBot`.

1. Получите токен у @BotFather. Для текущего фронтенда используется
   `@BirgeAuthBot`, поэтому проще всего взять токен этого бота.
2. Render Dashboard → `birge-api` → **Environment** → **Edit** →
   **Add variable**:
   - `TELEGRAM_BOT_TOKEN` = токен из BotFather (без кавычек и пробелов);
   - `TELEGRAM_WEBHOOK_SECRET` уже сгенерирован в текущем деплое; не меняйте
     его без необходимости. Если переменной нет, сгенерируйте случайное
     значение кнопкой **Generate**.
3. Нажмите **Save, rebuild, and deploy**. При старте backend сам вызывает
   `setWebhook` для `https://birge-api.onrender.com/bot/webhook` и передаёт
   secret token. Отдельный Pre-Deploy не нужен.
4. В Render → `birge-api` → **Logs** найдите строку
   `[Telegram] ✅ Webhook установлен: https://birge-api.onrender.com/bot/webhook`.
   Если там `❌ Ошибка webhook`, проверьте токен и URL.
5. Проверьте webhook (токен подставьте локально, не сохраняйте в git):

   ```bash
   curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | python -m json.tool
   ```

   Ожидаем `url` нового backend, `pending_update_count: 0` и отсутствие
   `last_error_message`. Поле `secret_token` Telegram не возвращает.
6. Откройте `@BirgeAuthBot` → `/start` → **«Поделиться номером»**. Бот должен
   подтвердить привязку; `/status` показывает номер и профиль.
7. На сайте введите тот же номер → **«Получить код»**. Бот пришлёт 6-значный
   код; `POST /auth/send-code` должен вернуть 200 и `tg_linked: true`.
   Если номер не привязан, production вернёт 503 — это ожидаемо.
8. Введите код на сайте. Успешный `POST /auth/verify-code` возвращает
   `access_token` и `refresh_token`; после этого `/users/me` отвечает 200.
9. Проверка защиты webhook: запрос без заголовка
   `X-Telegram-Bot-Api-Secret-Token` должен вернуть 403 (если секрет задан):

   ```bash
   curl -i -X POST https://birge-api.onrender.com/bot/webhook \
     -H 'Content-Type: application/json' --data '{}'
   ```

   Проверка отправки кода (номер должен быть привязан к боту):

   ```bash
   curl -i -X POST https://birge-api.onrender.com/auth/send-code \
     -H 'Content-Type: application/json' \
     -H 'Origin: https://birge-professional.vercel.app' \
     --data '{"phone":"+996700000000"}'
   ```

   Ожидаем 200, `"tg_linked": true` и сообщение с кодом в Telegram. Затем
   проверьте код (подставьте код из бота):

   ```bash
   curl -i -X POST https://birge-api.onrender.com/auth/verify-code \
     -H 'Content-Type: application/json' \
     --data '{"phone":"+996700000000","code":"123456"}'
   ```

   Успешный ответ содержит `access_token` и `refresh_token`.

Если webhook не зарегистрировался автоматически, зарегистрируйте вручную:

```bash
curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  --data-urlencode "url=https://birge-api.onrender.com/bot/webhook" \
  --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Если использовать тот же токен, что у старого `birge-backend`, webhook
переедет на новый сервис и старый Telegram-вход перестанет получать
обновления. Для параллельной работы нужен отдельный бот/токен.

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

### Текущее ограничение

`birge-postgres` — free: автоматических бэкапов и PITR нет; база будет удалена
14.12.2026. Пока не выполнен upgrade, делайте ручной `pg_dump` и храните дамп
вне Render. Внешний доступ к БД закрыт; для дампа временно добавьте свой IP в
Networking и сразу удалите правило.

Render continuously backs up **paid** Postgres instances for point-in-time
recovery (PITR):

- Hobby workspace: 3-day recovery window.
- Pro or higher: 7-day recovery window.
- Free Postgres: no PITR.
- PITR cannot restore to within 10 minutes of the current time.
- A restore creates a new database; the original is untouched.

In addition, before every migration or risky data operation:

1. Open Render Dashboard → Postgres → **Recovery**.
2. Create an on-demand logical backup and download it. Render keeps on-demand
   exports for 7 days.
3. Record the backup timestamp and the migration revision in the deployment
   notes.

For an external copy, temporarily add your IP to the database allow list and
run:

```bash
pg_dump "$DATABASE_URL" \
  --format=custom --no-owner --no-acl \
  --file "birge-$(date +%Y%m%d-%H%M).dump"
```

Remove the temporary allow-list entry immediately afterwards.

## 6. Restore drill (quarterly, staging first)

Never test a restore against production. Use a recovery instance and point only
staging at it.

1. In the production Postgres **Recovery** page, trigger PITR to a timestamp
   before the simulated incident. Name the new instance
   `birge-restore-YYYYMMDD`.
2. Wait until the recovery instance is available and note its internal
   connection string.
3. Point a temporary staging service (or a one-off Render job) at the recovery
   database. Do **not** change production.
4. Run:

   ```bash
   cd birge-backend
   alembic current
   alembic check
   ```

5. Start the backend against the recovery database and verify:
   - `/ready` returns `{"status": "ready"}`;
   - login and a read-only trips request succeed;
   - row counts match the expected snapshot;
   - the newest `audit_logs` row is at or before the restore timestamp.
6. Record the restored timestamp, durations and any mismatch in the incident
   log. Delete the recovery instance after the drill.
7. If a real production restore is required, update the production
   `DATABASE_URL` to the verified recovery instance, redeploy, run the smoke
   checks again, and keep the old instance until the restore is accepted.

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

- [ ] Production and staging use different databases, Redis instances and
      secrets.
- [ ] External access to Postgres/Key Value is disabled or limited to explicit
      operator IPs.
- [ ] `/health` and `/ready` pass for `https://birge-api.onrender.com`.
- [ ] Telegram `getWebhookInfo` has no `last_error_message`; `/bot/webhook` without the secret returns 403.
- [ ] A bound phone receives a code; `/auth/send-code` returns 200 with `tg_linked: true`.
- [ ] Free plan is accepted: Postgres has no PITR and expires 2026-12-14; upgrade before that date if the data must survive.
- [ ] A logical backup has been downloaded and its checksum recorded.
- [ ] A PITR restore into a non-production instance has been verified.
- [ ] The restore timestamp and drill result are recorded.
- [ ] The frontend origin in `ALLOWED_ORIGINS` matches the deployed frontend.

Render setup, secret entry and the first restore drill require dashboard access
and are intentionally manual steps.
