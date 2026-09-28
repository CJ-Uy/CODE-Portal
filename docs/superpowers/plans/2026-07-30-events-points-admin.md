# Events & Points Admin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin Events & Points console able to answer who attended what, who was late, and who scanned them — while demoting retention from a special cross-cutting flag to an ordinary permanent point type.

**Architecture:** Two migrations straddle the code deploy: `0014` is additive and safe before it, `0015` drops a column and is safe only after. Attendance status is derived at read time by one pure function, never stored. A new read-only repository, `attendance-reports.ts`, replaces the current whole-term client-side data dump with bounded, server-filtered queries. The single admin page splits into six sibling routes.

**Tech Stack:** Next.js App Router (server components + object-valued server actions validated by Zod), Drizzle ORM on Cloudflare D1, Tailwind CSS v4, shadcn-style local primitives, Vitest in the Cloudflare Workers pool.

**Spec:** `docs/superpowers/specs/2026-07-30-events-points-admin-design.md` (revision 2). Read it first. Where this plan and the spec disagree, the spec wins — report the conflict rather than guessing.

**Revision 2 of this plan.** Incorporates a bounded Codex review (14 findings, 2 critical). See "Review log" at the end for what changed and why.

## Global Constraints

- `src/db/schema.ts` is the only schema source. Never write SQL DDL without a matching Drizzle field change, and never leave a Drizzle field declaring a column that no longer exists.
- Do not expose D1 as `DATABASE_URL`. Do not add raw SQL internal endpoints.
- All tests run in the Vitest Workers pool: `.ts` only, no jsdom, no render tests, no `better-sqlite3` import. Setup applies migrations via `applyD1Migrations` (`src/test/setup-d1.ts`).
- Migrations live in `drizzle/migrations/`, sequential, statements separated by `--> statement-breakpoint`. The local runner reads the migrations **directory**, not Drizzle's journal.
- **Show the exact `pnpm exec wrangler` command and get approval before any D1 reset, migration, seed, delete, or production-touching operation.** No exceptions, including migration applies.
- Never append `Co-Authored-By` or AI attribution trailers to commits in this repo.
- Interface copy: plain and specific. No em dashes, no promotional filler.
- User-controlled strings render with `min-w-0` + `break-all`. `break-words` does not work here.
- Brand palette only in admin tables. No emerald/amber/red. `--destructive` is near-black.
- Import `RETENTION_POINT_TYPE_ID` and `DEFAULT_GRACE_MINUTES`; never retype the literals.
- **Valid actor roles are `super`, `member`, `events`, `link`, `retention`, `member_admin`, `publishing`** (`src/server/auth/permissions.ts:53`). There is no `super_admin`. `can()` does `rolePermissions[role].includes(...)`, so an invalid role key throws a TypeError rather than returning false. Never cast a role array with `as Actor` to bypass this.
- Every task ends green: `pnpm typecheck && pnpm lint && pnpm vitest run` all pass before the commit. If a change cannot be green alone, it belongs in the same task as the change that makes it green.

---

## Existing test fixtures — use these, do not invent

Three test files are extended by this plan. Their real helpers:

**`src/db/repositories/events.integration.test.ts`**
- `makeRepos()` — **synchronous**, returns `{ db, repo }`
- `makeApprovedEvent(actor = owner)` — async, returns the created event; use `event.id`
- Actors: `eventsAdmin` `["events"]`, `retentionAdmin` `["retention"]`, and `owner`, `adminStaff`, `scanner`, `outsider` all `["member"]`
- Constants: `START` (2026-07-10T10:00Z), `END`, `TERM_START`, `TERM_END`
- Event staff roles are assigned with `repo.addStaff(actor, eventId, memberId, role)`

**`src/db/repositories/retention.integration.test.ts`**
- `makeRepo()` — returns `{ db, repo }`
- `insertRecord({ id, memberId?, termId?, pointTypeId?, points, reason?, recordedAt? })`
- Actors: `retentionAdmin` (`mem_admin`, `["retention"]`), `plainMember` (`mem_a`, `["member"]`)
- The summary method is `getMemberTermSummary`, not `memberTermSummary`

**`src/db/repositories/pointTypes.integration.test.ts`**
- `db` and `repo` are shared at describe scope — there is no `makeRepo()`
- Actors: `retentionAdmin` (`mem_admin`, `["retention"]`), `plainMember` (`mem_plain`, `[]`)
- `beforeEach` already inserts members and seeds `pt_retention`

---

## File Structure

**Created:** `drizzle/migrations/0014_attendance_grace_and_audit_target.sql`, `drizzle/migrations/0015_drop_counts_toward_retention.sql`, `src/lib/point-types.ts`, `src/lib/attendance-status.ts` (+test), `src/db/repositories/attendance-reports.ts` (+test), `src/components/portal/attendance-status-cell.tsx`, and six routes under `src/app/portal/admin/data/` plus `src/app/portal/admin/members/[id]/page.tsx`.

**Modified:** `src/db/schema.ts`, `audit.ts`, `events.ts`, `retention.ts`, `overview.ts`, `pointTypes.ts`, `retention-unavailable.ts`, `seed/data.ts`, `scripts/verify-points-upsert-local.ts`, `admin/nav.ts`, `admin/data/page.tsx`, `portal/page.tsx`, `event-scan-panel.tsx`, `portal/events/page.tsx`, point-types admin UI, `calendar/actions.ts`, `calendar/[eventId]/actions.ts`, `create-event-sheet.tsx`, `event-manage-panel.tsx`, `profile/point-breakdown.ts`.

**Deleted:** `admin/data/events-points-dashboard.tsx`, `admin/data/retention/page.tsx`, `loadAttendance` in `admin/data/retention/data.ts` (keep `loadRetentionPickers`), `src/server/internal/events.ts:145-150`.

---

# Phase 1 — Foundations

### Task 1: Migration 0014 and schema fields

**Files:** Create `drizzle/migrations/0014_attendance_grace_and_audit_target.sql`; modify `src/db/schema.ts` (`crsEvents`, `auditLogs`).

