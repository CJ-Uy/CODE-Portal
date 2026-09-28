# Migration Lineage Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the two incompatible D1 migration histories into one trunk that every environment shares, so promotion is `wrangler d1 migrations apply` with no per-release reconciliation.

**Architecture:** Production's history becomes the trunk; beta's gives way, because production holds live data and cannot be rewritten. One authored migration, `0004_unify_schema.sql`, carries a database from production's `0003` state to what `src/db/schema.ts` describes. It is authored rather than generated because `drizzle-kit generate` emits no DML and nine load-bearing seed and backfill statements would be lost, and because SQLite cannot alter nullability or a foreign key, so table rebuilds are unavoidable and are reviewed rather than accepted unread. Correctness is enforced by a structural comparison of a replayed trunk against a rendered `schema.ts`, plus a preservation check that data survives.

**Revision 3, 2026-08-07.** Revision 2 was reviewed by executing its own gates, and two failed:

- The convergence check compared `sqlite_master` DDL as text. It cannot converge: `ALTER TABLE ADD COLUMN` appends to the end of a table while a from-scratch render uses declaration order, so `crs_events` holds the same 22 columns in a different order. Text reported 8 differing tables that were identical. Task 2 now compares `PRAGMA` output keyed by column name, which reduced the same comparison to 1 real difference.
- The reset script relied on `PRAGMA defer_foreign_keys`, which defers the constraint check but not the cascade action, so 2 of 53 drops failed with `no such table`. `PRAGMA foreign_keys = OFF` fixes it locally but D1 rejects that pragma outright. Tasks 5 and 6 now repeat the drop pass until the database is empty, which converged in two passes.

Both fixes were verified by running them, not by reasoning about them.

**Tech Stack:** Cloudflare D1, Wrangler 4.98, Drizzle ORM 0.45, drizzle-kit 0.31, better-sqlite3 12 (local verification only), Vitest with `@cloudflare/vitest-pool-workers`, TypeScript, tsx.

**Spec:** `docs/superpowers/specs/2026-08-07-migration-lineage-unification-design.md`. Read its ten locked decisions before starting.

## Global Constraints

- Work in `C:\Users\charl\Documents\GitHub\code nest` on the `beta` branch.
- Show the exact `pnpm exec wrangler` command and wait for approval before every remote D1 export, reset, migration, seed or delete. This applies to staging as well as production.
- Do not touch `code-nest-prod-db` in this plan. No production migration, no production mutation.
- Take a `wrangler d1 export` backup immediately before any destructive remote operation. Backup filenames include a UTC timestamp and are never reused, so a retry cannot overwrite the only good copy.
- Every test must pass before any remote database is touched.
- Never write production data into staging or beta.
- Avoid em dashes in code, comments, UI copy, docs, commits and README text.
- Only the literal string `"true"` enables a feature flag; this plan changes no flag value.
- Tests run in the Cloudflare Workers pool, which cannot resolve `node:fs` or load `better-sqlite3`. A module that imports either at top level cannot be imported by a test. Keep pure logic in its own module.
- D1 rejects a `UNION ALL` of many counts with `SQLITE_ERROR 7500`. Use scalar subqueries: `SELECT (SELECT COUNT(*) FROM a) AS a, (SELECT COUNT(*) FROM b) AS b`.
- Run `graphify update .` after source changes.

## Measured starting state, 2026-08-07

Verified against the live databases. The plan depends on these; re-check if a day or more has passed.

| | production | staging |
| --- | --- | --- |
| `announcements`, `point_awards`, `articles`, `comments`, `lists`, `list_items`, `topics`, `team_members`, `favorites`, `consultancy_teams` | 0 rows each | 0 rows each |
| `nav_pins` | not checked | 0 |
| `members` / `audit_logs` / `short_links` / `crs_events` | not checked | 7 / 29 / 1 / 3 |
| `d1_migrations` | `0000`-`0003` | `0000`-`0003` plus `0004_beta_release_bridge` |

## What 0004 must do

Derived by replaying release `0000`-`0003` and beta's full lineage into throwaway databases and diffing. Seventeen shared tables differ; seven of them exist at `0003` and ten do not.

**Exists at `0003`, needs work:**

| Table | Action |
| --- | --- |
| `members` | `DROP COLUMN tour_member_done`, `DROP COLUMN tour_admin_done` |
| `audit_logs` | `ADD COLUMN target_member_id` |
| `crs_events` | `ADD COLUMN` x7: `deleted_at`, `grace_minutes`, `rsvp_form_json`, `rsvp_responses_public`, `all_day`, `read_only`, `public_code` |
| `event_rsvps` | `ADD COLUMN answers_json` |
| `member_feed_state` | `DROP TABLE` (locked decision 4) |
| `announcements` | rebuild: drop and recreate at the `schema.ts` shape, 0 rows so no copy |
| `nav_pins` | **nothing.** Release `0003` already creates it with `created_by` nullable, `ON DELETE set null` and `position` default `0`, which is exactly what `schema.ts` describes after Task 1. A rebuild would change nothing and discard every row, and production's count was never measured |

**Absent at `0003`, create fresh at the `schema.ts` shape:** `quick_links`, `term_member_roster`, `rate_limit_counters`, `point_types`, `retention_records`, `event_staff`, `event_invites`, `event_type_rules`, `event_point_awards`, `link_hourly_stats`, and also `announcement_reads`, `article_feedback`, `contact_submissions`, `library_items`, `library_lists`, `library_list_items`, `library_comments`, `library_favorites`, plus their indexes. Eighteen in total. The last eight were missed when this list was first written and the convergence gate caught them; the release bridge never created them either, so staging lacks them today.

**Drop, all measured empty (locked decision 6):** `articles`, `article_acl`, `article_components`, `article_questions`, `article_refs`, `article_related`, `article_sections`, `article_topics`, `comments`, `consultancy_teams`, `favorites`, `lists`, `list_items`, `point_awards`, `team_members`, `topics`.

**DML that must be preserved:**

| Source | Statement |
| --- | --- |
| `0004_robust_blue_shield.sql` | `INSERT OR IGNORE INTO roles` for `role_publishing` |
| `0010_event_type_rules.sql` | 3x `INSERT INTO event_type_rules` (`casual`, `birthday`, `official`) |
| `0012_event_type_metadata.sql` | 3x `UPDATE event_type_rules` setting `label`, `colour`, `position` |
| `0014_attendance_grace_and_audit_target.sql` | `UPDATE audit_logs SET target_member_id = substr(detail, 8) WHERE ...` |
| `0019_event_multiday_readonly_and_share_codes.sql` | `UPDATE crs_events SET public_code = (...)` random 6-char code |
| `release-migrations/0004_beta_release_bridge.sql:47` | seed `pt_retention` into `point_types` |
| `release-migrations/0004_beta_release_bridge.sql:70` | copy `point_awards` into `retention_records` (no-op at 0 rows, retained so the preservation test asserts it) |

---

### Task 1: Align schema.ts with the trunk

> **DONE 2026-08-07, commit `a49a15a`.** 459 tests, typecheck and eslint clean.

**Files:**
- Delete: `src/components/portal/guided-tour.tsx`, `src/db/repositories/memberFeed.ts`
- Modify: `src/app/portal/actions.ts`, `src/db/repositories/index.ts:10,62,135`, `src/db/schema.ts`

