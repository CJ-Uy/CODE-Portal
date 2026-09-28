# Plan B2 Points Repository and Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add typed point-award behavior on top of Plan B1 without changing the schema, while keeping the shipped single-value points panel and all retention totals correct.

**Architecture:** Keep event award writes in the events repository and express attendance reconciliation as ordered, set-based Drizzle statements inside the existing `runAtomic` unit. Retention reads join Plan B1's `point_types` table for labels and retention policy, while compatibility writes remain scoped to the seeded Retention type. Shared contracts expose the new shapes, and the existing manual-entry and XLSX surfaces receive only the fields required to remain usable in B2.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM over Cloudflare D1 and local better-sqlite3, Zod 4 contracts, Vitest on `@cloudflare/vitest-pool-workers`, and the installed `xlsx` package.

## Global Constraints

- Work on branch `beta` in the existing checkout. Do not create a worktree.
- Plan B1 is a hard prerequisite. This plan assumes `pointTypes`, `eventPointAwards`, and `retentionRecords.pointTypeId` exist in `src/db/schema.ts`, the B1 seed paths provide `pt_retention`, `pt_frontliner`, and `pt_project_lead`, and the partial unique index `retention_records_event_member_type_idx` exists.
- No new dependencies.
- No D1 migrate or deploy commands.
- No schema rebuild, drop, or rename.
- Do not modify `src/db/schema.ts`, `drizzle/migrations`, or migration metadata in B2.
- Workers `.ts` tests only. Do not create `.tsx` tests, jsdom tests, or React Testing Library tests.
- No `better-sqlite3` imported by tests. Local-driver verification belongs in a non-test `scripts/*.ts` command.
- Keep `crs_events.points`; it remains a deprecated compatibility mirror until B3.
- Keep the existing `setPoints` contract and server action until B3.
- Repository errors that must become HTTP 403 continue to start with `Not authorized`.
- No em dash characters in code, UI copy, docs, commit messages, or comments.
- Use tabs in TypeScript and TSX files.
- Do not stage or revert unrelated existing changes, including existing dirty `graphify-out/` files.

### Load-Bearing Traps

- `targetWhere: sql\`source = 'event_attendance'\`` must stay a source literal unqualified for the partial index; assert the generated SQL string.
- Five totals get the retention filter, including the `retention.ts:356` in-memory reduce.
- Projections get metadata, not a filter.
- The `setAwards` delete step only touches active point types.
- An inactive type scan creates no row and history survives reconciliation.
- The `setPoints` shim is scoped Retention-only, preserves non-Retention awards, mirrors to `crs_events.points`, and returns the distinct attendee count.
- Audit is atomic, notification is best-effort.

### Deliberate B2 Boundary

- Add no point-type administration screen, per-type event editor, profile breakdown, history-label rendering, or leaderboard selector. Those remain Plan B3.
- The manual-entry point-type selector is included because making `pointTypeId` required without updating the live form would break the shipped workflow.
- The XLSX `Point Type` column is included because it is explicitly part of B2's projection contract.

---

## File Structure

### Create

- `src/db/contract/events.test.ts`: contract coverage for the new bounded `setAwards` operation.
- `src/db/repositories/event-awards.ts`: focused builders for the two attendance-to-retention `INSERT ... SELECT` statements and their partial-index upsert target.
- `src/db/repositories/event-awards.test.ts`: generated SQL assertions that run in the Workers test pool.
- `scripts/verify-points-upsert-local.ts`: non-test better-sqlite3 smoke check for the exact shared upsert builder.

### Modify

- `src/db/types.ts`: shared `EventAwardInput` schema and, later, required manual `pointTypeId`.
- `src/db/types.test.ts`: input-boundary tests for awards and manual records.
- `src/db/contract/events.ts:123-129`: retain `setPoints` and add `setAwards`.
- `src/db/repositories/audit.ts`: expose one audit-value builder so `events.ts` can put the audit insert in its atomic batch without duplicating actor metadata.
- `src/db/repositories/events.ts:1-11,73-96,319-347,450-485`: add `setAwards`, replace scan row creation, and narrow `setPoints` to its Retention-only compatibility behavior.
- `src/db/repositories/events.integration.test.ts:27-80,95-191,226-281`: seed B1 point types, replace single-value expectations, and cover validation, reconciliation, inactive types, audit, notifications, and the shim.
- `src/db/repositories/retention.ts:1-118,120-147,149-295,339-367`: delete `recordEventAttendance`, type manual writes, add projection metadata, and filter all four SQL totals plus the in-memory total.
- `src/db/repositories/retention-unavailable.ts:3-20`: remove the deleted repository method.
- `src/db/repositories/retention.integration.test.ts:20-326`: replace deleted-writer fixtures and cover typed manual writes, all totals, both projections, and threshold integrity.
- `src/db/contract/retention.ts:5-15,40-60,107-115`: expose `pointTypeId` and `pointTypeLabel` on typed rows.
- `src/db/contract/retention.test.ts`: parse typed report and history rows.
- `src/db/repositories/overview.ts:1-9,46-55`: filter the dashboard total to retention-bearing types.
- `src/db/repositories/overview.integration.test.ts:12-94`: prove Frontliner rows do not affect the dashboard total.
- `src/app/portal/admin/data/retention/data.ts`: load active point-type options for manual entry.
- `src/app/portal/admin/data/retention/actions.ts:12-24`: parse the required `pointTypeId`.
- `src/app/portal/admin/data/retention/retention-form.tsx`: render the required visible selector, defaulted to Retention.
- `src/app/portal/admin/data/retention/page.tsx`: pass point types into the form and keep load-failure data shape complete.
- `src/server/reporting/xlsx.ts:24-47`: add `Point Type` beside `Points` in term and member workbooks.
- `src/server/reporting/xlsx.test.ts`: assert the new column in both workbook shapes.

## Test Matrix

| Requirement | Persistent check |
| --- | --- |
| Bounded award array | `src/db/types.test.ts`, `src/db/contract/events.test.ts`, and repository rejection in `events.integration.test.ts` |
| Duplicate type, non-integer, range, unknown, inactive validation | `src/db/repositories/events.integration.test.ts` |
| Set-based add, change, remove | `src/db/repositories/events.integration.test.ts` |
| Unchanged award preserves `recordedAt` | `src/db/repositories/events.integration.test.ts` |
| New award copies attendance provenance | `src/db/repositories/events.integration.test.ts` |
| Generated partial-index target is literal and unqualified | `src/db/repositories/event-awards.test.ts` |
| Actual partial-index upsert on D1 | `src/db/repositories/events.integration.test.ts` |
| Actual partial-index upsert on better-sqlite3 | `scripts/verify-points-upsert-local.ts` |
| Scan derives all active awards in the atomic batch | `src/db/repositories/events.integration.test.ts` |
| Inactive award grants no new row | `src/db/repositories/events.integration.test.ts` |
| Inactive history survives active reconciliation | `src/db/repositories/events.integration.test.ts` |
| Retention-only `setPoints` shim preserves other awards | `src/db/repositories/events.integration.test.ts` |
| Both write APIs mirror Retention to `crs_events.points` | `src/db/repositories/events.integration.test.ts` |
| Shim returns distinct attendee count | `src/db/repositories/events.integration.test.ts` |
| Audit rolls back with award reconciliation | `src/db/repositories/events.integration.test.ts` |
| Notification failure does not roll back awards or audit | `src/db/repositories/events.integration.test.ts` |
| Manual entry requires and stores an active type | `src/db/types.test.ts`, `src/db/repositories/retention.integration.test.ts` |
| Deleted `recordEventAttendance` has no caller | final `rg` check |
| Summary, both leaderboards, and history total filter by retention policy | `src/db/repositories/retention.integration.test.ts` |
| Overview total filters by retention policy | `src/db/repositories/overview.integration.test.ts` |
| History returns all typed rows and counts all returned rows | `src/db/repositories/retention.integration.test.ts` |
| Threshold status ignores non-Retention points | `src/db/repositories/retention.integration.test.ts` |
| Report and history projections carry type metadata without filtering rows | `src/db/repositories/retention.integration.test.ts`, `src/db/contract/retention.test.ts` |
| XLSX carries `Point Type` | `src/server/reporting/xlsx.test.ts` |

