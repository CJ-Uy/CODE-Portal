# Plan B1 Additive Points Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the additive points tables, typed retention column, index, seeds, and permission needed for later points work without changing runtime behavior.

**Architecture:** Add only new tables and an additive `retention_records` column through handwritten migration `0013`; the default preserves writes from the currently deployed Worker during rollout. Mirror that database shape in Drizzle, seed the three baseline point types, and extend permission typing without adding routes, repository operations, totals, UI, or upserts.

**Tech Stack:** Next.js, TypeScript, Drizzle ORM with SQLite/D1, Cloudflare Workers Vitest pool, handwritten D1 SQL migrations.

## Global Constraints

- Work on branch `beta` in the existing checkout. Do not create or use a worktree.
- Scope is spec section 9 Plan B1 only: additive points schema with no behavior change.
- Use migration `drizzle/migrations/0013_additive_points_schema.sql`, because `0012_event_type_metadata.sql` is the current migration tip.
- Do not edit `drizzle/migrations/meta/_journal.json` or any Drizzle snapshot.
- Do not rebuild any table. `retention_records.point_type_id` has no `REFERENCES` clause.
- Add `retention_records.point_type_id` as `TEXT NOT NULL DEFAULT 'pt_retention'`; the default is required for existing rows and old Worker inserts during the rollout window.
- Create `point_types` and `event_point_awards` as new tables with the foreign keys specified below.
- Add the partial unique index exactly as specified below. B1 creates the index but does not implement an upsert or any `targetWhere` behavior.
- `targetWhere: sql\`source = 'event_attendance'\`` belongs to the B2 generated SQL test. It is not implemented in B1.
- Seed `pt_retention`, `pt_frontliner`, and `pt_project_lead` in the existing local and dev seed paths.
- Add `retention:configure` to `PermissionAction` and grant it to the `retention` role. This is a schema and permission capability only, with no UI or repository behavior in B1.
- All new tests are Workers `.ts` tests. Do not import `better-sqlite3` from any test file.
- Add no dependencies.
- Do not run D1 migration, remote D1 SQL, dev seed, or beta deploy as an agent. Present the exact command and wait for explicit human approval before each of those operations.
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm build` before claiming completion. Check that the plan's code changes do not create mobile or desktop horizontal overflow, though B1 has no UI changes.

---

## File Structure

- Create: `drizzle/migrations/0013_additive_points_schema.sql`
  - Adds `point_types`, `event_point_awards`, `retention_records.point_type_id`, and the partial unique index without rebuilding existing tables.
- Modify: `src/db/schema.ts`
  - Exports `pointTypes` and `eventPointAwards`; mirrors the new retention column and partial unique index.
- Create: `src/db/additive-points-schema.integration.test.ts`
  - Uses `cloudflare:test` D1 to prove migration-created tables, defaults, foreign-key tables, and partial uniqueness.
- Modify: `src/db/seed/data.ts`
  - Exports the three baseline `seedPointTypes` rows.
- Modify: `src/db/seed/run.ts`
  - Inserts point-type seed rows after members and before any dependent event or retention seed data.
- Modify: `scripts/export-seed-sql.ts`
  - Includes `seedPointTypes` in the dev D1 SQL export in dependency order.
- Create: `src/db/seed/data.test.ts`
  - Verifies the three immutable B1 seed identities and Retention flag.
- Modify: `src/server/auth/permissions.ts`
  - Adds the `retention:configure` action and assigns it to the `retention` role.
- Modify: `src/server/auth/permissions.test.ts`
  - Verifies the new permission is granted only through the retention role or super-admin inheritance.
- Do not modify: repositories, contracts, actions, UI, `crs_events.points`, retention aggregation, `drizzle/migrations/meta/_journal.json`, or Drizzle metadata snapshots.

## Task 1: Add and Prove the D1 Additive Migration

**Files:**
- Create: `src/db/additive-points-schema.integration.test.ts`
- Create: `drizzle/migrations/0013_additive_points_schema.sql`

**Interfaces:**
- Consumes: `env.DB` from `cloudflare:test`, migrations loaded by `vitest.config.mts`, existing `members`, `terms`, `crs_events`, and `retention_records` tables.
- Produces: D1 schema objects `point_types`, `event_point_awards`, `retention_records.point_type_id`, and `retention_records_event_member_type_idx` for B2.

- [ ] **Step 1: Write the failing Workers D1 migration test**

Before creating `0013`, record the current pre-B1 commit for Task 4's existing-database verification:

```powershell
New-Item -ItemType Directory -Force -Path .local | Out-Null
git rev-parse HEAD | Set-Content -NoNewline .local\plan-b1-baseline-commit.txt
```

Create `src/db/additive-points-schema.integration.test.ts` using raw D1 statements only. Keep it free of `better-sqlite3` imports.

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

async function resetRows() {
	await env.DB.prepare("DELETE FROM event_point_awards").run();
	await env.DB.prepare("DELETE FROM retention_records").run();
	await env.DB.prepare("DELETE FROM crs_events").run();
	await env.DB.prepare("DELETE FROM terms").run();
	await env.DB.prepare("DELETE FROM point_types").run();
	await env.DB.prepare("DELETE FROM members").run();
}

describe("additive points schema on D1", () => {
	beforeEach(resetRows);

	it("defaults existing-style retention inserts and enforces one event award per point type", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_points", "points@example.com", "Points")
			.run();
		await env.DB.prepare("INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)")
			.bind("term_points", "Points term", 20, 10, 0, 1)
			.run();
		await env.DB.prepare("INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.bind("evt_points", "Points event", "official", "approved", "Room", 0, "Schema test", "mem_points", "secret")
			.run();
		await env.DB.prepare("INSERT INTO point_types (id, key, label, counts_toward_retention, active, position) VALUES (?, ?, ?, ?, ?, ?)")
			.bind("pt_retention", "retention", "Retention", 1, 1, 0)
			.run();
		await env.DB.prepare("INSERT INTO point_types (id, key, label, counts_toward_retention, active, position) VALUES (?, ?, ?, ?, ?, ?)")
			.bind("pt_frontliner", "frontliner", "Frontliner", 0, 1, 1)
			.run();

		await env.DB.prepare("INSERT INTO retention_records (id, member_id, term_id, event_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.bind("ret_default", "mem_points", "term_points", "evt_points", 5, "Legacy-shaped insert", "event_attendance", "mem_points", 0)
			.run();
		const defaulted = await env.DB.prepare("SELECT point_type_id FROM retention_records WHERE id = ?")
			.bind("ret_default")
			.first<{ point_type_id: string }>();
		expect(defaulted?.point_type_id).toBe("pt_retention");

		await expect(
			env.DB.prepare("INSERT INTO retention_records (id, member_id, term_id, event_id, point_type_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
				.bind("ret_duplicate", "mem_points", "term_points", "evt_points", "pt_retention", 5, "Duplicate", "event_attendance", "mem_points", 1)
				.run(),
		).rejects.toThrow(/UNIQUE constraint failed/);

		await env.DB.prepare("INSERT INTO event_point_awards (event_id, point_type_id, points) VALUES (?, ?, ?)")
			.bind("evt_points", "pt_frontliner", 3)
			.run();
		await expect(
			env.DB.prepare("INSERT INTO event_point_awards (event_id, point_type_id, points) VALUES (?, ?, ?)")
				.bind("evt_points", "pt_frontliner", 4)
				.run(),
		).rejects.toThrow(/UNIQUE constraint failed/);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/db/additive-points-schema.integration.test.ts`

