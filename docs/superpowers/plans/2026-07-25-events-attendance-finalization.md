# Events Attendance Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock local dev by fixing the migration-runner split, then finish the events attendance system with an enriched scan result, undo, admin-configurable event-type creation rules, a booking-style date picker, and a full-screen mobile QR scanner.

**Architecture:** Server work lands first (migration runner, migration `0010`, repository methods, contract ops, routes), then UI consumes it. Every new piece of non-trivial logic is extracted into a **pure function in a `.ts` file** so it is testable — see Global Constraints for why this is mandatory here.

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), Drizzle ORM over Cloudflare D1 (and better-sqlite3 locally), zod contracts, Tailwind + shadcn-style UI primitives, vitest on `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-07-25-events-attendance-finalization-design.md`

## Global Constraints

- **No new npm dependency.** Not for the date picker, not for the scanner, not for tests.
- **Tests run in the Cloudflare Workers pool.** `vitest.config.mts` sets `include: ["src/**/*.test.ts", "scripts/**/*.test.ts"]` — **`.ts` only, never `.tsx`**. There is no jsdom and no React Testing Library. **Do not write component render tests.** Extract logic into pure `.ts` helpers and test those.
- **`better-sqlite3` cannot be imported by any test.** It is a Node native module and the Workers pool cannot load it. The migration runner is therefore split into a pure planner (tested) and a thin I/O shell (untested).
- **`readD1Migrations` reads the migrations directory**, so tests automatically pick up `0009` and `0010` with no journal edit.
- Repository errors that should surface as HTTP 403 **must** have messages starting with `Not authorized` — `src/app/api/events/[id]/scan/route.ts:61` and `src/server/internal/events.ts:148` both branch on that prefix.
- Preserve the existing points guardrail: `create` must keep writing `points: null`. Only `event:points` holders set point values, via `setPoints`.
- Tabs for indentation, matching every existing file in this repo.
- Do **not** touch `drizzle/migrations/meta/_journal.json`. After Task 1 the directory is the source of truth.
- Multi-type points (`point_types`, `event_point_awards`) is **out of scope** — a separate spec.

---

### Task 1: Directory-driven local migration runner

Fixes the reported `SqliteError: table crs_events has no column named deleted_at`. Local dev is broken until this lands, so it goes first.

**Files:**
- Create: `src/db/migrations-plan.ts`
- Create: `src/db/migrations-plan.test.ts`
- Modify: `src/db/migrate-local-sqlite.ts` (full rewrite, currently 18 lines)

**Interfaces:**
- Consumes: nothing.
- Produces: `planMigrations(input: { files: string[]; applied: string[]; legacyAppliedCount: number }): { bootstrap: string[]; pending: string[] }`

- [ ] **Step 1: Write the failing test**

Create `src/db/migrations-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planMigrations } from "./migrations-plan";

const FILES = [
	"0000_young_bullseye.sql",
	"0001_v5_drop_deferred.sql",
	"0002_v5_add_foundation.sql",
	"0003_phase_9_rate_limit_counters.sql",
	"0004_robust_blue_shield.sql",
	"0005_bored_luke_cage.sql",
	"0006_bright_glorian.sql",
	"0007_flippant_leech.sql",
	"0008_elite_rogue.sql",
	"0009_events_member_owned.sql",
];

describe("planMigrations", () => {
	it("applies everything to a fresh database", () => {
		const plan = planMigrations({ files: FILES, applied: [], legacyAppliedCount: 0 });
		expect(plan.bootstrap).toEqual([]);
		expect(plan.pending).toEqual(FILES);
	});

	it("adopts a drizzle-migrated database without re-applying its history", () => {
		// The real bug: .local/dev.db had 9 __drizzle_migrations rows and no 0009,
		// because 0009 was hand-written and never entered meta/_journal.json.
		const plan = planMigrations({ files: FILES, applied: [], legacyAppliedCount: 9 });
		expect(plan.bootstrap).toEqual(FILES.slice(0, 9));
		expect(plan.pending).toEqual(["0009_events_member_owned.sql"]);
	});

	it("is a no-op on a second run", () => {
		const plan = planMigrations({ files: FILES, applied: FILES, legacyAppliedCount: 9 });
		expect(plan.bootstrap).toEqual([]);
		expect(plan.pending).toEqual([]);
	});

	it("applies only new files once adopted", () => {
		const plan = planMigrations({
			files: [...FILES, "0010_event_type_rules.sql"],
			applied: FILES,
			legacyAppliedCount: 9,
		});
		expect(plan.bootstrap).toEqual([]);
		expect(plan.pending).toEqual(["0010_event_type_rules.sql"]);
	});

	it("sorts by filename and ignores non-sql entries", () => {
		const plan = planMigrations({
			files: ["0002_c.sql", "meta", "0000_a.sql", "0001_b.sql"],
			applied: [],
			legacyAppliedCount: 0,
		});
		expect(plan.pending).toEqual(["0000_a.sql", "0001_b.sql", "0002_c.sql"]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/migrations-plan.test.ts`
Expected: FAIL — `Failed to resolve import "./migrations-plan"`

- [ ] **Step 3: Write the pure planner**

Create `src/db/migrations-plan.ts`:

```ts
export type MigrationPlan = {
	/** Already-applied files to record without executing (adopting a drizzle-migrated database). */
	bootstrap: string[];
	/** Files to execute, in order. */
	pending: string[];
};

export type MigrationPlanInput = {
	/** Directory listing of the migrations folder; non-.sql entries are ignored. */
	files: string[];
	/** Names already recorded in d1_migrations. */
	applied: string[];
	/** Row count in __drizzle_migrations, or 0 when that table is absent. */
	legacyAppliedCount: number;
};

export function planMigrations(input: MigrationPlanInput): MigrationPlan {
	const sorted = input.files.filter((file) => file.endsWith(".sql")).sort();

	// Drizzle's table stores hashes, not filenames, but its rows are written in
	// strict journal order — so N rows means the first N files ran.
	const bootstrap = input.applied.length === 0 && input.legacyAppliedCount > 0 ? sorted.slice(0, input.legacyAppliedCount) : [];

	const done = new Set([...input.applied, ...bootstrap]);
	return { bootstrap, pending: sorted.filter((file) => !done.has(file)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/db/migrations-plan.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Rewrite the runner shell**

Replace the entire contents of `src/db/migrate-local-sqlite.ts`:

```ts
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { planMigrations } from "./migrations-plan";

// ponytail: the migrations DIRECTORY is the source of truth here, matching
// `wrangler d1 migrations apply`. drizzle's meta/_journal.json is deliberately NOT
// consulted — hand-written SQL (0009) never enters the journal, so the old
// journal-driven migrator silently skipped it while D1 applied it. Do not
// "fix" this back to drizzle's migrate().
// Ceiling: statements run inside a transaction, so a migration relying on
// `PRAGMA foreign_keys=OFF` would not take effect. None do today; if one lands,
// run that file's statements outside the transaction.
const localSqlitePath = process.env.LOCAL_SQLITE_PATH ?? "./.local/dev.db";
const migrationsDir = "drizzle/migrations";

mkdirSync(dirname(localSqlitePath), { recursive: true });
const sqlite = new Database(localSqlitePath);

