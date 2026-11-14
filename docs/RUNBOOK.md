# Staging, backups and restore drill

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
   - start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`;
   - plan: paid (`starter` or higher) because Pre-Deploy requires a paid
     service;
   - health check path: `/ready`;
   - pre-deploy command: `alembic upgrade head`.
3. Create **Postgres**:
   - name: `birge-postgres`;
   - database: `birge_production`; user: `birge`;
   - region: same as the web service;
   - plan: paid (`basic-256mb` or higher) so PITR is available;
   - networking: clear the external IP allow list so only Render's private
     network can connect.
4. Create **Key Value**:
   - name: `birge-redis`;
   - region: same as the web service;
   - plan: `256mb` for production;
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
6. Confirm both probes:

   ```bash
   curl -fsS https://<backend-host>/health
   curl -fsS https://<backend-host>/ready
   ```

   `/ready` checks Postgres and, when configured, Redis.
7. Set the frontend API URL to the backend host and add the exact frontend
   origin to `ALLOWED_ORIGINS`. Redeploy the backend after changing CORS.
8. Register the Telegram webhook with the secret from the dashboard:

   ```bash
   curl -fsS "https://api.telegram.org/bot<token>/setWebhook" \
     --data-urlencode "url=https://<backend-host>/bot/webhook" \
     --data-urlencode "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

## 3. Staging

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

## 4. Backup policy

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

## 5. Restore drill (quarterly, staging first)

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

## 6. Migration and rollback rules

- Migrations run only through the Render **Pre-Deploy Command**:
  `alembic upgrade head`.
- Do not run migrations concurrently from multiple web instances.
- Roll back application code through Render's deploy history; do not edit an
  applied Alembic revision.
- If a migration caused data loss, stop writes, take a logical backup if
  possible, and use PITR to a timestamp before the migration. Reconcile the
  Alembic revision after restoring.
- A staging restore drill must pass before a production migration that changes
  or drops existing data.

## 7. Verification checklist

- [ ] Production and staging use different databases, Redis instances and
      secrets.
- [ ] External access to Postgres/Key Value is disabled or limited to explicit
      operator IPs.
- [ ] `/health` and `/ready` pass on both environments.
- [ ] A logical backup has been downloaded and its checksum recorded.
- [ ] A PITR restore into a non-production instance has been verified.
- [ ] The restore timestamp and drill result are recorded.
- [ ] The frontend origin in `ALLOWED_ORIGINS` matches the deployed frontend.

Render setup, secret entry and the first restore drill require dashboard access
and are intentionally manual steps.
