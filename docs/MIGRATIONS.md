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