**Interfaces:** Produces `crsEvents.graceMinutes: number | null`, `auditLogs.targetMemberId: string | null`.

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE `crs_events` ADD COLUMN `grace_minutes` integer;
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD COLUMN `target_member_id` text REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `audit_logs_target_member_created_idx` ON `audit_logs` (`target_member_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `audit_logs_action_created_idx` ON `audit_logs` (`action`, `created_at`);
--> statement-breakpoint
UPDATE `audit_logs`
SET `target_member_id` = substr(`detail`, 8)
WHERE `category` = 'event'
  AND `action` IN ('event:scan_attendance', 'event:undo_scan')
  AND `detail` LIKE 'member=%'
  AND EXISTS (SELECT 1 FROM `members` WHERE `members`.`id` = substr(`audit_logs`.`detail`, 8));
```

`ADD COLUMN ... REFERENCES` is legal here because the new column is nullable with no default. The `EXISTS` guard is load-bearing: members can be hard-deleted while their historical audit rows survive, and backfilling a dangling id into a foreign-key column would abort the whole migration. Unmatched historical rows stay `NULL`.

`substr` is 1-indexed and `member=` is 7 characters, so position 8 is the first character of the id.

- [ ] **Step 2: Add the Drizzle fields**

In `crsEvents`, after `capacity`:

```ts
		graceMinutes: integer("grace_minutes"),
```

In `auditLogs`, after `detail`:

```ts
		targetMemberId: text("target_member_id").references(() => members.id, { onDelete: "set null" }),
```

In the same table's index array:

```ts
		index("audit_logs_target_member_created_idx").on(table.targetMemberId, table.createdAt),
		index("audit_logs_action_created_idx").on(table.action, table.createdAt),
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm vitest run src/db/repositories/events.integration.test.ts`
Expected: PASS. The Workers pool applies `drizzle/migrations/` on every run, so a malformed `0014` fails here immediately.

- [ ] **Step 4: Commit**

```bash
git add drizzle/migrations/0014_attendance_grace_and_audit_target.sql src/db/schema.ts
git commit -m "feat(db): add event grace_minutes and audit target_member_id"
```

---

### Task 2: Shared constants

**Files:** Create `src/lib/point-types.ts`.

- [ ] **Step 1: Write the module**

```ts
/**
 * The Retention point type always exists and cannot be retired. It is an ordinary
 * point type in every other respect; retention progress is the sum of records carrying this id.
 */
export const RETENTION_POINT_TYPE_ID = "pt_retention";

/** Grace window applied when an event sets no explicit `graceMinutes`. */
export const DEFAULT_GRACE_MINUTES = 15;
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck` — Expected: PASS.

```bash
git add src/lib/point-types.ts
git commit -m "feat(lib): add retention point type and grace period constants"
```

---

### Task 3: Attendance status derivation

**Files:** Create `src/lib/attendance-status.ts`, `src/lib/attendance-status.test.ts`.

**Interfaces:** Consumes `DEFAULT_GRACE_MINUTES`. Produces `AttendanceStatus`, `attendanceStatus(scannedAt, startsAt, graceMinutes)`, `minutesLate(scannedAt, startsAt, graceMinutes)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { attendanceStatus, minutesLate } from "./attendance-status";

const START = new Date("2026-03-01T10:00:00.000Z");
const at = (minutes: number, ms = 0) => new Date(START.getTime() + minutes * 60_000 + ms);

describe("attendanceStatus", () => {
	it("treats a scan before the start as on time", () => {
		expect(attendanceStatus(at(-20), START, 15)).toBe("on_time");
	});
	it("treats a scan exactly at the end of the grace window as on time", () => {
		expect(attendanceStatus(at(15), START, 15)).toBe("on_time");
	});
	it("treats one millisecond past the grace window as late", () => {
		expect(attendanceStatus(at(15, 1), START, 15)).toBe("late");
	});
	it("falls back to the default grace when none is set", () => {
		expect(attendanceStatus(at(15), START, null)).toBe("on_time");
		expect(attendanceStatus(at(16), START, null)).toBe("late");
	});
	it("honours a zero grace window", () => {
		expect(attendanceStatus(at(0), START, 0)).toBe("on_time");
		expect(attendanceStatus(at(1), START, 0)).toBe("late");
	});
});

describe("minutesLate", () => {
	it("returns 0 when on time", () => {
		expect(minutesLate(at(15), START, 15)).toBe(0);
		expect(minutesLate(at(-30), START, 15)).toBe(0);
	});
	it("measures from the end of the grace window, not the start time", () => {
		expect(minutesLate(at(27), START, 15)).toBe(12);
	});
	it("floors partial minutes", () => {
		// 16 min 59 s past start, minus a 15 min grace, is 1 min 59 s over. Floors to 1.
		expect(minutesLate(at(16, 59_000), START, 15)).toBe(1);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/attendance-status.test.ts` — Expected: FAIL, cannot resolve module.

- [ ] **Step 3: Implement**

```ts
import { DEFAULT_GRACE_MINUTES } from "./point-types";

export type AttendanceStatus = "on_time" | "late";

const graceMs = (graceMinutes: number | null) => (graceMinutes ?? DEFAULT_GRACE_MINUTES) * 60_000;

/**
 * Derived at read time, never stored. Correcting an event's start time or grace window
 * retroactively fixes every status rather than requiring a backfill.
 */
export function attendanceStatus(scannedAt: Date, startsAt: Date, graceMinutes: number | null): AttendanceStatus {
	return scannedAt.getTime() > startsAt.getTime() + graceMs(graceMinutes) ? "late" : "on_time";
}

/**
 * Whole minutes past the end of the grace window; 0 when on time. Measured from the end of
 * the window, so "+1 min" means one minute past the point where lateness began.
 */
export function minutesLate(scannedAt: Date, startsAt: Date, graceMinutes: number | null): number {
	const over = scannedAt.getTime() - startsAt.getTime() - graceMs(graceMinutes);
	return over > 0 ? Math.floor(over / 60_000) : 0;
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `pnpm vitest run src/lib/attendance-status.test.ts` — Expected: PASS, 8 tests.

```bash
git add src/lib/attendance-status.ts src/lib/attendance-status.test.ts
git commit -m "feat(lib): derive attendance lateness from event grace window"
```

---

# Phase 2 — Audit layer

### Task 4: Record the scanned member on audit rows

**Files:** Modify `src/db/repositories/audit.ts` (`AuditRecordInput`, `auditInsertValues`); create/extend `src/db/repositories/audit.integration.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";

const admin: Actor = { memberId: "mem_admin", roles: ["retention"] };

describe("audit target member", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM members").run();
		for (const [id, email] of [["mem_admin", "admin@example.com"], ["mem_target", "target@example.com"]]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
				.bind(id, email, id, Date.now(), Date.now()).run();
		}
	});

	it("writes and queries target_member_id", async () => {
		const db = drizzle(env.DB, { schema });
		await createAuditRepository(db).record(admin, {
			action: "event:scan_attendance",
			targetType: "event",
			targetId: "evt_1",
			category: "event",
			detail: "member=mem_target",
			targetMemberId: "mem_target",
		});

		const rows = await db.select().from(auditLogs).where(eq(auditLogs.targetMemberId, "mem_target"));
		expect(rows).toHaveLength(1);
		expect(rows[0].action).toBe("event:scan_attendance");
	});
});
```

`roles: ["retention"]` is a real role key. Do not write `["super_admin"]` — it does not exist and would throw inside `can()`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/db/repositories/audit.integration.test.ts` — Expected: FAIL, `targetMemberId` not a known property.

- [ ] **Step 3: Add the field and map it**

In `AuditRecordInput`:

```ts
	/** The member the action was performed *on*, when there is one. Indexed; `detail` is not. */
	targetMemberId?: string | null;
```

In `auditInsertValues`, after `detail`:

```ts
		targetMemberId: input.targetMemberId ?? null,
```

- [ ] **Step 4: Run and commit**

Run: `pnpm vitest run src/db/repositories/audit.integration.test.ts` — Expected: PASS.

```bash
git add src/db/repositories/audit.ts src/db/repositories/audit.integration.test.ts
git commit -m "feat(audit): record the target member id on audit entries"
```

---

### Task 5: Make scan and undo audit entries atomic

**Files:** Modify `src/db/repositories/events.ts` (`recordScan`, `undoScan`); extend `src/db/repositories/events.integration.test.ts`.

`recordScan` and `undoScan` currently `await audit.record(...)` **after** `runAtomic(...)`. A failure between the two loses the audit row silently, and Phase 4's scan log reads exactly those rows. `auditInsertValues` exists so a repository can batch its own audit insert.

- [ ] **Step 1: Write the failing test**

Add inside the existing describe block, using the file's real fixtures:

```ts
it("writes the scan audit row with the scanned member id", async () => {
	const { db, repo } = makeRepos();
	const event = await makeApprovedEvent();
	await repo.addStaff(owner, event.id, scanner.memberId, "scanner");
	await repo.recordScan(scanner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });

	const rows = await db
		.select()
		.from(auditLogs)
		.where(and(eq(auditLogs.action, "event:scan_attendance"), eq(auditLogs.targetMemberId, "mem_a")));
	expect(rows).toHaveLength(1);
});
```

`makeRepos()` is synchronous and returns `{ db, repo }`. Add `auditLogs` to the `@/db/schema` import and `and` to the `drizzle-orm` import. Use whatever member id the file's `beforeEach` already seeds; `mem_a` is used here as the placeholder — confirm against the fixture and substitute the real one.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/db/repositories/events.integration.test.ts -t "scanned member id"` — Expected: FAIL, 0 rows.

- [ ] **Step 3: Move both audit writes into their batch**

Import `auditInsertValues` from `./audit` and `auditLogs` from `@/db/schema`. In `recordScan`, delete the trailing `await audit.record({...})` and append to the `runAtomic` array instead:

```ts
	db.insert(auditLogs).values(
		auditInsertValues(actor, {
			action: "event:scan_attendance",
			targetType: "event",
			targetId: input.eventId,
			category: "event",
			detail: `member=${input.memberId}`,
			targetMemberId: input.memberId,
		}),
	),
```

Do the same in `undoScan` with `action: "event:undo_scan"`.

**Do not disturb the duplicate-scan race handling.** The `try/catch` around `runAtomic` at `events.ts:615-621` re-reads the row and reports the winner's version when two scanners hit the same badge. The audit insert goes *inside* the same batch, so a losing race rolls back its audit row too — which is correct, since no scan was recorded.

- [ ] **Step 4: Run the full events suite and commit**

Run: `pnpm vitest run src/db/repositories/events.integration.test.ts` — Expected: PASS, including pre-existing scan and undo tests.