Expected: FAIL because `point_types` and `event_point_awards` do not exist and `retention_records` has no `point_type_id`.

- [ ] **Step 3: Add the handwritten migration**

Create `drizzle/migrations/0013_additive_points_schema.sql` with these exact statements. Keep the `retention_records` change as `ALTER TABLE ... ADD COLUMN`, with no foreign key and no rebuild.

```sql
CREATE TABLE `point_types` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL UNIQUE,
	`label` text NOT NULL,
	`counts_toward_retention` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `event_point_awards` (
	`event_id` text NOT NULL,
	`point_type_id` text NOT NULL,
	`points` integer NOT NULL,
	PRIMARY KEY(`event_id`, `point_type_id`),
	FOREIGN KEY (`event_id`) REFERENCES `crs_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`point_type_id`) REFERENCES `point_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `retention_records`
	ADD COLUMN `point_type_id` text NOT NULL DEFAULT 'pt_retention';
--> statement-breakpoint
CREATE UNIQUE INDEX `retention_records_event_member_type_idx`
	ON `retention_records` (`event_id`, `member_id`, `point_type_id`)
	WHERE `source` = 'event_attendance';
```

The partial unique index is deliberately required in B1:

```sql
CREATE UNIQUE INDEX retention_records_event_member_type_idx
	ON retention_records (event_id, member_id, point_type_id)
	WHERE source = 'event_attendance';
```

