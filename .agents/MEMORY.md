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

- Backend tests: 101 passed (ruff `E9,F,B` ignoring `B008`; includes geo/corridor matching/route-preview/OSRM+Photon fallback, moderation reports & blocking, 6-stage conversion funnel, recurring trips & late cancellation policy, native WebView CORS + body refresh fallback, `/users/me/export` & `DELETE /users/me`, batch `/trip-requests/statuses`, `/users/me/verify`, Telegram challenge flow, PII/OTP, refresh rotation, SSE/WS).
- Frontend tests: 53 passed in 15 files (`platform`, `Settings`, `i18n`, `useTripSearch`, `Login`, `api`, `useIncomingRequests`, `AddressInput`, `ReviewModal`, `ReportModal`, `RealMap`, `routes`, `escapeHtml`, `date`, `swPolicy`).
- Browser E2E: 9 passed on PostgreSQL 16.2 (`a11y.spec.js` `@axe-core/playwright` WCAG 2.1 AA light+dark + `ky` language switch, `login-code` + `390x844` fit checks + `sse-ticket`).
- Production build: passed; Leaflet bundled (`vendor-maps`), `build` + `build:mobile` pass.
- `main.py`: ~265 lines (extracted `routers/{admin,bot,reports,reviews,users_privacy}.py`, `trip_maintenance.py`, `analytics.py`, `geo.py`, `auth_challenges.py`).
- OpenAPI: regenerated `birge/openapi.json` and `birge/src/types/api.d.ts`.
- P0: complete. P1: complete & deployed; P2: complete (deep links, OpenAPI types, accessibility, RU/KY i18n, export/deletion, Capacitor WebView hardening, Leaflet/OSM corridor/ETA maps, abuse moderation, conversion funnel, recurring trips & cancellation policy). Paid `0.1c-256mb` Postgres upgrade before `2026-12-14` & Capacitor native app packaging remain next.

## 3. Active Work State

- Current goal: Keep `birge-postgres` ready for in-place paid upgrade (`0.1c-256mb`, $6/mo; Neon migration cancelled) before 2026-12-14, then pick remaining P2 product features (funnel analytics, corridor/ETA, moderation/reports).
- Working tree: Milestones A, B, and C complete (`datetime.utcnow()` removed; `geo.py`/`auth_challenges.py`/`users_privacy.py`/`Dashboard` split; Leaflet/OSM + backend geocache/corridor/ETA; abuse reports/moderation, 6-stage funnel analytics, recurring trips & late cancellation policy). Ready for Capacitor mobile app testing after CI/deploy verification.
- P1 done: shared Redis rate limiting for auth and write endpoints; Redis Pub/Sub for SSE and WS chat; CHECK constraints and partial unique index; audit log; `/ready`; `X-Request-ID`; JSON logs with request id; optional Sentry backend/frontend; manual Render setup + backup/restore runbook; Dependabot/pip-audit/gitleaks/Redis compose.
- P1 hardening 2026-11-15: `User.token_version` + `/auth/logout` revoke all sessions; token version checked in HTTP, SSE and WS; SSE uses a short-lived stream-bound ticket; escaped map balloon HTML; security headers on Vercel/API; current production CORS fallback; safe API URL; local startup no longer registers a production Telegram webhook without `RENDER_EXTERNAL_URL`.
- Migration/E2E 2026-11-15: CI runs Alembic on `postgres:16`; Playwright browser E2E starts ephemeral PostgreSQL 16.2 via `pgserver`, applies Alembic, seeds a user and runs real backend/frontend ticket + EventSource checks. Cleanup is covered by `globalTeardown` and stale-instance cleanup. Local PostgreSQL migration check passed; GitHub PostgreSQL/E2E job passed on 2748929.
- P1 security 2026-11-16: payment PII encrypted at rest via Fernet (`enc:v1:`), OTP HMAC-SHA256, migration `5c8f1a2b9d4e`; refresh sessions/rotation migration `6e2b7c4d1a3f`; CI and docs moved to Python 3.12. 51 backend tests pass on 3.12.10; PostgreSQL migration check passes.
- P2 done: React Router deep links, participant-only `GET /trips/{trip_id}`, Vercel SPA fallback, deterministic OpenAPI export + generated frontend types, WCAG 2.1 AA automated `@axe-core/playwright` audit (light+dark+mobile) & full RU/KY `i18n.js` UI coverage.
- P1 tests: 53 backend tests; `tests/test_api.py` covers PII encryption, OTP hashing, refresh rotation/cleanup, logout/SSE and payment access. `tests/test_redis_multiprocess.py` covers shared rate limit, SSE and WS across separate OS processes. Local test uses `tests/redis_stub.py`; CI uses real Redis. `tests/test_logging.py` covers JSON formatting and request-id log correlation.
- Hot files: `auth.py`, `pii_crypto.py`, `dependencies.py`, `rate_limit.py`, `realtime.py`, `logging_config.py`, `sentry_config.py`, `models.py`, `routers/{auth,trips,trip_requests,users}.py`, `birge/src/App.jsx`, `birge/src/index.css`, `birge/src/components/{AddressInput,RealMap,ReviewModal,TripRequestModal}.jsx`, `birge/src/screens/{Login,Dashboard,Profile,Settings,Matches}.jsx`, `birge/src/hooks/useAuth.js`, `birge/src/utils/{api,escapeHtml,routes}.js`, `birge/openapi.json`, `birge/src/types/api.d.ts`, `scripts/export_openapi.py`, `scripts/{seed_e2e,run_e2e_backend,stop_e2e_postgres,check_postgres_migrations}.py`, `birge/e2e/*`, `birge/playwright.config.js`, `tests/test_api.py`, `tests/test_logging.py`, `tests/test_redis_multiprocess.py`, `tests/test_sentry.py`, `alembic/versions/{3b8e4c1d9f2a_p1_constraints_and_audit,4d1e2f3a5b6c_add_token_version_to_users,5c8f1a2b9d4e_encrypt_pii_and_invalidate_plaintext_otp,6e2b7c4d1a3f_add_refresh_sessions}.py`, `docs/RUNBOOK.md`, `docs/MIGRATIONS.md`, `.github/workflows/ci.yml`, `.github/workflows/security.yml`.
- Not done: manual Render restore drill & post-migration backup (before 2026-12-14); P2 analytics/moderation/export & monolith refactor (`Login.jsx`, `api.js`); `@vitejs/plugin-react` 6 (blocked on `vite-plugin-pwa`/`workbox-build` `@babel/core@7` peer). All 12 Dependabot PRs resolved and Render `PYTHON_VERSION=3.12` (`3.12.16`) live.
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
- CI: `npm ci` requires a lockfile; keep `npm ci --dry-run` green after dependency changes, and on Windows verify Linux optional packages (`@emnapi/core`, `@emnapi/runtime` for `@rolldown/binding-wasm32-wasi`) are not pruned from `package-lock.json`.
- React Router: `setActiveTab('trip')` may navigate to `/scheduled` when called immediately after `setActiveTrip` (state not rendered yet); the `/scheduled` effect canonicalizes to `/trips/:id`. Bottom-nav passes the active trip id directly.
- Generated OpenAPI types are editor-time declarations only; do not import the runtime `.d.ts` file into the bundle.
- Light-background modals must keep fixed dark text (`#1f2937`/`#4b5563`); using `var(--text-main)` there turns text white in dark theme.
- Render Blueprints are not used; do not reintroduce `render.yaml` without an explicit request.
- Live Render `birge-api` runs `PYTHON_VERSION=3.12` (`3.12.16` verified in build log, matching CI `3.12`). Local `birge-backend/venv` also runs Python 3.12.
- Keep `@vitejs/plugin-react` on `5.x` while `vite-plugin-pwa` pulls `workbox-build` (`@babel/core@^7.0.0`); `@vitejs/plugin-react@6.3.0` (`@rolldown/plugin-babel`) triggers npm `ERESOLVE` on `@babel/core@8`.

