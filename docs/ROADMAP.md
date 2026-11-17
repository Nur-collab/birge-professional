# Birge professionalization roadmap

Status legend: `[x]` done, `[~]` in progress, `[ ]` planned.

## P0 — engineering baseline

- [x] Clean working copy separated from the original project
- [x] Root README and backend `.env.example`
- [x] Pinned runtime and development dependencies
- [x] CI for backend lint/tests and frontend build
- [x] Remove dead frontend modules and dead bundler rules
- [x] Security guards for admin/internal endpoints and explicit CORS
- [x] Server-side profile photo upload
- [x] Short-lived access tokens with refresh
- [x] Short-lived WebSocket tickets instead of JWT in the URL
- [x] Alembic migrations and database indexes
- [x] Backend integration tests through HTTP (`TestClient`)
- [x] Frontend tests (Vitest + React Testing Library)
- [x] Split `main.py` into routers/services and `App.jsx` into hooks/contexts
  - [x] `routers/auth.py` extracted from `main.py`
  - [x] `routers/users.py` extracted from `main.py`
  - [x] `routers/trips.py` extracted (trip CRUD, chat and payment endpoints)
  - [x] Extract remaining WebSocket/SSE and trip-request routes
  - [x] Split `App.jsx` into hooks/contexts
- [x] Windows-safe UTF-8 console output

## P1 — production readiness

- [x] Redis Pub/Sub for SSE/WebSocket; local fallback when `REDIS_URL` is empty
- [x] Redis-backed rate limiting for auth and write endpoints
- [x] Partial unique index for active trip requests
- [x] CHECK constraints for seats, price and rating after legacy data cleanup
- [x] Audit log for trip status changes, request decisions and payment-detail access
- [x] Structured logs with request IDs
- [~] Sentry SDK wired for backend + frontend (DSN/project validation pending)
- [x] Separate liveness (`/health`) and readiness (`/ready`) probes
- [x] Server-side session revocation: `User.token_version`, checked for HTTP, SSE and WS; `/auth/logout` revokes refresh tokens
- [x] Escape user-controlled map balloon HTML and add baseline security headers
- [x] Safe production API fallback and no local Telegram webhook registration by default
- [~] Staging environment, database backups and restore drill (runbook ready; manual Render setup/drill pending)
- [~] Dependabot, `pip-audit` and secret scanning (configured; verify on GitHub)
- [x] Short-lived SSE tickets instead of access token in the query string; WS/SSE tickets carry `token_version`
- [x] Browser E2E for SSE ticket issuance and EventSource auth (Playwright; 3 tests pass locally on PostgreSQL 16.2)
- [x] Encrypt payment details at rest (Fernet `enc:v1:`) and hash OTP codes (HMAC-SHA256); data migration added
- [x] One-time refresh-token rotation via persisted hashed JTI; replay is rejected and consumed/expired rows are purged
- [x] PostgreSQL migration check (local ephemeral PostgreSQL 16.2 passed; CI postgres:16 job added)
- [x] Python 3.12+ runtime (CI uses Python 3.12; tests pass on 3.12.10 locally)

## P2 — product and UX

- [x] React Router with deep links (`/trips/:id`, `/scheduled`, `/profile`)
- [x] Incremental TypeScript or OpenAPI-generated frontend types (`openapi.json` + generated `api.d.ts` + JSDoc client types)
- [~] Accessibility baseline: labels, keyboard, dialogs, focus and contrast tokens fixed; automated axe/visual contrast sweep remains
- [ ] Complete Russian/Kyrgyz i18n coverage
- [ ] Funnel analytics: search → request → accept → trip → review
- [ ] Route-corridor matching, ETA, recurring trips and cancellation policy
- [ ] Support/moderation tools and abuse reporting
- [ ] Data export/deletion and consent flows

## Deliberate non-goals

- Microservices, Kubernetes and GraphQL are not justified at the current scale.
- A full rewrite (including a big-bang TypeScript migration) is out of scope.
- Realtime is not considered production-ready until Redis or another shared
  broker is in place.