**Interfaces:**
- Produces: `src/db/schema.ts` with no `memberFeedState` export and `navPins` aligned on three properties. Tasks 2 and 3 both target this file's output.
- Removes: `Repositories["memberFeed"]`. `Repositories` is `ReturnType<typeof createDrizzleRepositories>`, so deleting the key from both factories updates the type.

- [x] **Step 1: Confirm the tour is unreferenced**

```bash
grep -rn "GuidedTour\|guided-tour\|markTourSeenAction\|memberFeed\|tourSeenAt\|surveysSeenAt\|eventsSeenAt" src --include=*.ts --include=*.tsx
```

Expected: matches only in `guided-tour.tsx`, `memberFeed.ts`, `src/app/portal/actions.ts`, `src/db/repositories/index.ts`, `src/db/schema.ts`. Any other file means stop and report.

- [x] **Step 2: Delete the dead files**

```bash
git rm src/components/portal/guided-tour.tsx src/db/repositories/memberFeed.ts
```

- [x] **Step 3: Reduce portal actions to the one live action**

Replace the whole of `src/app/portal/actions.ts` with:

```ts
"use server";

import { signOut } from "@/auth";

export async function signOutAction(): Promise<void> {
	await signOut({ redirectTo: "/" });
}
```

- [x] **Step 4: Unwire the repository**

In `src/db/repositories/index.ts` delete these three lines:

```ts
import { createMemberFeedRepository, createUnavailableMemberFeedRepository } from "./memberFeed";
```
```ts
		memberFeed: createMemberFeedRepository(d1),
```
```ts
		memberFeed: createUnavailableMemberFeedRepository(),
```

- [x] **Step 5: Edit schema.ts**

Delete the entire `memberFeedState` export.

Replace the `navPins` `createdBy` field. It currently reads:

```ts
		createdBy: text("created_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
```

It becomes, matching what staging and production already hold:

```ts
		// Nullable with SET NULL so deleting a member clears authorship rather than
		// deleting their pins. Matches the shape already applied to staging and production.
		createdBy: text("created_by").references(() => members.id, { onDelete: "set null" }),
```

And give `position` the default the deployed databases carry:

```ts
		position: integer("position").notNull().default(0),
```

- [x] **Step 6: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: clean typecheck, 459 tests pass. A failure means something still referenced the tour.

- [x] **Step 7: Commit**

```bash
npx eslint src/app/portal/actions.ts src/db/repositories/index.ts src/db/schema.ts
graphify update .
git add -A src graphify-out
git commit -m "refactor(db): retire the unused tour and align nav_pins

GuidedTour was never rendered and markTourSeenAction was never called. No
column of member_feed_state had a reader, so the table goes too, which
removes the tour_seen_at divergence between the lineages rather than
reconciling it.

nav_pins now matches what staging and production already hold on all three
properties: created_by nullable, ON DELETE SET NULL, position default 0.
Deleting a member clears authorship instead of deleting their pins."
```

---

### Task 2: Convergence and preservation tests

> **DONE 2026-08-07.** 468 tests, eslint clean. Calibration reported the expected 5 problems.

These are the gate. Everything after depends on them.

**Compare structure, not DDL text.** Verified empirically on 2026-08-07, and the naive approach fails: `ALTER TABLE ADD COLUMN` appends columns to the end of a table, while a from-scratch render emits them in `schema.ts` declaration order. `crs_events` ends up with the same 22 columns in a completely different order. Comparing `sqlite_master.sql` as text reported 8 differing tables that were in fact identical, so a text-based gate never passes and Task 3 would loop forever. Comparing `PRAGMA` output keyed by column name reduced the same comparison to 1 genuine difference.

SQLite has no boolean type, so hand-written `DEFAULT 0` and a rendered `DEFAULT false` are the same value. Normalise `true` to `1` and `false` to `0`, or four columns report false differences.

**Files:**
- Create: `scripts/schema-compare.ts` (pure, zero imports)
- Create: `scripts/schema-compare.test.ts`
- Create: `scripts/sqlite-schema.ts` (better-sqlite3 and node:fs, never imported by a test)
- Create: `scripts/verify-trunk.ts`

**Interfaces:**
- Produces from `scripts/schema-compare.ts`: `normalizeDefault(value: string | null): string | null` and `compareSnapshots(a: DbSnapshot, b: DbSnapshot): string[]`, returning human-readable problems, empty when converged.
- `DbSnapshot = { tables: Record<string, { cols: Record<string, ColumnSpec>; fks: string[] }>; indexes: Record<string, { table: string; unique: number; cols: string[] }> }` and `ColumnSpec = { type: string; notnull: number; dflt: string | null; pk: number }`.
- Produces from `scripts/sqlite-schema.ts`: `applyMigrations(db, dir)`, `snapshot(db): DbSnapshot`, `openScratch(file)`.
- Consumed by: Task 3.

- [x] **Step 1: Write the failing test**

Create `scripts/schema-compare.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareSnapshots, normalizeDefault, type DbSnapshot } from "./schema-compare";

const col = (over = {}) => ({ type: "text", notnull: 0, dflt: null as string | null, pk: 0, ...over });
const snap = (tables: DbSnapshot["tables"], indexes: DbSnapshot["indexes"] = {}): DbSnapshot => ({ tables, indexes });

describe("normalizeDefault", () => {
	it("treats sqlite boolean keywords as their integer values", () => {
		expect(normalizeDefault("false")).toBe(normalizeDefault("0"));
		expect(normalizeDefault("true")).toBe(normalizeDefault("1"));
	});

	it("strips the parentheses sqlite adds around expressions", () => {
		expect(normalizeDefault("(unixepoch() * 1000)")).toBe(normalizeDefault("unixepoch()*1000"));
	});

	it("keeps different values apart", () => {
		expect(normalizeDefault("'CODE'")).not.toBe(normalizeDefault("'other'"));
		expect(normalizeDefault(null)).toBeNull();
	});
});

describe("compareSnapshots", () => {
	it("ignores column order, which ALTER ADD COLUMN always changes", () => {
		const a = snap({ t: { cols: { x: col(), y: col() }, fks: [] } });
		const b = snap({ t: { cols: { y: col(), x: col() }, fks: [] } });
		expect(compareSnapshots(a, b)).toEqual([]);
	});

	it("reports a column present on only one side", () => {
		const a = snap({ t: { cols: { x: col() }, fks: [] } });
		const b = snap({ t: { cols: { x: col(), y: col() }, fks: [] } });
		expect(compareSnapshots(a, b).join()).toContain("t.y");
	});

	it("reports a nullability difference", () => {
		const a = snap({ t: { cols: { x: col({ notnull: 1 }) }, fks: [] } });
		const b = snap({ t: { cols: { x: col({ notnull: 0 }) }, fks: [] } });
		expect(compareSnapshots(a, b).join()).toContain("t.x");
	});

	it("reports a foreign key action difference", () => {
		const a = snap({ t: { cols: { x: col() }, fks: ["x->m.id del=SET NULL upd=NO ACTION"] } });
		const b = snap({ t: { cols: { x: col() }, fks: ["x->m.id del=CASCADE upd=NO ACTION"] } });
		expect(compareSnapshots(a, b).join()).toContain("t FKs differ");
	});

	it("reports a missing index", () => {
		const a = snap({ t: { cols: { x: col() }, fks: [] } }, {});
		const b = snap({ t: { cols: { x: col() }, fks: [] } }, { i: { table: "t", unique: 1, cols: ["x"] } });
		expect(compareSnapshots(a, b).join()).toContain("i");
	});

	it("reports a table present on only one side", () => {
		const a = snap({ t: { cols: { x: col() }, fks: [] } });
		const b = snap({});
		expect(compareSnapshots(a, b).join()).toContain("t");
	});
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run scripts/schema-compare.test.ts`
Expected: FAIL, cannot resolve `./schema-compare`.