```bash
git add src/db/repositories/events.ts src/db/repositories/events.integration.test.ts
git commit -m "fix(events): write scan audit entries inside the atomic batch"
```

---

# Phase 3 — Retention de-specialization

> **Tasks 6, 7, and 8 form ONE commit boundary.** Do not commit until Task 8 Step 4.
> `portal/events/page.tsx` imports `PublicLeaderboardSelection` (`page.tsx:10`, used at `:46`) and
> carries a `countsTowardRetention` comment at `:44`. So Task 6 removing the union and Task 7's
> zero-hit gate both depend on Task 8's page rewrite. Splitting them produces two red commits.
> Work through all three, then commit once.

### Task 6: Retention and overview repositories

**Files:** Modify `src/db/repositories/retention.ts`, `overview.ts`, `retention-unavailable.ts`; extend `src/db/repositories/retention.integration.test.ts`.

**Interfaces:** Produces `publicLeaderboard(actor, { termId, pointTypeId, limit?, offset? })` — the `PublicLeaderboardSelection` union is gone.

- [ ] **Step 1: Rewrite the breaking tests first**

In `retention.integration.test.ts`: replace every `{ kind: "retention" }` with `{ pointTypeId: RETENTION_POINT_TYPE_ID }` and every `{ kind: "pointType", pointTypeId: X }` with `{ pointTypeId: X }`. **Delete** any test asserting two different point types both contribute to a retention total — that behaviour is being removed deliberately.

Add, using the file's real helpers (`makeRepo`, `insertRecord`, `retentionAdmin`, `getMemberTermSummary`) and the already-seeded `pt_frontliner`:

```ts
it("counts only the retention point type toward the retention total", async () => {
	const { repo } = makeRepo();
	await insertRecord({ id: "rec_ret", pointTypeId: RETENTION_POINT_TYPE_ID, points: 5 });
	await insertRecord({ id: "rec_other", pointTypeId: "pt_frontliner", points: 100 });

	const summary = await repo.getMemberTermSummary(retentionAdmin, {
		memberId: plainMember.memberId,
		termId: "term_1",
	});
	expect(summary.totalPoints).toBe(5);
});
```

Confirm the term id and default `memberId` that `insertRecord` uses and match them here rather than assuming.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/db/repositories/retention.integration.test.ts` — Expected: FAIL, total includes 100.

- [ ] **Step 3: Switch the predicates**

Import `RETENTION_POINT_TYPE_ID` in `retention.ts` and `overview.ts`. At `retention.ts:167`, `:202`, `:217`, `:373` and `overview.ts:59`, replace

```ts
eq(pointTypes.countsTowardRetention, true)
```

with

```ts
eq(retentionRecords.pointTypeId, RETENTION_POINT_TYPE_ID)
```

Where that predicate was the only reason for `innerJoin(pointTypes, ...)`, drop the join. At `:373` the row shape carries a `countsTowardRetention` boolean used in a `reduce`; replace with `row.pointTypeId === RETENTION_POINT_TYPE_ID`.

- [ ] **Step 4: Delete the selection union**

Remove `PublicLeaderboardSelection` and the `selection` field from `PublicLeaderboardInput`. `publicLeaderboard` takes `{ termId, pointTypeId, limit?, offset? }` and filters `eq(retentionRecords.pointTypeId, input.pointTypeId)`. Update `retention-unavailable.ts:11` so its throwing stub still matches the signature.

- [ ] **Step 5: Run the repository tests, then continue — do not commit**

Run: `pnpm vitest run src/db/repositories/retention.integration.test.ts src/db/repositories/overview.integration.test.ts` — Expected: PASS.

`pnpm typecheck` is expected to be RED here (`portal/events/page.tsx` still builds the removed union). That is why this task does not commit. Continue straight to Task 7.

---

### Task 7: Remove the flag end to end, in one commit

> **This task is deliberately large.** Splitting it produces commits that cannot typecheck: `PointTypeRow` is consumed by the manager UI and the input parser, so removing the field from the type and fixing its consumers must land together. Do not commit partway through.

**Files:** `src/db/schema.ts`, `src/db/repositories/pointTypes.ts`, `src/db/seed/data.ts`, `src/db/seed/data.test.ts`, `scripts/verify-points-upsert-local.ts`, `src/app/portal/admin/system/point-types/{actions.ts,input.ts,input.test.ts,point-types-manager.tsx}`, `src/app/portal/profile/point-breakdown.ts` + test, `src/app/portal/calendar/[eventId]/award-editor-input.test.ts`, `src/db/additive-points-schema.integration.test.ts`, `src/db/repositories/{pointTypes,events,overview}.integration.test.ts`.

- [ ] **Step 1: Write the failing permanence tests**

In `pointTypes.integration.test.ts`, using the file's shared `repo` and `retentionAdmin` (there is no `makeRepo()` here, and `beforeEach` already seeds `pt_retention`):

```ts
it("refuses to retire the retention point type", async () => {
	await expect(
		repo.upsertType(retentionAdmin, {
			id: RETENTION_POINT_TYPE_ID,
			key: "retention",
			label: "Retention",
			active: false,
			position: 0,
		}),
	).rejects.toThrow("The Retention point type cannot be retired.");
});