- [ ] **Step 4: Run the D1 migration test to verify it passes**

Run: `pnpm test -- src/db/additive-points-schema.integration.test.ts`

Expected: PASS. The legacy-shaped insert returns `pt_retention`, and duplicate event-attendance or event-award rows fail with SQLite uniqueness errors.

- [ ] **Step 5: Commit the migration and test**

```bash
git add drizzle/migrations/0013_additive_points_schema.sql src/db/additive-points-schema.integration.test.ts
git commit -m "feat: add additive points migration"
```

## Task 2: Mirror the Schema and Add Baseline Seeds

**Files:**
- Modify: `src/db/schema.ts:1,374-396`
- Modify: `src/db/seed/data.ts:1-25, after seed roles`
- Modify: `src/db/seed/run.ts:1-27,55-83`
- Modify: `scripts/export-seed-sql.ts:1-26,38-61`
- Create: `src/db/seed/data.test.ts`

**Interfaces:**
- Consumes: migration table and column names from Task 1, Drizzle's existing `sql`, `primaryKey`, and `uniqueIndex` imports, and the existing seed insert order.
- Produces: `pointTypes`, `eventPointAwards`, `seedPointTypes`, and seed insertion/export entries that B2 can import without adding another schema migration.

- [ ] **Step 1: Write the failing seed identity test**

Create `src/db/seed/data.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { seedPointTypes } from "./data";

describe("point-type seeds", () => {
	it("provides the three baseline point types with Retention flagged", () => {
		expect(seedPointTypes).toEqual([
			expect.objectContaining({ id: "pt_retention", key: "retention", label: "Retention", countsTowardRetention: true, active: true, position: 0 }),
			expect.objectContaining({ id: "pt_frontliner", key: "frontliner", label: "Frontliner", countsTowardRetention: false, active: true, position: 1 }),
			expect.objectContaining({ id: "pt_project_lead", key: "project_lead", label: "Project Lead", countsTowardRetention: false, active: true, position: 2 }),
		]);
	});
});
```

- [ ] **Step 2: Run the seed test to verify it fails**

Run: `pnpm test -- src/db/seed/data.test.ts`

Expected: FAIL because `seedPointTypes` is not exported.

- [ ] **Step 3: Mirror the migration in Drizzle and define seed rows**

In `src/db/schema.ts`, keep the existing `sql` import and add these exported table declarations before `retentionRecords`. Add `pointTypeId` to `retentionRecords` with no `.references()` call. Add the partial unique index using the literal predicate so Drizzle's schema metadata matches the migration.