---

### Task 1: Award Input and Shared Contract

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/db/types.test.ts`
- Modify: `src/db/contract/events.ts`
- Create: `src/db/contract/events.test.ts`

**Interfaces:**
- Consumes: B1 point-type IDs as non-empty strings.
- Produces: `EventAwardInput`, `eventAwardInputSchema`, `eventAwardsInputSchema`, and `eventsContract.setAwards`.
- Produces repository signature for Task 2: `setAwards(actor: Actor, eventId: string, awards: EventAwardInput[]): Promise<{ updated: number }>`.
- Keeps compatibility signature unchanged: `setPoints(actor: Actor, eventId: string, points: number | null): Promise<{ updated: number }>`.

- [ ] **Step 1: Write failing award-schema tests**

Add to `src/db/types.test.ts`:

```ts
import { createManualRetentionRecordInputSchema, eventAwardsInputSchema } from "./types";

describe("eventAwardsInputSchema", () => {
	it("accepts a bounded typed award set", () => {
		expect(
			eventAwardsInputSchema.parse([
				{ pointTypeId: "pt_retention", points: 2 },
				{ pointTypeId: "pt_frontliner", points: -3 },
			]),
		).toHaveLength(2);
	});

	it("rejects non-integer and out-of-range points", () => {
		expect(() => eventAwardsInputSchema.parse([{ pointTypeId: "pt_retention", points: 2.5 }])).toThrow();
		expect(() => eventAwardsInputSchema.parse([{ pointTypeId: "pt_retention", points: 101 }])).toThrow();
	});

	it("rejects more than 100 awards", () => {
		const awards = Array.from({ length: 101 }, (_, index) => ({
			pointTypeId: `pt_${index}`,
			points: 1,
		}));
		expect(() => eventAwardsInputSchema.parse(awards)).toThrow("at most 100");
	});
});
```

- [ ] **Step 2: Run the input test and confirm failure**

Run:

```bash
pnpm exec vitest run src/db/types.test.ts
```

Expected: FAIL because `eventAwardsInputSchema` is not exported.

- [ ] **Step 3: Add the shared award schema**

Add beside the existing database input schemas in `src/db/types.ts`:

```ts
export const eventAwardInputSchema = z.object({
	pointTypeId: z.string().trim().min(1),
	points: z.number().int().min(-100).max(100),
});

export const eventAwardsInputSchema = z
	.array(eventAwardInputSchema)
	.max(100, "Set at most 100 point awards per event.");

export type EventAwardInput = z.infer<typeof eventAwardInputSchema>;
```

Do not add duplicate-ID validation to Zod. Task 2 enforces it in the repository, where every caller is covered.

- [ ] **Step 4: Write the failing contract test**

Create `src/db/contract/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eventsContract } from "./events";

describe("eventsContract point awards", () => {
	it("parses typed awards and keeps both write operations shared-dev denied", () => {
		const input = eventsContract.setAwards.input.parse({
			eventId: "evt_1",
			awards: [
				{ pointTypeId: "pt_retention", points: 2 },
				{ pointTypeId: "pt_frontliner", points: 3 },
			],
		});

		expect(input.awards).toHaveLength(2);
		expect(eventsContract.setAwards.sharedDev).toBe("deny");
		expect(eventsContract.setPoints.sharedDev).toBe("deny");
	});
});
```

- [ ] **Step 5: Run the contract test and confirm failure**

Run:

```bash
pnpm exec vitest run src/db/contract/events.test.ts
```

Expected: FAIL because `eventsContract.setAwards` does not exist.

- [ ] **Step 6: Add the `setAwards` contract**

Import `eventAwardsInputSchema` in `src/db/contract/events.ts` and add this operation beside `setPoints`:

```ts
setAwards: operation({
	input: z.object({
		eventId: z.string().min(1),
		awards: eventAwardsInputSchema,
	}),
	output: z.object({ updated: z.number().int().min(0) }),
	auth: "admin",
	permission: "event:points",
	sharedDev: "deny",
}),
```

Do not remove or redirect `setPoints`.

- [ ] **Step 7: Run the focused tests**

Run:

```bash
pnpm exec vitest run src/db/types.test.ts src/db/contract/events.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the contract boundary**

```bash
git add src/db/types.ts src/db/types.test.ts src/db/contract/events.ts src/db/contract/events.test.ts
git commit -m "feat: add event award contract"
```

---

### Task 2: Atomic `setAwards` Reconciliation

**Files:**
- Create: `src/db/repositories/event-awards.ts`
- Create: `src/db/repositories/event-awards.test.ts`
- Create: `scripts/verify-points-upsert-local.ts`
- Modify: `src/db/repositories/audit.ts`
- Modify: `src/db/repositories/events.ts`
- Modify: `src/db/repositories/events.integration.test.ts`

**Interfaces:**
- Consumes: `EventAwardInput[]`, B1 `pointTypes`, `eventPointAwards`, and `retentionRecords.pointTypeId`.
- Produces: `buildExistingAttendanceAwardUpsert(db, eventId, pointTypeId?)`.
- Produces: `buildScanAwardUpsert(db, input)` for Task 3.
- Produces: `auditInsertValues(actor, input): InferInsertModel<typeof auditLogs>`.
- Produces: `EventsRepository.setAwards(actor, eventId, awards): Promise<{ updated: number }>`.
- Defines `updated` for `setAwards` as the number of distinct attendance rows on the event after reconciliation.

- [ ] **Step 1: Seed B1 point types in the events repository fixture**

In `src/db/repositories/events.integration.test.ts`, delete child tables in foreign-key order:

```ts
for (const table of [
	"notifications",
	"audit_logs",
	"retention_records",
	"crs_attendance",
	"event_point_awards",
	"event_invites",
	"event_staff",
	"event_rsvps",
	"event_type_rules",
	"crs_events",
	"terms",
	"point_types",
	"members",
]) {
	await env.DB.prepare(`DELETE FROM ${table}`).run();
}
```

After members are inserted, seed deterministic point types:

