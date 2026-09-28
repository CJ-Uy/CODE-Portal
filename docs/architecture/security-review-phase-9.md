# Phase 9 security review

Reviewed against master plan section 10. Each row: control, status
(pass / fail / n-a-deferred), evidence (file + test), notes.

| Control (section 10) | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Auth.js DB sessions, httpOnly/Secure cookie, revocable, sign-out deletes row | pass | `src/auth.ts`, `src/db/schema.ts` (`sessions`) | Auth.js uses `DrizzleAdapter` with `sessionsTable` and `session: { strategy: "database" }`. Cookie flags and sign-out session deletion are handled by Auth.js for database sessions. |
| AUTH_SECRET per env, trustHost true | pass | `src/auth.ts`, `src/server/env.ts` | `secret: config.AUTH_SECRET`, `trustHost: true`; env validation requires `AUTH_SECRET` unless `APP_ENV=shared`. |
| Server-side authz in repositories on every mutation + admin read | pass | `src/server/auth/permissions.ts`, `src/db/repositories/*`, `src/server/auth/permissions.test.ts` | Repositories call `can()` for admin reads and mutations, with integration coverage across events, links, members, retention, roster, surveys, nav pins, and quick links. |
| Ownership + team/ACL checks (team/ACL n-a: content system deferred, section 11) | n-a-deferred | `docs/superpowers/plans/2026-06-18-code-portal-master-plan.md` section 11, `src/db/repositories/links.ts`, `src/server/uploads.ts` | Content team/ACL subsystem is deferred. Implemented ownership checks cover links and uploads. |
| Uploads: auth + server-assigned keys + content-type/size limits + authorized GET/DELETE | pass | `src/server/uploads.ts`, `src/server/uploads.test.ts` | Upload handler requires actor, rejects caller-supplied keys, checks type and size, validates namespaces, and authorizes private GET plus DELETE. |
| Auth.js CSRF for auth routes | pass | `src/app/api/auth/[...nextauth]/route.ts`, `src/auth.ts` | Auth routes delegate to Auth.js handlers after the Phase 9 rate-limit precheck. |
| assertSameOrigin on our mutating /api/* + server actions | pass | `src/server/http/origin.ts`, `src/server/http/origin.test.ts`, mutating routes under `src/app/api` | Mutating API routes call `assertSameOrigin`; server actions run through authenticated server contexts. |
| Rate limits on auth / link-create / scan | pass | `src/app/api/auth/[...nextauth]/route.ts`, `src/server/links/handlers.ts`, `src/app/api/events/[id]/scan/route.ts`, `src/server/ratelimit/*.test.ts` | Auth is IP keyed. Link create and scan are actor keyed and fail open on limiter storage errors. |
| Short-link destination validation (http/https), open-redirect guard | pass | `src/lib/links.ts`, `src/db/repositories/links.ts`, `src/db/repositories/links.integration.test.ts` | `isValidDestinationUrl()` accepts only `http:` and `https:`; integration test rejects `javascript:`. |
| Shared API: bearer -> seeded actor, per-op auth/permission/sharedDev gating, no raw SQL | pass | `src/server/internal/shared-actor.ts`, `src/db/contract/common.ts`, `src/server/internal/*`, `src/db/shared-parity.integration.test.ts` | Bearer token resolves to seeded actor roles. Internal handlers enforce operation contracts and repository authz, not raw SQL endpoints. |
| Destructive ops denied in shared mode | pass | `src/db/contract/links.ts`, `src/server/internal/links.ts`, `src/server/internal/events.ts`, `src/server/internal/uploads.ts`, `src/db/shared-parity.integration.test.ts` | Shared handlers deny `sharedDev: "deny"` operations, including create/update/delete flows. |
| /internal/* returns 404 unless DEPLOY_ENV=dev; env.ts rejects shared config on prod | pass | `src/server/internal/*`, `src/server/env.ts`, `src/server/internal/events.test.ts`, `src/server/internal/surveys.integration.test.ts` | Internal handlers check `deployEnv !== "dev"` and production env validation rejects shared API config. |
| No secrets client-side; bindings confined to adapters/internal modules | pass | `src/server/env.ts`, `src/server/cloudflare.ts`, `src/db/adapters/*`, `src/storage/*`, `docs/architecture/security.md` | Public env status returns booleans, not secret values. D1/R2 access is behind server adapters and internal handlers. |
| PII (emails, birthdays) members-only; birthday privacy honored in calendar | pass | `src/app/portal/*`, `src/db/repositories/calendar.ts`, `src/db/repositories/calendar.integration.test.ts` | Portal layout gates member pages. Calendar hides private birthdays from normal members and tests that behavior. |
| Survey anonymity: responses carry only survey_id; one-submit conditional update | pass | `src/db/schema.ts`, `src/db/repositories/surveys.ts`, `src/app/api/surveys/submit/route.integration.test.ts` | `surveyResponses` stores survey id only. Submit marks assignment complete only when token hash matches and `completedAt` is null. |
| Forum anonymity: member_id stored, identity hidden except super reveal (audited) | pass | `src/db/repositories/event-forum.ts`, `src/db/repositories/event-forum.integration.test.ts` | List hides author for anonymous posts unless actor is super with member management; reveal requires super and writes audit. |
| Audit row on every successful admin mutation | pass | `src/db/repositories/audit.ts`, repository `audit.record` calls, repository integration tests | Admin mutations across events, links, members, nav, quick links, retention, roster, surveys, and forum reveal record audit rows. |

## Result

No concrete fail rows found. No code fix required from this review.
