# Birge — professional working copy

This directory is a clean working copy of the Birge project. The original
`../birge` and `../birge-backend` directories are intentionally left untouched.

```
birge-professional/
├── birge/            # React + Vite PWA (frontend)
├── birge-backend/    # FastAPI + SQLAlchemy API
└── .github/          # CI
```

## Requirements

- Node.js 20.19+
- Python 3.10+
- PostgreSQL for production; SQLite is supported for local development and tests

## Local setup

### Backend

```bash
cd birge-backend
python -m venv venv
# Windows: venv\Scripts\activate
# Linux/macOS: source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env          # fill the values locally; never commit .env
alembic upgrade head          # create/update the local schema
uvicorn main:app --reload --port 8000
```

The API is available at `http://127.0.0.1:8000`; interactive docs are at
`http://127.0.0.1:8000/docs`.

### Frontend

```bash
cd birge
npm ci
# Only for local development. Vite loads .env.local in production too,
# so never put the local API URL there.
cp .env.example .env.development.local    # VITE_API_URL=http://127.0.0.1:8000
npm run dev
```

Production builds read `VITE_API_URL` from `.env.production` or from the
hosting provider's environment. The build fails if that value points to
`localhost`, `127.0.0.1` or `0.0.0.0`.

## Tests and checks

```bash
# backend
cd birge-backend
python -m pytest -q
ruff check .

# frontend
cd birge
npm test
npm run build
```

CI runs the same checks on every push and pull request.

## Environment variables

Backend (see `birge-backend/.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `ENVIRONMENT` | production | `development`, `test` or `production` |
| `SECRET_KEY` | yes | JWT signing key; generate a long random value |
| `DATABASE_URL` | yes | PostgreSQL URL in production, SQLite locally |
| `ALLOWED_ORIGINS` | production | Comma-separated exact frontend origins |
| `TELEGRAM_BOT_TOKEN` | production | Telegram code delivery and bot |
| `TELEGRAM_WEBHOOK_SECRET` | production | Telegram webhook verification |
| `ADMIN_PHONES` | production | Comma-separated phones allowed to call admin endpoints |
| `IMGBB_API_KEY` | optional | Server-side profile photo uploads |
| `INTERNAL_SYNC_ENABLED` | no | Enables the internal Telegram sync endpoint (development only) |
| `INTERNAL_SYNC_SECRET` | with sync | Separate secret for the internal sync endpoint |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | Access token lifetime (default 60) |
| `REFRESH_TOKEN_EXPIRE_DAYS` | no | Refresh token lifetime (default 30) |

Frontend:

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base URL (no trailing slash); production value, not `.env.local` |

Secrets must never be committed. `.env`, `.env.*`, databases and build
artifacts are ignored by git; `.env.example` and `.env.production.example`
are templates only.

## Architecture rules

- Routers own HTTP concerns; services own business rules; models own persistence.
- All schema changes go through Alembic; do not use `create_all` in production.
- Every new endpoint needs an authorization check and a regression test.
- Do not add a dependency without a clear need and a pinned version.
- Realtime state is currently single-process; see the roadmap before scaling to
  multiple workers (Redis Pub/Sub is required).

## Deployment

- Frontend: Vercel (or another static host), `npm run build`, `dist/`.
- Backend web command: `uvicorn main:app --host 0.0.0.0 --port $PORT`.
- Run `alembic upgrade head` as a separate release/pre-deploy step. It is
  declared as `release:` in `birge-backend/Procfile`; on Render, use the
  service's **Pre-Deploy Command** with the same command.
- Keep staging and production databases separate; take a backup before migrations.

## Roadmap and operations

- `docs/HANDOFF.md` — current state, commands and continuation checklist.
- `docs/CHAT_HISTORY.md` — condensed history of the work session.
- `docs/ROADMAP.md` — prioritized plan (security, realtime scaling,
  observability, data integrity and product polish).
- `docs/MIGRATIONS.md` — fresh and existing-database migration paths.
