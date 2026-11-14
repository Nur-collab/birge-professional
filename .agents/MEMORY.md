# Birge Professional — Agent Memory

> Scope: `C:\Users\User\.gemini\antigravity\scratch\birge-professional` only.
> Never modify `../birge`, `../birge-backend`, or `../.agents/MEMORY.md` (Antigravity memory).

## 1. Stack & Core Commands

- Backend: Python 3.10.4, FastAPI, SQLAlchemy 2, Alembic, Redis 8.1.0, PyJWT 2.15.1, Sentry SDK 2.75.0; SQLite local/tests; PostgreSQL production.
- Frontend: React 18, React Router 7.18.5, Vite 7.3.8, Vitest 4.1.12, PWA, @sentry/react 11.12.0 (lazy), openapi-typescript 7.13.0 (dev); Node >=20.19 (CI Node 22).
- Layout: `birge-backend/`, `birge/`, `docs/`, `.github/workflows/ci.yml`, `docs/RUNBOOK.md`.
- Backend checks:
  - `cd birge-backend`
  - `./venv/Scripts/ruff.exe check .`
  - `./venv/Scripts/python.exe -m pytest -q`
- Frontend checks:
  - `cd birge`
  - `npm test`
  - `npm run build`
- API smoke: `GET /health` -> 200; `GET /ready` -> 200; `GET /openapi.json` -> 200, 31 paths.
- Git: branch `main`, initial commit `3cc590a`; no remote configured; P1 changes uncommitted.
- CI: Python 3.10 + ruff/pytest/pip-audit + fresh-SQLite `alembic upgrade head`/`alembic check` + OpenAPI snapshot drift check, Node 22 + `npm ci`/npm audit --omit=dev/test/build + generated-types drift check; Redis service `redis:7-alpine`, tests receive `TEST_REDIS_URL`; scheduled Security workflow runs pip-audit + gitleaks. Not run on GitHub yet.

## 2. Current Metrics (2026-11-14)

- Backend tests: 44 passed (Sentry + participant-only trip detail).
- Frontend tests: 14 passed in 6 files (routing + API + date + a11y).
- Production build: passed (~8.6s); 18 precache entries; main JS 218.91 KB (53.16 KB gzip), CSS 7.73 KB (2.38 KB gzip), vendor-react 226.63 KB (74.21 KB gzip), lazy Sentry chunk 461.58 KB (156.20 KB gzip).
- `main.py`: 984 lines; `App.jsx`: 488 lines; `index.css`: 424 lines.
- OpenAPI: 31 paths, 18 schemas; WS `/ws/chat/{trip_id}/{user_id}` is registered but absent from OpenAPI. `openapi.json` is 85 KB; generated `src/types/api.d.ts` is 2166 lines.
- Tracked files: 98; +22 P1/Phase A/Sentry/P2/a11y files (120 after commit).
- P0: complete. P1: code complete; manual Render setup and restore drill pending. P2: deep links, OpenAPI types and accessibility baseline complete.

## 3. Active Work State

- Current goal: P2 product/UX (deep links, OpenAPI types and accessibility baseline complete; axe/visual contrast and i18n next).
- Working tree: all P1 changes are uncommitted; no remote.
- P1 done: shared Redis rate limiting for auth and write endpoints; Redis Pub/Sub for SSE and WS chat; CHECK constraints and partial unique index; audit log; `/ready`; `X-Request-ID`; JSON logs with request id; optional Sentry backend/frontend; manual Render setup + backup/restore runbook; Dependabot/pip-audit/gitleaks/Redis compose.
- P2 done: React Router deep links, participant-only `GET /trips/{trip_id}`, Vercel SPA fallback, deterministic OpenAPI export + generated frontend types, accessibility baseline (labels, skip-link, focus, combobox, dialogs, icon labels, contrast tokens).
- P1 tests: `tests/test_redis_multiprocess.py` covers shared rate limit, SSE and WS across separate OS processes. Local test uses `tests/redis_stub.py`; CI uses real Redis. `tests/test_logging.py` covers JSON formatting and request-id log correlation.
- Hot files: `rate_limit.py`, `realtime.py`, `logging_config.py`, `sentry_config.py`, `models.py`, `routers/{auth,trips,trip_requests,users}.py`, `birge/src/App.jsx`, `birge/src/index.css`, `birge/src/components/{AddressInput,ReviewModal,TripRequestModal}.jsx`, `birge/src/screens/{Login,Dashboard,Profile,Settings}.jsx`, `birge/src/utils/routes.js`, `birge/src/utils/api.js`, `birge/openapi.json`, `birge/src/types/api.d.ts`, `scripts/export_openapi.py`, `tests/test_api.py`, `tests/test_logging.py`, `tests/test_redis_multiprocess.py`, `tests/test_sentry.py`, `alembic/versions/3b8e4c1d9f2a_p1_constraints_and_audit.py`, `docs/RUNBOOK.md`, `.github/workflows/security.yml`.
- Not done: Sentry DSN/project validation, manual Render setup, restore drill, verify Dependabot/gitleaks/real Redis/CI on GitHub; P2 axe/visual contrast sweep, i18n/analytics/moderation/export.
- Discarded: async Redis Pub/Sub against fakeredis TCP (does not deliver); custom RESP stub is used instead.
- Immediate next prompt: "Run an axe/Lighthouse accessibility and visual contrast sweep over every screen, then fix the remaining findings."

## 4. Architecture & Invariants