```ts
for (const [id, key, label, countsTowardRetention, active, position] of [
	["pt_retention", "retention", "Retention", 1, 1, 0],
	["pt_frontliner", "frontliner", "Frontliner", 0, 1, 1],
	["pt_retired", "retired", "Retired", 0, 0, 2],
] as const) {
	await env.DB.prepare(
		`INSERT INTO point_types
			(id, key, label, counts_toward_retention, active, position, updated_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(id, key, label, countsTowardRetention, active, position, "mem_retention")
		.run();
}
```

- [ ] **Step 2: Write failing generated-SQL tests**

Create `src/db/repositories/event-awards.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { buildExistingAttendanceAwardUpsert, buildScanAwardUpsert } from "./event-awards";

describe("event attendance award upsert SQL", () => {
	it("uses the literal unqualified partial-index predicate", () => {
		const db = drizzle(env.DB, { schema });
		const queries = [
			buildExistingAttendanceAwardUpsert(db, "evt_1"),
			buildScanAwardUpsert(db, {
				eventId: "evt_1",
				memberId: "mem_1",
				termId: "term_1",
				scannedBy: "mem_admin",
				scannedAt: new Date("2026-07-10T10:00:00.000Z"),
			}),
		];

		for (const query of queries) {
			const generated = query.toSQL().sql;
			expect(generated).toContain("where source = 'event_attendance'");
			expect(generated).not.toContain('"retention_records"."source" = ?');
		}
	});
});
```

- [ ] **Step 3: Run the SQL test and confirm failure**

Run:

```bash
pnpm exec vitest run src/db/repositories/event-awards.test.ts
```

Expected: FAIL because `event-awards.ts` does not exist.

- [ ] **Step 4: Implement the two set-based upsert builders**

Create `src/db/repositories/event-awards.ts`. Both builders must:

```ts
const attendanceConflict = {
	target: [
		retentionRecords.eventId,
		retentionRecords.memberId,
		retentionRecords.pointTypeId,
	],
	targetWhere: sql`source = 'event_attendance'`,
	set: {
		points: sql`excluded.points`,
		reason: sql`excluded.reason`,
	},
};
```

Use this ID expression in both `INSERT ... SELECT` projections so every selected row receives a different ID:

```ts
id: sql<string>`'ret_' || lower(hex(randomblob(12)))`,
```

`buildExistingAttendanceAwardUpsert(db, eventId, pointTypeId?)` selects:

```ts
{
	id: sql<string>`'ret_' || lower(hex(randomblob(12)))`,
	memberId: crsAttendance.memberId,
	termId: terms.id,
	eventId: crsAttendance.eventId,
	pointTypeId: eventPointAwards.pointTypeId,
	points: eventPointAwards.points,
	reason: sql<string>`'Attended ' || ${crsEvents.title}`,
	source: sql<"event_attendance">`'event_attendance'`,
	recordedBy: crsAttendance.scannedBy,
	recordedAt: crsAttendance.scannedAt,
}
```

Its source query starts at `crsAttendance`, joins:

- `eventPointAwards` on the same event.
- `pointTypes` on award type with `pointTypes.active = true`.
- `crsEvents` on event ID.
- `terms` where `crsAttendance.scannedAt` falls inclusively between term start and end.

Filter by `eventId`; when `pointTypeId` is passed, add that filter. Finish with:

```ts
return db
	.insert(retentionRecords)
	.select(source)
	.onConflictDoUpdate(attendanceConflict);
```

`buildScanAwardUpsert(db, input)` starts at `eventPointAwards`, joins active `pointTypes` and `crsEvents`, filters the one event, and projects the supplied member, term, scanner, and scan time. It uses the same `attendanceConflict`. Do not read awards into JavaScript.

- [ ] **Step 5: Run the SQL test**

Run:

```bash
pnpm exec vitest run src/db/repositories/event-awards.test.ts
```

Expected: PASS, with the exact literal predicate present in both generated statements.

- [ ] **Step 6: Make audit values reusable inside a batch**

In `src/db/repositories/audit.ts`, extract the current insert object into:

```ts
export function auditInsertValues(actor: Actor, input: AuditRecordInput): AuditInsert {
	return {
		id: createId("aud"),
		actorMemberId: actor.memberId,
		actorContext: actor.context ?? "session",
		sharedTokenHash: actor.sharedTokenHash ?? null,
		sharedTokenLabel: actor.sharedTokenLabel ?? null,
		action: input.action,
		targetType: input.targetType,
		targetId: input.targetId,
		detail: input.detail ?? null,
		category: input.category,
	};
}
```

Change `AuditRepository.record` to call `db.insert(auditLogs).values(auditInsertValues(actor, input))`. No public repository method changes.

- [ ] **Step 7: Write failing `setAwards` validation tests**

Add one table-driven test to `src/db/repositories/events.integration.test.ts`:

```ts
it("validates every setAwards value inside the repository", async () => {
	const event = await makeApprovedEvent();
	const { repo } = makeRepos();

	for (const awards of [
		[
			{ pointTypeId: "pt_retention", points: 2 },
			{ pointTypeId: "pt_retention", points: 3 },
		],
		[{ pointTypeId: "pt_retention", points: 2.5 }],
		[{ pointTypeId: "pt_retention", points: 101 }],
		[{ pointTypeId: "pt_missing", points: 2 }],
		[{ pointTypeId: "pt_retired", points: 2 }],
	]) {
		await expect(repo.setAwards(eventsAdmin, event.id, awards)).rejects.toThrow();
	}

	const tooMany = Array.from({ length: 101 }, (_, index) => ({
		pointTypeId: `pt_${index}`,
		points: 1,
	}));
	await expect(repo.setAwards(eventsAdmin, event.id, tooMany)).rejects.toThrow("at most 100");
});
```

Also assert a non-`event:points` actor receives `Not authorized`.

- [ ] **Step 8: Write the failing reconciliation and provenance test**

Add a test that:

1. Creates an event.
2. Calls `setAwards` with Retention 2.
3. Scans `mem_a`.
4. Captures the row's `recordedAt`.
5. Advances fake time.
6. Calls `setAwards` with unchanged Retention 2 plus Frontliner 3.
7. Asserts Retention kept its original `recordedAt`.
8. Asserts Frontliner copied `crs_attendance.scannedBy` and `scannedAt`.
9. Changes Retention to 4 and omits Frontliner.
10. Asserts Retention changed to 4 and Frontliner was deleted.

Core assertions:

```ts
expect(rowsAfterAdd.map((row) => [row.pointTypeId, row.points])).toEqual([
	["pt_frontliner", 3],
	["pt_retention", 2],
]);
expect(retentionAfterAdd.recordedAt).toEqual(originalRecordedAt);
expect(frontlinerAfterAdd.recordedBy).toBe(owner.memberId);
expect(frontlinerAfterAdd.recordedAt).toEqual(attendance.scannedAt);

