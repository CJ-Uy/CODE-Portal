# Caching (OpenNext)

v1 posture, per master plan section 13:

- `/` (public landing): static at build (`export const dynamic = "force-static"`).
  No DB, no cookies; content publishing is deferred so there is nothing to revalidate.
- `/portal/*` (member workspace and admin): dynamic (`force-dynamic`). Every
  request reads the session, so none of it is cacheable.
- `/l/[slug]` (short-link redirect): dynamic. Resolves per request and records
  analytics via `runInBackground()` after responding.

## Incremental cache

R2 incremental cache stays disabled in v1. There is no ISR or on-demand
revalidation surface, so the default in-Worker cache is sufficient. Revisit if a
later phase adds ISR.
