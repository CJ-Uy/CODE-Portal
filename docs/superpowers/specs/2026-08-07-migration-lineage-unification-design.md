# Migration Lineage Unification

**Date:** 2026-08-07
**Status:** revision 2, approved in principle, not yet implemented
**Supersedes:** the two-directory arrangement introduced by `docs/superpowers/plans/2026-08-05-beta-to-staging-release.md`
**Revision note:** revision 1 was reviewed adversarially and failed. Four critical defects, three high. Revision 2 records what changed and why, because several of the corrections are counterintuitive.

## Problem

The project maintains two incompatible D1 migration histories.

| # | `drizzle/release-migrations` (staging, prod) | `drizzle/migrations` (beta) |
| --- | --- | --- |
| 0000 | `young_bullseye` | `young_bullseye` (same content, CRLF differs) |
| 0001 | `member_portal_links` | `v5_drop_deferred` |
| 0002 | `link_workspace_fields` | `v5_add_foundation` |
| 0003 | `admin_members_nav` | `phase_9_rate_limit_counters` |
| 0004 | `beta_release_bridge` | `robust_blue_shield`, then 0005 to 0019 |

D1 records applied migrations by filename, so the two histories cannot be pointed at the same database. The release lineage exists because beta's `0001_v5_drop_deferred.sql` drops 17 tables with no `IF EXISTS` guard, all of which staging and production hold because the shared `0000` created them.

### Measured drift

Both lineages were applied to throwaway SQLite databases and the resulting `sqlite_master` rows compared, normalising whitespace and backticks. Reproduced independently during adversarial review.

- 82 objects exist in both lineages, **17 of them substantively different**
- 39 objects exist only in the release lineage: 16 legacy tables plus their indexes
- 16 objects exist only in the beta lineage, all library and announcements support tables

### Live consequences

`src/db/schema.ts` declares `member_feed_state.tour_seen_at`. `code-nest-staged-db` instead has `announcements_seen_at`. `src/db/repositories/memberFeed.ts` selects and upserts `tourSeenAt`, so those calls raise `no such column` against staging today.

`nav_pins` differs in three ways, not one: `created_by` nullability, its foreign key action (`SET NULL` in release, `CASCADE` in `schema.ts`), and whether `position` carries a default.

Neither divergence was noticed because nothing compares the lineages.

### Root cause

Not that the bridge was hand-written. **That nothing ever checked it.** Revision 1 misdiagnosed this and built its whole approach on the wrong lesson. See locked decision 3.

## Goal

Collapse to a single migration history that every environment shares, where each environment sits at a prefix of it: production furthest behind, staging one step ahead as the rehearsal, beta at the tip. Promotion becomes `wrangler d1 migrations apply` with no per-release reconciliation.

## Locked decisions

1. **The release lineage is the trunk.** Production holds live data and its history cannot be rewritten. Beta's history gives way.

2. **`code-nest-beta-db` will be wiped and replayed.** Its data is disposable. This is what makes unification possible.

3. **The reconciling migration is authored, not generated, and gated by an automated convergence test.**

   Revision 1 said "generated, not hand-written". That is wrong twice over.

   First, `drizzle-kit generate` emits only DDL. Nine DML statements across five beta migrations, plus four in the existing bridge, are load-bearing: seeding `roles`, seeding and labelling `event_type_rules`, seeding `pt_retention`, copying historical `point_awards` into `retention_records`, backfilling `audit_logs`, and backfilling `crs_events.public_code`. A generated migration silently drops all of them. An empty `event_type_rules` means nobody can create an event.

   Second, SQLite cannot alter a column's nullability or a foreign key. Every such change requires a create-copy-drop-rename rebuild. Those rebuilds are precisely where data is lost, so they are reviewed deliberately rather than accepted unread from a generator whose snapshot state this repo already knows is unreliable.

   `drizzle-kit` is still used, but only to render the target schema from `schema.ts` as a **reference**. It never authors the migration.

4. **The tour is removed.** `GuidedTour` is never rendered, `markTourSeenAction` is never called, and no column of `member_feed_state` has a reader. The whole table retires, which dissolves the `tour_seen_at` divergence rather than patching it.