it("allows relabelling and reordering the retention point type", async () => {
	const row = await repo.upsertType(retentionAdmin, {
		id: RETENTION_POINT_TYPE_ID,
		key: "retention",
		label: "CRS Retention",
		active: true,
		position: 3,
	});
	expect(row.label).toBe("CRS Retention");
	expect(row.position).toBe(3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/db/repositories/pointTypes.integration.test.ts` — Expected: FAIL, no such error thrown.

- [ ] **Step 3: Remove the Drizzle field**

Delete `countsTowardRetention` from the `pointTypes` table in `src/db/schema.ts`. Leaving it would make Drizzle declare a column that `0015` removes.

- [ ] **Step 4: Update the repository**

Replace `LAST_RETENTION_TYPE_ERROR` with:

```ts
const RETENTION_RETIRE_ERROR = "The Retention point type cannot be retired.";
```

Remove `countsTowardRetention` from `PointTypeRow`, `PointTypeUpsertInput`, the `list()` select, and both write paths. Replace the entire `exists(...)` guard with a plain id match plus the retire check:

```ts
if (input.id === RETENTION_POINT_TYPE_ID && !input.active) {
	throw new Error(RETENTION_RETIRE_ERROR);
}
const updated = await db.update(pointTypes).set({
	label,
	active: input.active,
	position: input.position,
	updatedBy: actor.memberId,
	updatedAt: new Date(),
}).where(eq(pointTypes.id, input.id)).returning();
if (updated.length === 0) throw new Error("Point type not found.");
```

Drop the now-unused `exists` and `ne` imports. Key changes are already blocked at `pointTypes.ts:86` and there is no delete method, so this one guard completes "always there and permanent".

- [ ] **Step 5: Update the admin UI and parser**

`point-types-manager.tsx`: delete the create-form checkbox, the `Retention` badge, and the per-row checkbox. For the row where `row.id === RETENTION_POINT_TYPE_ID`, render a locked affordance instead of the active checkbox:

```tsx
{row.id === RETENTION_POINT_TYPE_ID ? (
	<>
		<input type="hidden" name="activeIds" value={row.id} />
		<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title="Retention always exists and cannot be retired.">
			<Lock className="size-3.5" aria-hidden />
			Always active
		</span>
	</>
) : (
	<input type="checkbox" name="activeIds" value={row.id} defaultChecked={row.active} className="size-4 accent-primary" />
)}
```

The hidden input matters: a disabled checkbox submits nothing, and the parser treats an absent id as "inactive", which would try to retire the row the repository now rejects.

`input.ts`: delete the `retentionIds` set, the `countsTowardRetention` field, the retention mapping, and the last-retention-type validator. Delete the matching cases in `input.test.ts`.

`actions.ts`: the retention-first ordering pass has nothing to order by. Replace the three lines with a single pass over `inputs` in given order.

- [ ] **Step 6: Update remaining callers and fixtures**

`point-breakdown.ts`: `retention: type.id === RETENTION_POINT_TYPE_ID`. Update its four test fixture sites to set an `id`.

Remove the flag from `seed/data.ts`, `seed/data.test.ts`, and `scripts/verify-points-upsert-local.ts`.

Remove `counts_toward_retention` from the raw-SQL fixtures in `pointTypes.integration.test.ts`, `events.integration.test.ts` (including the nested `seedPointType` helper), `overview.integration.test.ts`, `award-editor-input.test.ts`, and `additive-points-schema.integration.test.ts`. Locate them by searching, not by line number — these files shift as you edit them.

- [ ] **Step 7: Run the completion gate**

```bash
rg -n "countsTowardRetention|counts_toward_retention" src scripts
```

Expected: **zero hits.** The search is scoped to `src` and `scripts` because an unscoped run always matches this plan and the spec. `drizzle/migrations/0013_additive_points_schema.sql` legitimately keeps the term as historical SQL and is outside those paths.

- [ ] **Step 8: Continue to Task 8 — do not commit**

The zero-hit gate in Step 7 will still match `portal/events/page.tsx:44`, and typecheck will still be red from Task 6. Both are fixed by Task 8. Go there now; Task 8 Step 4 commits all three tasks together.

---

### Task 8: Member-facing Points page

**Files:** Modify `src/app/portal/events/page.tsx`, `src/components/retention-history.tsx`.

- [ ] **Step 1: Replace the leaderboard selection logic**

Delete the `leaderboardSelection` block and its comment:

```tsx
const leaderboard =
	view === "leaderboard" && pointTypeLoad.ok && selectedTermId && selectedPointTypeId
		? await repositories.retention
				.publicLeaderboard(actor, { termId: selectedTermId, pointTypeId: selectedPointTypeId, limit: 25 })
				.catch(() => [])
		: [];
```

- [ ] **Step 2: Retitle**

`h1` from `Retention` to `Points`. Tabs from `My history` / `Leaderboard` to `My points` / `Leaderboard`.

- [ ] **Step 3: Apply the point-type filter to both tabs**

Move the filter `<form>` above the `view === "history"` conditional, binding its hidden `view` input to the current `view`. Pass `selectedPointTypeId` into `RetentionHistory` and filter the history list by it.

- [ ] **Step 4: Full green, then commit Tasks 6, 7, and 8 together**

Re-run the zero-hit gate from Task 7 Step 7 — the `:44` comment is gone now, so it must return zero:

```bash
rg -n "countsTowardRetention|counts_toward_retention" src scripts
```

Run: `pnpm vitest run && pnpm typecheck && pnpm lint` — Expected: all PASS. This is the first green point since Task 5.

```bash
git add -A src scripts
git commit -m "refactor: make retention an ordinary permanent point type

Drops counts_toward_retention from the schema, repositories, admin UI, seed
data, and every test fixture. Retention progress is now the sum of records
carrying pt_retention. The point type is guarded against retirement; key
changes and deletion were already impossible.

Renames the member-facing page from Retention to Points and applies the
point-type filter to both of its tabs."
```

---

# Phase 4 — Reporting repository

### Task 9: Event-shaped read models

**Files:** Create `src/db/repositories/attendance-reports.ts` and its integration test.

**Interfaces:** Produces `createAttendanceReports(db)` returning `{ termEventSummaries, eventRoster }`.

This module takes a `Db` from `getDb()` directly and is **not** registered in `createDrizzleRepositories` or `createSharedRepositories`, matching `admin/data/retention/data.ts`. `getDb()` throws in shared mode, so the admin section does not work there today and will not after this change — a documented pre-existing gap, not a regression.

- [ ] **Step 1: Write the failing test**

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { attendanceStatus } from "@/lib/attendance-status";
import { createAttendanceReports } from "./attendance-reports";

const admin: Actor = { memberId: "mem_admin", roles: ["retention"] };
const outsider: Actor = { memberId: "mem_out", roles: ["member"] };

const EVENT_START = new Date("2026-07-10T10:00:00.000Z");

/**
 * One event starting 10:00 with a 15 minute grace. mem_ontime scans 10:10,
 * mem_late scans 10:30, mem_absent RSVPs going and never scans.
 */
async function seedFixture() {
	// Insert term_1, evt_1 (grace_minutes 15, status approved), three members,
	// two crs_attendance rows, one event_rsvps row with state 'going'.
	// Use env.DB.prepare(...).bind(...).run() throughout, matching the raw-SQL
	// fixture style already used in pointTypes.integration.test.ts.
}

describe("attendance reports", () => {
	beforeEach(async () => {
		for (const table of ["crs_attendance", "event_rsvps", "retention_records", "crs_events", "terms", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await seedFixture();
	});

	it("refuses an actor without retention:record", async () => {
		const reports = createAttendanceReports(drizzle(env.DB, { schema }));
		await expect(reports.termEventSummaries(outsider, "term_1")).rejects.toThrow("Not authorized");
	});

	it("counts late and absent against the event grace window", async () => {
		const reports = createAttendanceReports(drizzle(env.DB, { schema }));
		const [summary] = await reports.termEventSummaries(admin, "term_1");
		expect(summary.attendedCount).toBe(2);
		expect(summary.lateCount).toBe(1);
		expect(summary.absentCount).toBe(1);
	});

	it("agrees with the shared status function on every roster row", async () => {
		const reports = createAttendanceReports(drizzle(env.DB, { schema }));
		const roster = await reports.eventRoster(admin, "evt_1");
		expect(roster.length).toBeGreaterThan(0);
		const lateFromTs = roster.filter(
			(row) => row.scannedAt && attendanceStatus(row.scannedAt, row.startsAt, row.graceMinutes) === "late",
		).length;
		const [summary] = await reports.termEventSummaries(admin, "term_1");
		expect(lateFromTs).toBe(summary.lateCount);
		expect(lateFromTs).toBe(1);
	});
});
```

Write `seedFixture` out in full — the comment above is the specification, not the implementation. The third test asserts `toBe(1)` as well as agreement, so it cannot pass vacuously on an empty roster.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/db/repositories/attendance-reports.integration.test.ts` — Expected: FAIL, cannot resolve module.

- [ ] **Step 3: Implement**

```ts
import { and, eq, sql } from "drizzle-orm";
import { crsAttendance, crsEvents, eventRsvps, members, retentionRecords } from "@/db/schema";
import { DEFAULT_GRACE_MINUTES } from "@/lib/point-types";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const requireReporting = (actor: Actor) => {
	if (!can(actor, "retention:record")) throw new Error("Not authorized to read attendance reports.");
};

export const clampLimit = (limit: number) => Math.min(Math.max(1, Math.floor(limit)), 200);

/**
 * SQL mirror of `attendanceStatus`. Aggregate counts cannot call the TS function, so the
 * comparison is duplicated here — narrowly, and covered by a test asserting the two agree.
 * Both columns are `timestamp_ms`, so the arithmetic is plain integer milliseconds.
 */
const lateExpr = sql`${crsAttendance.scannedAt} > ${crsEvents.startsAt} + coalesce(${crsEvents.graceMinutes}, ${DEFAULT_GRACE_MINUTES}) * 60000`;

export function createAttendanceReports(db: Db) {
	return {
		async termEventSummaries(actor: Actor, termId: string) {
			requireReporting(actor);
			/* group by event; attendedCount = count(attendance), lateCount = sum(case when lateExpr
			   then 1 else 0 end), absentCount = correlated count of event_rsvps state 'going' with no
			   attendance row, pointsIssued = sum of retention_records points for the event. Scope to
			   events inside the term window with deletedAt is null. */
		},
		async eventRoster(actor: Actor, eventId: string) {
			requireReporting(actor);
			/* left join crs_attendance and event_rsvps to members for one event. Return startsAt and
			   graceMinutes on every row so the caller derives status with the TS function. Alias
			   members a second time on crs_attendance.scannedBy for scannedById/scannedByName,
			   following the `scannerMember` alias pattern at events.ts:183. */
		},
	};
}
```

Fill both bodies. The comments are the specification.

- [ ] **Step 4: Run and commit**

Run: `pnpm vitest run src/db/repositories/attendance-reports.integration.test.ts` — Expected: PASS, 3 tests.

```bash
git add src/db/repositories/attendance-reports.ts src/db/repositories/attendance-reports.integration.test.ts
git commit -m "feat(reports): add bounded event attendance read models"
```

---

### Task 10: Member read models, scan log, and bounded ledgers

**Files:** Modify `src/db/repositories/attendance-reports.ts` and its test.

**Interfaces:** Produces `termMemberSummaries(actor, termId, { q?, limit, offset })`, `memberAttendance(actor, memberId, termId)`, `scanLog(actor, termId, { eventId?, scannerId?, memberId?, from?, to?, limit, offset })`. Also **extends** `retention.listForTerm` and `retention.listMemberTermHistory` with optional `{ q?, limit?, offset? }`.

**The ledger stays in `retention.ts`.** `listForTerm` (`retention.ts:290`) and `listMemberTermHistory` (`:304`) already return the exact row model the ledger routes need and already share `reportBaseColumns` (`:107`). They lack only search and bounds. Adding `termLedger`/`memberLedger` to `attendance-reports.ts` would duplicate two working queries to bolt on two arguments. Extend the existing methods instead; leave their current call sites working by making every new argument optional.

`scanLog` reads `auditLogs` directly, **not** `audit.list`. `audit.list` gates on `hasAnyAdminScope`, broader than `retention:record`; routing through it would widen who can read attendance history.

- [ ] **Step 1: Write the failing tests**

```ts
it("caps limit at 200 however large the request", async () => {
	await seedManyMembers(250);
	const reports = createAttendanceReports(drizzle(env.DB, { schema }));
	const rows = await reports.termMemberSummaries(admin, "term_1", { limit: 5000, offset: 0 });
	expect(rows).toHaveLength(200);
});

it("filters members by name or email", async () => {
	const reports = createAttendanceReports(drizzle(env.DB, { schema }));
	const rows = await reports.termMemberSummaries(admin, "term_1", { q: "late", limit: 50, offset: 0 });
	expect(rows).toHaveLength(1);
	expect(rows[0].memberId).toBe("mem_late");
});

it("keeps an undone scan visible in the scan log", async () => {
	await seedUndo({ eventId: "evt_1", memberId: "mem_late", actorMemberId: "mem_admin" });
	const reports = createAttendanceReports(drizzle(env.DB, { schema }));
	const rows = await reports.scanLog(admin, "term_1", { limit: 50, offset: 0 });
	expect(rows.some((row) => row.action === "event:undo_scan" && row.memberId === "mem_late")).toBe(true);
});

This one goes in `retention.integration.test.ts`, not the reports test, since it covers an extended existing method. Seed **two records sharing one `recordedAt`** — `createManual` deliberately stamps every row in a batch with the same timestamp (`retention.ts:257`, `:268`), so ties are the normal case, not an edge case:

```ts
it("paginates the term ledger deterministically across tied timestamps", async () => {
	const { repo } = makeRepo();
	const at = Date.now();
	await insertRecord({ id: "rec_1", points: 1, recordedAt: at });
	await insertRecord({ id: "rec_2", points: 2, recordedAt: at });

	const page1 = await repo.listForTerm(retentionAdmin, "term_1", { limit: 1, offset: 0 });
	const page2 = await repo.listForTerm(retentionAdmin, "term_1", { limit: 1, offset: 1 });
	expect(page1).toHaveLength(1);
	expect(page2).toHaveLength(1);
	expect(page1[0].recordId).not.toBe(page2[0].recordId);
});
```

Match `listForTerm`'s real signature. Without a tiebreaker this test fails intermittently, which is the point.
```

Both new helpers must be written out in full:

- `seedManyMembers(n)` — inserts `n` members and one `crs_attendance` row each against `evt_1`, so `termMemberSummaries` actually returns them.
- `seedUndo({ eventId, memberId, actorMemberId })` — deletes the `crs_attendance` row and inserts an `audit_logs` row with `action: 'event:undo_scan'`, matching `category`, `targetId`, and `targetMemberId`, reproducing what `undoScan` does after Task 5.

The cap test asserts exactly 200 and the search test asserts exactly one row with a known id. Asserting only `<= 200` or using a bare `every(...)` would pass on zero rows.

The ledger pagination test needs at least two records in `term_1`; extend `seedFixture` to insert them if it does not already.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/db/repositories/attendance-reports.integration.test.ts` — Expected: FAIL, functions do not exist.

- [ ] **Step 3: Implement all five**

`termMemberSummaries` groups attendance across the term's events, counting rows and `lateExpr` rows, left-joining `retention_records` grouped by point type for `pointsByType`. `q` matches `members.fullName`, `members.name`, `members.email` with `like` and `lower(...)` on both sides. Applies `clampLimit`.

`memberAttendance` returns one row per term event the member attended or RSVP'd `going` to, carrying `startsAt`, `graceMinutes`, `scannedAt | null`, `rsvpState`, `pointsEarned`.

`scanLog` selects from `auditLogs` where `category = 'event'` and `action in ('event:scan_attendance','event:undo_scan')`; joins `members` on `targetMemberId`, `members` again via alias on `actorMemberId`, and `crsEvents` on `targetId`; scopes to the term window by `crsEvents.startsAt`; applies `from`/`to` against `auditLogs.createdAt` (`to` exclusive); applies `clampLimit`.

**Order by `createdAt desc, id desc`.** Offset pagination over a non-unique sort key is unstable — tied rows can repeat on one page and vanish from the next. Audit rows written in the same batch share a timestamp, so this is routine here.

Then extend the two existing retention methods in `retention.ts`:

- `listForTerm(actor, termId, opts?)` and `listMemberTermHistory(actor, ...)` gain optional `{ q?, limit?, offset? }`. Defaults preserve today's behaviour so existing callers are untouched.
- `q` matches member name, email, event title, and reason.
- Both order by **`recordedAt desc, id desc`** for the same stability reason. `createManual` stamps a whole batch with one `recordedAt` (`retention.ts:257`, `:268`), so ties are guaranteed, not hypothetical.
- Both clamp `limit` to 200.

- [ ] **Step 4: Run and commit**

Run: `pnpm vitest run src/db/repositories/attendance-reports.integration.test.ts` — Expected: PASS, 7 tests.

```bash
git add src/db/repositories/attendance-reports.ts src/db/repositories/attendance-reports.integration.test.ts
git commit -m "feat(reports): add member summaries, scan log, and bounded ledgers"
```

---

# Phase 5 — Admin interface

### Task 11: Attendance status cell

**Files:** Create `src/components/portal/attendance-status-cell.tsx`.

On time renders nothing — badging the majority case builds a wall of badges carrying no information. The palette has no red/amber/green, so status is encoded by weight and a literal number instead of hue.

- [ ] **Step 1: Write the component**

```tsx
import { Badge } from "@/components/ui/badge";
import { attendanceStatus, minutesLate } from "@/lib/attendance-status";

export function AttendanceStatusCell({
	scannedAt,
	startsAt,
	graceMinutes,
}: {
	scannedAt: Date | null;
	startsAt: Date;
	graceMinutes: number | null;
}) {
	if (!scannedAt) return <span className="text-xs text-muted-foreground">Absent</span>;
	// On time is the majority case and carries no exception. A badge here would add noise
	// to every row without adding information.
	if (attendanceStatus(scannedAt, startsAt, graceMinutes) === "on_time") return null;
	return (
		<Badge variant="warn" className="tabular-nums">
			+{minutesLate(scannedAt, startsAt, graceMinutes)} min
		</Badge>
	);
}
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint` — Expected: PASS. No render test: the Workers pool cannot render components, and the logic is covered by Task 3.

```bash
git add src/components/portal/attendance-status-cell.tsx
git commit -m "feat(portal): add exception-first attendance status cell"
```

---

### Task 12: Grace period, end to end

**Files:** `src/db/repositories/events.ts` (`CreateEventInput`, `UpdateEventInput`, create/update write maps), `src/app/portal/calendar/actions.ts`, `src/app/portal/calendar/[eventId]/actions.ts`, `src/app/portal/calendar/create-event-sheet.tsx`, `src/app/portal/calendar/[eventId]/event-manage-panel.tsx`.

> **These forms do not submit `FormData`.** `createEventAction(input: z.input<typeof createSchema>)` is an object-valued server action validated by Zod (`calendar/actions.ts:24`). Every layer below must carry `graceMinutes` or the input renders but never persists.

- [ ] **Step 1: Extend the Zod schemas**

In `calendar/actions.ts`, add to `createSchema`:

```ts
		graceMinutes: z.number().int().min(0).max(240).nullable().default(null),
```

Add the same field to the update schema in `calendar/[eventId]/actions.ts`.

- [ ] **Step 2: Extend the repository types and writes**

Add to `CreateEventInput` as **optional**, and to the `Partial<{...}>` in `UpdateEventInput`:

```ts
	graceMinutes?: number | null;   // CreateEventInput
	graceMinutes: number | null;    // inside UpdateEventInput's Partial<{}>
```

Optional is load-bearing. `create` has callers that will never pass it — `events.integration.test.ts:100` and `:640`, and `api/events/route.ts:36`, which forwards output from a contract schema (`contract/events.ts:67`) that has no such field. Making it required breaks all three and Task 12 cannot typecheck.

Map it in `create`'s insert with an explicit default, and in `update`'s write map (`events.ts:317`):

```ts
	graceMinutes: input.graceMinutes ?? null,
```

Without the map entries the parsed value is silently dropped.

- [ ] **Step 2b: Prove persistence with a repository test**

Add to `events.integration.test.ts`:

```ts
it("persists grace minutes through create and update", async () => {
	const { db, repo } = makeRepos();
	const event = await repo.create(owner, {
		title: "Graced", type: "casual", place: "SOM 111", description: "d",
		startsAt: START, endsAt: END, capacity: null, graceMinutes: 20,
	});
	const [created] = await db.select().from(crsEvents).where(eq(crsEvents.id, event.id));
	expect(created.graceMinutes).toBe(20);

	await repo.update(owner, event.id, { graceMinutes: null });
	const [updated] = await db.select().from(crsEvents).where(eq(crsEvents.id, event.id));
	expect(updated.graceMinutes).toBeNull();
});
```

Match `repo.update`'s real signature rather than assuming the one shown. A green typecheck does not prove persistence — a dropped optional field typechecks fine.

- [ ] **Step 3: Add the inputs**

In both components, add a controlled number field bound to the component's existing state object, submitting `graceMinutes` as `number | null` — an empty field sends `null`, not `""`:

```tsx
<label className="grid gap-1.5 text-sm">
	<span className="font-medium">Grace period (minutes)</span>
	<Input
		type="number"
		min={0}
		max={240}
		placeholder="15"
		value={form.graceMinutes ?? ""}
		onChange={(e) => setForm({ ...form, graceMinutes: e.target.value === "" ? null : Number(e.target.value) })}
	/>
	<span className="text-xs text-muted-foreground">Members scanned after this many minutes are marked late. Blank uses 15.</span>
</label>
```

Match each component's actual state-management pattern rather than copying this verbatim.

- [ ] **Step 4: Verify end to end**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run` — Expected: all PASS.

Confirm by reading the code path that a value entered in the sheet reaches `crs_events.grace_minutes`: component state → action argument → Zod parse → `CreateEventInput` → insert map. A green typecheck alone does not prove this, because a dropped optional field typechecks fine.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/events.ts src/app/portal/calendar/
git commit -m "feat(events): let organizers set a per-event grace period"
```

---

### Task 13: Overview route

**Files:** Modify `src/app/portal/admin/data/page.tsx`.

- [ ] **Step 1: Replace the page body**

Keep the term selector and header actions. Replace `<EventsPointsDashboard/>` with the four-metric row, a **Needs attention** section (approved events ended with zero attendance; events with `event_point_awards` but zero scans; members below `terms.probationBelow` — each capped at 5 with a "see all" link), and the five most recent `scanLog` rows.

Subhead: `What needs your attention this term.`

- [ ] **Step 2: Apply the density rules**

Section labels use `text-sm font-semibold uppercase tracking-[0.08em]` in Source Sans, not `font-heading text-2xl`. Unna (`font-heading`) stays on the page `h1` only. Rows use `py-2.5`.

- [ ] **Step 3: Empty states**

If a Needs-attention list is empty, render one muted line saying so. Do not hide the section — its emptiness is the signal.

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint` — Expected: PASS.

```bash
git add src/app/portal/admin/data/page.tsx
git commit -m "feat(admin): replace the events dashboard with a needs-attention overview"
```

---

### Task 14: Events list and event roster

**Files:** Create `src/app/portal/admin/data/events/page.tsx` and `events/[id]/page.tsx`.

- [ ] **Step 1: Events list**

Subhead: `How each event turned out.` Columns: event, date, type, status, attended, late, absent, points issued, all `tabular-nums`. GET-form search filtering server-side. Title links to `./events/[id]`.

- [ ] **Step 2: Event roster**

Subhead: `Who attended, and who was late.` Header carries title, date, place, type, grace period, counts.

Attendee columns: member, scanned at, status (`<AttendanceStatusCell>`), scanned by, points from this event. Member cells use `min-w-0` + `break-all`.

Absent members go **below** the attendee table inside a native `<details>` labelled `Show N absent`. Not a modal.

- [ ] **Step 3: Teaching empty states**

Zero scans, no scanner assigned: say so and link to `/portal/calendar/[id]` to assign one. Zero scans with a scanner assigned: state that check-in opens 30 minutes before the start, and give the time.

- [ ] **Step 4: Guard both routes**

```ts
const actor = await requireActor();
if (!can(actor, "retention:record")) notFound();
```

before any query.

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm lint` — Expected: PASS.

```bash
git add src/app/portal/admin/data/events/
git commit -m "feat(admin): add the events list and event roster routes"
```

---

### Task 15: Members, scan log, and ledger routes

**Files:** Create `src/app/portal/admin/data/{members,scans,ledger}/page.tsx`.

**Interfaces:** Consumes `termMemberSummaries` and `scanLog` from Task 10, and the extended `retention.listForTerm(actor, termId, { q?, limit?, offset? })`.

- [ ] **Step 1: Members list**

Subhead: `Who is participating, and who is short.` Columns: member, events attended, late count, points by type, total. Server-side search, paginated at 50, rows link to `/portal/admin/members/[id]`.

- [ ] **Step 2: Scan log**

Subhead: `What happened at the door, and who did it.` Columns: time, member, event, action, status, actor. Filters for event, scanner, member, and date range, passed to `scanLog`'s `from`/`to`.

Rows with `action === "event:undo_scan"` render struck-through with the reversing actor named, so a scan and its reversal read as one story rather than an absence.

- [ ] **Step 3: Ledger**

Subhead: `Where every point came from.` Consumes the extended `retention.listForTerm` with `q`, `limit`, and `offset` — server-side search and pagination, replacing the old client-side `.filter()`.

- [ ] **Step 4: Validate every search param**

The scans route needs every filter Step 2 promises, or they cannot be passed at all:

```ts
const scansQuerySchema = z
	.object({
		page: z.coerce.number().int().min(1).max(10_000).catch(1),
		eventId: z.string().max(60).optional(),
		scannerId: z.string().max(60).optional(),
		memberId: z.string().max(60).optional(),
		from: z.coerce.date().optional(),
		to: z.coerce.date().optional(),
	})
	.refine((v) => !v.from || !v.to || v.from <= v.to, { path: ["to"], message: "End date must not precede the start." });
```

A bare `<input type="date">` yields midnight, so an inclusive-looking `to` would silently exclude that whole day. Treat `to` as **exclusive** and add one day before passing it to `scanLog`.

Members and ledger routes use the simpler shape:

```ts
const listQuerySchema = z.object({
	q: z.string().trim().max(100).optional(),
	page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
```

Never pass an unvalidated param into a query.

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm lint` — Expected: PASS.

```bash
git add src/app/portal/admin/data/members/ src/app/portal/admin/data/scans/ src/app/portal/admin/data/ledger/
git commit -m "feat(admin): add members, scan log, and ledger routes"
```

---

### Task 16: Register navigation, delete the old dashboard

**Files:** Modify `src/app/portal/admin/nav.ts`, `nav.test.ts`; delete `events-points-dashboard.tsx`, `data/retention/page.tsx`, `loadAttendance`.

- [ ] **Step 1: Update the existing nav test, then extend it**

`nav.test.ts` already asserts the `data` group's page list. Adding pages breaks that assertion, so **update it in the same step** rather than only appending a new test:

```ts
it("lists the events and points pages in order", () => {
	const group = adminGroups.find((g) => g.segment === "data");
	expect(group?.pages.map((page) => page.segment)).toEqual([
		"dashboard", "events", "members", "scans", "ledger", "event-types", "point-types", "exports",
	]);
});

it("gates the new events and points pages on retention:record", () => {
	const group = adminGroups.find((g) => g.segment === "data");
	for (const segment of ["events", "members", "scans", "ledger"]) {
		expect(group?.pages.find((page) => page.segment === segment)?.permission).toBe("retention:record");
	}
});
```

Read the existing assertion first and adapt it; do not assume its exact current shape.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/app/portal/admin/nav.test.ts` — Expected: FAIL.

- [ ] **Step 3: Register the pages**

Insert after `dashboard`, keeping `event-types`, `point-types`, `exports` last:

```ts
{ segment: "events", label: "Events", description: "How each event turned out.", permission: "retention:record" },
{ segment: "members", label: "Members", description: "Attendance and points per member.", permission: "retention:record" },
{ segment: "scans", label: "Scan Log", description: "Every check-in and reversal, and who did it.", permission: "retention:record" },
{ segment: "ledger", label: "Ledger", description: "Every point record this school year.", permission: "retention:record" },
```

Change `dashboard`'s description to `What needs your attention this term.`

- [ ] **Step 4: Delete the replaced files**

Remove `events-points-dashboard.tsx`, `data/retention/page.tsx`, and the `loadAttendance` export. Keep `loadRetentionPickers` — `ManualRecordSheet` uses it. Delete `dashboard-summary.ts` only if nothing imports it after Task 13. Confirm with `rg` before deleting anything.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint` — Expected: all PASS.

```bash
git add -A src/app/portal/admin/
git commit -m "feat(admin): register the events and points routes, drop the old dashboard"
```

---

### Task 17: Member profile route

**Files:** Create `src/app/portal/admin/members/[id]/page.tsx`.

**Interfaces:** Consumes `memberAttendance` from Task 10, the extended `retention.listMemberTermHistory(actor, ..., { limit?, offset? })`, and `RetentionProgress` from `@/components/portal/overview-metrics`.

- [ ] **Step 1: Build the page**

Five sections: header (full name, email, status, roles); retention progress for the term against `terms.retainedAt` and `terms.probationBelow`, reusing `RetentionProgress`; points by type for every type with a nonzero total; events attended from `memberAttendance` with `<AttendanceStatusCell>` per row, including RSVP'd-but-absent rows; and the extended `retention.listMemberTermHistory`, paginated.

Include the section's standard term selector.

- [ ] **Step 2: Guard**

```ts
const actor = await requireActor();
if (!can(actor, "retention:record")) notFound();
```

A member's own equivalent already exists at `/portal/events`, so there is no self-access fallback.

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm lint` — Expected: PASS.

```bash
git add src/app/portal/admin/members/
git commit -m "feat(admin): add the member attendance and points profile"
```

---

# Phase 6 — Scanner

### Task 18: Scanner activation panel

**Files:** Modify `src/app/portal/page.tsx`, `src/components/event-scan-panel.tsx`.

- [ ] **Step 1: Define the panel's props first**

`EventScanPanel` gains three props. Define them before any caller passes them:

```tsx
export function EventScanPanel({
	eventId,
	eventTitle,
	termId,
	closesAt,
	scannedCount,
	canUndo,
}: {
	eventId: string;
	eventTitle: string;
	termId: string;
	closesAt: Date;
	scannedCount: number;
	canUndo: boolean;
}) {
```

Pass `canUndo` through to `EventScanOverlay` in place of the hardcoded `false`.

- [ ] **Step 2: Support multiple live events and supply the count**

In `page.tsx`, replace `.find()` with `.filter()` — the current code silently drops a second live event where the actor is a scanner:

```tsx
const liveScanEvents = scanEvents.filter(
	(event) =>
		event.myRole === "scanner" &&
		event.endsAt !== null &&
		now.getTime() >= event.startsAt.getTime() - CHECKIN_LEAD_MS &&
		now.getTime() <= event.endsAt.getTime(),
);
```

`scannedCount` is not on `EventRecord`. Fetch it per live event with a count query against `crs_attendance`, or extend the existing `listPublished` projection. Whichever you choose, do it in this task — the panel cannot render without it.

- [ ] **Step 3: Move the panel to the top**

Delete the block at the bottom of `page.tsx`. Render beneath the greeting, above the metric grid:

```tsx
{currentTerm
	? liveScanEvents.map((event) => (
			<EventScanPanel
				key={event.id}
				eventId={event.id}
				eventTitle={event.title}
				termId={currentTerm.id}
				closesAt={event.endsAt!}
				scannedCount={countsByEventId[event.id] ?? 0}
				canUndo={false}
			/>
		))
	: null}
```

`canUndo={false}` for now — Task 19 replaces it with the environment check once undo actually works.

- [ ] **Step 4: Make it the one loud surface**

Replace the neutral `Card` with `bg-accent text-accent-foreground`, full width. The open-scanner control gets `min-h-11` for a 44px touch target — used one-handed, standing, on a phone. Show the count and closing time in plain words: `Check-in is open until 4:30 PM.`

Everything else stays restrained; this panel is time-boxed and appears on its own, so it earns the emphasis.

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm lint` — Expected: PASS.

```bash
git add src/app/portal/page.tsx src/components/event-scan-panel.tsx
git commit -m "feat(portal): surface the scanner prompt at the top of the dashboard"
```

---

### Task 19: Let scanners undo their own scan

**Files:** Modify `src/db/repositories/events.ts` (`undoScan`), `src/app/portal/page.tsx`; delete `src/server/internal/events.ts:145-150`; extend `events.integration.test.ts`.

- [ ] **Step 1: Write the failing tests**

Using the file's real fixtures:

```ts
it("lets a scanner undo a scan they recorded", async () => {
	const { repo } = makeRepos();
	const event = await makeApprovedEvent();
	await repo.addStaff(owner, event.id, scanner.memberId, "scanner");
	await repo.recordScan(scanner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });
	await expect(repo.undoScan(scanner, { eventId: event.id, memberId: "mem_a" })).resolves.toEqual({ removed: true });
});

it("stops a scanner undoing a scan another member recorded", async () => {
	const { repo } = makeRepos();
	const event = await makeApprovedEvent();
	await repo.addStaff(owner, event.id, scanner.memberId, "scanner");
	await repo.recordScan(owner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });
	await expect(repo.undoScan(scanner, { eventId: event.id, memberId: "mem_a" })).rejects.toThrow("Not authorized");
});

it("lets an event admin undo a scan they did not record", async () => {
	const { repo } = makeRepos();
	const event = await makeApprovedEvent();
	await repo.addStaff(owner, event.id, scanner.memberId, "scanner");
	await repo.addStaff(owner, event.id, adminStaff.memberId, "admin");
	await repo.recordScan(scanner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });
	await expect(repo.undoScan(adminStaff, { eventId: event.id, memberId: "mem_a" })).resolves.toEqual({ removed: true });
});
```

Substitute the member id the file's `beforeEach` actually seeds for `mem_a`, and the real term id for `term_1`.

**The existing test asserting a scanner cannot undo stays and must keep passing** — the scanner there undoes the *owner's* scan, which the new rule still forbids.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/db/repositories/events.integration.test.ts -t "undo"` — Expected: the first new test FAILS with `Not authorized to undo attendance.`