```ts
export const pointTypes = sqliteTable(
	"point_types",
	{
		id: text("id").primaryKey(),
		key: text("key").notNull().unique(),
		label: text("label").notNull(),
		countsTowardRetention: integer("counts_toward_retention", { mode: "boolean" }).notNull().default(false),
		active: integer("active", { mode: "boolean" }).notNull().default(true),
		position: integer("position").notNull().default(0),
		updatedBy: text("updated_by").references(() => members.id, { onDelete: "set null" }),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
);

export const eventPointAwards = sqliteTable(
	"event_point_awards",
	{
		eventId: text("event_id").notNull().references(() => crsEvents.id, { onDelete: "cascade" }),
		pointTypeId: text("point_type_id").notNull().references(() => pointTypes.id),
		points: integer("points").notNull(),
	},
	(table) => [primaryKey({ columns: [table.eventId, table.pointTypeId] })],
);
```

Use this retention fragment in the existing `retentionRecords` declaration:

```ts
pointTypeId: text("point_type_id").notNull().default("pt_retention"),
```

Add this schema index alongside the three current retention indexes:

```ts
uniqueIndex("retention_records_event_member_type_idx")
	.on(table.eventId, table.memberId, table.pointTypeId)
	.where(sql`source = 'event_attendance'`),
```

In `src/db/seed/data.ts`, import `pointTypes` and add the following export after `seedRoles`:

```ts
export const seedPointTypes: InferInsertModel<typeof pointTypes>[] = [
	{ id: "pt_retention", key: "retention", label: "Retention", countsTowardRetention: true, active: true, position: 0 },
	{ id: "pt_frontliner", key: "frontliner", label: "Frontliner", countsTowardRetention: false, active: true, position: 1 },
	{ id: "pt_project_lead", key: "project_lead", label: "Project Lead", countsTowardRetention: false, active: true, position: 2 },
];
```

In `src/db/seed/run.ts`, import `seedPointTypes` and add this line after members are inserted and before the first dependent event or retention insert:

```ts
await insertChunks(db, schema.pointTypes, seedPointTypes);
```

In `scripts/export-seed-sql.ts`, import `seedPointTypes` and add this dependency-ordered entry after members:

```ts
entry(schema.pointTypes, "point_types", seedPointTypes),
```

- [ ] **Step 4: Run focused tests to verify the schema and seed declarations**

Run: `pnpm test -- src/db/additive-points-schema.integration.test.ts src/db/seed/data.test.ts`

Expected: PASS. The Workers integration test remains free of `better-sqlite3`, and all three seed identities match exactly.

- [ ] **Step 5: Commit the schema and seed support**

```bash
git add src/db/schema.ts src/db/seed/data.ts src/db/seed/run.ts scripts/export-seed-sql.ts src/db/seed/data.test.ts
git commit -m "feat: add point type schema seeds"
```

## Task 3: Add the Point-Type Configuration Permission

**Files:**
- Modify: `src/server/auth/permissions.ts:25-57`
- Modify: `src/server/auth/permissions.test.ts:4-24`

**Interfaces:**
- Consumes: `permissionActions`, `PermissionAction`, `rolePermissions`, and the retention role already defined in the authorization module.
- Produces: the `"retention:configure"` `PermissionAction`, granted to `roles: ["retention"]` and inherited by super admins through the existing `can()` implementation.

- [ ] **Step 1: Extend the existing permission test case and action list**

In `src/server/auth/permissions.test.ts`, add `"retention:configure"` to the `retention` allowed action list and to `actions`.

```ts
{ role: "retention", allowed: ["points:assign", "retention:record", "retention:configure"] },
```

```ts
"retention:configure",
```

- [ ] **Step 2: Run the permission test to verify it fails**

Run: `pnpm test -- src/server/auth/permissions.test.ts`

Expected: FAIL at TypeScript compilation because `"retention:configure"` is not yet a `PermissionAction`.

- [ ] **Step 3: Add the action and role grant**

In `src/server/auth/permissions.ts`, add the action to `permissionActions` and add it to the existing retention role only.

```ts
export const permissionActions = [
	"event:moderate",
	"event:points",
	"event:create_restricted",
	"points:assign",
	"retention:record",
	"retention:configure",
	// Existing actions remain unchanged.
] as const;
```