- [x] **Step 3: Implement the pure comparer**

Create `scripts/schema-compare.ts`. It imports nothing, so the Workers pool can load it.

```ts
export type ColumnSpec = { type: string; notnull: number; dflt: string | null; pk: number };
export type DbSnapshot = {
	tables: Record<string, { cols: Record<string, ColumnSpec>; fks: string[] }>;
	indexes: Record<string, { table: string; unique: number; cols: string[] }>;
};

/**
 * sqlite stores a default as the literal text it was declared with, so the same value
 * arrives spelled differently depending on whether the column came from hand-written SQL
 * or a drizzle render. sqlite has no boolean type: true and false are keywords for 1 and
 * 0, and it wraps expression defaults in parentheses.
 */
export function normalizeDefault(value: string | null): string | null {
	if (value === null || value === undefined) return null;
	let v = String(value).replace(/\s+/g, "").replace(/^\((.*)\)$/, "$1").toLowerCase();
	if (v === "true") v = "1";
	if (v === "false") v = "0";
	return v;
}

/**
 * Compares structure rather than DDL text. Column order is deliberately ignored: a column
 * added by ALTER TABLE lands at the end of the table while a from-scratch render places it
 * in declaration order, so one schema has two equally valid texts.
 */
export function compareSnapshots(a: DbSnapshot, b: DbSnapshot): string[] {
	const problems: string[] = [];
	const spec = (c: ColumnSpec) => JSON.stringify({ ...c, dflt: normalizeDefault(c.dflt) });

	for (const table of [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort()) {
		const ta = a.tables[table];
		const tb = b.tables[table];
		if (!ta) {
			problems.push(`table only in B: ${table}`);
			continue;
		}
		if (!tb) {
			problems.push(`table only in A: ${table}`);
			continue;
		}
		for (const name of [...new Set([...Object.keys(ta.cols), ...Object.keys(tb.cols)])].sort()) {
			if (!ta.cols[name]) problems.push(`${table}.${name} only in B`);
			else if (!tb.cols[name]) problems.push(`${table}.${name} only in A`);
			else if (spec(ta.cols[name]) !== spec(tb.cols[name])) {
				problems.push(`${table}.${name} differs: A=${spec(ta.cols[name])} B=${spec(tb.cols[name])}`);
			}
		}
		if (JSON.stringify([...ta.fks].sort()) !== JSON.stringify([...tb.fks].sort())) {
			problems.push(`${table} FKs differ: A=[${[...ta.fks].sort().join(" | ")}] B=[${[...tb.fks].sort().join(" | ")}]`);
		}
	}

	for (const name of [...new Set([...Object.keys(a.indexes), ...Object.keys(b.indexes)])].sort()) {
		const ia = a.indexes[name];
		const ib = b.indexes[name];
		if (!ia) problems.push(`index only in B: ${name}`);
		else if (!ib) problems.push(`index only in A: ${name}`);
		else if (JSON.stringify(ia) !== JSON.stringify(ib)) {
			problems.push(`index ${name} differs: A=${JSON.stringify(ia)} B=${JSON.stringify(ib)}`);
		}
	}

	return problems;
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `pnpm exec vitest run scripts/schema-compare.test.ts`
Expected: PASS, 9 tests. A failure resolving `node:fs` means an import leaked in.

- [x] **Step 5: Implement the sqlite side**

Create `scripts/sqlite-schema.ts`. Run only through `tsx`, never imported by a test.

```ts
import Database from "better-sqlite3";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { DbSnapshot } from "./schema-compare";

type Db = InstanceType<typeof Database>;

export function openScratch(file: string): Db {
	rmSync(file, { force: true });
	return new Database(file);
}

/** Applies every .sql file in order, the same way wrangler d1 migrations apply does. */
export function applyMigrations(db: Db, dir: string): void {
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
		const sql = readFileSync(path.join(dir, file), "utf8");
		for (const statement of sql.split("--> statement-breakpoint")) {
			const trimmed = statement.trim();
			if (!trimmed) continue;
			try {
				db.exec(trimmed);
			} catch (error) {
				throw new Error(`${file}: ${(error as Error).message}`);
			}
		}
	}
}

export function snapshot(db: Db): DbSnapshot {
	const out: DbSnapshot = { tables: {}, indexes: {} };
	const tables = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
		.all() as Array<{ name: string }>;
	for (const { name } of tables) {
		const cols: DbSnapshot["tables"][string]["cols"] = {};
		const info = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
			name: string;
			type: string;
			notnull: number;
			dflt_value: string | null;
			pk: number;
		}>;
		for (const row of info) {
			cols[row.name] = { type: row.type.toLowerCase(), notnull: row.notnull, dflt: row.dflt_value, pk: row.pk > 0 ? 1 : 0 };
		}
		const fkRows = db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{
			from: string;
			table: string;
			to: string;
			on_delete: string;
			on_update: string;
		}>;
		const fks = fkRows.map((f) => `${f.from}->${f.table}.${f.to} del=${f.on_delete} upd=${f.on_update}`).sort();
		out.tables[name] = { cols, fks };
	}
	const indexes = db
		.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
		.all() as Array<{ name: string; tbl_name: string }>;
	for (const { name, tbl_name } of indexes) {
		const listed = (db.prepare(`PRAGMA index_list("${tbl_name}")`).all() as Array<{ name: string; unique: number }>).find(
			(i) => i.name === name,
		);
		const cols = (db.prepare(`PRAGMA index_info("${name}")`).all() as Array<{ name: string }>).map((c) => c.name);
		out.indexes[name] = { table: tbl_name, unique: listed ? listed.unique : 0, cols };
	}
	return out;
}
```

- [x] **Step 6: Implement the trunk verifier**

Create `scripts/verify-trunk.ts`. Side A is the replayed trunk, side B is `schema.ts` rendered from scratch. Neither derives from the other.

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareSnapshots } from "./schema-compare";
import { applyMigrations, openScratch, snapshot } from "./sqlite-schema";

const repo = process.cwd();
const work = mkdtempSync(path.join(tmpdir(), "trunk-"));

const trunkDb = openScratch(path.join(work, "trunk.db"));
applyMigrations(trunkDb, path.join(repo, "drizzle/migrations"));
const trunk = snapshot(trunkDb);
trunkDb.close();

// drizzle-kit writes a from-empty migration when it has no snapshot, which is exactly
// the target schema described by schema.ts.
const renderDir = path.join(work, "render");
const config = `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ schema: "./src/db/schema.ts", out: ${JSON.stringify(renderDir)}, dialect: "sqlite" });\n`;
writeFileSync(path.join(work, "render.config.ts"), config);
execFileSync("pnpm", ["exec", "drizzle-kit", "generate", "--config", path.join(work, "render.config.ts")], {
	cwd: repo,
	stdio: "pipe",
	shell: true,
});
const renderDb = openScratch(path.join(work, "render.db"));
applyMigrations(renderDb, renderDir);
const target = snapshot(renderDb);
renderDb.close();

const problems = compareSnapshots(trunk, target);
rmSync(work, { recursive: true, force: true });

console.log(`trunk tables: ${Object.keys(trunk.tables).length}, target tables: ${Object.keys(target.tables).length}`);
if (problems.length === 0) {
	console.log("CONVERGED: the trunk and schema.ts describe the same database.");
	process.exit(0);
}
console.error(`NOT CONVERGED (${problems.length})`);
for (const problem of problems) console.error("  " + problem);
process.exit(1);
```

