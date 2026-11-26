# Birge Professional — Agent Memory

> Scope: `C:\Users\User\.gemini\antigravity\scratch\birge-professional` only.
> Never modify `../birge`, `../birge-backend`, or `../.agents/MEMORY.md` (Antigravity memory).

## 1. Stack & Core Commands

- Backend: Python 3.12+ (CI 3.12; verified locally on 3.12.10), FastAPI, SQLAlchemy 2, Alembic, Redis 8.1.0, PyJWT 2.15.1, cryptography 50.0.2, Sentry SDK 2.75.0; SQLite local/tests; PostgreSQL production.
- Frontend: React 18, React Router 7.18.5, Vite 8.3.8, Vitest 5.1.1, jsdom 31.0.1, PWA, @sentry/react 11.12.0 (lazy), openapi-typescript 7.13.0 (dev), Playwright 1.65.1 (dev); Node >=20.19 (CI Node 22).
- Layout: `birge-backend/`, `birge/`, `docs/`, `.github/workflows/ci.yml`, `docs/RUNBOOK.md`.
- Backend checks:
  - `cd birge-backend`
  - `./venv/Scripts/ruff.exe check .`
  - `./venv/Scripts/python.exe -m pytest -q`
- Frontend checks:
  - `cd birge`
  - `npm test`
  - `npm run build`
  - `npm run e2e` (Playwright; starts ephemeral PostgreSQL 16.2, runs Alembic, seeds a user and starts the Vite app)
- API smoke: `GET /health` -> 200; `GET /ready` -> 200; production `/openapi.json` synced via `export_openapi.py`.
- Git: branch `main`, remote `origin` (`Nur-collab/birge-professional`); HEAD includes P1 hardening, Sentry, Telegram-first auth, mobile scroll polish, and post-audit fixes.
- CI: Python 3.12 + ruff/pytest/pip-audit + fresh-SQLite `alembic upgrade head`/`alembic check` + PostgreSQL 16 migration check + OpenAPI snapshot drift check; Browser E2E job (Playwright Chromium against ephemeral PostgreSQL 16.2 backend); frontend Node 22 + `npm ci`/npm audit --omit=dev/test/build + generated-types drift check; Redis service `redis:7-alpine`, tests receive `TEST_REDIS_URL`; scheduled Security workflow runs pip-audit + gitleaks.

## 2. Current Metrics (2026-11-26)

- Backend tests: 92 passed (ruff `E9,F,B` ignoring `B008`; includes batch `/trip-requests/statuses`, `/users/me/verify` `@BirgeAuthBot` URL, `/trips/matches` rate limit, Telegram challenge flow, auth proxy IP/CGNAT, Sentry fallback alert, panic cooldown, Redis TTL guard, PII/OTP, refresh rotation, SSE/WS).
- Frontend tests: 40 passed in 10 files (`useTripSearch` error recovery & seats mapping, `Login` Stage 1+2 Telegram challenge & rescue flow, `api.checkRequestsStatuses` batch polling, `useIncomingRequests` SSE + AudioContext reuse/cleanup, WS incremental chat, routing, API, date, a11y, XSS escaping, SW policy).
- Browser E2E: 6 passed on PostgreSQL 16.2 (`login-code` + `390x844` Login & Dashboard no-scroll checks + Telegram challenge UI + `sse-ticket`).
- Production build: passed; 18 precache entries; Vite + PWA `injectManifest` + `@sentry/bundler-plugins`.
- `main.py`: ~205 lines (extracted `routers/{admin,bot,reviews}.py`, `trip_maintenance.py`).
- OpenAPI: regenerated `birge/openapi.json` and `birge/src/types/api.d.ts`.
- P0: complete. P1: complete & deployed; PostgreSQL migration CI, browser E2E, PII/OTP encryption, refresh rotation, Sentry, and Stage 1+2 Telegram-first auth are live. Manual Render restore drill and post-migration backup remain before `2026-12-14`. P2: deep links, OpenAPI types and accessibility baseline complete.

## 3. Active Work State