- [ ] **Step 3: Authorize before loading, then narrow by ownership**

Order matters. Loading the row first and returning `{ removed: false }` for a missing row while throwing 403 for someone else's row lets any authenticated caller probe whether a given member attended a given event — `DELETE /api/events/[id]/scan` is reachable by anyone signed in.

```ts
const { role } = await requireEvent(actor, input.eventId);
// Gate on role before touching the row: a caller who is neither staff nor a manager must not
// be able to tell a missing scan from someone else's scan.
if (!canManage(role, actor) && role !== "scanner") throw new Error("Not authorized to undo attendance.");

const existing = await loadScanRow(db, input.eventId, input.memberId);
if (!existing) return { removed: false };

// A scanner may reverse only the row they created.
if (!canManage(role, actor) && existing.scannedBy !== actor.memberId) {
	throw new Error("Not authorized to undo attendance.");
}
```

Confirm `loadScanRow` returns `scannedBy`; add it to the select if not.

- [ ] **Step 4: Gate the UI to environments that support it**

Undo cannot work through the shared dev Worker: `src/app/internal/events/route.ts` exports no `DELETE`, so a request 405s before reaching any handler. In `page.tsx`, replace `canUndo={false}` with `canUndo={getAppConfig().APP_ENV !== "shared"}`.

