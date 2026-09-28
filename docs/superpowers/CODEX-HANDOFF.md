# Codex Handoff — Event Taxonomy & Multi-Type Points

## Mission

Implement **Plan A**, then write and implement **Plans B1, B2, B3**, delivering the whole
`2026-07-27-event-taxonomy-and-points-design.md` spec. Use subagents for implementation, review
between tasks, and stop for the human only at the approval gates listed at the bottom.

## Session setup

Activate for this session: **caveman ultra**, the **taste** skill, and **ponytail (full)**.
This repo has `graphify-out/graph.json` — use `graphify query "<question>"` / `graphify explain` /
`graphify path` **before** grepping or reading raw files. Run `graphify update .` after code changes.

Repo: `c:\Users\charl\Documents\GitHub\code nest`, branch `beta`. Work directly on `beta`; do not
create a worktree (the local `.local/dev.db` matters and a worktree would not have it).

## Read these first, in this order

1. `docs/superpowers/specs/2026-07-27-event-taxonomy-and-points-design.md` — the spec. §10 maps all
   21 adversarial-review findings to their resolutions. **§A and §B are the two constraints that
   shape everything; read them twice.**
2. `docs/superpowers/plans/2026-07-27-plan-a-event-types-as-data.md` — Plan A, 7 tasks, ready to run.
3. `docs/superpowers/specs/2026-07-27-event-taxonomy-and-points-review-log*.md` — four review logs.
   Read only if you need the reasoning behind a decision; the spec already carries the conclusions.

## Where this came from

The spec went through **four Codex adversarial review rounds — 21 findings, all accepted and
applied**. Round 4 verdict: `IMPLEMENTATION READY: YES`. Do not relitigate settled decisions. If you
believe one is wrong, say so and ask; do not silently implement something different.

The two findings that would have destroyed data, so you understand why the constraints exist:

- Rebuilding `crs_events` fires `ON DELETE CASCADE` across six child tables (attendance, staff,
  invites, RSVPs, media, forum). Drizzle guards rebuilds with `PRAGMA foreign_keys=OFF`, which the
  local runner neuters inside its transaction. **Hence: no table rebuilds, anywhere.**
- A `setPoints` shim written as a `setAwards` alias erases every non-Retention award, because
  `setAwards` replaces the whole set. **Hence: the shim is a scoped Retention-only operation.**

## Non-negotiable constraints

- **No new npm dependency.** Not for anything.
- **Tests run in the Cloudflare Workers pool.** `vitest.config.mts` includes `src/**/*.test.ts` only
  — **`.ts`, never `.tsx`**. No jsdom, no React Testing Library. **Component render tests are
  impossible.** Put logic in pure `.ts` helpers and test those.
- **`better-sqlite3` must not be imported by any test file.** It is a Node native module the Workers
  pool cannot load.
- **Never rename `event_type_rules`, never drop a column, never rebuild a table.** `db:migrate:dev`
  and `deploy:dev` are separate commands, so the *currently deployed Worker runs against the new
  schema* before the new Worker ships. Every migration must be safe for the old Worker.
  `ALTER TABLE … ADD COLUMN` only, always with a non-null default when `NOT NULL`.
- **Do not touch `drizzle/migrations/meta/_journal.json`.** The migrations *directory* is the source
  of truth — `src/db/migrate-local-sqlite.ts` is directory-driven, matching wrangler. Migration
  filenames are sequential; the next free number is `0011`.
- Repository errors that must surface as HTTP 403 **must** start with `Not authorized` — both
  `src/app/api/events/[id]/scan/route.ts` and `src/server/internal/events.ts` branch on that prefix.
- Preserve the points guardrail: `events.create` writes `points: null`. Only `event:points` holders
  set point values.
- Tabs for indentation.

## Sequencing — this is a hard technical constraint, not a preference

**Never run two implementation subagents in parallel.** The plans collide:

- Migration numbering — two agents both creating `0011_*.sql` corrupts the sequence.
- Shared files — Plan A and B2 both edit `src/db/repositories/events.ts`; A and B1 both edit
  `src/db/schema.ts`.
- Hard ordering — B1 creates the tables B2 queries; B2 creates the `setAwards` that B3's UI calls.

Order: **A → B1 → B2 → B3**, one task at a time, review between each.