5. **`nav_pins` is aligned on all three properties**: `created_by` nullable, foreign key `ON DELETE SET NULL`, `position` default `0`. Revision 1 changed only nullability and would have left a diff behind. The FK change also alters behaviour: deleting a member now clears authorship instead of deleting their pins, which is the intended semantics.

6. **The 16 legacy tables are dropped in `0004`, guarded.** Measured 2026-08-07: `announcements`, `point_awards`, `articles`, `comments`, `lists`, `list_items`, `topics`, `team_members`, `favorites` and `consultancy_teams` all hold **zero rows in both production and staging**. No code writes to any of them.

   Revision 1 said they would simply stay, which contradicted its own generate-everything decision, since any generator comparing a correct baseline against `schema.ts` must read 39 absent objects as deletions. The interim position was to declare them in `schema.ts` and drop them later, chosen only because the row counts were unknown. They are known now and they are zero, so declaring sixteen dead tables to postpone a provably safe delete buys nothing and leaves `schema.ts` describing tables the product does not have.

   Every drop is `DROP TABLE IF EXISTS` and appears on the destructive-statement allowlist in Verification check 3. The data-preservation test asserts the tables were empty before the drop, so if any environment ever does hold rows the suite fails rather than discarding them.

7. **The single directory keeps the name `drizzle/migrations`.** `drizzle.config.ts`, `vitest.config.mts` and `src/db/migrate-local-sqlite.ts` already hardcode that path.

8. **`announcements` stays one table at the `schema.ts` shape.** The two versions are not two concepts. Both are org-wide member announcements; beta's is a redesign that replaced structured targeting (`audience_kind`, `audience_value`) with a display label, replaced `pinned_until` with a boolean, and dropped scheduling. Its `linked_event_id` is nullable, always written null, and never read, so the table is not event-scoped and must not be renamed to suggest it is. A nullable union of both column sets was rejected: it would forfeit every `NOT NULL` guarantee and move the real rules into application code. Separate `org_announcements` and `event_announcements` tables were rejected as over-engineering for one flagged-off feature.

   **No column mapping is needed.** Measured 2026-08-07: `announcements` holds zero rows in both production and staging. `0004` drops and recreates the table at the `schema.ts` shape. Had rows existed, the mapping would have been `title`, `body`, `created_at` direct; `tag` defaulting to `CODE`; `author_member_id` to `created_by`; `pinned_until` to `pinned` as `pinned_until > now`; `audience_kind` and `audience_value` composed into `audience`; `scheduled_for` and `published_at` dropped. That mapping is recorded here only so the decision is not re-derived if the counts ever change before `0004` runs, which the preservation test checks.

9. **Convergence is a test in the suite, not a manual step.** Revision 1 proposed running `drizzle-kit generate` twice and expecting an empty diff. That is circular: the second run compares `schema.ts` against the snapshot the first run wrote, and would pass on a completely wrong trunk. See Verification.

10. **Rollback is an executable procedure.** Revision 1 named a backup file and stopped. Migrations are atomic per file, not across a replay, so a failure partway leaves a half-rebuilt database whose original data is already gone.

## Target architecture

One directory, `drizzle/migrations`:

```
0000_young_bullseye.sql          shared origin (release copy is canonical)
0001_member_portal_links.sql     production history
0002_link_workspace_fields.sql   production history
0003_admin_members_nav.sql       production history
0004_unify_schema.sql            authored: DDL rebuilds plus preserved DML
```

`drizzle/release-migrations` is deleted. Beta's former `0001` to `0019` are deleted; their cumulative effect survives inside `0004_unify_schema.sql`.

| Config | Database | `migrations_dir` |
| --- | --- | --- |
| `wrangler.beta.jsonc` | `code-nest-beta-db` | `drizzle/migrations` |
| `wrangler.staging.jsonc` | `code-nest-staged-db` | `drizzle/migrations` |
| `wrangler.jsonc` | `code-nest-prod-db` | `drizzle/migrations` |

End state: production at `0003` and untouched by this work, staging at `0004` as the rehearsal, beta at `0004` after a wipe and replay.