Delete the unreachable deny-branch at `src/server/internal/events.ts:145-150`. It documents an intent the route file does not implement, and leaving it invites someone to trust it.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint` — Expected: all PASS.

```bash
git add src/db/repositories/events.ts src/server/internal/events.ts src/app/portal/page.tsx src/db/repositories/events.integration.test.ts
git commit -m "feat(events): let a scanner reverse their own scan"
```

---

# Phase 7 — Deploy

### Task 20: Pre-flight, deploy, then drop the column

> Every command here touches a real database. **Show it and get approval before running it.** Do not batch these steps. Dev/beta is `code-nest-beta-db` behind `wrangler.beta.jsonc`; production is `code-nest-prod-db` behind `wrangler.jsonc`. The default config is production, so an omitted `--config` on a "dev" command aims at prod.

- [ ] **Step 1: Audit the flag on dev**

```bash
pnpm exec wrangler d1 execute code-nest-beta-db --config wrangler.beta.jsonc --remote --command "select id, key, label, counts_toward_retention from point_types"
```

Any type other than `pt_retention` with the flag set loses its retention contribution. If one exists, stop and decide per type — merge its records into `pt_retention`, or accept the drop — and record the decision before continuing.

- [ ] **Step 2: Audit the flag on production**

```bash
pnpm exec wrangler d1 execute code-nest-prod-db --config wrangler.jsonc --remote --command "select id, key, label, counts_toward_retention from point_types"
```

- [ ] **Step 3: Confirm dev migration state**

```bash
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
```

Local migrations run to `0013`; dev D1 was last verified at `0010`. Reconcile the gap before applying anything.

- [ ] **Step 4: Apply 0014**

```bash
pnpm exec wrangler d1 migrations apply DB --config wrangler.beta.jsonc --remote
```

This is what `pnpm db:migrate:dev` runs. Show the underlying command and get approval; do not hide a remote migration behind a script alias.

`0014` is additive, so the old code is unaffected while it lands.

- [ ] **Step 5: Deploy**

```bash
pnpm deploy:dev
```

- [ ] **Step 6: Verify the deployed app before dropping anything**

On the deployed dev Worker: the admin Events & Points routes load; a scan records and appears in the scan log; retention totals match their pre-deploy values. Do not proceed until all three hold.

- [ ] **Step 7: Write and commit 0015 before applying it**

Create `drizzle/migrations/0015_drop_counts_toward_retention.sql`:

```sql
ALTER TABLE `point_types` DROP COLUMN `counts_toward_retention`;
```

If D1's SQLite rejects `DROP COLUMN`, use the table rebuild from `0013_additive_points_schema.sql`: create `point_types_new` without the column, `INSERT ... SELECT`, drop, rename.

```bash
git add drizzle/migrations/0015_drop_counts_toward_retention.sql
git commit -m "chore(db): drop the counts_toward_retention column"
```

Commit before applying, so the committed migration set always matches what remote state has seen.

- [ ] **Step 8: Apply 0015**

```bash
pnpm exec wrangler d1 migrations apply DB --config wrangler.beta.jsonc --remote
```

This migration is cosmetic. If anything looked wrong at Step 6, leave it unapplied indefinitely — nothing depends on the column being gone.

---

## Self-Review

**Spec coverage.** §1 → Tasks 1, 2, 6, 7, 8, 20. §2 → Tasks 1, 3, 12. §3 → Tasks 9, 10. §4 → Tasks 13, 14, 15, 16. §5 → Task 17. §6 → Tasks 18, 19. §7 → Tasks 11, 13, 14, 15, 18. Audit layer → Tasks 4, 5.

**Type consistency.** `RETENTION_POINT_TYPE_ID` / `DEFAULT_GRACE_MINUTES` defined in Task 2, consumed by 3, 6, 7, 9, 11. `attendanceStatus` / `minutesLate` defined in Task 3, consumed by 9, 11. `createAttendanceReports` defined in Task 9, extended in Task 10, consumed by 13, 14, 15, 17. `AuditRecordInput.targetMemberId` added in Task 4, used in 5 and 10. `EventScanPanel`'s three new props defined in Task 18 before Task 19 changes `canUndo`.

**Known gap, deliberate.** The admin Events & Points section does not work in shared development mode. `getDb()` throws there and the pages this replaces already call it directly — pre-existing, not a regression. Recorded in the spec's Known debt.

---

## Review log

Codex bounded review of plan revision 1: 14 findings, 2 critical, all four scopes complete, verdict REVISE. All 14 verified against source before disposition.

| # | Finding | Change made |
|---|---|---|
| 1 (critical) | Old Tasks 7-9 could not typecheck independently; no task removed the Drizzle field, so after `0015` Drizzle would declare a nonexistent column | Merged into a single Task 7 that removes the schema field, the repository types, every caller, and the UI in one green commit |
| 2 (critical) | `parseGraceMinutes(FormDataEntryValue)` had no integration point — the calendar forms use object-valued server actions with Zod, and `CreateEventInput` had no `graceMinutes` | Task 12 rewritten to name every layer: Zod schemas, `CreateEventInput`/`UpdateEventInput`, both repository write maps, both components |
| 3 (high) | Loading the scan row before authorizing leaked attendance existence to any authenticated caller | Task 19 authorizes on role first, loads second, then narrows by ownership |
| 4 (high) | `ADD COLUMN ... REFERENCES` is valid, but the backfill could write a dangling member id into a foreign-key column and abort `0014` | `EXISTS` guard added; unmatched historical rows stay `NULL` |
| 5-7 (high) | Every prescribed test helper name was wrong: `makeRepos()` returns `{ db, repo }` not `{ events }`; retention uses `makeRepo`/`insertRecord`/`retentionAdmin`/`getMemberTermSummary`; pointTypes has a shared `repo`, no factory | Real fixtures documented in their own section and used throughout Tasks 5, 6, 7, 19 |
| 8 (high) | `roles: ["super_admin"]` is not a valid role key; `can()` would throw a TypeError rather than fail an assertion | Corrected to real role keys; added to Global Constraints |
| 9 (high) | No task produced bounded ledger queries, yet two routes promised pagination | Task 10 gains scan-log `from`/`to` filters and extends `retention.listForTerm` / `listMemberTermHistory` with `q`/`limit`/`offset` (revised — see round 2 finding 4) |

### Verification round

A second Codex round verified all 14 fixes: 12 landed correctly, 2 did not, plus 3 new defects introduced by the revision. All 5 verified against source and fixed here.

| # | Finding | Change made |
|---|---|---|
| 1 (critical) | Finding 1's fix did not land. `portal/events/page.tsx` imports `PublicLeaderboardSelection` at `:10` and carries a flag comment at `:44`, so Task 6 still committed red and Task 7's zero-hit gate still matched | Tasks 6, 7, 8 declared one commit boundary; only Task 8 Step 4 commits, after re-running the gate |
| 2 (critical) | Finding 2's fix was partial. Making `CreateEventInput.graceMinutes` **required** breaks `events.integration.test.ts:100`, `:640`, and `api/events/route.ts:36`, which forwards a contract schema lacking the field | Made optional with `input.graceMinutes ?? null` at the insert; added a persistence test, since a dropped optional field typechecks fine |
| 3 (medium) | Task 15's scans route promised four filters its Zod schema could not express | Schema carries `scannerId`, `memberId`, `from`, `to`, with `from <= to` and `to` treated as an exclusive next-day boundary |
| 4 (medium) | `termLedger`/`memberLedger` duplicated `listForTerm`/`listMemberTermHistory`, which already share `reportBaseColumns` and differ only by lacking search and bounds | Both dropped; the existing methods gain optional `q`/`limit`/`offset` |
| 5 (medium) | Offset pagination ordered only by timestamp, but `createManual` stamps a whole batch identically, so pages could duplicate or drop rows | Ledgers order by `recordedAt desc, id desc`, scan log by `createdAt desc, id desc`; the pagination test seeds tied timestamps |
| 10 (high) | Task 18 passed props that did not exist and required a count no data source provided | Props defined first; `scannedCount` sourced explicitly; `canUndo={false}` until Task 19 |
| 11 (high) | Remote migrations hidden behind a script alias, and `0015` applied before being committed | Exact `wrangler` commands shown for every apply; `0015` committed before application |
| 12 (medium) | Cap and search tests passed vacuously on zero rows | Assert exactly 200 rows and exactly one known member id; both new seed helpers specified |
| 13 (medium) | Registering nav pages broke an existing assertion the plan never updated | Task 16 updates the existing assertion in the same step |
| 14 (low) | Stale line citations and a reference to "Task 24" in a 22-task plan | Citations moved to symbol names where fragile; numbering corrected |
