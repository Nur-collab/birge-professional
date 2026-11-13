# Birge Professional — Agent Memory

> Scope: `C:\Users\User\.gemini\antigravity\scratch\birge-professional` only.
> Never modify `../birge`, `../birge-backend`, or `../.agents/MEMORY.md` (Antigravity memory).

## 1. Stack & Core Commands

- Backend: Python 3.10.4, FastAPI, SQLAlchemy 2, Alembic; SQLite local/tests; PostgreSQL production.
- Frontend: React 18, Vite 7.3.8, Vitest 4.1.12, PWA; Node >=20.19 (CI Node 22).
- Layout: `birge-backend/`, `birge/`, `docs/`, `.github/workflows/ci.yml`.
- Backend checks:
  - `cd birge-backend`
  - `./venv/Scripts/ruff.exe check .`
  - `./venv/Scripts/python.exe -m pytest -q`
- Frontend checks:
  - `cd birge`
  - `npm test`
  - `npm run build`
- API smoke: `GET /health` -> 200; `GET /openapi.json` -> 200, 30 paths.
- Git: branch `main`, initialized 2026-11-13, initial commit `3cc590a`; no remote configured.
- CI: Python 3.10 + ruff/pytest; Node 22 + `npm ci`/test/build. Validated locally; not run on GitHub.

## 2. Current Metrics (2026-11-13)

- Backend tests: 31 passed.
- Frontend tests: 6 passed in 2 files.
- Production build: passed (~4.8s); 17 precache entries.
- `main.py`: 901 lines; `App.jsx`: 418 lines.
- OpenAPI: 30 paths; WS `/ws/chat/{trip_id}/{user_id}` is registered but absent from OpenAPI.
- Tracked files: 98 (97 initial + this memory file).
- P0: complete.

## 3. Active Work State

- Current goal: P1 production readiness.
- Working tree: clean after `3cc590a`; this memory is committed separately.
- P0 backend: routers `auth`, `users`, `trips`, `trip_requests`, `chat`; WS/SSE and trip requests moved out of `main.py`.
- P0 frontend: hooks in `src/hooks/*`; `src/utils/tripStorage.js`; screen behavior/props preserved.
- Hot files: `birge-backend/routers/trip_requests.py`, `birge-backend/routers/chat.py`, `birge-backend/main.py`, `birge/src/App.jsx`, `birge/src/hooks/*`.
- Not done: Redis Pub/Sub and shared rate limiting, Sentry, staging/backups, DB CHECK/partial unique indexes, audit log, WS/SSE integration tests.
- Discarded in P0: contexts (hooks only), extracting reviews/Telegram/lifecycle, API changes.
- Immediate next prompt: "Прочитай `docs/HANDOFF.md`, `docs/ROADMAP.md`, `.agents/MEMORY.md`. Начни P1: Redis rate limiting + Pub/Sub, затем DB constraints/audit log."

## 4. Architecture & Invariants

- API paths, methods and response models are stable; add a regression test before API changes.
- Routers own HTTP concerns; services own business rules; models own persistence.
- Alembic only; no `create_all` in production.
- Realtime is single-process until Redis Pub/Sub is in place.
- Auth: access 60m, refresh 30d; WebSocket uses a short-lived ticket; SSE/WS may pass token via query.
- CORS uses an explicit allowlist; admin endpoints use `ADMIN_PHONES`; internal sync is off by default.
- Secrets stay backend-side; never commit `.env`, databases or logs.
- Preserve UI invariants: zero emoji in UI; semantic CSS tokens; no hardcoded white backgrounds; `100dvh` + safe-area on mobile; no hard-delete of active trips with accepted participants.
- `birge-professional` is the only working copy; original `birge` and `birge-backend` stay untouched.

## 5. Bug Graveyard

- Route split: preserve prefixes/order; WS route is not in OpenAPI; assert it via `app.routes`.
- SSE/WS: keep `is_trip_participant` checks; token query is expected for EventSource/WS.
- React hooks: no early returns before hooks; keep `clearActiveTrip` stable in `useAuth`.
- Rate limits are per-process in-memory dictionaries; not multi-worker safe.
- Windows: use UTF-8 for console/files; dispose the SQLite engine before unlinking the test DB.
- CI: `npm ci` requires a lockfile; keep `npm ci --dry-run` green after dependency changes.

## 6. Rolling Changelog (max 5)

- 2026-11-13: P0 backend split; `main.py` 1383 -> 901; 31 tests.
- 2026-11-13: P0 frontend hooks; `App.jsx` 812 -> 418; 6 tests + build.
- 2026-11-13: `docs/ROADMAP.md`, `docs/HANDOFF.md`, `docs/CHAT_HISTORY.md` synced; P0 complete.
- 2026-11-13: Git initialized on `main`; initial commit `3cc590a`; CI config checked.
- 2026-11-13: Project-scoped `.agents/MEMORY.md` synced; Antigravity memory untouched.