## 6. Rolling Changelog (max 5)

- 2026-11-27: Milestone C P2 product & trust features: abuse reports & moderation (`POST /reports/`, `/admin/reports*`, `ReportModal`, `AdminModerationPanel`), 6-stage privacy-safe funnel analytics (`GET /admin/funnel`), recurring trips (`recurrence_days` auto-rescheduling), and late-cancellation tracking (`< 30 min`, `101` pytest, alembic `c2d5e8f1a3b4`).
- 2026-11-27: Milestone B free map & geo stack: replaced `@pbe/react-yandex-maps` with bundled `leaflet` + OSM/CARTO tiles, CSP updated, backend `/trips/geocode|reverse-geocode|route-preview` with Redis/memory TTL cache + directional corridor matching + ETA (`b1e4c9d2a6f0`, `99` pytest, `51` vitest).
- 2026-11-27: Milestone A tech-debt cleanup: replaced deprecated `datetime.utcnow()` in `models.py` & tests (0 utcnow warnings in pytest); extracted `geo.py`, `auth_challenges.py`, `routers/users_privacy.py`, and `birge/src/screens/dashboard/{bishkekHubs.js,HubsDisclosure.jsx,DriverParameters.jsx}` (`96` backend, `50` unit, `9` E2E pass).
- 2026-11-27: Mobile WebView/Capacitor hardening: added `NATIVE_WEBVIEW_ORIGINS` (`capacitor://localhost`, `ionic://localhost`, `https://localhost`) CORS & JSON `refresh_token` fallback in `routers/auth.py` (strictly isolated from web), created `src/utils/platform.js`, `npm run build:mobile` (SW disabled), safe Notification/links/clipboard, `localStorage` Telegram challenge recovery, and SSE foreground resume (`96` backend, `50` unit, `9` E2E pass).
- 2026-11-27: P2 privacy & App Store compliance: added `GET /users/me/export` (rate-limited JSON export + `AuditLog`), `DELETE /users/me` (blocks `in_progress`, cancels open trips/releases seats + SSE notify, deletes Telegram/session bindings, anonymizes PII, bumps `token_version`), OpenAPI (40 paths) + Settings UI/RU+KY i18n (`95` backend, `45` unit, `9` E2E pass).
