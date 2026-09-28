# E2E tests

Light Playwright suite covering one happy path per shipped phase. It runs
against `next dev` with `APP_ENV=local` and the seeded better-sqlite3 DB. It
uses no Cloudflare credentials and no real Google OAuth.

## Run

```bash
pnpm db:migrate:local:sqlite
pnpm db:seed:local
pnpm test:e2e
```

## Mocked auth

Sign-in uses `signInAs(page, role)` from `e2e/fixtures/auth.ts`, which posts to
the test-only `/api/auth/e2e` route. That route returns 404 unless
`APP_ENV=local` and `E2E_AUTH_BYPASS=1`, so it is inert in production and shared
mode.