sqlite.exec(
	`CREATE TABLE IF NOT EXISTS d1_migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE,
		applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
);

function tableExists(name: string): boolean {
	const row = sqlite.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name=?").get(name) as {
		count: number;
	};
	return row.count > 0;
}

const applied = (sqlite.prepare("SELECT name FROM d1_migrations").all() as { name: string }[]).map((row) => row.name);
const legacyAppliedCount = tableExists("__drizzle_migrations")
	? (sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get() as { count: number }).count
	: 0;

const { bootstrap, pending } = planMigrations({ files: readdirSync(migrationsDir), applied, legacyAppliedCount });

const record = sqlite.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)");
for (const name of bootstrap) record.run(name);
if (bootstrap.length > 0) console.log(`Adopted ${bootstrap.length} migration(s) already applied by drizzle.`);

for (const name of pending) {
	const statements = readFileSync(join(migrationsDir, name), "utf8")
		.split("--> statement-breakpoint")
		.map((statement) => statement.trim())
		.filter(Boolean);
	sqlite.exec("BEGIN");
	try {
		for (const statement of statements) sqlite.exec(statement);
		record.run(name);
		sqlite.exec("COMMIT");
	} catch (error) {
		sqlite.exec("ROLLBACK");
		throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	console.log(`Applied ${name}`);
}

sqlite.close();
console.log(`${localSqlitePath} is up to date (${pending.length} applied).`);
```

- [ ] **Step 6: Run the runner against the real broken local database**

Run: `pnpm db:migrate:local:sqlite`
Expected output includes `Adopted 9 migration(s) already applied by drizzle.` and `Applied 0009_events_member_owned.sql`

- [ ] **Step 7: Verify the column that caused the 500 now exists**

Run:
```bash
node -e "const D=require('better-sqlite3');const db=new D('./.local/dev.db',{readonly:true});console.log(db.prepare('pragma table_info(crs_events)').all().map(c=>c.name).join(','));console.log('event_staff:',db.prepare(\"select count(*) c from sqlite_master where name='event_staff'\").get().c);"
```
Expected: the column list contains `deleted_at`, and `event_staff: 1`

- [ ] **Step 8: Verify idempotency**

Run: `pnpm db:migrate:local:sqlite`
Expected: `(0 applied)`, no `Adopted` line, no error

- [ ] **Step 9: Commit**

```bash
git add src/db/migrations-plan.ts src/db/migrations-plan.test.ts src/db/migrate-local-sqlite.ts
git commit -m "fix(db): make local migrations directory-driven like wrangler"
```

---

### Task 2: Migration 0010, schema, and the `event:create_restricted` permission

**Files:**
- Create: `drizzle/migrations/0010_event_type_rules.sql`
- Modify: `src/db/schema.ts` (add `eventTypes` const + `eventTypeRules` table)
- Modify: `src/server/auth/permissions.ts:25-39` (permissionActions), `:51-57` (rolePermissions)
- Modify: `src/server/auth/permissions.test.ts:6` (the `events` role expectation)

**Interfaces:**
- Consumes: nothing.
- Produces: `eventTypes: readonly ["official", "casual", "birthday"]`, `eventTypeRules` Drizzle table, `"event:create_restricted"` as a `PermissionAction`.

- [ ] **Step 1: Write the migration**

Create `drizzle/migrations/0010_event_type_rules.sql`:

```sql
CREATE TABLE `event_type_rules` (
	`type` text PRIMARY KEY NOT NULL,
	`required_permission` text,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `event_type_rules` (`type`, `required_permission`) VALUES ('casual', NULL);--> statement-breakpoint
INSERT INTO `event_type_rules` (`type`, `required_permission`) VALUES ('birthday', NULL);--> statement-breakpoint
INSERT INTO `event_type_rules` (`type`, `required_permission`) VALUES ('official', 'event:create_restricted');
```

- [ ] **Step 2: Add the schema table**

In `src/db/schema.ts`, replace line 5:

```ts
export type EventType = "official" | "casual" | "birthday";
```

with:

```ts
export const eventTypes = ["official", "casual", "birthday"] as const;
export type EventType = (typeof eventTypes)[number];
```

Then append after the `crsAttendance` table definition (around line 268):

```ts
export const eventTypeRules = sqliteTable("event_type_rules", {
	type: text("type").$type<EventType>().primaryKey(),
	// NULL means any member may create this event type.
	requiredPermission: text("required_permission"),
	updatedBy: text("updated_by").references(() => members.id, { onDelete: "set null" }),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});
```

- [ ] **Step 3: Add the permission**

In `src/server/auth/permissions.ts`, add `"event:create_restricted",` to `permissionActions` immediately after `"event:points",`, and change the `events` role to:

```ts
	events: ["event:moderate", "event:points", "event:create_restricted"],
```

- [ ] **Step 4: Update the permission test that now fails**

In `src/server/auth/permissions.test.ts`, line 6, change:

```ts
	{ role: "events", allowed: ["event:moderate", "event:points"] },
```

to:

```ts
	{ role: "events", allowed: ["event:moderate", "event:points", "event:create_restricted"] },
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/server/auth/permissions.test.ts`
Expected: PASS

- [ ] **Step 6: Apply the migration locally and typecheck**

Run: `pnpm db:migrate:local:sqlite && pnpm typecheck`
Expected: `Applied 0010_event_type_rules.sql`, then typecheck clean

- [ ] **Step 7: Commit**

```bash
git add drizzle/migrations/0010_event_type_rules.sql src/db/schema.ts src/server/auth/permissions.ts src/server/auth/permissions.test.ts
git commit -m "feat(events): add event_type_rules table and event:create_restricted permission"
```

---

### Task 3: Enrich `recordScan` and fix the fabricated timestamp

**Files:**
- Modify: `src/db/repositories/events.ts:44` (type), `:369-412` (`recordScan`), plus a new module-level helper
- Modify: `src/db/contract/events.ts:179-189` (`scan` output schema)
- Test: `src/db/repositories/events.integration.test.ts` (append one `it`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
```ts
type RecordScanResult = {
	eventId: string; memberId: string;
	memberName: string | null; memberImage: string | null;
	scannedAt: Date; scannedByName: string | null;
	alreadyPresent: boolean;
};
```
  Task 4 reuses the private `loadScanRow` helper; Task 8 consumes this shape over HTTP.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("events repository on D1")` block in `src/db/repositories/events.integration.test.ts`:

```ts
	it("returns the original scan time and scanner on a duplicate scan", async () => {
		const event = await makeApprovedEvent();
		const { repo } = makeRepos();
		await repo.addStaff(owner, event.id, adminStaff.memberId, "admin");

		vi.setSystemTime(new Date("2026-07-10T10:05:00.000Z"));
		const first = await repo.recordScan(owner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });
		expect(first.alreadyPresent).toBe(false);
		expect(first.memberName).toBe("Member A");
		expect(first.scannedByName).toBe("Owner");
		expect(first.scannedAt.toISOString()).toBe("2026-07-10T10:05:00.000Z");

		// A different scanner re-scans the same badge 20 minutes later.
		vi.setSystemTime(new Date("2026-07-10T10:25:00.000Z"));
		const second = await repo.recordScan(adminStaff, { eventId: event.id, memberId: "mem_a", termId: "term_1" });
		expect(second.alreadyPresent).toBe(true);
		expect(second.memberName).toBe("Member A");
		// The bug being fixed: this used to report now() and omit the scanner.
		expect(second.scannedAt.toISOString()).toBe("2026-07-10T10:05:00.000Z");
		expect(second.scannedByName).toBe("Owner");
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/repositories/events.integration.test.ts -t "original scan time"`
Expected: FAIL — `first.memberName` is `undefined`

- [ ] **Step 3: Update the result type and contract**

In `src/db/repositories/events.ts`, replace line 44:

```ts
export type RecordScanResult = {
	eventId: string;
	memberId: string;
	memberName: string | null;
	memberImage: string | null;
	scannedAt: Date;
	scannedByName: string | null;
	alreadyPresent: boolean;
};
```

In `src/db/contract/events.ts`, replace the `output` of the `scan` operation (lines 181-186):

```ts
		output: z.object({
			eventId: z.string(),
			memberId: z.string(),
			memberName: z.string().nullable(),
			memberImage: z.string().nullable(),
			scannedAt: z.coerce.date(),
			scannedByName: z.string().nullable(),
			alreadyPresent: z.boolean(),
		}),
```

- [ ] **Step 4: Add the join helper**

In `src/db/repositories/events.ts`, add `alias` to the sqlite-core import at the top:

```ts
import { alias } from "drizzle-orm/sqlite-core";
```

Add these module-level definitions after `runAtomic` (around line 135):

```ts
const scannerMember = alias(members, "scanner_member");

type ScanRow = {
	scannedAt: Date;
	memberFullName: string | null;
	memberName: string | null;
	memberEmail: string;
	memberImage: string | null;
	scannedByFullName: string | null;
	scannedByName: string | null;
};

/** The attendance row joined to both the attendee and whoever scanned them. */
async function loadScanRow(db: Db, eventId: string, memberId: string): Promise<ScanRow | null> {
	const [row] = await db
		.select({
			scannedAt: crsAttendance.scannedAt,
			memberFullName: members.fullName,
			memberName: members.name,
			memberEmail: members.email,
			memberImage: members.image,
			scannedByFullName: scannerMember.fullName,
			scannedByName: scannerMember.name,
		})
		.from(crsAttendance)
		.innerJoin(members, eq(members.id, crsAttendance.memberId))
		.leftJoin(scannerMember, eq(scannerMember.id, crsAttendance.scannedBy))
		.where(and(eq(crsAttendance.eventId, eventId), eq(crsAttendance.memberId, memberId)))
		.limit(1);
	return row ?? null;
}

function toScanResult(eventId: string, memberId: string, row: ScanRow, alreadyPresent: boolean): RecordScanResult {
	return {
		eventId,
		memberId,
		memberName: row.memberFullName ?? row.memberName ?? row.memberEmail,
		memberImage: row.memberImage,
		scannedAt: row.scannedAt,
		scannedByName: row.scannedByFullName ?? row.scannedByName,
		alreadyPresent,
	};
}
```

- [ ] **Step 5: Rewrite `recordScan`**

Replace the body of `recordScan` (lines 369-412) with:

```ts
		async recordScan(actor, input) {
			const { event, role } = await requireEvent(actor, input.eventId);
			if (!canOperate(role, actor)) throw new Error("Not authorized to scan attendance.");
			if (role === "scanner" && !inCheckinWindow(event, new Date())) throw new Error("Check-in is closed.");

			const existing = await loadScanRow(db, input.eventId, input.memberId);
			if (existing) return toScanResult(input.eventId, input.memberId, existing, true);

			const scannedAt = new Date();
			try {
				await runAtomic(db, [
					db
						.insert(crsAttendance)
						.values({ eventId: input.eventId, memberId: input.memberId, scannedAt, scannedBy: actor.memberId }),
					db.insert(retentionRecords).values({
						id: createId("ret"),
						memberId: input.memberId,
						termId: input.termId,
						eventId: input.eventId,
						points: event.points,
						reason: `Attended ${event.title}`,
						source: "event_attendance",
						recordedBy: actor.memberId,
						recordedAt: scannedAt,
					}),
				]);
			} catch (error) {
				// Two scanners hit the same badge at once: the loser reports the winner's row.
				const raced = await loadScanRow(db, input.eventId, input.memberId);
				if (raced) return toScanResult(input.eventId, input.memberId, raced, true);
				throw error;
			}
			await audit.record(actor, {
				action: "event:scan_attendance",
				targetType: "event",
				targetId: input.eventId,
				category: "event",
				detail: `member=${input.memberId}`,
			});
			const inserted = await loadScanRow(db, input.eventId, input.memberId);
			if (!inserted) throw new Error("Scan was recorded but could not be read back.");
			return toScanResult(input.eventId, input.memberId, inserted, false);
		},
```

Note the behaviour change: a genuine insert failure now rethrows instead of masquerading as `alreadyPresent: true`. That silent swallow is why a broken write looked like a duplicate.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/db/repositories/events.integration.test.ts`
Expected: PASS (all existing tests plus the new one)

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories/events.ts src/db/contract/events.ts src/db/repositories/events.integration.test.ts
git commit -m "fix(events): return the real scan time and scanner on duplicate scans"
```

---

### Task 4: `undoScan` repository method and `DELETE` route

**Files:**
- Modify: `src/db/repositories/events.ts` (add to `EventsRepository` type + implementation)
- Modify: `src/db/contract/events.ts` (add `undoScan` operation)
- Modify: `src/app/api/events/[id]/scan/route.ts` (add `DELETE`)
- Modify: `src/server/internal/events.ts` (add a `DELETE` branch)
- Test: `src/db/repositories/events.integration.test.ts` (append one `it`)

**Interfaces:**
- Consumes: `loadScanRow(db, eventId, memberId)` and `canManage(role, actor)` from Task 3 / existing code.
- Produces: `undoScan(actor: Actor, input: { eventId: string; memberId: string }): Promise<{ removed: boolean }>`; `DELETE /api/events/[id]/scan` with body `{ memberId: string }`.

- [ ] **Step 1: Write the failing test**

Append inside the same `describe` block in `src/db/repositories/events.integration.test.ts`:

```ts
	it("lets owners undo a scan and removes the points with it, but blocks scanners", async () => {
		const event = await makeApprovedEvent();
		const { repo, db } = makeRepos();
		await repo.setPoints(eventsAdmin, event.id, 5);
		await repo.addStaff(owner, event.id, scanner.memberId, "scanner");
		await repo.recordScan(owner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });

		await expect(repo.undoScan(scanner, { eventId: event.id, memberId: "mem_a" })).rejects.toThrow("Not authorized");

		await expect(repo.undoScan(owner, { eventId: event.id, memberId: "mem_a" })).resolves.toEqual({ removed: true });
		expect(await db.select().from(schema.crsAttendance)).toHaveLength(0);
		// The points row must die with the attendance row, or the member keeps
		// credit for an event they were removed from.
		expect(await db.select().from(schema.retentionRecords)).toHaveLength(0);

		// Undoing something that is not there is a no-op, not an error.
		await expect(repo.undoScan(owner, { eventId: event.id, memberId: "mem_a" })).resolves.toEqual({ removed: false });
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/repositories/events.integration.test.ts -t "undo a scan"`
Expected: FAIL — `repo.undoScan is not a function`

- [ ] **Step 3: Add the method to the repository type**

In `src/db/repositories/events.ts`, add after the `recordScan` line in `EventsRepository` (line 81):

```ts
	undoScan(actor: Actor, input: UndoScanInput): Promise<{ removed: boolean }>;
```

And add the input type next to `RecordScanInput` (line 43):

```ts
export type UndoScanInput = { eventId: string; memberId: string };
```

- [ ] **Step 4: Implement it**

In `src/db/repositories/events.ts`, add immediately after the `recordScan` implementation:

```ts
		async undoScan(actor, input) {
			const { role } = await requireEvent(actor, input.eventId);
			// Owner, event admin, or a CRS moderator. Plain scanners cannot undo.
			if (!canManage(role, actor)) throw new Error("Not authorized to undo attendance.");

			const existing = await loadScanRow(db, input.eventId, input.memberId);
			if (!existing) return { removed: false };

			await runAtomic(db, [
				db
					.delete(crsAttendance)
					.where(and(eq(crsAttendance.eventId, input.eventId), eq(crsAttendance.memberId, input.memberId))),
				db
					.delete(retentionRecords)
					.where(
						and(
							eq(retentionRecords.eventId, input.eventId),
							eq(retentionRecords.memberId, input.memberId),
							eq(retentionRecords.source, "event_attendance"),
						),
					),
			]);
			await audit.record(actor, {
				action: "event:undo_scan",
				targetType: "event",
				targetId: input.eventId,
				category: "event",
				detail: `member=${input.memberId}`,
			});
			return { removed: true };
		},
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/db/repositories/events.integration.test.ts`
Expected: PASS

- [ ] **Step 6: Add the contract operation**

In `src/db/contract/events.ts`, add immediately after the `scan` operation:

```ts
	undoScan: operation({
		input: z.object({ eventId: z.string().min(1), memberId: z.string().min(1) }),
		output: z.object({ removed: z.boolean() }),
		auth: "member",
		sharedDev: "deny",
	}),
```

- [ ] **Step 7: Add the DELETE route**

Append to `src/app/api/events/[id]/scan/route.ts`:

```ts
const undoBodySchema = z.object({ memberId: z.string().min(1) });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, `/internal/events?op=undoScan&eventId=${encodeURIComponent(id)}`);
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const body = undoBodySchema.parse(await request.json());
		const repositories = await getRepositories();
		const result = await repositories.events.undoScan(actor, { eventId: id, memberId: body.memberId });
		return NextResponse.json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
```

- [ ] **Step 8: Add the shared-dev DELETE branch**

In `src/server/internal/events.ts`, add immediately before the final `return new Response("Method not allowed", { status: 405, headers: responseHeaders });` (line 145):

```ts
				if (request.method === "DELETE" && op === "undoScan") {
					return Response.json(
						{ error: "Operation is disabled in shared development." },
						{ status: 403, headers: responseHeaders },
					);
				}
```

- [ ] **Step 9: Typecheck and run the full suite**

Run: `pnpm typecheck && pnpm vitest run`
Expected: typecheck clean, all tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/db/repositories/events.ts src/db/contract/events.ts src/app/api/events/\[id\]/scan/route.ts src/server/internal/events.ts src/db/repositories/events.integration.test.ts
git commit -m "feat(events): undo a scan, removing attendance and its points row"
```

---

### Task 5: Event type rules repository and creation enforcement

**Files:**
- Create: `src/db/repositories/eventTypeRules.ts`
- Create: `src/db/repositories/eventTypeRules.integration.test.ts`
- Modify: `src/db/repositories/index.ts` (register in both factories)
- Modify: `src/db/repositories/events.ts` (`create` enforcement)
- Modify: `src/db/repositories/events.integration.test.ts` (append one `it`)

**Interfaces:**
- Consumes: `eventTypeRules` table and `"event:create_restricted"` from Task 2.
- Produces:
```ts
type EventTypeRule = { type: EventType; requiredPermission: PermissionAction | null };
canCreateType(actor: Actor, rules: EventTypeRule[], type: EventType): boolean
allowedEventTypes(actor: Actor, rules: EventTypeRule[]): EventType[]
createEventTypeRulesRepository(db, audit): {
	list(): Promise<EventTypeRule[]>;
	setRequiredPermission(actor: Actor, type: EventType, permission: PermissionAction | null): Promise<void>;
}
```
  Task 6 consumes all of it; Task 7's create sheet consumes `allowedEventTypes`.

- [ ] **Step 1: Write the failing test**

Create `src/db/repositories/eventTypeRules.integration.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { allowedEventTypes, canCreateType, createEventTypeRulesRepository } from "./eventTypeRules";

const plainMember: Actor = { memberId: "mem_plain", roles: ["member"] };
const eventsAdmin: Actor = { memberId: "mem_events", roles: ["events"] };
const superAdmin: Actor = { memberId: "mem_super", roles: ["super"] };

function makeRepo() {
	const db = drizzle(env.DB, { schema });
	return createEventTypeRulesRepository(db, createAuditRepository(db));
}

describe("event type rules on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM members").run();
		for (const [id, email] of [
			["mem_plain", "plain@example.com"],
			["mem_events", "events@example.com"],
			["mem_super", "super@example.com"],
		]) {
			await env.DB.prepare("INSERT INTO members (id, email) VALUES (?, ?)").bind(id, email).run();
		}
		await env.DB.prepare("DELETE FROM event_type_rules").run();
		await env.DB.prepare("INSERT INTO event_type_rules (type, required_permission) VALUES ('casual', NULL)").run();
		await env.DB.prepare("INSERT INTO event_type_rules (type, required_permission) VALUES ('birthday', NULL)").run();
		await env.DB.prepare(
			"INSERT INTO event_type_rules (type, required_permission) VALUES ('official', 'event:create_restricted')",
		).run();
	});

	it("ships seeded defaults: casual and birthday open, official restricted", async () => {
		const rules = await makeRepo().list();
		expect(rules).toEqual(
			expect.arrayContaining([
				{ type: "casual", requiredPermission: null },
				{ type: "birthday", requiredPermission: null },
				{ type: "official", requiredPermission: "event:create_restricted" },
			]),
		);
	});

	it("gates types by permission", async () => {
		const rules = await makeRepo().list();
		expect(canCreateType(plainMember, rules, "casual")).toBe(true);
		expect(canCreateType(plainMember, rules, "official")).toBe(false);
		expect(canCreateType(eventsAdmin, rules, "official")).toBe(true);
		expect(canCreateType(superAdmin, rules, "official")).toBe(true);
		expect(allowedEventTypes(plainMember, rules).sort()).toEqual(["birthday", "casual"]);
	});

	it("applies an admin's change at runtime", async () => {
		const repo = makeRepo();
		await repo.setRequiredPermission(superAdmin, "casual", "event:create_restricted");
		const rules = await repo.list();
		expect(canCreateType(plainMember, rules, "casual")).toBe(false);
		expect(canCreateType(eventsAdmin, rules, "casual")).toBe(true);
	});

	it("rejects a write from an actor without role:assign", async () => {
		await expect(makeRepo().setRequiredPermission(plainMember, "casual", null)).rejects.toThrow("Not authorized");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/db/repositories/eventTypeRules.integration.test.ts`
Expected: FAIL — cannot resolve `./eventTypeRules`

- [ ] **Step 3: Write the repository**

Create `src/db/repositories/eventTypeRules.ts`:

```ts
import { eq } from "drizzle-orm";
import { eventTypeRules, eventTypes } from "@/db/schema";
import type { EventType } from "@/db/schema";
import type { Actor, PermissionAction } from "@/server/auth/permissions";
import { can, permissionActions } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type EventTypeRule = { type: EventType; requiredPermission: PermissionAction | null };

export type EventTypeRulesRepository = {
	list(): Promise<EventTypeRule[]>;
	setRequiredPermission(actor: Actor, type: EventType, permission: PermissionAction | null): Promise<void>;
};

/** A type with no rule row falls open — a missing row must never lock members out. */
export function canCreateType(actor: Actor, rules: EventTypeRule[], type: EventType): boolean {
	const rule = rules.find((entry) => entry.type === type);
	if (!rule || rule.requiredPermission === null) return true;
	return can(actor, rule.requiredPermission);
}

export function allowedEventTypes(actor: Actor, rules: EventTypeRule[]): EventType[] {
	return eventTypes.filter((type) => canCreateType(actor, rules, type));
}

function normalize(row: { type: string; requiredPermission: string | null }): EventTypeRule {
	const permission = row.requiredPermission;
	return {
		type: row.type as EventType,
		requiredPermission:
			permission && (permissionActions as readonly string[]).includes(permission) ? (permission as PermissionAction) : null,
	};
}

export function createEventTypeRulesRepository(db: Db, audit: AuditRepository): EventTypeRulesRepository {
	return {
		async list() {
			const rows = await db
				.select({ type: eventTypeRules.type, requiredPermission: eventTypeRules.requiredPermission })
				.from(eventTypeRules);
			return rows.map(normalize);
		},

		async setRequiredPermission(actor, type, permission) {
			if (!can(actor, "role:assign")) throw new Error("Not authorized to change event type rules.");
			if (!(eventTypes as readonly string[]).includes(type)) throw new Error("Unknown event type.");
			if (permission !== null && !(permissionActions as readonly string[]).includes(permission)) {
				throw new Error("Unknown permission.");
			}
			await db
				.insert(eventTypeRules)
				.values({ type, requiredPermission: permission, updatedBy: actor.memberId, updatedAt: new Date() })
				.onConflictDoUpdate({
					target: eventTypeRules.type,
					set: { requiredPermission: permission, updatedBy: actor.memberId, updatedAt: new Date() },
				});
			await audit.record(actor, {
				action: "event:set_type_rule",
				targetType: "event_type",
				targetId: type,
				category: "event",
				detail: `required=${permission ?? "none"}`,
			});
		},
	};
}
```

- [ ] **Step 4: Register the repository**

In `src/db/repositories/index.ts`:

Add the import beside the other event imports:
```ts
import { createEventTypeRulesRepository } from "./eventTypeRules";
```

Add to the returned object in `createDrizzleRepositories`, after `eventForum`:
```ts
		eventTypeRules: createEventTypeRulesRepository(db, audit),
```

Add to the returned object in `createSharedRepositories`, after `eventForum`:
```ts
		eventTypeRules: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createEventTypeRulesRepository>,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/db/repositories/eventTypeRules.integration.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Write the failing enforcement test**

Append inside the `describe` block in `src/db/repositories/events.integration.test.ts`:

```ts
	it("gates event creation on the configured type rules", async () => {
		await env.DB.prepare("DELETE FROM event_type_rules").run();
		await env.DB.prepare("INSERT INTO event_type_rules (type, required_permission) VALUES ('casual', NULL)").run();
		await env.DB.prepare("INSERT INTO event_type_rules (type, required_permission) VALUES ('birthday', NULL)").run();
		await env.DB.prepare(
			"INSERT INTO event_type_rules (type, required_permission) VALUES ('official', 'event:create_restricted')",
		).run();
		const { repo } = makeRepos();
		const base = {
			title: "Gated",
			place: "SOM 111",
			description: "Gated",
			startsAt: START,
			endsAt: END,
			capacity: null,
		};

		await expect(repo.create(owner, { ...base, type: "official" })).rejects.toThrow("Not authorized");
		await expect(repo.create(owner, { ...base, type: "casual" })).resolves.toMatchObject({ type: "casual" });
		await expect(repo.create(eventsAdmin, { ...base, type: "official" })).resolves.toMatchObject({ type: "official" });
	});
```

Also add the `event_type_rules` table to the `beforeEach` truncation list in that file, immediately before `"crs_events"`, then re-seed the three default rows at the end of `beforeEach`:

```ts
		await env.DB.prepare("INSERT INTO event_type_rules (type, required_permission) VALUES ('casual', NULL)").run();
		await env.DB.prepare("INSERT INTO event_type_rules (type, required_permission) VALUES ('birthday', NULL)").run();
		await env.DB.prepare(
			"INSERT INTO event_type_rules (type, required_permission) VALUES ('official', 'event:create_restricted')",
		).run();
```

`makeApprovedEvent` currently creates an **`official`** event as `owner`, which the new rule forbids. All 8 of its call sites depend on `owner` being the event owner, and **no test asserts the type is `official`** — so change the type, not the actor. In `makeApprovedEvent` (line 74):

```ts
			type: "casual",
```

Leave `async function makeApprovedEvent(actor: Actor = owner)` exactly as it is. Do **not** change the default actor to `eventsAdmin` — that would strip `owner` of its owner role at all 8 call sites and cascade failures through the staff, scan, and undo tests.

The only test that should create an `official` event is the new gating test above, which passes `eventsAdmin` explicitly.

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm vitest run src/db/repositories/events.integration.test.ts -t "gates event creation"`
Expected: FAIL — creating an `official` event as `owner` resolves instead of rejecting

- [ ] **Step 8: Enforce in `create`**

In `src/db/repositories/events.ts`, add the import:

```ts
import { canCreateType, createEventTypeRulesRepository } from "./eventTypeRules";
```

Then insert at the very top of the `create` implementation (before the `db.insert`):

```ts
			const rules = await createEventTypeRulesRepository(db, audit).list();
			if (!canCreateType(actor, rules, input.type)) {
				throw new Error(`Not authorized to create ${input.type} events.`);
			}
```

- [ ] **Step 9: Run the full suite**

Run: `pnpm vitest run && pnpm typecheck`
Expected: all PASS, typecheck clean

- [ ] **Step 10: Commit**

```bash
git add src/db/repositories/eventTypeRules.ts src/db/repositories/eventTypeRules.integration.test.ts src/db/repositories/index.ts src/db/repositories/events.ts src/db/repositories/events.integration.test.ts
git commit -m "feat(events): gate event creation on admin-configurable type rules"
```

---

### Task 6: Admin screen for event type rules

**Files:**
- Create: `src/app/portal/admin/system/event-types/page.tsx`
- Create: `src/app/portal/admin/system/event-types/event-type-rules-manager.tsx`
- Create: `src/app/portal/admin/system/event-types/actions.ts`
- Modify: `src/app/portal/admin/nav.ts:47-56` (the `system` group)

**Interfaces:**
- Consumes: `repositories.eventTypeRules.list()` / `.setRequiredPermission()` from Task 5.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Register the page in the admin nav**

In `src/app/portal/admin/nav.ts`, add as the first entry of the `G("system", "System", [...])` array:

```ts
		{
			segment: "event-types",
			label: "Event Type Rules",
			description: "Which permission each event type requires to create.",
			permission: "role:assign",
		},
```

- [ ] **Step 2: Write the server action**

Create `src/app/portal/admin/system/event-types/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { eventTypes } from "@/db/schema";
import { requireActor } from "@/server/auth/actor";
import { permissionActions } from "@/server/auth/permissions";

// "" is the form's representation of "any member may create this type".
const schema = z.object({
	type: z.enum(eventTypes),
	requiredPermission: z
		.union([z.enum(permissionActions), z.literal("")])
		.transform((value) => (value === "" ? null : value)),
});

export async function setEventTypeRuleAction(formData: FormData) {
	const actor = await requireActor();
	const input = schema.parse({
		type: formData.get("type"),
		requiredPermission: formData.get("requiredPermission") ?? "",
	});
	const repositories = await getRepositories();
	await repositories.eventTypeRules.setRequiredPermission(actor, input.type, input.requiredPermission);
	revalidatePath("/portal/admin/system/event-types");
	revalidatePath("/portal/calendar");
}
```

- [ ] **Step 3: Write the page**

Create `src/app/portal/admin/system/event-types/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { EventTypeRulesManager } from "./event-type-rules-manager";

export const dynamic = "force-dynamic";

export default async function EventTypesAdminPage() {
	const actor = await requireActor();
	if (!can(actor, "role:assign")) redirect("/portal/admin");
	const repositories = await getRepositories();
	// Shared-dev has no internal proxy for this repo; degrade rather than crash.
	const rules = await repositories.eventTypeRules.list().catch(() => []);
	return <EventTypeRulesManager rules={rules} />;
}
```

- [ ] **Step 4: Write the manager component**

Create `src/app/portal/admin/system/event-types/event-type-rules-manager.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EventTypeRule } from "@/db/repositories/eventTypeRules";
import { eventTypes } from "@/db/schema";
import { permissionActions } from "@/server/auth/permissions";
import { setEventTypeRuleAction } from "./actions";

const TYPE_LABELS: Record<string, string> = {
	casual: "Casual",
	official: "Official",
	birthday: "Birthday",
};

export function EventTypeRulesManager({ rules }: { rules: EventTypeRule[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Event Type Rules</CardTitle>
				<CardDescription>
					Choose which permission a member needs to create each event type. “Any member” lets everyone create it.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{eventTypes.map((type) => {
					const current = rules.find((rule) => rule.type === type)?.requiredPermission ?? "";
					return (
						<form key={type} action={setEventTypeRuleAction} className="flex flex-wrap items-end gap-3">
							<input type="hidden" name="type" value={type} />
							<label className="grid gap-1.5 text-sm">
								<span className="font-medium">{TYPE_LABELS[type] ?? type}</span>
								<select
									name="requiredPermission"
									defaultValue={current}
									className="w-64 rounded-lg border border-border bg-background p-2 text-sm"
								>
									<option value="">Any member</option>
									{permissionActions.map((action) => (
										<option key={action} value={action}>
											{action}
										</option>
									))}
								</select>
							</label>
							<Button type="submit" size="sm" variant="secondary">
								Save
							</Button>
						</form>
					);
				})}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean

- [ ] **Step 6: Verify manually**

Run `pnpm dev`, sign in as a super admin, open `/portal/admin/system/event-types`.
Expected: three rows; `official` preselects `event:create_restricted`; saving `casual` → `event:create_restricted` then opening `/portal/calendar` shows Casual removed from the create form's type list for a plain member. Set it back to "Any member" afterward.

- [ ] **Step 7: Commit**

```bash
git add src/app/portal/admin/nav.ts src/app/portal/admin/system/event-types/
git commit -m "feat(admin): screen for event type creation rules"
```

---

### Task 7: Booking-style date and time picker

**Files:**
- Create: `src/lib/date-slots.ts`
- Create: `src/lib/date-slots.test.ts`
- Create: `src/components/date-time-picker.tsx`
- Modify: `src/app/portal/calendar/create-event-sheet.tsx` (replace the two `datetime-local` inputs, lines 133-154; take an `allowedTypes` prop)
- Modify: `src/app/portal/calendar/page.tsx` (pass `allowedTypes` into `CreateEventSheet`)
- Modify: `src/app/portal/calendar/[eventId]/event-manage-panel.tsx` (the edit form's date inputs)

**Interfaces:**
- Consumes: `allowedEventTypes` from Task 5.
- Produces:
```ts
type DaySlot = { date: string; day: number; inMonth: boolean };  // date is "YYYY-MM-DD"
buildMonthGrid(year: number, month: number): DaySlot[]           // month is 0-indexed; always 42 cells
timeSlots(stepMinutes: number): string[]                          // "HH:mm", 00:00 .. 23:XX
deriveEnd(startLocal: string, durationMinutes: number): string    // both "YYYY-MM-DDTHH:mm"
toLocalInput(date: Date): string                                  // "YYYY-MM-DDTHH:mm"
```
  Task 8 does not consume these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/date-slots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMonthGrid, deriveEnd, timeSlots, toLocalInput } from "./date-slots";

describe("buildMonthGrid", () => {
	it("always returns six full weeks so the grid never jumps height", () => {
		expect(buildMonthGrid(2026, 6)).toHaveLength(42);
	});

	it("pads leading and trailing days from the neighbouring months", () => {
		// July 2026 starts on a Wednesday.
		const grid = buildMonthGrid(2026, 6);
		expect(grid[0]).toEqual({ date: "2026-06-29", day: 29, inMonth: false });
		expect(grid[2]).toEqual({ date: "2026-07-01", day: 1, inMonth: true });
		expect(grid.filter((slot) => slot.inMonth)).toHaveLength(31);
	});

	it("handles a leap February", () => {
		const grid = buildMonthGrid(2028, 1);
		expect(grid.filter((slot) => slot.inMonth)).toHaveLength(29);
	});
});

describe("timeSlots", () => {
	it("covers the whole day at the requested step", () => {
		const slots = timeSlots(30);
		expect(slots).toHaveLength(48);
		expect(slots[0]).toBe("00:00");
		expect(slots[26]).toBe("13:00");
		expect(slots[47]).toBe("23:30");
	});
});

describe("deriveEnd", () => {
	it("adds the duration", () => {
		expect(deriveEnd("2026-07-25T13:00", 60)).toBe("2026-07-25T14:00");
	});

	it("rolls over midnight into the next day", () => {
		expect(deriveEnd("2026-07-25T23:30", 60)).toBe("2026-07-26T00:30");
	});

	it("rolls over a month boundary", () => {
		expect(deriveEnd("2026-07-31T23:00", 120)).toBe("2026-08-01T01:00");
	});

	it("returns an empty string for an empty start", () => {
		expect(deriveEnd("", 60)).toBe("");
	});
});

describe("toLocalInput", () => {
	it("formats local wall-clock time, not UTC", () => {
		const date = new Date(2026, 6, 25, 13, 5);
		expect(toLocalInput(date)).toBe("2026-07-25T13:05");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/date-slots.test.ts`
Expected: FAIL — cannot resolve `./date-slots`

- [ ] **Step 3: Write the helpers**

Create `src/lib/date-slots.ts`:

```ts
export type DaySlot = { date: string; day: number; inMonth: boolean };

const pad = (value: number) => String(value).padStart(2, "0");

/** "YYYY-MM-DDTHH:mm" in local wall-clock time — the format <input type="datetime-local"> uses. */
export function toLocalInput(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toLocalDate(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Six weeks starting on the Monday on or before the 1st. Fixed 42 cells so the
 * calendar does not change height between months.
 */
export function buildMonthGrid(year: number, month: number): DaySlot[] {
	const first = new Date(year, month, 1);
	// getDay() is 0=Sunday; shift so Monday is 0.
	const offset = (first.getDay() + 6) % 7;
	const start = new Date(year, month, 1 - offset);
	return Array.from({ length: 42 }, (_, index) => {
		const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
		return { date: toLocalDate(date), day: date.getDate(), inMonth: date.getMonth() === month };
	});
}

export function timeSlots(stepMinutes: number): string[] {
	const slots: string[] = [];
	for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
		slots.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
	}
	return slots;
}

/**
 * Adds a duration to a local datetime string. Uses the Date constructor's local
 * component arithmetic, so it rolls over days, months, and DST correctly.
 */
export function deriveEnd(startLocal: string, durationMinutes: number): string {
	if (!startLocal) return "";
	const [datePart, timePart] = startLocal.split("T");
	const [year, month, day] = datePart.split("-").map(Number);
	const [hour, minute] = (timePart ?? "00:00").split(":").map(Number);
	return toLocalInput(new Date(year, month - 1, day, hour, minute + durationMinutes));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/date-slots.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Build the picker component**

Create `src/components/date-time-picker.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildMonthGrid, deriveEnd, timeSlots, toLocalDate } from "@/lib/date-slots";

const DURATIONS = [
	{ label: "30m", minutes: 30 },
	{ label: "1h", minutes: 60 },
	{ label: "2h", minutes: 120 },
	{ label: "3h", minutes: 180 },
];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const SLOTS = timeSlots(30);

const chip = "rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOn = "border-primary bg-primary text-primary-foreground";
const chipOff = "border-border hover:bg-muted";

export function DateTimePicker({
	startsAt,
	endsAt,
	onChange,
}: {
	startsAt: string;
	endsAt: string;
	onChange: (next: { startsAt: string; endsAt: string }) => void;
}) {
	const [day, time] = startsAt ? startsAt.split("T") : ["", ""];
	const [cursor, setCursor] = useState(() => {
		const base = day ? new Date(`${day}T00:00`) : new Date();
		return { year: base.getFullYear(), month: base.getMonth() };
	});
	const [custom, setCustom] = useState(false);

	const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
	const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
		new Date(cursor.year, cursor.month, 1),
	);
	const today = toLocalDate(new Date());
	const activeDuration = DURATIONS.find(({ minutes }) => startsAt && endsAt && deriveEnd(startsAt, minutes) === endsAt);

	function pick(nextStart: string, minutes?: number) {
		const duration = minutes ?? activeDuration?.minutes ?? 60;
		onChange({ startsAt: nextStart, endsAt: custom ? endsAt : deriveEnd(nextStart, duration) });
	}

	function shiftMonth(delta: number) {
		setCursor(({ year, month }) => {
			const next = new Date(year, month + delta, 1);
			return { year: next.getFullYear(), month: next.getMonth() };
		});
	}

	return (
		<div className="grid gap-4">
			<div className="rounded-xl border border-border p-3">
				<div className="mb-2 flex items-center justify-between">
					<button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded-md p-1 hover:bg-muted">
						<ChevronLeft className="size-4" />
					</button>
					<span className="text-sm font-medium">{monthLabel}</span>
					<button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="rounded-md p-1 hover:bg-muted">
						<ChevronRight className="size-4" />
					</button>
				</div>
				<div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
					{WEEKDAYS.map((label, index) => (
						<span key={`${label}-${index}`}>{label}</span>
					))}
				</div>
				<div className="mt-1 grid grid-cols-7 gap-1">
					{grid.map((slot) => (
						<button
							key={slot.date}
							type="button"
							onClick={() => pick(`${slot.date}T${time || "18:00"}`)}
							aria-current={slot.date === day ? "date" : undefined}
							className={cn(
								"aspect-square rounded-lg text-sm transition-colors",
								slot.inMonth ? "" : "text-muted-foreground/40",
								slot.date === day ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted",
								slot.date === today && slot.date !== day ? "ring-1 ring-primary/40" : "",
							)}
						>
							{slot.day}
						</button>
					))}
				</div>
			</div>

			<div className="grid gap-2">
				<span className="text-sm font-medium">Starts</span>
				<div className="grid max-h-40 grid-cols-4 gap-2 overflow-y-auto pr-1">
					{SLOTS.map((slot) => (
						<button
							key={slot}
							type="button"
							onClick={() => pick(`${day || today}T${slot}`)}
							className={cn(chip, slot === time ? chipOn : chipOff)}
						>
							{slot}
						</button>
					))}
				</div>
			</div>

			<div className="grid gap-2">
				<span className="text-sm font-medium">Duration</span>
				<div className="flex flex-wrap gap-2">
					{DURATIONS.map((duration) => (
						<button
							key={duration.label}
							type="button"
							onClick={() => {
								setCustom(false);
								pick(startsAt, duration.minutes);
							}}
							className={cn(chip, !custom && activeDuration?.minutes === duration.minutes ? chipOn : chipOff)}
						>
							{duration.label}
						</button>
					))}
					<button type="button" onClick={() => setCustom(true)} className={cn(chip, custom ? chipOn : chipOff)}>
						Custom
					</button>
				</div>
				{custom ? (
					<label className="grid gap-1.5 text-sm">
						<span className="font-medium">Ends</span>
						<input
							type="datetime-local"
							className="w-full rounded-lg border border-border bg-background p-2 text-sm"
							value={endsAt}
							min={startsAt || undefined}
							onChange={(event) => onChange({ startsAt, endsAt: event.target.value })}
						/>
					</label>
				) : (
					<p className="text-xs text-muted-foreground">
						{endsAt ? `Ends ${endsAt.replace("T", " ")}` : "Pick a day and start time."}
					</p>
				)}
			</div>
		</div>
	);
}
```

- [ ] **Step 6: Wire it into the create sheet**

In `src/app/portal/calendar/create-event-sheet.tsx`:

1. Add the imports:
```tsx
import { DateTimePicker } from "@/components/date-time-picker";
import { deriveEnd } from "@/lib/date-slots";
import type { EventType } from "@/db/schema";
```
2. Change the component signature to accept the permitted types:
```tsx
export function CreateEventSheet({ allowedTypes }: { allowedTypes: EventType[] }) {
```
3. Replace the local `toLocalInput` helper (lines 27-30) with an import from `@/lib/date-slots`, and seed the end alongside the start:
```tsx
	const [startsAt, setStartsAt] = useState(defaultStart);
	const [endsAt, setEndsAt] = useState(() => deriveEnd(defaultStart(), 60));
```
4. Default the type to the first permitted one and render only permitted options:
```tsx
	const [type, setType] = useState<EventType>(allowedTypes[0] ?? "casual");
```
```tsx
						<select className={FIELD} value={type} onChange={(e) => setType(e.target.value as EventType)}>
							{allowedTypes.map((option) => (
								<option key={option} value={option}>
									{option.charAt(0).toUpperCase() + option.slice(1)}
								</option>
							))}
						</select>
```
5. Replace the two-column `datetime-local` block and the `endBeforeStart` paragraph (lines 133-154) with:
```tsx
					<DateTimePicker
						startsAt={startsAt}
						endsAt={endsAt}
						onChange={(next) => {
							setStartsAt(next.startsAt);
							setEndsAt(next.endsAt);
						}}
					/>
```
6. Delete the `endBeforeStart` const (line 48) and drop it from `canSubmit`:
```tsx
	const canSubmit = title.trim() && place.trim() && description.trim() && startsAt && endsAt;
```
7. Update `reset()` to restore both dates:
```tsx
		setStartsAt(defaultStart());
		setEndsAt(deriveEnd(defaultStart(), 60));
```

Leave the `.refine()` in `src/app/portal/calendar/actions.ts` untouched — the client can no longer produce an inverted range, but a server action is a public entry point and keeps its own check.

- [ ] **Step 7: Pass the permitted types from the page**

In `src/app/portal/calendar/page.tsx`, load the rules and pass them down:

```tsx
import { allowedEventTypes } from "@/db/repositories/eventTypeRules";
```
```tsx
	const rules = await repositories.eventTypeRules.list().catch(() => []);
	const allowedTypes = allowedEventTypes(actor, rules);
```
and change the render to `<CreateEventSheet allowedTypes={allowedTypes} />`.

Read the file first — match its existing variable names for `actor` and `repositories` rather than introducing new ones.

- [ ] **Step 8: Wire it into the edit form**

In `src/app/portal/calendar/[eventId]/event-manage-panel.tsx`, find the edit form's `datetime-local` inputs and replace them with the same `<DateTimePicker />` block, driven by whatever state that form already holds for start and end. Keep every other field untouched.

- [ ] **Step 9: Typecheck, lint, and test**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: all clean

- [ ] **Step 10: Verify manually**

Run `pnpm dev`, open `/portal/calendar`, click Create event.
Expected: month grid navigates; picking a day then a time then `2h` shows the derived end; `Custom` reveals an end field; the type dropdown lists only what you may create.

- [ ] **Step 11: Commit**

```bash
git add src/lib/date-slots.ts src/lib/date-slots.test.ts src/components/date-time-picker.tsx src/app/portal/calendar/
git commit -m "feat(calendar): booking-style date and time picker"
```

---

### Task 8: Full-screen mobile scanner

**Files:**
- Create: `src/lib/scan-feedback.ts`
- Create: `src/lib/scan-feedback.test.ts`
- Create: `src/components/event-scan-overlay.tsx`
- Modify: `src/components/camera-scanner.tsx` (expose torch + facing mode, accept children)
- Modify: `src/components/event-scan-panel.tsx` (launch the overlay on top of today's inline card)

**Interfaces:**
- Consumes: the enriched scan response from Task 3 and `DELETE /api/events/[id]/scan` from Task 4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `src/lib/scan-feedback.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyScan, describeScan, supportsTorch } from "./scan-feedback";

describe("classifyScan", () => {
	it("flags a QR that is not ours before any request is made", () => {
		expect(classifyScan("https://example.com")).toEqual({ kind: "invalid" });
		expect(classifyScan("code:m:not a member id")).toEqual({ kind: "invalid" });
	});

	it("recognises a member code", () => {
		expect(classifyScan("code:m:mem_abc123")).toEqual({ kind: "member", memberId: "mem_abc123" });
	});
});

describe("describeScan", () => {
	const base = {
		eventId: "evt_1",
		memberId: "mem_a",
		memberName: "Juan Dela Cruz",
		memberImage: null,
		scannedAt: new Date("2026-07-25T10:00:00.000Z"),
		scannedByName: "Maria Santos",
	};

	it("reports a fresh scan", () => {
		const result = describeScan({ ...base, alreadyPresent: false }, new Date("2026-07-25T10:00:05.000Z"));
		expect(result.state).toBe("success");
		expect(result.title).toBe("Juan Dela Cruz");
		expect(result.detail).toBe("Marked present");
	});

	it("reports who scanned a duplicate and how long ago", () => {
		const result = describeScan({ ...base, alreadyPresent: true }, new Date("2026-07-25T10:12:00.000Z"));
		expect(result.state).toBe("duplicate");
		expect(result.detail).toBe("Already scanned 12 min ago by Maria Santos");
	});

	it("omits the scanner when it is unknown", () => {
		const result = describeScan(
			{ ...base, scannedByName: null, alreadyPresent: true },
			new Date("2026-07-25T10:00:30.000Z"),
		);
		expect(result.detail).toBe("Already scanned just now");
	});
});

describe("supportsTorch", () => {
	it("is false when the browser exposes no capabilities (iOS Safari)", () => {
		expect(supportsTorch(undefined)).toBe(false);
		expect(supportsTorch({} as MediaStreamTrack)).toBe(false);
	});

	it("is true only when the track advertises torch", () => {
		const withTorch = { getCapabilities: () => ({ torch: true }) } as unknown as MediaStreamTrack;
		const without = { getCapabilities: () => ({}) } as unknown as MediaStreamTrack;
		expect(supportsTorch(withTorch)).toBe(true);
		expect(supportsTorch(without)).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/scan-feedback.test.ts`
Expected: FAIL — cannot resolve `./scan-feedback`

- [ ] **Step 3: Write the helpers**

Create `src/lib/scan-feedback.ts`:

```ts
import { isCheckinToken } from "./checkin-token";
import { decodeMemberCode } from "./member-code";

export type ScanState = "idle" | "success" | "duplicate" | "invalid" | "error";

export type ScanClassification =
	| { kind: "member"; memberId: string }
	| { kind: "token"; token: string }
	| { kind: "invalid" };

export type ScanResponse = {
	eventId: string;
	memberId: string;
	memberName: string | null;
	memberImage: string | null;
	scannedAt: Date;
	scannedByName: string | null;
	alreadyPresent: boolean;
};

export type ScanDescription = { state: ScanState; title: string; detail: string };

/** Decides what a decoded QR is before any network call, so bad QRs fail instantly. */
export function classifyScan(raw: string): ScanClassification {
	const value = raw.trim();
	if (isCheckinToken(value)) return { kind: "token", token: value };
	const memberId = decodeMemberCode(value);
	if (memberId) return { kind: "member", memberId };
	return { kind: "invalid" };
}

function agoLabel(from: Date, now: Date): string {
	const minutes = Math.floor((now.getTime() - from.getTime()) / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	return hours < 24 ? `${hours} hr ago` : `${Math.floor(hours / 24)} d ago`;
}

export function describeScan(response: ScanResponse, now: Date): ScanDescription {
	const title = response.memberName ?? response.memberId;
	if (!response.alreadyPresent) return { state: "success", title, detail: "Marked present" };
	const when = agoLabel(response.scannedAt, now);
	const by = response.scannedByName ? ` by ${response.scannedByName}` : "";
	return { state: "duplicate", title, detail: `Already scanned ${when}${by}` };
}

/**
 * iOS Safari never advertises torch through getUserMedia, so the control must be
 * capability-gated rather than feature-detected on the browser.
 */
export function supportsTorch(track: MediaStreamTrack | undefined): boolean {
	const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
	return capabilities?.torch === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/scan-feedback.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Extend the camera scanner with torch and facing mode**

Rewrite `src/components/camera-scanner.tsx`, keeping the existing detector/jsQR loop and the 2500ms debounce exactly as they are, and adding:

- Props: `{ onCode, facingMode, className, children }` where `children` renders over the video.
- A `trackRef` holding `stream.getVideoTracks()[0]`.
- `const [torchOn, setTorchOn] = useState(false)` plus `const [torchAvailable, setTorchAvailable] = useState(false)`, set from `supportsTorch(trackRef.current)` once the stream starts.
- A `toggleTorch` callback:
```tsx
	async function toggleTorch() {
		const track = trackRef.current;
		if (!track) return;
		const next = !torchOn;
		try {
			await track.applyConstraints({ advanced: [{ torch: next }] } as MediaTrackConstraints);
			setTorchOn(next);
		} catch {
			setTorchAvailable(false);
		}
	}
```
- Expose `{ torchAvailable, torchOn, toggleTorch }` to the parent via an `onControls` callback prop so the overlay can render the buttons where it wants.
- Add `facingMode` to the `getUserMedia` constraints instead of the hardcoded `"environment"`, and include it in the effect's dependency array so flipping restarts the stream.
- Add an `inFlightRef` guard: skip `onCodeRef.current(code)` while a previous scan is still being processed. The parent signals completion by the `onCode` promise resolving — type `onCode` as `(code: string) => void | Promise<void>` and `await` it.

Keep the existing `canUseCameraScanner()` early return and its copy.

- [ ] **Step 6: Build the overlay**

Create `src/components/event-scan-overlay.tsx` — a client component rendering a fixed, full-viewport layer:

- Container: `fixed inset-0 z-50 flex flex-col bg-black text-white` with `style={{ height: "100dvh" }}` and `overscroll-none`.
- Top bar: close button (calls `onClose`), torch toggle **rendered only when `torchAvailable`**, and a flip-camera button toggling `facingMode` between `"environment"` and `"user"`. Pad with `env(safe-area-inset-top)`.
- Middle: `<CameraScanner>` filling the space, with a centred reticle (`absolute inset-x-12 top-1/2 aspect-square -translate-y-1/2 rounded-2xl border-2 border-white/70`).
- Bottom: the result banner built from `describeScan`, colour-keyed per state (`success` green, `duplicate` amber, `invalid` red, `error` red), showing `memberImage` in a 40px rounded avatar when present. On `success`, render an **Undo** button when `canUndo` is true. Pad with `env(safe-area-inset-bottom)`.
- A `Scanned {count}` pill and a button opening a scan-log sheet listing recent results.

Scan handling:
```tsx
	async function handleCode(raw: string) {
		const classified = classifyScan(raw);
		if (classified.kind === "invalid") {
			setResult({ state: "invalid", title: "Not a CODE member QR code", detail: "Ask them to open their member code." });
			play("invalid");
			return;
		}
		const body = classified.kind === "member" ? { memberId: classified.memberId } : { token: classified.token };
		const response = await fetch(`/api/events/${eventId}/scan`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...body, termId }),
		});
		if (!response.ok) {
			const error = (await response.json().catch(() => null)) as { error?: string } | null;
			setResult({ state: "error", title: "Scan failed", detail: error?.error ?? "Use the search instead." });
			play("invalid");
			return;
		}
		const raw2 = (await response.json()) as Omit<ScanResponse, "scannedAt"> & { scannedAt: string };
		const parsed: ScanResponse = { ...raw2, scannedAt: new Date(raw2.scannedAt) };
		const described = describeScan(parsed, new Date());
		setResult(described);
		setLastMemberId(parsed.memberId);
		if (!parsed.alreadyPresent) setCount((value) => value + 1);
		setLog((entries) => [{ ...described, at: new Date() }, ...entries].slice(0, 50));
		play(described.state === "success" ? "success" : "duplicate");
	}
```

Undo:
```tsx
	async function undoLast() {
		if (!lastMemberId) return;
		const response = await fetch(`/api/events/${eventId}/scan`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ memberId: lastMemberId }),
		});
		if (!response.ok) return;
		setCount((value) => Math.max(0, value - 1));
		setResult({ state: "idle", title: "", detail: "" });
		setLastMemberId(null);
	}
```

Feedback, defined inside the same file (no asset files, no dependency):
```tsx
	// ponytail: three oscillator blips beat shipping and decoding audio assets.
	const audioRef = useRef<AudioContext | null>(null);
	function play(kind: "success" | "duplicate" | "invalid") {
		if (typeof window === "undefined") return;
		navigator.vibrate?.(kind === "success" ? 60 : [40, 60, 40]);
		try {
			// Created on the first gesture — browsers block AudioContext before that.
			const context = (audioRef.current ??= new AudioContext());
			const tones = { success: [880], duplicate: [520, 520], invalid: [180] }[kind];
			tones.forEach((frequency, index) => {
				const oscillator = context.createOscillator();
				const gain = context.createGain();
				oscillator.frequency.value = frequency;
				gain.gain.value = 0.08;
				oscillator.connect(gain).connect(context.destination);
				const start = context.currentTime + index * 0.18;
				oscillator.start(start);
				oscillator.stop(start + 0.12);
			});
		} catch {
			// Audio is a nicety; vibration and the banner already reported the result.
		}
	}
```

- [ ] **Step 7: Launch the overlay from the panel**

In `src/components/event-scan-panel.tsx`:
- Accept a new `canUndo: boolean` prop (the caller passes whether the actor is owner/admin/moderator).
- Replace the inline `<CameraScanner>` with a primary "Scan attendance" button that sets `overlayOpen`.
- Render `{overlayOpen ? <EventScanOverlay eventId={eventId} termId={termId} canUndo={canUndo} onClose={() => setOverlayOpen(false)} /> : null}`.
- Keep the manual code form, the member search, and the recent-scan log exactly as they are — they are the fallback when the camera is unavailable.
- Replace the inline `decodeMemberCode` check in the old `onCode` handler with `classifyScan` so the panel and overlay agree on what counts as invalid.

In `src/app/portal/calendar/[eventId]/event-manage-panel.tsx`, pass `canUndo` using the same condition the page already uses for owner/admin capabilities (`myRole === "owner" || myRole === "admin" || canModerate`).

- [ ] **Step 8: Typecheck, lint, and test**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: all clean

- [ ] **Step 9: Verify manually on a phone**

Run `pnpm dev`, open the event page on an Android phone on the same network (camera access needs HTTPS or localhost — use `next dev --experimental-https` or a tunnel).
Expected: full-screen camera; torch button present on Android and **absent on iPhone**; scanning a member QR shows the green banner with the name; scanning the same badge again shows the amber banner with the original time and scanner; scanning any other QR shows the red invalid banner; Undo removes the scan and decrements the count.

- [ ] **Step 10: Commit**

```bash
git add src/lib/scan-feedback.ts src/lib/scan-feedback.test.ts src/components/
git commit -m "feat(events): full-screen mobile scanner with torch, feedback, and undo"
```

---

## Deployment (product owner runs these)

Per `CLAUDE.md`, this changes schema and permissions, so the dev Worker path must be updated after Task 8. Show and confirm before running:

```bash
pnpm exec wrangler d1 migrations list DB --env dev --remote   # read-only, confirms 0009/0010 state
pnpm db:migrate:dev
pnpm deploy:dev
```

Wrangler cannot authenticate non-interactively, so these run in a normal terminal.

## Self-Review Notes

Checked against the spec:

- Spec §1 → Task 1. §2 → Task 3. §3 → Task 4. §4 → Task 8. §5 → Task 7. §6 → Tasks 2, 5, 6. §7 is explicitly deferred. §8 build order is followed exactly. §9 → the Deployment section.
- Type consistency verified: `RecordScanResult` (Task 3) matches the contract `scan` output (Task 3) and `ScanResponse` (Task 8); `EventTypeRule` (Task 5) is what Tasks 6 and 7 import; `deriveEnd`/`toLocalInput` (Task 7) are used with the same signatures in the create sheet.
- Two spots deliberately say "read the file first and match its existing names" rather than quoting code: Task 7 Step 7 (`calendar/page.tsx`) and Step 8 (`event-manage-panel.tsx`, 651 lines). Those files were not read in full during planning, so quoting their internals would be invention. Both steps state exactly what to change and what to leave alone.

---

## Post-implementation follow-ups

All 8 tasks shipped. Final whole-branch review triaged every deferred finding as
non-blocking; the list below is the punch list, ordered by value.

**Recommended next:**

1. **`termId` is client-supplied on `POST /api/events/[id]/scan`.** The server-action path
   (`calendar/[eventId]/actions.ts`) deliberately resolves the term server-side "so the client
   can't set it"; the REST route takes it from the request body. An actor who can already scan can
   direct attendance points into any real term they name, including a closed past one. The FK
   rejects non-existent terms, so this cannot fabricate data — but it can misfile points.
   Pre-existing, not introduced by this work, and now the primary scanning path. Closing it means
   moving term resolution behind the API so both paths agree.
2. **`retention.recordEventAttendance` also writes `source='event_attendance'`.** `undoScan`
   deletes by `(eventId, memberId, source)`, so if that method ever gains a production caller,
   undo could delete a points row it did not create. Currently unreachable — no production caller.
3. **`surveys.ts` calls `db.batch(...)` directly**, bypassing `runAtomic` and therefore the
   local-sqlite transactional fix from Task 3.

**Cosmetic / debt:**

- Editing a legacy event with `NULL ends_at` surfaces a raw ZodError blob; resolved by the
  deferred `ends_at NOT NULL` backfill.
- The create sheet's `catch` renders `e.message`, which is raw JSON for a `ZodError`.
- `runAtomic`'s local path calls `.run()` on each builder, so a future call site adding
  `.returning()` or a select-shaped builder throws at runtime. Worth one comment line.
- No `deriveEnd` test across a DST transition or a year boundary (same code path as the
  covered month-boundary case).
- `event-manage-panel.tsx` keeps its own `toLocalInput` duplicating `date-slots.ts`.
- A failed undo replaces the success banner, so the retry affordance is lost until the next scan.
- `[eventId]/page.tsx` reads `eventTypeRules.list()` on every event-detail view, including for
  non-staff viewers who never render the manage panel.

**Verification still outstanding (needs hardware/browser, could not be automated):**

- The full-screen scanner on a real phone: torch present on Android, absent on iPhone; success /
  already-scanned / invalid-QR banners; undo.
- The booking-style date picker end-to-end in a browser.
- The admin Event Type Rules screen click-through.