- [x] **Step 7: Confirm the suite still passes**

Run: `pnpm test`
Expected: 468 tests pass, the 459 from Task 1 plus 9 here. `vitest.config.mts:43` already includes `scripts/**/*.test.ts`.

- [x] **Step 8: Calibrate the comparer against the current lineage**

Before trusting the comparer on the trunk, point it at the current `drizzle/migrations` and check that it reports exactly the differences we already know about. Side A is the migrations, which Task 1 deliberately did not touch. Side B is `schema.ts`, which Task 1 did change. So the expected output is Task 1's delta plus one pre-existing defect.

Run: `pnpm exec tsx scripts/verify-trunk.ts`

Expected: `NOT CONVERGED (5)`, listing exactly these and nothing else.

| Problem | Why it is expected |
| --- | --- |
| `table only in A: member_feed_state` | Task 1 removed it from `schema.ts`; the migrations still create it |
| `nav_pins.created_by differs` (notnull 1 vs 0) | Task 1 made it nullable |
| `nav_pins.position differs` (dflt null vs 0) | Task 1 added the default |
| `nav_pins FKs differ` (CASCADE vs SET NULL) | Task 1 changed the action |
| `index only in B: point_types_key_unique` | Pre-existing. `schema.ts` declares a unique index on `point_types.key` that beta's lineage never created, so beta currently permits duplicate keys |

This is the calibration: the comparer sees the four changes Task 1 made, plus the one real defect, and invents nothing. All five disappear in Task 3, four because the trunk adopts the `schema.ts` shape and the fifth because `0004` creates `point_types` fresh with its unique index.

A different set is a stop. Extra problems mean the comparer is too strict and will block Task 3 for benign reasons. Fewer mean it is too loose. Either way, fix it before continuing, because Task 3 depends entirely on this being trustworthy.

- [x] **Step 9: Commit**

```bash
git add scripts/schema-compare.ts scripts/schema-compare.test.ts scripts/sqlite-schema.ts scripts/verify-trunk.ts
git commit -m "test(db): add a structural trunk convergence check

Nothing compared the migrations to schema.ts, which is how the bridge
drifted until staging lacked a column schema.ts declared.

The check compares PRAGMA output keyed by column name, not sqlite_master
text. Text cannot work here: ALTER TABLE ADD COLUMN appends to the end of
a table while a from-scratch render uses declaration order, so crs_events
holds the same 22 columns in a different order. Text reported 8 differing
tables that were identical; structure reports 1 real difference, a unique
index on point_types.key that beta never created.

sqlite has no boolean type, so DEFAULT 0 and DEFAULT false normalise to
the same value."
```

---

### Task 3: Author 0004_unify_schema.sql and assemble the trunk

> **DONE 2026-08-07, commits `4282520` and `e9dd3ee`.** PRESERVATION OK, CONVERGED, 468 tests. 18 drops, 2 drop-columns, 0 deletes.

**Files:**
- Delete: `drizzle/migrations/0001_v5_drop_deferred.sql` through `0019_*.sql`, and `drizzle/migrations/meta/`
- Create: `drizzle/migrations/0001_member_portal_links.sql`, `0002_link_workspace_fields.sql`, `0003_admin_members_nav.sql` (copied from `drizzle/release-migrations`)
- Create: `drizzle/migrations/0004_unify_schema.sql`
- Create: `scripts/verify-preservation.ts`
- Replace: `drizzle/migrations/0000_young_bullseye.sql` with the release copy

**Interfaces:**
- Consumes: Task 1's `schema.ts`, Task 2's verifier.
- Produces: `drizzle/migrations` as the single trunk.

- [x] **Step 1: Confirm the two 0000 files are SQL-equivalent**

They differ in bytes because of line endings: 20,684 versus 21,165. Compare content, not bytes.

```bash
git diff --no-index --ignore-cr-at-eol --stat drizzle/migrations/0000_young_bullseye.sql drizzle/release-migrations/0000_young_bullseye.sql
```

Expected: no output, meaning no content difference. Any reported change means stop; the lineages do not share an origin.

- [x] **Step 2: Replace beta's history with production's**

The release copy becomes canonical so the trunk matches what production actually applied.

```bash
git rm -r drizzle/migrations/meta
git rm drizzle/migrations/000[1-9]_*.sql drizzle/migrations/001[0-9]_*.sql
cp drizzle/release-migrations/0000_young_bullseye.sql drizzle/migrations/
cp drizzle/release-migrations/0001_member_portal_links.sql drizzle/migrations/
cp drizzle/release-migrations/0002_link_workspace_fields.sql drizzle/migrations/
cp drizzle/release-migrations/0003_admin_members_nav.sql drizzle/migrations/
ls drizzle/migrations/
```

Expected: exactly four `.sql` files, no `meta/`. `0004_beta_release_bridge.sql` is deliberately not copied; it is the drifted artefact being replaced.

- [x] **Step 3: Render the target schema for reference**

Do not use this as the migration. It is a from-empty render used to copy exact DDL for the tables `0004` creates.

```bash
mkdir -p .local/render
cat > .local/drizzle.render.config.ts <<'CONFIG'
import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./src/db/schema.ts", out: "./.local/render", dialect: "sqlite" });
CONFIG
pnpm exec drizzle-kit generate --config .local/drizzle.render.config.ts
```

Expected: one file in `.local/render` containing roughly 44 `CREATE TABLE` statements. Use it as the source of truth for column types, defaults and index definitions when writing `0004`.

- [x] **Step 4: Author 0004_unify_schema.sql**

Create `drizzle/migrations/0004_unify_schema.sql`. Statements are separated by `--> statement-breakpoint`, matching the rest of the directory. Structure it in this order, because the drops must follow the copy that reads from `point_awards`:

1. **Column additions** to tables that already exist:
   - `ALTER TABLE audit_logs ADD COLUMN target_member_id text REFERENCES members(id) ON DELETE set null;`
   - `ALTER TABLE crs_events ADD COLUMN` for each of `deleted_at`, `grace_minutes`, `rsvp_form_json`, `rsvp_responses_public`, `all_day`, `read_only`, `public_code`, copying exact types and defaults from `.local/render`
   - `ALTER TABLE event_rsvps ADD COLUMN answers_json text DEFAULT '{}' NOT NULL;`
2. **New tables** at the rendered shape, with their indexes: `point_types`, `event_type_rules`, `event_staff`, `event_invites`, `event_point_awards`, `retention_records`, `term_member_roster`, `quick_links`, `rate_limit_counters`, `link_hourly_stats`
3. **Preserved DML**, copied verbatim from the sources in the table above: seed `role_publishing`; insert three `event_type_rules` rows then the three `UPDATE`s that set `label`, `colour` and `position`; seed `pt_retention` into `point_types`; the `audit_logs.target_member_id` backfill from `0014`; the `crs_events.public_code` backfill from `0019`
4. **Copy** `point_awards` into `retention_records`, verbatim from `release-migrations/0004_beta_release_bridge.sql:70`. A no-op at zero rows, retained so the preservation test can assert on it
5. **Rebuilds**, both measured empty so no data copy is needed:
   - `DROP TABLE IF EXISTS announcements;` then `CREATE TABLE announcements (...)` at the rendered shape, plus `announcements_pinned_idx`
   - `DROP TABLE IF EXISTS nav_pins;` then `CREATE TABLE nav_pins (...)` with `created_by` nullable, `ON DELETE set null`, `position` default `0`, plus its index