expect(rowsAfterRemove.map((row) => [row.pointTypeId, row.points])).toEqual([
	["pt_retention", 4],
]);
```

- [ ] **Step 9: Write failing atomic-audit and best-effort notification tests**

For audit rollback, create a temporary D1 trigger:

```ts
await env.DB.prepare(`
	CREATE TRIGGER fail_set_awards_audit
	BEFORE INSERT ON audit_logs
	WHEN NEW.action = 'event:set_awards'
	BEGIN
		SELECT RAISE(ABORT, 'audit unavailable');
	END
`).run();

await expect(
	repo.setAwards(eventsAdmin, event.id, [{ pointTypeId: "pt_retention", points: 2 }]),
).rejects.toThrow();
expect(await db.select().from(schema.eventPointAwards)).toHaveLength(0);
expect((await db.select().from(schema.crsEvents))[0].points).toBeNull();

await env.DB.prepare("DROP TRIGGER fail_set_awards_audit").run();
```

For best-effort notifications, scan two attendees, add a trigger that aborts only `points_awarded` notification inserts, spy on `console.error`, and assert:

```ts
await expect(
	repo.setAwards(eventsAdmin, event.id, [{ pointTypeId: "pt_retention", points: 5 }]),
).resolves.toEqual({ updated: 2 });
expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "event:set_awards"))).toHaveLength(1);
expect(errorSpy).toHaveBeenCalledTimes(2);
```

Drop the trigger and restore the spy in `finally`.

- [ ] **Step 10: Implement repository-level validation**

In `events.ts`, add `setAwards` to `EventsRepository` and validate before building writes:

```ts
if (!can(actor, "event:points")) throw new Error("Not authorized to set event point awards.");
if (awards.length > 100) throw new Error("Set at most 100 point awards per event.");

const ids = awards.map((award) => award.pointTypeId);
if (new Set(ids).size !== ids.length) throw new Error("Point type IDs must be unique.");
for (const award of awards) {
	if (!Number.isInteger(award.points) || award.points < -100 || award.points > 100) {
		throw new Error("Award points must be an integer from -100 to 100.");
	}
}
```

Load all submitted IDs from `pointTypes` and reject unless the row count matches and every row is active. Empty arrays skip the lookup. This is repository validation, not contract validation.

- [ ] **Step 11: Implement the atomic set replacement**

Build this ordered `runAtomic` list in `setAwards`:

1. Delete the event's current `eventPointAwards`.
2. Insert all submitted awards when the array is non-empty.
3. Run `buildExistingAttendanceAwardUpsert(db, eventId)`.
4. Delete only active-type attendance rows no longer in the final award table.
5. Mirror the final Retention award into `crsEvents.points`.
6. Insert `event:set_awards` audit values directly into `auditLogs`.

Step 1 replaces configured award rows. The active-type restriction applies to step 4's attendance-history deletion, which is the `setAwards` delete step called out by the preservation rule.

The deletion predicate must preserve inactive history:

```sql
DELETE FROM retention_records
 WHERE source = 'event_attendance'
   AND event_id = ?
   AND point_type_id IN (
       SELECT id FROM point_types WHERE active = 1
   )
   AND point_type_id NOT IN (
       SELECT point_type_id
         FROM event_point_awards
        WHERE event_id = ?
   );
