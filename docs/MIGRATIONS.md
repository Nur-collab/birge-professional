# Database migrations

The backend uses Alembic. The application no longer creates tables at import.

## Fresh database

```bash
cd birge-backend
alembic upgrade head
```

This creates the schema and all query indexes.

## Existing database (production or a populated local SQLite file)

1. Take a backup.
2. Confirm the existing schema already contains all tables and columns from
   `alembic/versions/1fdb9f734fe9_initial_schema.py`.
3. Mark the baseline migration as applied **without running it**:

```bash
alembic stamp 1fdb9f734fe9
```

4. Apply the index migration:

```bash
alembic upgrade head
```

5. Verify:

```bash
alembic current
```

If the existing database is missing columns from the baseline, do not stamp it.
Create a dedicated additive migration for the missing columns first.

## P1 constraints and audit migration

The migration `3b8e4c1d9f2a` adds CHECK constraints for trip seats/prices and
review ratings, a partial unique index for active trip requests, and the
`audit_logs` table. Before adding the constraints it clamps invalid legacy
values and declines duplicate active requests. It is safe to run on SQLite
(batch mode) and PostgreSQL. Always take a backup first.

## PII/OTP and refresh-session migrations

`5c8f1a2b9d4e` encrypts existing `users.mbank_phone` and
`users.elkart_number` values in place using the versioned `enc:v1:` Fernet
format, then invalidates legacy plaintext OTP rows. Set `PII_ENCRYPTION_KEY`
before running it in production; losing that key makes the payment fields
unreadable. New OTP codes are stored only as HMAC-SHA256 hashes, so users with
an outstanding code must request a new one after the migration.

`6e2b7c4d1a3f` adds `refresh_sessions`. Each refresh token now carries a
one-time `jti`; rotation revokes the previous JTI, and replaying a used token
returns 401. Refresh tokens issued before this migration have no JTI and are
rejected once, so users with an old session sign in again. Consumed/expired
session rows are purged on the next login/refresh; logout removes all of the
user's session rows immediately.

## PostgreSQL check

CI runs the Alembic chain against both SQLite and PostgreSQL. For a local
PostgreSQL run without Docker, use the ephemeral PostgreSQL 16 helper:

```bash
cd birge-backend
pip install -r requirements.txt -r requirements-e2e.txt
python scripts/check_postgres_migrations.py
```

The helper starts a temporary PostgreSQL 16.2 server, runs
`alembic upgrade head` and `alembic check`, then stops and deletes it. It does
not require a system PostgreSQL installation or administrator rights.

For production, configure `PII_ENCRYPTION_KEY` in the Render Dashboard before
running the release migration; the app intentionally refuses to start without
it when `ENVIRONMENT=production`.

Alternatively, start the Compose service and point `DATABASE_URL` at it:

```bash
docker compose up -d postgres
cd birge-backend
DATABASE_URL=postgresql://birge:birge@localhost:5432/birge_test alembic upgrade head
DATABASE_URL=postgresql://birge:birge@localhost:5432/birge_test alembic check
```

Use the same check before deploying a migration that changes constraints,
indexes or defaults; SQLite and PostgreSQL do not reflect all DDL identically.

## Creating a new migration

```bash
alembic revision --autogenerate -m "describe the change"
# review the generated file
alembic upgrade head
```

Never edit an applied migration. Add a new one instead.

## Deployment

Run `alembic upgrade head` as a release/pre-deploy step, before the new web
process starts. `birge-backend/Procfile` declares it as `release:`; on Render,
use the service's **Pre-Deploy Command** with the same command. Do not run
migrations concurrently from multiple instances.