```ts
retention: ["points:assign", "retention:record", "retention:configure"],
```

Do not add a route, navigation entry, server action, repository mutator, or UI guard in B1. The existing super-admin inheritance in `can()` covers the super role without a duplicate grant.

- [ ] **Step 4: Run the focused permission test to verify it passes**

Run: `pnpm test -- src/server/auth/permissions.test.ts`

Expected: PASS. A retention actor and a super actor can configure point types; a member cannot.

- [ ] **Step 5: Commit the permission capability**

```bash
git add src/server/auth/permissions.ts src/server/auth/permissions.test.ts
git commit -m "feat: add point type configuration permission"
```

## Task 4: Verify Local Migration States and Run the Full Local Check

**Files:**
- Verify only: the files created or modified in Tasks 1-3.

**Interfaces:**
- Consumes: the migration directory as the source of truth for `src/db/migrate-local-sqlite.ts`, the Worker migration harness from `vitest.config.mts`, and the schema declaration from Task 2.
- Produces: evidence that B1 migrates an empty database, migrates a database at the `0012` baseline while preserving a legacy retention row, and passes local static and build checks.

- [ ] **Step 1: Verify a fresh local database**

Run these PowerShell commands from the repository root. They are local-only and must not target remote D1.

```powershell
Remove-Item -LiteralPath .local\plan-b1-fresh.db -Force -ErrorAction SilentlyContinue
$env:LOCAL_SQLITE_PATH = ".local/plan-b1-fresh.db"
pnpm db:migrate:local:sqlite
pnpm db:seed:local
```

Expected: all migrations through `0013_additive_points_schema.sql` apply and the local seed succeeds with the three point types.

- [ ] **Step 2: Construct a pre-B1 local database and verify additive backfill**

Use the pre-B1 commit recorded in Task 1. This avoids a worktree and proves the `0013` migration against an existing database rather than only a fresh one.

```powershell
Remove-Item -LiteralPath .local\plan-b1-baseline -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path .local\plan-b1-baseline | Out-Null
$baselineCommit = Get-Content .local\plan-b1-baseline-commit.txt
git archive --format=tar $baselineCommit drizzle/migrations src/db/migrate-local-sqlite.ts src/db/migrations-plan.ts | tar -xf - -C .local\plan-b1-baseline
Push-Location .local\plan-b1-baseline
$env:LOCAL_SQLITE_PATH = "../plan-b1-existing.db"
pnpm exec tsx src/db/migrate-local-sqlite.ts
Pop-Location
pnpm exec tsx -e "import Database from 'better-sqlite3'; const db = new Database('.local/plan-b1-existing.db'); db.exec(\"INSERT INTO members (id, email, name) VALUES ('mem_existing', 'existing@example.com', 'Existing'); INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES ('term_existing', 'Existing term', 20, 10, 0, 1); INSERT INTO retention_records (id, member_id, term_id, points, reason, source, recorded_by, recorded_at) VALUES ('ret_existing', 'mem_existing', 'term_existing', 5, 'Existing row', 'manual', 'mem_existing', 0);\"); db.close();"
$env:LOCAL_SQLITE_PATH = ".local/plan-b1-existing.db"
pnpm db:migrate:local:sqlite
pnpm exec tsx -e "import Database from 'better-sqlite3'; const db = new Database('.local/plan-b1-existing.db'); const row = db.prepare(\"SELECT point_type_id FROM retention_records WHERE id = 'ret_existing'\").get(); if (row.point_type_id !== 'pt_retention') throw new Error(JSON.stringify(row)); db.close();"
```

Expected: the preserved legacy retention row reads `point_type_id = 'pt_retention'`. The `ALTER TABLE` is additive and no table rebuild occurs.

- [ ] **Step 3: Run focused and project verification commands**