```

Build the equivalent Drizzle expression with subqueries. Do not delete by a JavaScript snapshot of submitted IDs.

Mirror Retention with a scalar subquery keyed by `point_types.key = 'retention'`. A missing final Retention award must set `crs_events.points` to `null`.

- [ ] **Step 12: Add best-effort notification fan-out**

After `runAtomic` succeeds, select distinct attendee member IDs. Attempt every recipient sequentially:

```ts
for (const attendee of attendees) {
	try {
		await notify(db, {
			memberId: attendee.memberId,
			kind: "points_awarded",
			title: "Points updated",
			body: `${event.title} point awards were updated.`,
			href: `/portal/calendar/${eventId}`,
		});
	} catch (error) {
		console.error("Failed to notify attendee about event point awards.", {
			eventId,
			memberId: attendee.memberId,
			error,
		});
	}
}
return { updated: attendees.length };
```

Do not put notifications in `runAtomic`. Do not let one failure stop later recipients.

- [ ] **Step 13: Run the event repository tests on D1**

Run:

```bash
pnpm exec vitest run src/db/repositories/event-awards.test.ts src/db/repositories/events.integration.test.ts
```

Expected: PASS, including actual D1 execution against B1's partial unique index.

- [ ] **Step 14: Add the local-driver verification script**

Create `scripts/verify-points-upsert-local.ts`. It must:

- Open `new Database(":memory:")`.
- Read every sorted `drizzle/migrations/*.sql` file.
- Split each file on `--> statement-breakpoint` and execute each non-empty statement.
- Seed the minimum members, Retention point type, term, event, attendance, and Retention award rows. The B1 migration creates `point_types`; the separate seed path, not the migration, normally inserts `pt_retention`.
- Build and `.run()` `buildExistingAttendanceAwardUpsert(db, "evt_local")`.
- Change the award from 2 to 7, run the same builder again, and assert exactly one retention row remains with 7 points.
- Close the database in `finally`.

Use this exact minimum fixture after applying migrations:

```ts
sqlite.exec(`
	INSERT INTO members (id, email, name)
	VALUES ('mem_local', 'local@example.com', 'Local Member');
	INSERT INTO point_types
		(id, key, label, counts_toward_retention, active, position, updated_by)
	VALUES ('pt_retention', 'retention', 'Retention', 1, 1, 0, 'mem_local');
	INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at)
	VALUES ('term_local', 'Local Term', 20, 10, 0, 2000);
	INSERT INTO crs_events
		(id, title, type, status, place, starts_at, ends_at, description, created_by, checkin_secret)
	VALUES ('evt_local', 'Local Event', 'official', 'approved', 'Room', 500, 1500, 'Local check', 'mem_local', 'secret');
	INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by)
	VALUES ('evt_local', 'mem_local', 1000, 'mem_local');
	INSERT INTO event_point_awards (event_id, point_type_id, points)
	VALUES ('evt_local', 'pt_retention', 2);
`);
```

Use this terminal assertion:

```ts
const rows = sqlite
	.prepare(`
		SELECT point_type_id AS pointTypeId, points
		  FROM retention_records
		 WHERE event_id = 'evt_local'
		   AND member_id = 'mem_local'
	`)
	.all() as Array<{ pointTypeId: string; points: number }>;

if (rows.length !== 1 || rows[0].pointTypeId !== "pt_retention" || rows[0].points !== 7) {
	throw new Error(`Local partial-index upsert failed: ${JSON.stringify(rows)}`);
}
console.log("Local partial-index upsert verified.");
```

This file is not named `*.test.ts` and is never imported by Vitest.

- [ ] **Step 15: Run the local-driver check**

Run:

```bash
pnpm exec tsx scripts/verify-points-upsert-local.ts
```

Expected: `Local partial-index upsert verified.`

- [ ] **Step 16: Commit `setAwards`**

```bash
git add src/db/repositories/event-awards.ts src/db/repositories/event-awards.test.ts scripts/verify-points-upsert-local.ts src/db/repositories/audit.ts src/db/repositories/events.ts src/db/repositories/events.integration.test.ts
git commit -m "feat: reconcile event point awards"
```

---

### Task 3: Award-Derived Scans and the `setPoints` Shim

**Files:**
- Modify: `src/db/repositories/events.ts`
- Modify: `src/db/repositories/events.integration.test.ts`

**Interfaces:**
- Consumes: Task 2's two upsert builders and atomic audit-value helper.
- Produces: `recordScan` attendance plus zero or more active typed rows in one atomic batch.
- Keeps: `setPoints(actor, eventId, points): Promise<{ updated: number }>` with Retention-only scope.
- Guarantees: `setPoints.updated` is the distinct attendee count, not a retention-row count.

- [ ] **Step 1: Write the failing multi-award scan test**

Add to `events.integration.test.ts`:

```ts
it("derives scan rows from every active event award", async () => {
	const event = await makeApprovedEvent();
	const { db, repo } = makeRepos();
	await repo.setAwards(eventsAdmin, event.id, [
		{ pointTypeId: "pt_retention", points: 2 },
		{ pointTypeId: "pt_frontliner", points: 3 },
	]);

	await repo.recordScan(owner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });

	const rows = await db
		.select()
		.from(schema.retentionRecords)
		.orderBy(schema.retentionRecords.pointTypeId);
	expect(rows.map((row) => [row.pointTypeId, row.points, row.eventId])).toEqual([
		["pt_frontliner", 3, event.id],
		["pt_retention", 2, event.id],
	]);
});
```

- [ ] **Step 2: Write the failing inactive-type scan and history-preservation test**

Seed an award while `pt_frontliner` is active, scan `mem_a`, deactivate Frontliner, then scan `mem_b`. Save an active-only award set and assert:

```ts
expect(
	rows.filter((row) => row.memberId === "mem_b").map((row) => row.pointTypeId),
).toEqual(["pt_retention"]);
expect(
	rows.some((row) => row.memberId === "mem_a" && row.pointTypeId === "pt_frontliner"),
).toBe(true);
```

The second assertion must be made after `setAwards(eventsAdmin, event.id, [{ pointTypeId: "pt_retention", points: 4 }])`.

- [ ] **Step 3: Replace the untyped scan insert**

In `recordScan`, keep the attendance insert first and replace the single `retentionRecords.values(...)` statement with:

```ts
buildScanAwardUpsert(db, {
	eventId: input.eventId,
	memberId: input.memberId,
	termId: input.termId,
	scannedBy: actor.memberId,
	scannedAt,
})
```

The helper's active `pointTypes` join is evaluated inside the same `runAtomic` call as attendance. Keep the duplicate-scan race handling unchanged.

Do not read `event.points` and do not generate one default Retention row when no active award exists.

- [ ] **Step 4: Run the scan tests**

Run:

```bash
pnpm exec vitest run src/db/repositories/events.integration.test.ts -t "active event award|inactive-type"
```

Expected: PASS.

- [ ] **Step 5: Write the failing compatibility-shim test**

Add:

```ts
it("keeps setPoints scoped to Retention and returns distinct attendees", async () => {
	const event = await makeApprovedEvent();
	const { db, repo } = makeRepos();
	await repo.setAwards(eventsAdmin, event.id, [
		{ pointTypeId: "pt_retention", points: 2 },
		{ pointTypeId: "pt_frontliner", points: 3 },
	]);
	await repo.recordScan(owner, { eventId: event.id, memberId: "mem_a", termId: "term_1" });
	await repo.recordScan(owner, { eventId: event.id, memberId: "mem_b", termId: "term_1" });

	await expect(repo.setPoints(eventsAdmin, event.id, 7)).resolves.toEqual({ updated: 2 });

	const awards = await db.select().from(schema.eventPointAwards).orderBy(schema.eventPointAwards.pointTypeId);
	expect(awards.map((row) => [row.pointTypeId, row.points])).toEqual([
		["pt_frontliner", 3],
		["pt_retention", 7],
	]);
	expect((await db.select().from(schema.crsEvents).where(eq(schema.crsEvents.id, event.id)))[0].points).toBe(7);
	expect(
		(await db.select().from(schema.retentionRecords))
			.filter((row) => row.pointTypeId === "pt_frontliner")
			.every((row) => row.points === 3),
	).toBe(true);
});
```

Extend it with `setPoints(..., null)` and assert only the Retention award and Retention attendance rows disappear, Frontliner remains, the mirror becomes `null`, and `{ updated: 2 }` remains true.

- [ ] **Step 6: Implement the Retention-only shim**

Keep repository validation for `points`:

```ts
if (points !== null && (!Number.isInteger(points) || points < -100 || points > 100)) {
	throw new Error("Event points must be an integer from -100 to 100.");
}
```

Resolve the active Retention type by `pointTypes.key = "retention"` inside the repository. Refuse if it is unavailable.

For non-null `points`, the ordered atomic statements are:

1. Upsert only `(eventId, retentionType.id)` in `eventPointAwards`.
2. Run `buildExistingAttendanceAwardUpsert(db, eventId, retentionType.id)`.
3. Update `crs_events.points` to `points`.
4. Insert the `event:set_points` audit row.

For null `points`, the ordered atomic statements are:

1. Delete only the Retention award.
2. Delete only Retention `event_attendance` rows for this event.
3. Set `crs_events.points` to `null`.
4. Insert the same audit action.

Never call `setAwards` from `setPoints`; whole-set replacement would erase non-Retention awards.

After the batch, send notifications with the same best-effort helper as `setAwards` when points are non-null. Return the selected distinct attendance count in both branches.

- [ ] **Step 7: Assert both APIs maintain the mirror**

In the `setAwards` reconciliation test, add:

```ts
const [mirrored] = await db.select().from(schema.crsEvents).where(eq(schema.crsEvents.id, event.id));
expect(mirrored.points).toBe(4);
```

After removing Retention from the whole award set, assert `mirrored.points` is `null`.

- [ ] **Step 8: Run all event tests**

Run:

```bash
pnpm exec vitest run src/db/contract/events.test.ts src/db/repositories/event-awards.test.ts src/db/repositories/events.integration.test.ts
pnpm exec tsx scripts/verify-points-upsert-local.ts
```

Expected: all Vitest cases pass and the local script prints its verification line.

- [ ] **Step 9: Commit scans and compatibility**

```bash
git add src/db/repositories/events.ts src/db/repositories/events.integration.test.ts
git commit -m "feat: derive scan points from active awards"
```

---

### Task 4: Typed Manual Records and Dead Writer Removal

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/db/types.test.ts`
- Modify: `src/db/repositories/retention.ts`
- Modify: `src/db/repositories/retention-unavailable.ts`
- Modify: `src/db/repositories/retention.integration.test.ts`
- Modify: `src/app/portal/admin/data/retention/data.ts`
- Modify: `src/app/portal/admin/data/retention/actions.ts`
- Modify: `src/app/portal/admin/data/retention/retention-form.tsx`
- Modify: `src/app/portal/admin/data/retention/page.tsx`

**Interfaces:**
- Consumes: B1 `pointTypes` and required `pt_retention` seed.
- Produces: `CreateManualRetentionRecordInput.pointTypeId: string`.
- Produces picker option: `{ id: string; key: string; label: string }`.
- Removes: `RecordEventAttendanceInput` and `RetentionRepository.recordEventAttendance`.

- [ ] **Step 1: Write the failing required-type input tests**

Replace the minimal manual-input test in `src/db/types.test.ts` with:

```ts
it("requires a point type for a manual entry", () => {
	expect(() =>
		createManualRetentionRecordInputSchema.parse({
			memberIds: ["mem_a"],
			termId: "term_1",
			reason: "Submitted the required medical waiver",
		}),
	).toThrow();

	expect(
		createManualRetentionRecordInputSchema.parse({
			memberIds: ["mem_a"],
			termId: "term_1",
			pointTypeId: "pt_retention",
			reason: "Submitted the required medical waiver",
		}),
	).toMatchObject({ pointTypeId: "pt_retention" });
});
```

Add `pointTypeId: "pt_retention"` to all other valid manual schema fixtures.

- [ ] **Step 2: Run the type tests and confirm failure**

Run:

```bash
pnpm exec vitest run src/db/types.test.ts
```

Expected: FAIL because the current schema silently accepts no point type.

- [ ] **Step 3: Require `pointTypeId` in the shared input**

Add to `createManualRetentionRecordInputSchema`:

```ts
pointTypeId: z.string().trim().min(1, "Select a point type."),
```

Do not give it a schema default. The visible form chooses Retention explicitly.

- [ ] **Step 4: Replace deleted-writer test fixtures**

In `retention.integration.test.ts`, delete the two tests dedicated to `recordEventAttendance`. Add a fixture helper that inserts typed records directly:

```ts
async function insertRecord(input: {
	id: string;
	memberId?: string;
	termId?: string;
	pointTypeId?: string;
	points: number | null;
	reason?: string;
}) {
	await env.DB.prepare(`
		INSERT INTO retention_records
			(id, member_id, term_id, point_type_id, points, reason, source, recorded_by, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?, 'manual', 'mem_admin', ?)
	`)
		.bind(
			input.id,
			input.memberId ?? "mem_a",
			input.termId ?? "term_1",
			input.pointTypeId ?? "pt_retention",
			input.points,
			input.reason ?? input.id,
			TERM_START.getTime() + 1000,
		)
		.run();
}
```

Use this helper for read, summary, leaderboard, and history setup. Do not replace the deleted production method with another fixture-only repository API.

- [ ] **Step 5: Seed point types in the retention fixture**

Add `point_types` to cleanup after `terms` and before `members`, respecting foreign keys. Seed:

```ts
await env.DB.prepare(`
	INSERT INTO point_types
		(id, key, label, counts_toward_retention, active, position, updated_by)
	VALUES
		('pt_retention', 'retention', 'Retention', 1, 1, 0, 'mem_admin'),
		('pt_frontliner', 'frontliner', 'Frontliner', 0, 1, 1, 'mem_admin'),
		('pt_retired', 'retired', 'Retired', 0, 0, 2, 'mem_admin')
`).run();
```

- [ ] **Step 6: Write failing manual repository tests**

Update every `createManual` call to pass `pointTypeId`. Add:

```ts
it("requires an active point type and records it", async () => {
	const { db, repo } = makeRepo();
	await repo.createManual(retentionAdmin, {
		memberIds: ["mem_a"],
		termId: "term_1",
		eventId: null,
		pointTypeId: "pt_frontliner",
		points: 3,
		reason: "Led a project",
	});
	expect((await db.select().from(schema.retentionRecords))[0].pointTypeId).toBe("pt_frontliner");

	await expect(
		repo.createManual(retentionAdmin, {
			memberIds: ["mem_a"],
			termId: "term_1",
			eventId: null,
			pointTypeId: "pt_missing",
			points: 3,
			reason: "Unknown type",
		}),
	).rejects.toThrow("Point type is not active");

	await expect(
		repo.createManual(retentionAdmin, {
			memberIds: ["mem_a"],
			termId: "term_1",
			eventId: null,
			pointTypeId: "pt_retired",
			points: 3,
			reason: "Retired type",
		}),
	).rejects.toThrow("Point type is not active");
});
```

- [ ] **Step 7: Delete `recordEventAttendance` and type manual inserts**

From `retention.ts`, remove:

- `RecordEventAttendanceInput`.
- The `recordEventAttendance` repository signature.
- The `recordEventAttendance` implementation.

From `retention-unavailable.ts`, remove the stub property.

In `createManual`, query `pointTypes` for the submitted ID and `active = true` before writing. Throw `Point type is not active.` for missing and inactive IDs. Add:

```ts
pointTypeId: input.pointTypeId,
```

to every manual retention row.

- [ ] **Step 8: Add the point-type picker data**

In `data.ts`, import `asc`, `eq`, and `pointTypes`. Extend the return type with:

```ts
pointTypes: { id: string; key: string; label: string }[];
```

Load only active types:

```ts
const pointTypeRows = await db
	.select({ id: pointTypes.id, key: pointTypes.key, label: pointTypes.label })
	.from(pointTypes)
	.where(eq(pointTypes.active, true))
	.orderBy(asc(pointTypes.position), asc(pointTypes.label));
```

Return them unchanged as `pointTypes`.

- [ ] **Step 9: Wire the required visible selector**

In `actions.ts`, include:

```ts
pointTypeId: nullableText(formData.get("pointTypeId")) ?? "",
```

In `retention-form.tsx`, add the prop:

```ts
pointTypeOptions: { id: string; key: string; label: string }[];
```

Render this field between school year and event:

```tsx
<label className="grid gap-2 text-sm font-medium">
	Point type
	<Select
		name="pointTypeId"
		defaultValue={pointTypeOptions.find((option) => option.key === "retention")?.id ?? ""}
		required
	>
		{pointTypeOptions.map((option) => (
			<option key={option.id} value={option.id}>
				{option.label}
			</option>
		))}
	</Select>
</label>
```

In `page.tsx`, destructure `pointTypes`, include `pointTypes: []` in the load-failure object, and pass `pointTypeOptions={pointTypes}`.

- [ ] **Step 10: Run manual-entry tests and static checks**

Run:

```bash
pnpm exec vitest run src/db/types.test.ts src/db/repositories/retention.integration.test.ts
pnpm typecheck
```

Expected: PASS and no remaining type reference to `recordEventAttendance`.

- [ ] **Step 11: Confirm the dead writer is gone**

Run:

```bash
rg -n "recordEventAttendance|RecordEventAttendanceInput" src
```

Expected: no output.

- [ ] **Step 12: Commit the typed manual path**

```bash
git add src/db/types.ts src/db/types.test.ts src/db/repositories/retention.ts src/db/repositories/retention-unavailable.ts src/db/repositories/retention.integration.test.ts src/app/portal/admin/data/retention/data.ts src/app/portal/admin/data/retention/actions.ts src/app/portal/admin/data/retention/retention-form.tsx src/app/portal/admin/data/retention/page.tsx
git commit -m "feat: require point types for manual records"
```

---

### Task 5: Retention Totals and Typed Projections

**Files:**
- Modify: `src/db/repositories/retention.ts`
- Modify: `src/db/repositories/retention.integration.test.ts`
- Modify: `src/db/contract/retention.ts`
- Modify: `src/db/contract/retention.test.ts`

**Interfaces:**
- Produces: `TypedRetentionRecord = RetentionRecord & { pointTypeId: string; pointTypeLabel: string }`.
- Produces: `TermMasterRow.pointTypeId` and `TermMasterRow.pointTypeLabel`.
- Keeps all rows in `listForMember`, both report methods, and `myHistory`.
- Filters only totals and status calculations by `pointTypes.countsTowardRetention = true`.
- Defines `myHistory.summary.recordCount` as all typed rows returned, not only retention-bearing rows.

- [ ] **Step 1: Write the failing five-total and threshold tests**

In `retention.integration.test.ts`, seed for one member:

```ts
await insertRecord({ id: "ret_keep", pointTypeId: "pt_retention", points: 20 });
await insertRecord({ id: "ret_ignore", pointTypeId: "pt_frontliner", points: -50 });
```

Assert:

```ts
const summary = await repo.getMemberTermSummary(plainMember, {
	memberId: "mem_a",
	termId: "term_1",
});
const adminBoard = await repo.leaderboard(retentionAdmin, { termId: "term_1" });
const publicBoard = await repo.publicLeaderboard(plainMember, { termId: "term_1" });
const history = await repo.myHistory(plainMember, { termId: "term_1" });

expect(summary.totalPoints).toBe(20);
expect(summary.status).toBe("retained");
expect(adminBoard[0].totalPoints).toBe(20);
expect(publicBoard[0].totalPoints).toBe(20);
expect(history.summary?.totalPoints).toBe(20);
expect(history.summary?.status).toBe("retained");
expect(history.summary?.recordCount).toBe(2);
expect(history.records).toHaveLength(2);
```

This covers four SQL totals plus the `retention.ts:356` in-memory reduce. Task 6 covers the fifth total in `overview.ts`.

- [ ] **Step 2: Write failing projection tests**

For `listForTerm`, `listMemberTermHistory`, `listForMember`, and `myHistory`, insert one Retention row and one Frontliner row, then assert both are returned:

```ts
expect(termRows.map((row) => row.pointTypeLabel)).toEqual(["Retention", "Frontliner"]);
expect(memberRows.map((row) => row.pointTypeId)).toEqual(["pt_retention", "pt_frontliner"]);
expect(ownRows).toEqual(
	expect.arrayContaining([
		expect.objectContaining({ pointTypeLabel: "Retention" }),
		expect.objectContaining({ pointTypeLabel: "Frontliner" }),
	]),
);
expect(history.records.map((row) => row.pointTypeLabel).sort()).toEqual(["Frontliner", "Retention"]);
```

Order fixtures by distinct `recordedAt` values so expected arrays are deterministic.

- [ ] **Step 3: Filter the three retention SQL methods**

Import `pointTypes` and add an inner join plus policy predicate to:

- `getMemberTermSummary`.
- `leaderboard`.
- `publicLeaderboard`.

Use:

```ts
.innerJoin(pointTypes, eq(pointTypes.id, retentionRecords.pointTypeId))
.where(
	and(
		/* existing member or term predicates */
		eq(pointTypes.countsTowardRetention, true),
	),
)
```

Apply the same policy predicate to the `orderBy(sum(...))` queries through their filtered row set. Do not filter by `pointTypes.active`; inactive historical Retention rows still count if their type remains flagged.

- [ ] **Step 4: Add type metadata to row projections without filtering**

Define reusable selected columns for retention-record outputs:

```ts
const typedRecordColumns = {
	id: retentionRecords.id,
	memberId: retentionRecords.memberId,
	termId: retentionRecords.termId,
	eventId: retentionRecords.eventId,
	pointTypeId: retentionRecords.pointTypeId,
	pointTypeLabel: pointTypes.label,
	points: retentionRecords.points,
	reason: retentionRecords.reason,
	source: retentionRecords.source,
	recordedBy: retentionRecords.recordedBy,
	recordedAt: retentionRecords.recordedAt,
};
```

Add `pointTypeId` and `pointTypeLabel` to `reportBaseColumns`.

Join `pointTypes` by ID in:

- `listForMember`.
- `listForTerm`.
- `listMemberTermHistory`.
- `myHistory`.

These joins have no `countsTowardRetention` and no `active` predicate. Projections get metadata, not a filter.

- [ ] **Step 5: Fix the in-memory total only**

Select the policy bit only for `myHistory`:

```ts
const rows: Array<TypedRetentionRecord & { countsTowardRetention: boolean }> = await db
	.select({
		...typedRecordColumns,
		countsTowardRetention: pointTypes.countsTowardRetention,
	})
	.from(retentionRecords)
	.innerJoin(pointTypes, eq(pointTypes.id, retentionRecords.pointTypeId))
	.where(and(eq(retentionRecords.memberId, actor.memberId), eq(retentionRecords.termId, termId)))
	.orderBy(desc(retentionRecords.recordedAt));