- Current goal: P1 is deployed; finish production database/backup work before 2026-12-14, then P2 axe/visual contrast and i18n.
- Working tree: clean at `2748929`; Render and Vercel are live on that commit.
- P1 done: shared Redis rate limiting for auth and write endpoints; Redis Pub/Sub for SSE and WS chat; CHECK constraints and partial unique index; audit log; `/ready`; `X-Request-ID`; JSON logs with request id; optional Sentry backend/frontend; manual Render setup + backup/restore runbook; Dependabot/pip-audit/gitleaks/Redis compose.
- P1 hardening 2026-11-15: `User.token_version` + `/auth/logout` revoke all sessions; token version checked in HTTP, SSE and WS; SSE uses a short-lived stream-bound ticket; escaped map balloon HTML; security headers on Vercel/API; current production CORS fallback; safe API URL; local startup no longer registers a production Telegram webhook without `RENDER_EXTERNAL_URL`.
- Migration/E2E 2026-11-15: CI runs Alembic on `postgres:16`; Playwright browser E2E starts ephemeral PostgreSQL 16.2 via `pgserver`, applies Alembic, seeds a user and runs real backend/frontend ticket + EventSource checks. Cleanup is covered by `globalTeardown` and stale-instance cleanup. Local PostgreSQL migration check passed; GitHub PostgreSQL/E2E job passed on 2748929.
- P1 security 2026-11-16: payment PII encrypted at rest via Fernet (`enc:v1:`), OTP HMAC-SHA256, migration `5c8f1a2b9d4e`; refresh sessions/rotation migration `6e2b7c4d1a3f`; CI and docs moved to Python 3.12. 51 backend tests pass on 3.12.10; PostgreSQL migration check passes.
- P2 done: React Router deep links, participant-only `GET /trips/{trip_id}`, Vercel SPA fallback, deterministic OpenAPI export + generated frontend types, accessibility baseline (labels, skip-link, focus, combobox, dialogs, icon labels, contrast tokens).
- P1 tests: 53 backend tests; `tests/test_api.py` covers PII encryption, OTP hashing, refresh rotation/cleanup, logout/SSE and payment access. `tests/test_redis_multiprocess.py` covers shared rate limit, SSE and WS across separate OS processes. Local test uses `tests/redis_stub.py`; CI uses real Redis. `tests/test_logging.py` covers JSON formatting and request-id log correlation.
- Hot files: `auth.py`, `pii_crypto.py`, `dependencies.py`, `rate_limit.py`, `realtime.py`, `logging_config.py`, `sentry_config.py`, `models.py`, `routers/{auth,trips,trip_requests,users}.py`, `birge/src/App.jsx`, `birge/src/index.css`, `birge/src/components/{AddressInput,RealMap,ReviewModal,TripRequestModal}.jsx`, `birge/src/screens/{Login,Dashboard,Profile,Settings,Matches}.jsx`, `birge/src/hooks/useAuth.js`, `birge/src/utils/{api,escapeHtml,routes}.js`, `birge/openapi.json`, `birge/src/types/api.d.ts`, `scripts/export_openapi.py`, `scripts/{seed_e2e,run_e2e_backend,stop_e2e_postgres,check_postgres_migrations}.py`, `birge/e2e/*`, `birge/playwright.config.js`, `tests/test_api.py`, `tests/test_logging.py`, `tests/test_redis_multiprocess.py`, `tests/test_sentry.py`, `alembic/versions/{3b8e4c1d9f2a_p1_constraints_and_audit,4d1e2f3a5b6c_add_token_version_to_users,5c8f1a2b9d4e_encrypt_pii_and_invalidate_plaintext_otp,6e2b7c4d1a3f_add_refresh_sessions}.py`, `docs/RUNBOOK.md`, `docs/MIGRATIONS.md`, `.github/workflows/ci.yml`, `.github/workflows/security.yml`.
- Not done: manual Render restore drill & post-migration backup (before 2026-12-14); P2 axe/visual contrast sweep & i18n/analytics/moderation; `@vitejs/plugin-react` 6 (blocked on `vite-plugin-pwa`/`workbox-build` `@babel/core@7` peer). All 12 Dependabot PRs resolved and Render `PYTHON_VERSION=3.12` (`3.12.16`) live.
- Discarded: async Redis Pub/Sub against fakeredis TCP (does not deliver); custom RESP stub is used instead.
- Immediate next prompt: "P1 is deployed on `2748929`; take a post-migration encrypted backup, do the manual restore drill, then continue P2 (axe/visual contrast, i18n, analytics) and Dependabot review."

## 4. Architecture & Invariants

- API paths, methods and response models are stable; add a regression test before API changes.
- Routers own HTTP concerns; services own business rules; models own persistence.
- Alembic only; no `create_all` in production.
- Realtime uses Redis Pub/Sub when `REDIS_URL` is set; each worker owns local WS/SSE managers and dispatches only its local clients. Empty URL = in-process fallback.
- Redis event channel: `birge:realtime`; envelopes: `sse_driver`, `sse_requester`, `ws_chat`.
- Redis clients use `protocol=2`; the pub/sub listener runs in a daemon thread, dispatches through `asyncio.run_coroutine_threadsafe`, and reconnects with backoff.
- Auth: access 60m, refresh 30d; access/refresh include `ver` from `User.token_version`; `/auth/logout` increments it and revokes all sessions; HTTP, SSE and WS validate the version. WebSocket and SSE use short-lived tickets bound to trip/stream.
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
- E2E runs against ephemeral PostgreSQL 16.2 via `pgserver`; `globalTeardown` and `stop_e2e_postgres.py` must remain in place, otherwise Playwright failures leak postgres.exe/temp dirs. The E2E data root is `%TEMP%/birge-e2e-pg` (one run at a time).
- Render setup is manual; secrets live only in the Render Dashboard. Production and staging must never share DB/Redis/secrets.
- Secrets stay backend-side; never commit `.env`, databases or logs.
- Preserve UI invariants: zero emoji in UI; semantic CSS tokens; no hardcoded white backgrounds; `100dvh` + safe-area on mobile; no hard-delete of active trips with accepted participants.
- `birge-professional` is the only working copy; original `birge` and `birge-backend` stay untouched.

