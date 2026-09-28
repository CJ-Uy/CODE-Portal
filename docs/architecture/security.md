# Security

Outside developers are not added to the Cloudflare account because they only need app-level shared dev access.

## Rules

- Do not commit secrets.
- Do not share production D1 or R2 credentials.
- Do not create raw SQL endpoints for shared dev.
- Do not expose D1 as `DATABASE_URL`.
- Use the shared dev API for typed database operations.
- Use dev-only R2 S3 credentials if direct shared upload testing is needed.
- Production uses Cloudflare bindings for native D1 and R2 access.
- Auth, link-create, and scan routes are rate-limited with the D1 fixed-window counter in `src/server/ratelimit/`.
- Phase 9 security review: see `docs/architecture/security-review-phase-9.md`.

## Secret Files

Committed:

- `.env.example`

Ignored:

- `.env.local`
- `.env.*.local`
- `.dev.vars`
- `.local/`