- API paths, methods and response models are stable; add a regression test before API changes.
- Routers own HTTP concerns; services own business rules; models own persistence.
- Alembic only; no `create_all` in production.
- Realtime uses Redis Pub/Sub when `REDIS_URL` is set; each worker owns local WS/SSE managers and dispatches only its local clients. Empty URL = in-process fallback.
- Redis event channel: `birge:realtime`; envelopes: `sse_driver`, `sse_requester`, `ws_chat`.
- Redis clients use `protocol=2`; the pub/sub listener runs in a daemon thread, dispatches through `asyncio.run_coroutine_threadsafe`, and reconnects with backoff.
- Auth: access 60m, refresh 30d; WebSocket uses a short-lived ticket; SSE/WS may pass token via query.
- Rate limits are shared via Redis when configured; Redis failure falls back to process-local memory.
- Write endpoints use per-user buckets (`user:<id>:<action>`); auth uses per-IP buckets.
- `/health` stays a liveness probe; `/ready` checks the database and optional Redis. Every HTTP response carries `X-Request-ID` (incoming value capped at 128 chars).
- Production logs are one JSON object per line; local logs are text. `request_id` is held in a ContextVar and attached to every `birge` log record. Never log secrets, tokens or payment values.
- Sentry is opt-in: empty DSN means no SDK init/import. Keep `send_default_pii=False`, no request bodies, and frontend Sentry lazy-loaded.
- CHECK constraints cover seat/price/rating ranges; `uq_trip_requests_active` allows one pending/accepted request per `(trip_id, requester_id)`.
- Audit rows are written in the same transaction as trip/request changes; payment audit stores only IDs, never payment values.
- CORS uses an explicit allowlist; admin endpoints use `ADMIN_PHONES`; internal sync is off by default.
- `GET /trips/{trip_id}` returns 404 for non-participants and uses the existing `Trip` schema; do not expose phone/payment fields.
- BrowserRouter wraps App in `main.jsx`; Vercel needs the SPA rewrite in `birge/vercel.json`.
- Accessibility baseline: keep one `main` landmark with `id="main-content"`, a skip-link, route-change focus, visible `:focus-visible` rings, native buttons for clickable cards, associated form labels and focus-trapped `role="dialog"` modals.
- `birge/openapi.json` is generated by `birge-backend/scripts/export_openapi.py`; never hand-edit it or `src/types/api.d.ts`. Regenerate with `npm run api:types` after API/schema changes.
- Render setup is manual; secrets live only in the Render Dashboard. Production and staging must never share DB/Redis/secrets.
- Secrets stay backend-side; never commit `.env`, databases or logs.
- Preserve UI invariants: zero emoji in UI; semantic CSS tokens; no hardcoded white backgrounds; `100dvh` + safe-area on mobile; no hard-delete of active trips with accepted participants.
- `birge-professional` is the only working copy; original `birge` and `birge-backend` stay untouched.

## 5. Bug Graveyard

- Route split: preserve prefixes/order; WS route is not in OpenAPI; assert it via `app.routes`; chat still needs `manager.connect`/`disconnect` locally.
- SSE/WS: keep `is_trip_participant` checks; token query is expected for EventSource/WS.
- React hooks: no early returns before hooks; keep `clearActiveTrip` stable in `useAuth`.
- fakeredis TCP does not deliver Pub/Sub across connections; use the minimal RESP stub locally and real Redis in CI.
- Do not block the event loop with sync Redis calls: use `asyncio.to_thread` for publish/INCR and a separate listener thread.
- Rate-limit Redis uses `INCR` + `EXPIRE`, not Lua/pipeline, so the test stub and real Redis follow the same path.
- Migration `3b8e4c1d9f2a` normalizes legacy seats/prices/ratings and declines duplicate active requests before adding constraints.
- Do not add payment details to audit `details`: only actor/driver IDs and action metadata.
- `/ready` creates a short-lived Redis client per check; do not reuse the Pub/Sub client for readiness.
- `python-jose`/`ecdsa` were replaced by `PyJWT`; keep HS256 and the existing `sub`/`exp`/`typ` claims to avoid token incompatibility.
- Frontend `@sentry/react` must stay dynamically imported; a static import adds ~90 KB gzip to the initial bundle.
- Gitleaks organization repositories need `GITLEAKS_LICENSE`; personal repositories do not.
- Windows: use UTF-8 for console/files; dispose the SQLite engine before unlinking the test DB.
- CI: `npm ci` requires a lockfile; keep `npm ci --dry-run` green after dependency changes.
- React Router: `setActiveTab('trip')` may navigate to `/scheduled` when called immediately after `setActiveTrip` (state not rendered yet); the `/scheduled` effect canonicalizes to `/trips/:id`. Bottom-nav passes the active trip id directly.
- Generated OpenAPI types are editor-time declarations only; do not import the runtime `.d.ts` file into the bundle.
- Light-background modals must keep fixed dark text (`#1f2937`/`#4b5563`); using `var(--text-main)` there turns text white in dark theme.
- Render Blueprints are not used; do not reintroduce `render.yaml` without an explicit request.

## 6. Rolling Changelog (max 5)

- 2026-11-13: P0 split; `main.py` 1383 -> 901, `App.jsx` 812 -> 418; Git initialized on `main`, initial commit `3cc590a`.
- 2026-11-13: P1 Redis rate limiting/PubSub + write limits + CHECK/partial unique constraints + audit log + `/ready`/`X-Request-ID`; 39 tests.
- 2026-11-13: Phase A JSON logs/request id, PyJWT migration, pip-audit, Dependabot/gitleaks, Redis compose, Sentry backend/frontend; 43 tests.
- 2026-11-14: Render Blueprints removed by request; manual Render setup + backup/restore runbook retained.
- 2026-11-14: P2 deep links + trip detail + Vercel fallback + OpenAPI types + accessibility baseline; 44 backend / 14 frontend tests.