6. **Column removals**: `ALTER TABLE members DROP COLUMN tour_member_done;` and `ALTER TABLE members DROP COLUMN tour_admin_done;`
7. **Drops**, each `DROP TABLE IF EXISTS`: `member_feed_state`, then `article_acl`, `article_components`, `article_questions`, `article_refs`, `article_related`, `article_sections`, `article_topics`, `articles`, `comments`, `consultancy_teams`, `favorites`, `list_items`, `lists`, `point_awards`, `team_members`, `topics`

Open the file with a header comment naming the spec, so the next reader knows why it is authored rather than generated.

- [x] **Step 5: Write the preservation check**

Create `scripts/verify-preservation.ts`. It builds `0000`-`0003`, inserts legacy fixtures, applies `0004`, and asserts. Synthetic rows only.

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMigrations, openScratch } from "./sqlite-schema";
import { readdirSync, readFileSync } from "node:fs";

const repo = process.cwd();
const work = mkdtempSync(path.join(tmpdir(), "preserve-"));
const db = openScratch(path.join(work, "p.db"));
const dir = path.join(repo, "drizzle/migrations");

function applyOne(file: string) {
	for (const statement of readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
		const trimmed = statement.trim();
		if (trimmed) db.exec(trimmed);
	}
}

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const file of files.filter((f) => f < "0004")) applyOne(file);

// Legacy fixtures: a member, an event, and an audit row shaped like the ones
// 0014 backfills from.
db.exec(`INSERT INTO members (id, email) VALUES ('mem_fix1', 'fixture@example.com')`);
db.exec(
	`INSERT INTO crs_events (id, title, type, place, starts_at, description, created_by)
	 VALUES ('evt_fix1', 'Fixture', 'casual', 'Room', 1000, 'd', 'mem_fix1')`,
);
db.exec(
	`INSERT INTO audit_logs (id, action, target_type, target_id, category, detail)
	 VALUES ('aud_fix1', 'event:scan_attendance', 'event', 'evt_fix1', 'event', 'member=mem_fix1')`,
);