## 5. Bug Graveyard

- Route split: preserve prefixes/order; WS route is not in OpenAPI; assert it via `app.routes`; chat still needs `manager.connect`/`disconnect` locally.
- SSE/WS: keep `is_trip_participant` checks; both use short-lived tickets (`?ticket=`), never the long-lived access token. Tickets carry `ver`; revalidate against `User.token_version` before subscribing.
- React hooks: no early returns before hooks; keep `clearActiveTrip` stable in `useAuth`.
- fakeredis TCP does not deliver Pub/Sub across connections; use the minimal RESP stub locally and real Redis in CI.
- Do not block the event loop with sync Redis calls: use `asyncio.to_thread` for publish/INCR and a separate listener thread.
- Rate-limit Redis uses `INCR` + `EXPIRE`, not Lua/pipeline, so the test stub and real Redis follow the same path.
- Migration `3b8e4c1d9f2a` normalizes legacy seats/prices/ratings and declines duplicate active requests before adding constraints.
- Do not add payment details to audit `details`: only actor/driver IDs and action metadata.
- `/ready` creates a short-lived Redis client per check; do not reuse the Pub/Sub client for readiness.
- `python-jose`/`ecdsa` were replaced by `PyJWT`; keep HS256 and the existing `sub`/`exp`/`typ` claims. New tokens add `ver` from `User.token_version`; tokens without `ver` are treated as version 0 for rollout compatibility.
- Frontend `@sentry/react` must stay dynamically imported; a static import adds ~90 KB gzip to the initial bundle.
- Gitleaks organization repositories need `GITLEAKS_LICENSE`; personal repositories do not.
- Windows: use UTF-8 for console/files; dispose the SQLite engine before unlinking the test DB.
- CI: `npm ci` requires a lockfile; keep `npm ci --dry-run` green after dependency changes.
- React Router: `setActiveTab('trip')` may navigate to `/scheduled` when called immediately after `setActiveTrip` (state not rendered yet); the `/scheduled` effect canonicalizes to `/trips/:id`. Bottom-nav passes the active trip id directly.
- Generated OpenAPI types are editor-time declarations only; do not import the runtime `.d.ts` file into the bundle.
- Light-background modals must keep fixed dark text (`#1f2937`/`#4b5563`); using `var(--text-main)` there turns text white in dark theme.
- Render Blueprints are not used; do not reintroduce `render.yaml` without an explicit request.
- Live Render `birge-api` runs `PYTHON_VERSION=3.12` (`3.12.16` verified in build log, matching CI `3.12`). Local `birge-backend/venv` also runs Python 3.12.
- Keep `@vitejs/plugin-react` on `5.x` while `vite-plugin-pwa` pulls `workbox-build` (`@babel/core@^7.0.0`); `@vitejs/plugin-react@6.3.0` (`@rolldown/plugin-babel`) triggers npm `ERESOLVE` on `@babel/core@8`.

## 6. Rolling Changelog (max 5)

- 2026-11-26: Post-audit quality fixes: fixed `/users/me/verify` bot URL (`BirgeAuthBot` without phone PII), `TripHistory` `price_per_seat` + `сом`, `/trips/matches` rate limit & 200-row cap, batch `GET /trip-requests/statuses` replacing N+1 fallback polling, `Settings` timer cleanup, `TripRequestModal`/`ReviewModal` flat styles, and `390x844` Login E2E fit check; 92 backend, 38 frontend, 6 E2E pass.
- 2026-11-26: Step 1 search/matches reliability: removed unguarded `setTimeout` error trap in `useTripSearch.js`, extracted shared `mapMatchTrip.js`, surfaced free seats (`seats - seats_taken`) in `Matches.jsx`, guarded `ReviewModal` submit state & timer cleanup in `useTripActions.js`; 40 frontend unit + 6 E2E pass.
- 2026-11-26: Step 2 Dependabot review: merged `#1`/`#2` (`setup-python@v7`, `setup-node@v7`), applied `#3` (`checkout@v7`), `#9` (`uvicorn==0.54.0`), `#10` (`pydantic==2.14.3`), `#13` (`psycopg2-binary==2.9.13`), `#5` (`jsdom@31.0.1`), `#11` (`vitest@5.1.1`); 92 backend, 40 unit, 6 E2E pass.
- 2026-11-26: Upgraded Vite to `8.3.8` (`#4`, 551 KiB PWA precache, 40 unit + 6 E2E pass) with cross-platform lockfile (`157fcc8`, Vercel Prod Ready); closed `#6` (`@vitejs/plugin-react@6.3.0` `@babel/core@8` vs `workbox-build` conflict).
- 2026-11-26: Render `PYTHON_VERSION` upgraded to `3.12` (`3.12.16` live); applied PR `#12` (`python-multipart==0.0.34`) & `#7` (`SQLAlchemy==2.1.9`), moved local `venv` to Python 3.12; 92 backend, alembic check, 40 frontend unit, 6 E2E pass.