Parallelism that *is* safe: writing plan documents while code is being implemented. Docs and code do
not conflict.

## What to do

### Phase 1 — implement Plan A

Run `docs/superpowers/plans/2026-07-27-plan-a-event-types-as-data.md` task by task via
`superpowers:subagent-driven-development`: fresh subagent per task, review after each, fix loop on
Critical/Important findings, then a whole-branch review at the end.

Plan A quirk worth knowing: **Task 1 Step 5 deliberately breaks every `eventTypes` import at once**,
and Tasks 2, 4 and 7 repair them. `pnpm typecheck` is expected to FAIL between Task 1 and Task 4 —
that is why Task 1's gate is migration verification, not typecheck. Do not "fix" that breakage out
of scope.

### Phase 2 — write Plans B1, B2, B3

Use `superpowers:writing-plans`. Scope each from spec §9:

- **B1 — additive points schema.** `point_types`, `event_point_awards`,
  `retention_records.point_type_id` (`TEXT NOT NULL DEFAULT 'pt_retention'`, **no `REFERENCES`** —
  SQLite forbids a non-null default alongside a foreign key, and this avoids the rebuild), the
  duplicate pre-check, the partial unique index. No behaviour change.
- **B2 — repository and contracts.** `setAwards` with validation and set-based reconciliation,
  `recordScan` deriving rows from active awards, `createManual` gaining `pointTypeId`, deleting
  `recordEventAttendance`, the five totals, the two projections including the XLSX point-type
  column, the `setPoints` shim and `crs_events.points` mirror.
- **B3 — UI and cleanup.** Point-types admin screen, event-detail per-type award editor, profile
  breakdown, member history labels, leaderboard type selector. Removes the B2 shim and mirror.

Traps the spec already solved — carry them into the plans verbatim:

- The partial-index upsert conflict target **must be unqualified and literal**:
  `` targetWhere: sql`source = 'event_attendance'` ``. The obvious
  `targetWhere: eq(retentionRecords.source, "event_attendance")` emits
  `WHERE "retention_records"."source" = ?` and SQLite refuses to match it to the partial index —
  verified empirically against the installed drizzle-orm 0.45.2 / better-sqlite3 12.10.0. Assert the
  generated SQL string in a test.
- **Five totals** get the retention filter (`retention.ts:168,200,219,356`, `overview.ts:51`).
  `retention.ts:356` is an in-memory `reduce`, not SQL — a SQL-only fix misses it.
- **Two projections** (`reportBaseColumns`, `myHistory` rows) get type *metadata*, **not** a filter.
  Filtering them would hide non-Retention records from reports and from the member's own history.
- `setAwards` step 3 must delete only rows of **active** types, or it destroys the history that
  deactivation is supposed to preserve.

### Phase 3 — implement B1, then B2, then B3

Same subagent-driven loop, same review discipline, one plan at a time.

## Stop and ask the human for these

Per `CLAUDE.md`, show the exact command and wait for approval before any D1 migration, seed, delete,
or production-touching operation. Wrangler cannot authenticate non-interactively, so **the human runs
these, not you**:

```
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote   # read-only
pnpm db:migrate:dev
pnpm deploy:dev
```

**Two blocking prerequisites before Plan A's migration can ship:**

1. **Migration `0010` is not yet applied to dev D1.** Plan A's `0011` alters the table `0010`
   creates, so `0010` must land first.
2. **Run the distinct-type audit against dev D1 before `0011`:**
   `SELECT type, COUNT(*) FROM crs_events GROUP BY type;`
   `crs_events.type` has no CHECK and no foreign key, so "only the three seeded values exist" is an
   assumption. The local DB holds only `official`, which proves nothing about dev. Any other value
   needs a reviewed, explicitly **inactive** `event_type_rules` row seeded before `0011` ships, or
   those events render a raw key and become uneditable by type.

Neither blocks writing or reviewing code. Keep implementing; batch the deploy asks.

## Definition of done

- All four plans implemented, `pnpm typecheck`, `pnpm lint` and `pnpm vitest run` clean.
- A whole-branch review per plan, with findings fixed or explicitly parked with a written ruling.
- `graphify update .` run.
- Deploy commands presented to the human, not executed by you.