const legacyCounts = ["announcements", "nav_pins", "point_awards"].map((t) => ({
	table: t,
	count: (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c,
}));

applyOne("0004_unify_schema.sql");

const failures: string[] = [];
function check(label: string, actual: unknown, expected: unknown) {
	if (actual !== expected) failures.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}
const one = (sql: string) => (db.prepare(sql).get() as { v: unknown }).v;

// Tables emptied by 0004 must have been empty first, or rows were discarded.
for (const row of legacyCounts) check(`${row.table} was empty before drop`, row.count, 0);

check("event_type_rules seeded", one("SELECT COUNT(*) AS v FROM event_type_rules"), 3);
check("official label set", one("SELECT label AS v FROM event_type_rules WHERE type='official'"), "Official");
check("casual colour set", one("SELECT colour AS v FROM event_type_rules WHERE type='casual'"), "emerald");
check("pt_retention seeded", one("SELECT COUNT(*) AS v FROM point_types WHERE id='pt_retention'"), 1);
check("publishing role seeded", one("SELECT COUNT(*) AS v FROM roles WHERE id='role_publishing'"), 1);
check("audit target backfilled", one("SELECT target_member_id AS v FROM audit_logs WHERE id='aud_fix1'"), "mem_fix1");
check("fixture member survived", one("SELECT COUNT(*) AS v FROM members WHERE id='mem_fix1'"), 1);
check("fixture event survived", one("SELECT COUNT(*) AS v FROM crs_events WHERE id='evt_fix1'"), 1);
if (one("SELECT public_code AS v FROM crs_events WHERE id='evt_fix1'") === null) {
	failures.push("public_code backfill: expected a code, got null");
}
check("member_feed_state gone", one("SELECT COUNT(*) AS v FROM sqlite_master WHERE type='table' AND name='member_feed_state'"), 0);
check("articles gone", one("SELECT COUNT(*) AS v FROM sqlite_master WHERE type='table' AND name='articles'"), 0);

db.close();
rmSync(work, { recursive: true, force: true });

if (failures.length > 0) {
	console.error("PRESERVATION FAILED");
	for (const failure of failures) console.error("  " + failure);
	process.exit(1);
}
console.log("PRESERVATION OK");
```

- [x] **Step 6: Run both checks**

```bash
pnpm exec tsx scripts/verify-preservation.ts
pnpm exec tsx scripts/verify-trunk.ts
```

Expected: `PRESERVATION OK`, then `CONVERGED`. Iterate on `0004_unify_schema.sql` until both pass. `NOT CONVERGED` prints exactly which objects differ.

- [x] **Step 7: Enforce the destructive-statement allowlist**

Every destructive statement in `0004` must be one you intended. A grep for table names is not enough; check the shape of every destructive statement.

```bash
grep -inE "drop table|drop column|^[[:space:]]*delete" drizzle/migrations/0004_unify_schema.sql
```

Expected exactly **18** `DROP TABLE IF EXISTS`, **2** `DROP COLUMN`, and **zero** `DELETE`:

| Statement | Count | Which |
| --- | --- | --- |
| `DROP TABLE IF EXISTS` | 1 | rebuild: `announcements` |
| `DROP TABLE IF EXISTS` | 1 | `member_feed_state` |
| `DROP TABLE IF EXISTS` | 16 | `article_acl`, `article_components`, `article_questions`, `article_refs`, `article_related`, `article_sections`, `article_topics`, `articles`, `comments`, `consultancy_teams`, `favorites`, `list_items`, `lists`, `point_awards`, `team_members`, `topics` |
| `DROP COLUMN` | 2 | `members.tour_member_done`, `members.tour_admin_done` |
| `DELETE` | 0 | none |

Any count that does not match, any drop of a table not named here, or any bare `DROP TABLE` without `IF EXISTS` is a stop. Confirm each drop against the table above by name; a count alone would pass a migration that dropped the wrong table.

- [x] **Step 8: Run the suite and clean up**

```bash
pnpm test
rm -rf .local/render .local/drizzle.render.config.ts
```

Expected: 467 tests pass.

- [x] **Step 9: Commit**

```bash
git add -A drizzle/migrations scripts/verify-preservation.ts
git commit -m "refactor(db): rebuild drizzle/migrations as a single trunk

Beta's 0001 to 0019 are replaced by production's 0001 to 0003 plus one
authored 0004. Production holds live data and its history cannot be
rewritten, so beta's gives way.

0004 is authored rather than generated because drizzle-kit emits no DML
and would have dropped nine load-bearing seed and backfill statements,
and because SQLite cannot alter nullability or a foreign key, so the
announcements and nav_pins rebuilds happen either way and are better
reviewed than accepted unread. Both were measured empty, so neither
rebuild copies rows.

Convergence and preservation both pass."
```

---

### Task 4: Restore a usable drizzle-kit baseline

> **DONE 2026-08-07, commit `a904e45`.** `pnpm db:generate` is now a no-op, CONVERGED, 468 tests.

`meta/_journal.json` has been stale since `0008` while SQL ran to `0019`, so `pnpm db:generate` has been unsafe in this repo for some time. The trunk is the moment to fix it.

**Files:**
- Create: `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/meta/0004_snapshot.json`

**Interfaces:**
- Produces: a snapshot describing the post-`0004` schema, so a later `db:generate` emits a correct `0005`.

- [x] **Step 1: Produce a snapshot of the current schema**

The render from Task 3 Step 3 writes a `meta/` describing exactly the post-`0004` schema, because `0004` converges to `schema.ts`.

```bash
mkdir -p .local/render
cat > .local/drizzle.render.config.ts <<'CONFIG'
import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./src/db/schema.ts", out: "./.local/render", dialect: "sqlite" });
CONFIG
pnpm exec drizzle-kit generate --config .local/drizzle.render.config.ts
ls .local/render/meta/
```

- [x] **Step 2: Install it as the trunk's baseline at index 4**

```bash
mkdir -p drizzle/migrations/meta
cp .local/render/meta/0000_snapshot.json drizzle/migrations/meta/0004_snapshot.json
node -e "
const fs=require('fs');
const src=JSON.parse(fs.readFileSync('.local/render/meta/_journal.json','utf8'));
const entry=src.entries[0];
fs.writeFileSync('drizzle/migrations/meta/_journal.json', JSON.stringify({
  version: src.version,
  dialect: src.dialect,
  entries: [{ idx: 4, version: entry.version, when: entry.when, tag: '0004_unify_schema', breakpoints: true }]
}, null, 2) + '\n');
console.log('journal written at idx 4');
"
```

- [x] **Step 3: Verify a subsequent generate is a no-op**

```bash
pnpm db:generate
```

Expected: drizzle-kit reports no schema changes and writes no new file. If it writes one, inspect the diff, delete the file, and correct the snapshot before continuing. Do not proceed with a generator that thinks the schema has drifted.

- [x] **Step 4: Confirm nothing else broke**

```bash
pnpm exec tsx scripts/verify-trunk.ts
pnpm test
rm -rf .local/render .local/drizzle.render.config.ts
```

Expected: `CONVERGED`, 467 tests pass.

- [x] **Step 5: Commit**

```bash
git add drizzle/migrations/meta
git commit -m "fix(db): restore a truthful drizzle-kit baseline

The journal had been stale since 0008 while the SQL ran to 0019, so
db:generate would have emitted eleven migrations' worth of changes as one
file. The trunk gets a single snapshot describing the post-0004 schema at
journal index 4, and a following db:generate is now a no-op."
```

---

---

## Execution status, 2026-08-07

Tasks 1 to 4 complete and committed. Task 5 is complete through the rehearsal; only the deploy and browser pass remain.

**Staging now sits at `0000` to `0004_unify_schema.sql` with nothing pending.** It was reset to production's exact `0003` state and then received the single `0004`, which is precisely the operation production will get. Verified after: `event_type_rules` seeded with 3 rows and the `official` label applied, `pt_retention` present, `role_publishing` present, the legacy tables gone, `library_items` created. The preserved DML survived, which was the single largest risk.

All three wrangler configs now point at `drizzle/migrations`.

**Production remains untouched** and sits at `0003`. It will offer exactly one pending migration, `0004_unify_schema.sql`, the identical file just rehearsed.

### Corrections learned by executing tasks 5

Four things in this plan were wrong and are fixed above. Each was found by running a step, not by reading it.

1. **The backup validator condemned a good backup.** A D1 export opens with `PRAGMA defer_foreign_keys=TRUE`, which only applies inside a transaction, and interleaves `CREATE TABLE` with that table's inserts. better-sqlite3 enables foreign keys by default, so an insert whose FK target does not exist yet fails. The validator must set `foreign_keys = OFF`.

2. **The reset must not drop `_cf_KV`.** It is a Cloudflare-internal D1 table and `NOT LIKE 'sqlite_%'` does not exclude it.

3. **A reset cannot be done as one file.** `wrangler d1 execute --file` is atomic, so a failed batch rolls back entirely and repeating it fails identically forever. Worse, no drop order exists: inside a transaction SQLite still resolves the foreign keys of already-dropped tables, and the cascade walks transitively, so dropping `members` fails on `consultancy_teams` two hops away. Emptying every table first does not help either, because the failure is schema resolution, not rows. **Drop one table per `--command` invocation so each is its own transaction, and repeat until none remain.** That converged in two passes plus one straggler.

4. **The config repoint belongs here, not in task 7.** Task 5 cannot apply the trunk's `0004` while `wrangler.staging.jsonc` still resolves to `drizzle/release-migrations`, which offers the old bridge instead. Done in commit `2a4512d`.

Also worth knowing: `migrations_dir` resolves relative to the **config file's own directory**, so a temporary config in `.local/` needs `"migrations_dir": "prefix"`, not `".local/prefix"`.

**Resume at Task 6**, the beta rebuild. Task 7 is now partly done; only deleting `drizzle/release-migrations` and writing the README remain.

---

### Task 5: Rehearse on staging

> **DONE 2026-08-07.** Staging was reset, replayed to production's `0003`, and `0004_unify_schema.sql` applied as a single step: 84 commands, nothing pending afterwards. Verified on the live database: `event_type_rules` 3 rows with `official` labelled "Official", `pt_retention` seeded, `role_publishing` seeded, the legacy tables gone, `library_items` present. The preserved DML survived, which was the single largest risk in the whole plan. Deployed as version `a54464fc`. Backup at `.local/staged-backup-2026-08-07T0652Z.sql`, validated before the reset.
>
> **Step 8's signed-in browser pass is still outstanding** and needs a human; it cannot be done from here.
>
> Four plan errors were found by executing these steps rather than reading them, all fixed in commits `5972408`, `16ca7bc`, `2a4512d` and `18179b6`. The largest: a reset cannot be one atomic file, because D1 rolls the whole file back on any failure and no drop order exists that avoids a failure. SQLite resolves a dropped table's foreign keys transitively while still inside the transaction, so dropping a parent walks into children that are already gone. Each drop needs its own transaction. It took two passes plus one straggler.


Staging carries the hand-written bridge, so it is neither at production's state nor at the trunk's. It is reset rather than patched, because mirroring production is the only thing that makes the rehearsal meaningful.

**Files:** none tracked. Working files under `.local/`, which is gitignored.

**Interfaces:**
- Consumes: the trunk from Tasks 3 and 4.
- Produces: `code-nest-staged-db` at `0000` through `0004`.

- [x] **Step 1: Back up staging, with approval**

Show and wait for approval. The timestamp makes the name unique so a retry cannot overwrite it.

```bash
pnpm exec wrangler d1 export DB --config wrangler.staging.jsonc --remote --output .local/staged-backup-2026-08-07T1100Z.sql
```

- [x] **Step 2: Prove the backup is restorable before destroying anything**

A backup you have not read is a hope, not a backup.

The validator must disable foreign keys first. A D1 export opens with `PRAGMA defer_foreign_keys=TRUE`, which only takes effect inside a transaction, and the dump interleaves `CREATE TABLE` with the `INSERT`s for that table. better-sqlite3 enables foreign keys by default, so an insert whose FK target has not been created yet fails with `no such table`. Verified 2026-08-07: without the pragma a perfectly good backup is condemned.

```bash
node -e "
const Database=require('better-sqlite3');
const fs=require('fs');
const db=new Database(':memory:');
db.pragma('foreign_keys = OFF');
db.exec(fs.readFileSync(process.env.BACKUP,'utf8'));
const one=(s)=>db.prepare(s).get().c;
console.log('tables        =', one(\"SELECT COUNT(*) c FROM sqlite_master WHERE type='table'\"));
console.log('members       =', one('SELECT COUNT(*) c FROM members'));
console.log('short_links   =', one('SELECT COUNT(*) c FROM short_links'));
console.log('d1_migrations =', one('SELECT COUNT(*) c FROM d1_migrations'));
"
```

Set `BACKUP` to the file written in Step 1. Expected: a plausible table count and row counts matching what the environment held before the export. A throw means stop; there is no usable backup and nothing destructive may proceed.

- [x] **Step 3: Build the reset script**

`DROP TABLE` with foreign keys enforced performs an implicit `DELETE FROM` that cascades. If a table dropped earlier in the batch is the parent of one still present, the cascade resolves into a table that no longer exists and the statement fails with `no such table`. Verified locally on 2026-08-07: 2 of 53 drops failed this way.

`PRAGMA defer_foreign_keys = true` does not help, because it defers the constraint *check*, not the cascade *action*. `PRAGMA foreign_keys = OFF` does fix it locally but **D1 rejects that pragma** with `not authorized to access this service [code: 7403]`, also verified.

The fix is to repeat the pass. Each pass drops every table whose dependents are already gone, so the set shrinks until empty. Locally this converged in two passes, 51 tables then 2. Treat two or three passes as normal, not as a fault.

```bash
pnpm exec wrangler d1 execute DB --config wrangler.staging.jsonc --remote --json --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'" > .local/staged-tables.json
node -e "
const r=require('./.local/staged-tables.json');
const all=r[0].results.map(x=>x.name);
const names=all.filter(n=>!n.startsWith('_cf_'));  // _cf_KV is a D1 internal, never drop it
require('fs').writeFileSync('.local/reset-staged.sql','PRAGMA defer_foreign_keys = true;\n'+names.map(n=>'DROP TABLE IF EXISTS \"'+n+'\";').join('\n')+'\n');
console.log('tables to drop:',names.length);
console.log('includes d1_migrations:',names.includes('d1_migrations'));
"
cat .local/reset-staged.sql
```

Expected: `includes d1_migrations: true`. If false, the replay in Step 5 skips every migration; stop and fix.

`_cf_KV` is a Cloudflare-internal D1 table and must be excluded. The obvious `NOT LIKE 'sqlite_%'` filter does not catch it, and staging's table list contained it on 2026-08-07. Dropping a D1 internal is not something to find out about the hard way, so the generator filters any name beginning with `_cf_`.


- [x] **Step 4: Apply the reset, with approval, until the database is empty**

Show and wait for approval. This destroys every table in `code-nest-staged-db`.

```bash
pnpm exec wrangler d1 execute DB --config wrangler.staging.jsonc --remote --file .local/reset-staged.sql
```

Some drops are expected to fail on the first pass. Now count what survived:

```bash
pnpm exec wrangler d1 execute DB --config wrangler.staging.jsonc --remote --command "SELECT COUNT(*) AS remaining FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
```

If `remaining` is greater than zero, repeat Step 3 to regenerate the script from the surviving tables, then apply it again with approval. Repeat until `remaining` is zero. Stop and report if it has not reached zero after four passes, since that means something other than cascade ordering is holding a table open.

- [x] **Step 5: Replay to production's state**

Production sits at `0003`. Use a temporary directory holding only `0000`-`0003` rather than moving files out of the tracked trunk, so an interruption cannot leave the repository missing `0004`.

```bash
mkdir -p .local/prefix
cp drizzle/migrations/000[0-3]_*.sql .local/prefix/
node -e "
const fs=require('fs');
const c=JSON.parse(fs.readFileSync('wrangler.staging.jsonc','utf8').replace(/^\s*\/\/.*$/gm,''));
c.d1_databases[0].migrations_dir='.local/prefix';
fs.writeFileSync('.local/wrangler.prefix.jsonc', JSON.stringify(c,null,2));
console.log('prefix config written');
"
```

Show and wait for approval:

```bash
pnpm exec wrangler d1 migrations apply DB --config .local/wrangler.prefix.jsonc --remote
```

Expected: four migrations applied. Staging now matches production exactly.

- [x] **Step 6: Rehearse the real step**

```bash
pnpm exec wrangler d1 migrations list DB --config wrangler.staging.jsonc --remote
```

Expected: exactly one pending migration, `0004_unify_schema.sql`. This is the same one-step state production will be in.

Show and wait for approval:

```bash
pnpm exec wrangler d1 migrations apply DB --config wrangler.staging.jsonc --remote
```

- [x] **Step 7: Verify staging**

```bash
pnpm exec wrangler d1 migrations list DB --config wrangler.staging.jsonc --remote
pnpm exec wrangler d1 execute DB --config wrangler.staging.jsonc --remote --command "SELECT (SELECT COUNT(*) FROM event_type_rules) AS event_type_rules, (SELECT COUNT(*) FROM point_types) AS point_types, (SELECT COUNT(*) FROM crs_events WHERE public_code IS NOT NULL) AS events_with_code, (SELECT COUNT(*) FROM members) AS members"
pnpm exec wrangler d1 execute DB --config wrangler.staging.jsonc --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('member_feed_state','articles','point_awards')"
```

Expected: nothing pending; `event_type_rules` 3; `point_types` at least 1; `events_with_code` 3, matching the three events measured before; `members` 7; and the third query returns no rows.

- [x] **Step 8: Deploy and check the running site**

```bash
pnpm deploy:staged
```

Sign in at `https://staged.ateneocode.org/portal` and load dashboard, calendar, one event detail page, links and profile. Confirm no schema errors. Record which pages were checked.

- [x] **Step 9: Record the rehearsal**

```bash
rm -rf .local/prefix .local/wrangler.prefix.jsonc
git commit --allow-empty -m "chore(db): rehearse the unified trunk on staging

Staging was reset to production's exact state, 0000 through 0003, then
0004_unify_schema.sql was applied as a single step. That is precisely the
operation production will receive. Backup at
.local/staged-backup-2026-08-07T1100Z.sql, validated before the reset."
```

---

### Task 6: Rebuild beta on the trunk

> **DONE 2026-08-07.** Backed up to `.local/beta-backup-2026-08-07T1405Z.sql` (validated: 46 tables, 10 members, 20 migration records), wiped in two passes, replayed `0000` to `0004` (84 commands), seeded via `db:seed:dev:export` plus an explicit `wrangler execute` (117 rows across 44 tables). Nothing pending. Deployed as version `7f87a01c`. Beta now holds 3 members, 3 event types, 3 point types, 3 library items, 8 roles, 1 short link.
>
> **Step 7's signed-in browser pass is still outstanding** and needs a human.


**Interfaces:**
- Consumes: the trunk.
- Produces: `code-nest-beta-db` at `0000` through `0004`, seeded.

- [x] **Step 1: Back up beta, with approval**

```bash
pnpm exec wrangler d1 export DB --config wrangler.beta.jsonc --remote --output .local/beta-backup-2026-08-07T1100Z.sql
```

- [x] **Step 2: Validate that backup**

Same check as Task 5 Step 2, against the beta file.

- [x] **Step 3: Build and apply the reset, with approval, until empty**

Same repeated-pass procedure as Task 5 Step 3 and 4, and for the same reason: a cascade into an already-dropped parent fails, `defer_foreign_keys` does not prevent it, and D1 rejects `PRAGMA foreign_keys = OFF`.

```bash
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --json --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'" > .local/beta-tables.json
node -e "
const r=require('./.local/beta-tables.json');
const all=r[0].results.map(x=>x.name);
const names=all.filter(n=>!n.startsWith('_cf_'));  // _cf_KV is a D1 internal, never drop it
require('fs').writeFileSync('.local/reset-beta.sql','PRAGMA defer_foreign_keys = true;
'+names.map(n=>'DROP TABLE IF EXISTS \"'+n+'\";').join('
')+'
');
console.log('tables to drop:',names.length,'includes d1_migrations:',names.includes('d1_migrations'));
"
```

Show and wait for approval:

```bash
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --file .local/reset-beta.sql
```

Then count survivors and repeat until zero:

```bash
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT COUNT(*) AS remaining FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
```

- [x] **Step 4: Replay the full trunk, with approval**

```bash
pnpm exec wrangler d1 migrations apply DB --config wrangler.beta.jsonc --remote
```

Expected: five migrations applied, `0000` through `0004`.

- [x] **Step 5: Seed beta**

`pnpm db:seed:dev` does not seed. It prints instructions and exits zero, and the command it prints uses `--env dev`, which is not an environment in this setup and would fall back to the default config, which binds production. Use the export path instead.

```bash
pnpm db:seed:dev:export
ls -la .local/dev-seed.sql
```

Show and wait for approval:

```bash
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --file .local/dev-seed.sql
```

- [x] **Step 6: Verify beta is populated**

```bash
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM event_type_rules) AS event_type_rules, (SELECT COUNT(*) FROM point_types) AS point_types, (SELECT COUNT(*) FROM short_links) AS short_links"
```

Expected: nothing pending, and non-zero counts. A zero `members` count means the seed did not apply; stop.

- [x] **Step 7: Deploy and check**

```bash
pnpm deploy:dev
```

Sign in at `https://beta.ateneocode.org/portal` and load dashboard, calendar, an event, links, profile, library and announcements. Beta has every flag on, so this exercises more of the schema than staging. Record which pages were checked.

- [x] **Step 8: Reset local development**

```bash
rm -f .local/dev.db
pnpm db:migrate:local:sqlite
pnpm db:seed:local
```

- [x] **Step 9: Record it**

```bash
git commit --allow-empty -m "chore(db): rebuild beta on the unified trunk

code-nest-beta-db was wiped, replayed from 0000 through 0004, and seeded
through db:seed:dev:export plus an explicit wrangler execute, because
db:seed:dev only prints instructions and would have left beta empty.
All three environments now share one migration history."
```

---

### Task 7: Retire the second directory

> **DONE 2026-08-07, commit `1fc7830`.** `drizzle/release-migrations` deleted, all three configs on `drizzle/migrations`, README written, the 2026-08-05 plan marked superseded in part. Verified after removal: typecheck clean, CONVERGED, PRESERVATION OK, 468 tests, and the local dev database rebuilds and seeds from the trunk.


**Files:**
- Delete: `drizzle/release-migrations/`
- Modify: `wrangler.staging.jsonc`, `wrangler.jsonc`, `docs/superpowers/plans/2026-08-05-beta-to-staging-release.md`
- Create: `drizzle/migrations/README.md`

- [x] **Step 1: Point staging and production at the trunk**

Set `"migrations_dir": "drizzle/migrations"` in both `wrangler.staging.jsonc` and `wrangler.jsonc`, and delete the comments describing the two-lineage split, which no longer exists.

```bash
grep -n "migrations_dir" wrangler.jsonc wrangler.staging.jsonc wrangler.beta.jsonc
```

Expected: three lines, all `drizzle/migrations`.

- [x] **Step 2: Delete the second directory**

```bash
git rm -r drizzle/release-migrations
```

- [x] **Step 3: Document the trunk**

Create `drizzle/migrations/README.md`:

```markdown
# Migrations

One history, shared by every environment. `0000` through `0003` are production's
own history. `0004_unify_schema.sql` brings a database to what
`src/db/schema.ts` describes.

| Environment | Database | Config |
| --- | --- | --- |
| beta | `code-nest-beta-db` | `wrangler.beta.jsonc` |
| staging | `code-nest-staged-db` | `wrangler.staging.jsonc` |
| production | `code-nest-prod-db` | `wrangler.jsonc` |

Each sits at a prefix of this list. Apply outward, never inward:

    pnpm db:migrate:dev
    pnpm db:migrate:staged
    pnpm db:migrate:prod

`pnpm db:migrate:prod` passes no `--config` and reads `wrangler.jsonc` from
whatever tree is checked out, so these configs must stay correct on every branch.

## Adding a change

Edit `src/db/schema.ts`, run `pnpm db:generate`, review the emitted file.

`drizzle-kit generate` writes DDL only. If your change needs a seed, a backfill
or a data copy, add it to the same file by hand and extend
`scripts/verify-preservation.ts` to assert it. This is not optional: `0004`
exists because nine such statements lived in the old history, and a generated
migration would have silently dropped every one. An empty `event_type_rules`
means nobody can create an event.

## Checks

    pnpm exec tsx scripts/verify-trunk.ts         # trunk and schema.ts agree
    pnpm exec tsx scripts/verify-preservation.ts  # data survives 0004

`verify-trunk` replays this directory into one database and renders `schema.ts`
into another, then diffs them. Neither side derives from the other. A previous
version of this project checked convergence by running `db:generate` twice,
which compares `schema.ts` against a snapshot `db:generate` had just written,
and would pass on a completely wrong migration.

Read pending migrations without writing:

    pnpm exec wrangler d1 migrations list DB --config wrangler.staging.jsonc --remote
```

- [x] **Step 4: Mark the superseded plan**

Under the title of `docs/superpowers/plans/2026-08-05-beta-to-staging-release.md`, add:

```markdown
> **Superseded in part, 2026-08-07.** The separate migration directory this plan
> introduced has been replaced by a single history. See
> `docs/superpowers/specs/2026-08-07-migration-lineage-unification-design.md`.
> The feature-flag work in tasks 1 to 5 still stands; task 1 and part of task 2
> shipped in commits f8bd0f3 and dbbebe4.
```

- [x] **Step 5: Full verification**

```bash
pnpm typecheck && pnpm test
pnpm exec tsx scripts/verify-trunk.ts
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
pnpm exec wrangler d1 migrations list DB --config wrangler.staging.jsonc --remote
```

Expected: clean typecheck, 467 tests, `CONVERGED`, nothing pending on either environment.

- [x] **Step 6: Commit and push**

```bash
graphify update .
git add -A drizzle wrangler.jsonc wrangler.staging.jsonc docs graphify-out
git commit -m "refactor(db): retire the second migration directory

Every environment now shares one history, so drizzle/release-migrations
and the split it encoded are gone. All three wrangler configs point at
drizzle/migrations.

The README records why a migration here is never assumed to be pure DDL:
the bridge that was, drifted, and left staging without a column schema.ts
declared."
git push origin beta
```

---

## Remaining after this plan

Production is still at `0003` and untouched. Applying `0004_unify_schema.sql` to `code-nest-prod-db` is deliberately separate, being the first irreversible step. Before it runs:

- re-check the legacy table counts, which were all zero on 2026-08-07
- take a `wrangler d1 export` backup with a fresh timestamped name and validate it
- apply the identical file Task 5 rehearsed

Feature-flag enforcement for server actions and internal route handlers, tasks 2 to 5 of the 2026-08-05 plan, remains outstanding and unrelated.
