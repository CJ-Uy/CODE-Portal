# Auth Architecture Notes

Auth for the CODE Portal uses Auth.js v5 with Google OAuth and database sessions. The `members` table is the Auth.js user table, extended with CODE profile fields. Auth.js adapter tables live in the Drizzle schema and migration set.

## Phase 0 Middleware Spike

The spike tested whether Auth.js `auth()` with a database-session adapter can reach D1 from the route interception layer.

Test setup:

- Temporary Auth.js v5 config with a database-session adapter.
- Adapter `getSessionAndUser()` queried D1 through Drizzle before returning a fake session.
- Temporary `middleware.ts` matched `/__auth-spike`.
- Request included an Auth.js session cookie.

Results:

| Runtime | Result | Notes |
| --- | --- | --- |
| `next dev` with `initOpenNextCloudflareForDev()` | Works | `auth()` reached D1 through Drizzle once the top-level local D1 binding was migrated. The dev server uses the top-level `DB` local simulation unless run through a specific Wrangler env. |
| `opennextjs-cloudflare preview` | Works | `auth()` reached D1 through Drizzle. Preview used the secure cookie name `__Secure-authjs.session-token`. |
| Deployed beta Worker | Not proven | `pnpm exec wrangler deploy --config wrangler.beta.jsonc` stalled after asset upload and during Worker version creation. The deployed `/__auth-spike` endpoint returned 404, so the spike build was not confirmed as published. |

Additional finding:

- Next.js 16 `proxy.ts` is Node middleware. `@opennextjs/cloudflare` rejected the build with `ERROR Node.js middleware is not currently supported. Consider switching to Edge Middleware.`
- Classic `middleware.ts` is deprecated by Next.js 16 but is still the Cloudflare-buildable interception layer in this stack.

Decision for v1:

- Keep middleware lightweight. It may check for session-cookie presence and redirect obvious unauthenticated `/portal/*` requests.
- Run authoritative `auth()` and role checks in layouts, server actions, route handlers, and repository/service calls.
- Do not depend on D1 access in middleware until a deployed dev Worker spike succeeds.

## D1 Schema Inventory

Inventory commands run against remote dev and prod:

```bash
pnpm exec wrangler d1 execute code-nest-dev-db --remote --command "SELECT name,sql FROM sqlite_master"
pnpm exec wrangler d1 execute code-nest-prod-db --remote --command "SELECT name,sql FROM sqlite_master"
```

Both databases contained only:

- Cloudflare/Wrangler metadata tables.
- `d1_migrations`.
- `users`.
- `users_email_unique`.

Row counts:

- Remote dev `users`: `0`
- Remote prod `users`: `0`

Decision:

- Use the clean-reset path for dev and prod D1 because there is no user data to preserve.
- Before running any reset, migration, or prod D1 command, show the exact `pnpm exec wrangler` command and wait for explicit confirmation.