```

Keep all `myHistory` rows and calculate:

```ts
const totalPoints = rows.reduce(
	(sum, row) => sum + (row.countsTowardRetention ? (row.points ?? 0) : 0),
	0,
);
```

Set `recordCount: rows.length`. The public `TypedRetentionRecord` does not expose the policy bit.

Return the public records explicitly:

```ts
const records: TypedRetentionRecord[] = rows.map(({ countsTowardRetention: _policy, ...record }) => record);
return { summary, records };
```

- [ ] **Step 6: Update shared output contracts**

In `retentionRecordOutputSchema`, add:

```ts
pointTypeId: z.string(),
pointTypeLabel: z.string(),
```

In `termMasterRowOutputSchema`, add the same two fields beside `points`.

Update `retention.test.ts` report fixtures and add a history parse:

```ts
const output = retentionContract.myHistory.output.parse({
	summary: null,
	records: [{
		id: "ret_1",
		memberId: "mem_1",
		termId: "term_1",
		eventId: null,
		pointTypeId: "pt_frontliner",
		pointTypeLabel: "Frontliner",
		points: 3,
		reason: "Led a project",
		source: "manual",
		recordedBy: "mem_admin",
		recordedAt: "2026-06-18T00:00:00.000Z",
	}],
});
expect(output.records[0]).toMatchObject({
	pointTypeId: "pt_frontliner",
	pointTypeLabel: "Frontliner",
});
```

- [ ] **Step 7: Run retention and contract tests**

Run:

```bash
pnpm exec vitest run src/db/repositories/retention.integration.test.ts src/db/contract/retention.test.ts
```

Expected: PASS. Both Frontliner projection rows remain visible while all retention totals equal only the Retention row.

- [ ] **Step 8: Commit retention reads**

```bash
git add src/db/repositories/retention.ts src/db/repositories/retention.integration.test.ts src/db/contract/retention.ts src/db/contract/retention.test.ts
git commit -m "fix: scope retention totals by point type"
```

---

### Task 6: Overview Retention Total

**Files:**
- Modify: `src/db/repositories/overview.ts`
- Modify: `src/db/repositories/overview.integration.test.ts`

**Interfaces:**
- Consumes: B1 `retentionRecords.pointTypeId` and `pointTypes.countsTowardRetention`.
- Keeps: `OverviewSummary` unchanged.
- Produces: dashboard `retention.points` from retention-bearing rows only.

- [ ] **Step 1: Write the failing mixed-type overview test**

Update the existing overview test fixture to insert:

```ts
await env.DB.prepare(`
	INSERT INTO retention_records
		(id, member_id, term_id, point_type_id, points, reason, source, recorded_by, recorded_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
	.bind("ret_keep", "mem_ov", "term_now", "pt_retention", 8, "Retention", "manual", "mem_admin", NOW.getTime())
	.run();
await env.DB.prepare(`
	INSERT INTO retention_records
		(id, member_id, term_id, point_type_id, points, reason, source, recorded_by, recorded_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
	.bind("ret_ignore", "mem_ov", "term_now", "pt_frontliner", 50, "Frontliner", "manual", "mem_admin", NOW.getTime())
	.run();
```

Seed both point types in `beforeEach`, then keep:

```ts
expect(summary.retention).toMatchObject({ points: 8, retainedAt: 20, termName: "Term 1" });
```

- [ ] **Step 2: Run the overview test and confirm failure**

Run:

```bash
pnpm exec vitest run src/db/repositories/overview.integration.test.ts
```

Expected: FAIL with 58 instead of 8.

- [ ] **Step 3: Filter the overview sum**

Import `pointTypes`, join it in the points query, and add:

```ts
eq(pointTypes.countsTowardRetention, true)
```

to the existing member and term predicates. Do not filter the rows elsewhere in the overview repository.

- [ ] **Step 4: Run the overview test**

Run:

```bash
pnpm exec vitest run src/db/repositories/overview.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the fifth total**

```bash
git add src/db/repositories/overview.ts src/db/repositories/overview.integration.test.ts
git commit -m "fix: filter overview retention points"
```

---

### Task 7: XLSX Point-Type Column

**Files:**
- Modify: `src/server/reporting/xlsx.ts`
- Modify: `src/server/reporting/xlsx.test.ts`

**Interfaces:**
- Consumes: Task 5's `TermMasterRow.pointTypeLabel` and `MemberHistoryRow.pointTypeLabel`.
- Produces: `Point Type` column in term-master and member-history workbooks.
- Keeps: event-roster workbook unchanged.

- [ ] **Step 1: Add point metadata to XLSX fixtures**

In `xlsx.test.ts`, add to `termRows[0]`:

```ts
pointTypeId: "pt_retention",
pointTypeLabel: "Retention",
```

- [ ] **Step 2: Write failing workbook assertions**

Extend the term assertion:

```ts
expect(json[0]).toMatchObject({
	Email: "a@example.com",
	Event: "Practice Night",
	"Point Type": "Retention",
	Points: 5,
	Source: "event_attendance",
});
```

Extend the member assertion:

```ts
expect(json[0]).toMatchObject({
	"Point Type": "Retention",
	Reason: "Attended Practice Night",
});
```

- [ ] **Step 3: Run the XLSX test and confirm failure**

Run:

```bash
pnpm exec vitest run src/server/reporting/xlsx.test.ts
```

Expected: FAIL because `Point Type` is absent.

- [ ] **Step 4: Add the XLSX columns**

In both `buildTermMasterWorkbook` and `buildMemberHistoryWorkbook`, place:

```ts
"Point Type": row.pointTypeLabel,
```

immediately before `Points`. Do not add a type column to the event roster.

- [ ] **Step 5: Run the XLSX test**

Run:

```bash
pnpm exec vitest run src/server/reporting/xlsx.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the export projection**

```bash
git add src/server/reporting/xlsx.ts src/server/reporting/xlsx.test.ts
git commit -m "feat: include point types in retention exports"
```

---

### Task 8: Full Verification and Graph Refresh

**Files:**
- Modify only if generated by the required command: `graphify-out/*`

**Interfaces:**
- Verifies all interfaces from Tasks 1 through 7.
- Produces no schema, migration, D1, or deployment changes.

- [ ] **Step 1: Run the complete B2 test set**

```bash
pnpm exec vitest run src/db/types.test.ts src/db/contract/events.test.ts src/db/contract/retention.test.ts src/db/repositories/event-awards.test.ts src/db/repositories/events.integration.test.ts src/db/repositories/retention.integration.test.ts src/db/repositories/overview.integration.test.ts src/server/reporting/xlsx.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the better-sqlite3 partial-index check**

```bash
pnpm exec tsx scripts/verify-points-upsert-local.ts
```

Expected: `Local partial-index upsert verified.`

- [ ] **Step 3: Run all repository tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Run static verification**

```bash
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Recheck the load-bearing source literals**

```bash
rg -n -F "targetWhere: sql" src/db/repositories/event-awards.ts
rg -n -F "source = 'event_attendance'" src/db/repositories/event-awards.ts
rg -n "recordEventAttendance|RecordEventAttendanceInput" src
rg -n "countsTowardRetention" src/db/repositories/retention.ts src/db/repositories/overview.ts
```

Expected:

- The first two commands find both attendance upsert builders and their exact literal predicates.
- The dead-writer command has no matches.
- The policy command finds the three retention SQL methods, `myHistory` reduce, and overview query.

- [ ] **Step 6: Check the changed manual form at mobile and desktop widths**

Run:

```bash
pnpm dev
```

Open `/portal/admin/data/retention` as a retention admin at 375 by 812 and 1440 by 900. Confirm the point-type selector is visible, defaults to Retention, is changeable, and creates no horizontal overflow. Stop the server after the check.

- [ ] **Step 7: Refresh the knowledge graph**

```bash
graphify update .
```

Review `git status --short`. Do not revert or stage unrelated graph changes that predated B2.

- [ ] **Step 8: Commit only remaining B2-owned verification output**

If `graphify update .` produced B2-owned graph changes that can be staged without including unrelated dirty files:

```bash
git add graphify-out
git commit -m "chore: refresh points knowledge graph"
```

If the graph files already contain unrelated unstaged work, leave them unstaged and report that exact condition instead of mixing ownership in a commit.

---

## Completion Criteria

- `setAwards` validates at the repository boundary and reconciles awards and attendee rows with set-based SQL.
- Both upsert builders contain the exact unqualified literal `targetWhere: sql\`source = 'event_attendance'\`` and their generated SQL is asserted.
- D1 and better-sqlite3 both execute the partial-index upsert successfully.
- `recordScan` creates one row per active award and no row for an inactive award.
- Reconciliation never deletes event-attendance history under inactive point types.
- `setPoints` modifies only Retention, preserves every non-Retention award, mirrors `crs_events.points`, and returns the distinct attendee count.
- Award reconciliation and its audit entry commit or roll back together; notification fan-out is best-effort after commit.
- `createManual` requires and stores an active `pointTypeId`; `recordEventAttendance` no longer exists.
- All five totals count only point types flagged for retention, including the in-memory `myHistory` reduce.
- Both row projections preserve all typed records and expose point metadata.
- Both retention XLSX exports include `Point Type`.
- No migration, D1, deployment, dependency, rebuild, drop, or rename occurs in B2.
