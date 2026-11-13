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

- [ ] Redis Pub/Sub for SSE/WebSocket; remove single-process assumption
- [ ] Redis-backed rate limiting for auth and write endpoints
- [ ] Partial unique index for active trip requests
- [ ] CHECK constraints for seats, price and rating after legacy data cleanup
- [ ] Audit log for trip status changes and payment-detail access
- [ ] Sentry (backend + frontend), structured logs and request IDs
- [ ] Separate liveness and readiness probes
- [ ] Staging environment, database backups and restore drill
- [ ] Render infrastructure-as-code and migration release step
- [ ] Dependabot, `pip-audit` and secret scanning

## P2 — product and UX

- [ ] React Router with deep links (`/trips/:id`, `/scheduled`, `/profile`)
- [ ] Incremental TypeScript or OpenAPI-generated frontend types
- [ ] Accessibility audit (focus management, labels, contrast, keyboard)
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
