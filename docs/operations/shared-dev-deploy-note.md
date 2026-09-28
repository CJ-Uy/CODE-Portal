# Shared Dev Deploy Note

Phase 0 changes the database schema, migrations, environment bindings, internal contracts, repository seams, and shared dev token seed shape.

Shared-mode developers depend on the deployed dev Worker staying current. After this phase is reviewed and the D1 reset commands are approved, the dev backend must be updated in this order:

1. Apply the new clean schema to `code-nest-dev-db`.
2. Seed `code-nest-dev-db` with the dev seed data.
3. Deploy `code-nest-beta`.

Exact Wrangler commands must be shown for approval before any D1 reset, migration, seed, or production database operation.

## Phase 3 short links

Phase 3 adds the short-link contract, internal `/internal/links` routes, public redirect behavior, public link-preview uploads, and richer link seed data.

After review, update the deployed dev Worker so shared-mode developers receive the new internal links API:

1. Deploy `code-nest-beta`.
2. Seed dev again only if the refreshed reserved slugs and demo link stats are needed in shared dev.

No schema migration is expected for Phase 3 because the v5 short-link tables already exist.

## Phase 9 hardening

Phase 9 adds the `rate_limit_counters` table, wraps the auth POST route with rate limiting, and wires rate limits into link-create and scan-submit paths.

After review, update the deployed dev Worker so shared-mode developers receive the new table and route behavior:

1. Apply dev D1 migrations with `pnpm db:migrate:dev`.
2. Deploy `code-nest-beta` with `pnpm deploy:dev`.

Do not run either command without approval from the orchestrating session.
