# Shared Dev Deploy Note

## Admin workspace, Pments and email personalization

`0010_ments_pments.sql` adds self-reported informal mentor relationships, and
`0011_email_personalization.sql` adds draft-specific recipient merge overrides.
Both are additive. Existing official Ments and member profiles remain intact;
no chart import, reset or seed is needed for this release.

The shared `/internal/ments` API now reads Pment reports and accepts updates.
Members replace only their own reports; member admins can remove reports.
Shared-mode developers need the updated beta Worker after these migrations.

After migration approval, use the beta database binding and redeploy
`code-portal-beta` in account `83376df5e0bae067afa197b07430168d`. Its D1 database
is `code-nest-beta-db` (`ffe974a7-4b89-4ac7-b07e-ad62f4530ca2`).

```powershell
pnpm exec wrangler d1 migrations apply DB --config wrangler.beta.jsonc --remote
pnpm build
pnpm exec wrangler deploy --no-x-autoconfig --config wrangler.beta.jsonc
```

The template starters ship in code. Recipient corrections save with the draft
and are applied to dispatch, test rendering and the member archive. They do not
change profile values. Review uses local fixtures and fake dispatch transport;
no real email or live relationship is created by the checks.

## Beta Ments Tree

`0009_ments_tree.sql` adds mentor profiles with optional portal account links,
foreign keys, and triggers that prevent cycles. The member page is `/portal/ments`;
member admins manage it at `/portal/admin/members/ments`. `FEATURE_MENTS` enables
the page, actions, navigation, and shared `/internal/ments` API. It defaults to
off and is enabled in the beta and staged Wrangler configs. Local/shared developers can
opt in with `FEATURE_MENTS=true`.

After approval, apply the beta migration, load the chart export if wanted, then
build and redeploy `code-portal-beta`. The beta binding is `code-nest-beta-db`
(`ffe974a7-4b89-4ac7-b07e-ad62f4530ca2`) in account
`83376df5e0bae067afa197b07430168d`. No reset is needed.

```powershell
pnpm exec wrangler d1 migrations apply DB --config wrangler.beta.jsonc --remote
pnpm exec tsx scripts/export-ments-chart.ts
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --file .local/ments-chart-seed.sql
pnpm build
pnpm exec wrangler deploy --no-x-autoconfig --config wrangler.beta.jsonc
```

The chart seed is separate from the shared migration history. It adds missing profiles without replacing existing
records or linking accounts by guessed names. Admins link accounts by email.
The source retains published spelling variants. The exporter merges the two
confirmed aliases and omits blank mentees, producing 393 people and 362 links.

## Staged Ments and email activation

The follow-up release enables Ments and email on `code-portal-staged`, switches
its entry to `custom-worker.ts`, and adds the EMAIL binding and dispatch cron.
The staged database is `543701fb-67ba-4f09-a931-85ffb861386f` in the same CODE
account. Apply pending migrations 0007 through 0011 and the additive chart seed
before merging the activation into staging. No database reset is required.

```powershell
pnpm exec wrangler d1 migrations apply DB --config wrangler.staging.jsonc --remote
pnpm exec tsx scripts/export-ments-chart.ts
pnpm exec wrangler d1 execute DB --config wrangler.staging.jsonc --remote --file .local/ments-chart-seed.sql
pnpm exec wrangler secret put EMAIL_UNSUBSCRIBE_SECRET --config wrangler.staging.jsonc
```

Set a fresh unsubscribe signing secret for staged. Configure a sender and
category through Email > Senders & categories before sending. The nine
template starters need no database seed.

Beta and staged share the verified `ateneocode.org` sending domain. Route
`beta-inbox@ateneocode.org` to `code-portal-beta` and
`staged-inbox@ateneocode.org` to `code-portal-staged`. Enable routing
subaddressing so campaign/thread tags survive in the recipient address. Leave
the catch-all rule disabled. Website subdomains do not need separate email
domain configuration because the inbox addresses use the root domain.

The `email_image` upload contract reuses the existing public image storage.
Redeploy beta after this change so shared developers receive the updated
upload handler. No new beta schema migration is required. Merge the reviewed
release into beta and staging to trigger their existing Cloudflare builds.

Phase 0 changes the database schema, migrations, environment bindings, internal contracts, repository seams, and shared dev token seed shape.

Shared-mode developers depend on the deployed dev Worker staying current. After this phase is reviewed and the D1 reset commands are approved, the dev backend must be updated in this order:

1. Apply the new clean schema to `code-nest-dev-db`.
2. Seed `code-nest-dev-db` with the dev seed data.
3. Deploy `code-portal-beta`.

Exact Wrangler commands must be shown for approval before any D1 reset, migration, seed, or production database operation.

## Phase 3 short links

Phase 3 adds the short-link contract, internal `/internal/links` routes, public redirect behavior, public link-preview uploads, and richer link seed data.

After review, update the deployed dev Worker so shared-mode developers receive the new internal links API:

1. Deploy `code-portal-beta`.
2. Seed dev again only if the refreshed reserved slugs and demo link stats are needed in shared dev.

No schema migration is expected for Phase 3 because the v5 short-link tables already exist.

## Phase 9 hardening

Phase 9 adds the `rate_limit_counters` table, wraps the auth POST route with rate limiting, and wires rate limits into link-create and scan-submit paths.

After review, update the deployed dev Worker so shared-mode developers receive the new table and route behavior:

1. Apply dev D1 migrations with `pnpm db:migrate:dev`.
2. Deploy `code-portal-beta` with `pnpm deploy:dev`.

Do not run either command without approval from the orchestrating session.