```bash
pnpm test -- src/db/additive-points-schema.integration.test.ts src/db/seed/data.test.ts src/server/auth/permissions.test.ts
pnpm lint
pnpm typecheck
pnpm build
```

Expected: all commands exit successfully. No UI files change, so the desktop and mobile overflow check is a confirmation that the existing layouts are unaffected.

- [ ] **Step 4: Request human approval for the dev D1 duplicate pre-check**

Do not execute this as an agent. The spec's mandatory query is retained verbatim below, but it cannot run against the current beta database before `0013` because `point_type_id` does not exist yet. Ask the human to approve the legacy-compatible preflight first. Abort the migration on any returned row.

```bash
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT event_id, member_id, 'pt_retention' AS point_type_id, COUNT(*) c FROM retention_records WHERE source = 'event_attendance' GROUP BY 1,2 HAVING c > 1;"
```

This is equivalent before the additive column exists because every existing row will receive the required `DEFAULT 'pt_retention'`. After `0013` has been applied, the canonical duplicate query is:

```bash
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT event_id, member_id, point_type_id, COUNT(*) c FROM retention_records WHERE source = 'event_attendance' GROUP BY 1,2,3 HAVING c > 1;"
```

The duplicate pre-check query is mandatory and must remain exactly:

```sql
SELECT event_id, member_id, point_type_id, COUNT(*) c
	FROM retention_records WHERE source = 'event_attendance'
	GROUP BY 1,2,3 HAVING c > 1;
```

- [ ] **Step 5: Request human approval for migration, seed refresh, and beta Worker deployment**

Do not execute any of these as an agent. Request approval separately for each command, and run the next command only after the preceding command succeeds.

```bash
pnpm exec wrangler d1 migrations apply DB --config wrangler.beta.jsonc --remote
pnpm db:seed:dev:export
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --file .local/dev-seed.sql
pnpm exec wrangler deploy --no-x-autoconfig --config wrangler.beta.jsonc
```

Expected: the dev D1 migration applies only after the duplicate query returns zero rows, the seed export includes the three point types, the reviewed remote seed is idempotent, and beta is redeployed because shared mode depends on the beta Worker.

- [ ] **Step 6: Commit verified B1 work**

```bash
git status --short
git add drizzle/migrations/0013_additive_points_schema.sql src/db/schema.ts src/db/additive-points-schema.integration.test.ts src/db/seed/data.ts src/db/seed/run.ts scripts/export-seed-sql.ts src/db/seed/data.test.ts src/server/auth/permissions.ts src/server/auth/permissions.test.ts
git commit -m "feat: add additive points schema"
```

If Tasks 1-3 were committed separately, skip this final commit rather than creating an empty commit.

## B1 Boundary Check

- B1 creates the partial unique index but does not add an upsert. The unqualified literal `targetWhere: sql\`source = 'event_attendance'\`` and generated SQL assertion belong to B2.
- B1 does not alter `recordScan`, `recordEventAttendance`, `createManual`, `setPoints`, totals, reports, contracts, audit behavior, or any screen.
- B1 does not add point-type administration. The new `retention:configure` permission exists only so B2/B3 can compile and authorize that later work without another permission migration.
- B1 does not reference `point_types` from `retention_records.point_type_id`, preserving the required additive migration and expand-contract compatibility.
- B1 does not modify `drizzle/migrations/meta/_journal.json` or perform any table rebuild.

## Self-Review

- Spec coverage: Task 1 covers both new tables, `retention_records.point_type_id`, default backfill, the partial unique index, and Workers D1 verification. Task 2 covers Drizzle declarations and all three seeds. Task 3 covers `retention:configure`. Task 4 covers fresh and existing local migration verification plus human-gated dev operations.
- Placeholder scan: no unspecified implementation, test, migration, or command steps remain.
- Type consistency: `pointTypes`, `eventPointAwards`, `seedPointTypes`, `pointTypeId`, and `retention:configure` use the same names in every task.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-28-plan-b1-additive-points-schema.md`. Execute it task-by-task with `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