## Verification

Four checks. Each must pass before the next stage.

1. **Convergence, as a test.** Replay the trunk into a throwaway SQLite to produce schema A. Render `schema.ts` from scratch with `drizzle-kit` to produce schema B. Compare A against B by introspection: `sqlite_master`, `PRAGMA table_info`, `PRAGMA foreign_key_list`, `PRAGMA index_list`. Neither side is derived from the other, so agreement is meaningful. This lives in the test suite and fails the build on any difference.

   The comparison must not lowercase or collapse whitespace inside SQL string literals. Revision 1's normaliser did, which made `'CODE'` and `'code'` compare equal.

2. **Data preservation.** Insert legacy-shaped fixture rows into a database built from `0000` to `0003`, apply `0004`, then assert exact values afterwards: seeded `event_type_rules` present with labels and colours, `pt_retention` present, `point_awards` rows visible in `retention_records`, `crs_events.public_code` populated, announcement rows mapped. Synthetic fixtures, never production data, so this runs in the suite and does not depend on any remote database.

3. **Destructive-statement allowlist.** Every `DROP TABLE`, `DROP COLUMN` and `DELETE` in `0004` is matched against an explicit allowlist. Revision 1 used a grep for a short list of table names, which would have passed the known-bad generated migration cleanly, since that migration contained zero drops and forty-four creates and still failed on its first statement.

4. **Live.** After each remote application, `wrangler d1 migrations list` reports nothing pending, and a signed-in pass over the portal loads dashboard, calendar, an event, links and profile without error.

## Risks

| Risk | Mitigation |
| --- | --- |
| Authored `0004` does not reproduce the intended schema | Convergence test, run in the suite before any remote application |
| A table rebuild loses rows | Data-preservation test with legacy fixtures, plus the destructive-statement allowlist |
| Staging reset destroys the data that would expose a bad mapping | Mapping is proven against synthetic legacy fixtures in the suite, which does not depend on staging holding that data |
| Replay fails partway, leaving a half-built database | Unique immutable backup filenames, dump validated in throwaway SQLite before the destructive step, documented reset-and-import recovery |
| Beta left empty after wipe | `pnpm db:seed:dev` is a no-op that prints instructions and exits zero; seeding uses `db:seed:dev:export` then an explicit `wrangler d1 execute --config wrangler.beta.jsonc --file` |
| Future `db:generate` misbehaves | Its journal is already stale at `0008` while SQL runs to `0019`; the trunk rebuilds the baseline and a task verifies a subsequent generate behaves |

## Out of scope

- Applying anything to `code-nest-prod-db`
- Dropping the 16 legacy tables
- Feature-flag enforcement for server actions and internal routes, still tasks 2 to 5 of the 2026-08-05 plan
- Re-enabling any flagged surface

## Success criteria

- One migration directory; `drizzle/release-migrations` no longer exists
- All three wrangler configs point at `drizzle/migrations`
- Convergence and data-preservation tests pass as part of `pnpm test`
- `migrations list` reports nothing pending for beta and staging
- Staging and beta serve the portal without schema errors
- Production untouched, one migration behind staging, ready to receive the rehearsed file

## Measured environment state, 2026-08-07

| Table | production | staging |
| --- | --- | --- |
| `announcements` | 0 | 0 |
| `point_awards` | 0 | 0 |
| `articles`, `comments`, `lists`, `list_items`, `topics`, `team_members`, `favorites`, `consultancy_teams` | 0 | 0 |
| `event_type_rules` | not present | 3 |
| `crs_events` | not present | 3 |

Read with `wrangler d1 execute --remote` using scalar subqueries; a `UNION ALL` of ten counts exceeds D1's compound `SELECT` term limit and fails with `SQLITE_ERROR 7500`.

Consequences: decision 8 needs no data mapping, decision 6 can drop rather than declare, and the `point_awards` to `retention_records` copy inherited from the bridge is a no-op on both environments but is retained because the preservation test asserts on it.

Staging holding three `crs_events` rows is useful: it gives the `crs_events.public_code` backfill a real target during the rehearsal rather than an empty table.

No open inputs remain.
