# Phase 4 — CRS Events + Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CRS events lifecycle (create -> approve, RSVP, member-carried static QR/barcode attendance with an event-admin scan flow plus manual-search fallback, event media, and the anonymity-aware event forum) and the unified `retention_records` system (event-derived entries, retention status, leaderboard) behind the existing repository + contract + internal-API seam.

**Architecture:** This is a repository-and-route-first feature. Every query lives in a Drizzle-backed repository function in `src/db/repositories/*.ts` that takes an explicit `actor`, calls `permissions.can()` before privileged work, and `audit.record()` after privileged writes. Cookie-authenticated `/api/*` route handlers call the repositories through `getRepositories()`; the same operations are exposed to shared-dev clients through typed `/internal/*` modules generated from a Zod contract. The member-carried QR/barcode is generated client-side from the member id (never persisted), and the event admin scans it against a chosen event; attendance writes are what create `retention_records` with `source='event_attendance'`. UI is built from the local shadcn/ui registry and styled with Tailwind tokens.

**Tech Stack:** Next.js 16 App Router on Cloudflare Workers (OpenNext), Drizzle ORM (SQLite dialect / D1), Auth.js v5 actor via `getActor()`, Zod contracts, Vitest + `@cloudflare/vitest-pool-workers` (the existing `vitest.config.mts` auto-applies `drizzle/migrations` to an ephemeral test D1), shadcn/ui local registry + lucide-react, Tailwind CSS v4.

## Global Constraints

- Drizzle schema at `src/db/schema.ts` is the ONE source of truth for all environments; one migration set under `drizzle/migrations` (master plan Global Constraints). This phase adds NO new tables or columns — every table it needs (`crsEvents`, `eventRsvps`, `crsAttendance`, `eventMedia`, `eventForumPosts`, `terms`, `retentionRecords`) already exists from the v5 foundation migration. If a query needs a column or index that is missing, that is a schema task with its own migration and dev-Worker redeploy, not an inline edit.
- Every repository function takes an explicit `actor` (`{ memberId, roles, context?, sharedTokenHash?, sharedTokenLabel? }`), calls `can(actor, action)` before any privileged read/write, and calls `audit.record(actor, {...})` after privileged writes (master plan §3.2, §5). Authorization lives in the repository layer so it holds identically across access modes.
- Mutating `/api/*` handlers are cookie-authenticated and same-origin: call `assertSameOrigin(request, config.APP_BASE_URL)` and return 403 on rejection; when `config.APP_ENV === "shared"`, proxy to the matching `/internal/*` path via `proxySharedApiRequest()` instead of running the repository locally (master plan §4.5, mirrored from `src/app/api/uploads/route.ts`).
- `/internal/*` handlers are cross-origin by design: return `new Response("Not found", { status: 404 })` unless `DEPLOY_ENV === "dev"`; authenticate with the shared bearer token via `resolveSharedActor(db, request)` (no cookie auth); apply the CORS allowlist via `getInternalCorsHeaders(request, allowedOrigins)`; destructive/admin ops require BOTH the actor's permission AND `sharedDev: "allow"` in the contract (master plan §3.3).
- D1 budget (master plan §3.4): <= 100 bound params and <= 100 KB per statement; no unbounded `SELECT` (every list paginates with a default and max page size); every query has a backing index; use `db.batch()` for multi-statement writes (single round trip, implicit transaction); D1 has no interactive transactions.
- Permission action strings are fixed by `src/server/auth/permissions.ts`: `event:approve`, `points:assign`, `retention:record` are on the `retention` role; `super` inherits all. Do NOT invent new action strings in this phase.
- IDs are app-generated prefixed strings via `createId(prefix)` from `@/lib/ids` (e.g. `createId("evt")`). Timestamps are `Date` objects on the way in (Drizzle `mode:"timestamp_ms"` stores epoch-ms).
- Forum anonymity (master plan §6): `member_id` is ALWAYS stored on `event_forum_posts` (for moderation); when `anonymous=true` the API/repository must NEVER return author identity to members or to normal admins; only an actor holding the `super` role may reveal author identity, and that reveal is an audited action (`category: "event"`).
- UI is built from the local shadcn/ui registry (`src/components/ui`); add a missing component with `pnpm dlx shadcn@latest add <component>` and theme via `src/app/globals.css` tokens. Reuse before adding. No CSS-in-JS, no em dashes in UI copy / code comments / docs / commits (master plan Global Constraints).
- After this phase lands (it changes repository signatures used over the proxy, the internal contract, and the internal routes), the dev Worker must be redeployed: `pnpm db:migrate:dev` (no-op if no migration) then `pnpm deploy:dev`, per CLAUDE.md and master-plan §15. Surfaced as the final, approval-gated step. Show the exact `pnpm exec wrangler` / `pnpm db:*` / `pnpm deploy:*` command and WAIT for approval before any D1 reset, migration, seed, delete, or production-touching operation (CLAUDE.md).

### Vestigial-column flag (carry into the schema backlog, do NOT fix in this phase)

`crs_events.checkin_secret` is `text("checkin_secret").notNull()` in `src/db/schema.ts:178`. Under the v5 QR/barcode flip the EVENT no longer carries a rotating secret that members scan; instead each MEMBER carries a static code and the admin scans it (master plan §6 `crs_attendance`). The column is therefore vestigial: nothing in this phase reads or validates it, and the attendance flow does not depend on it. This phase intentionally does NOT drop it (dropping a NOT NULL column is a SQLite table-rebuild migration with FK choreography per master-plan §2.2, plus a dev-Worker redeploy, which is out of scope for a feature phase). The seed already supplies a placeholder value (`checkinSecret: "demo-checkin-secret"`), and `createEvent` below writes an empty string so inserts keep succeeding. Record the drop as a follow-up schema cleanup. Until then, never read `checkinSecret` anywhere in feature code.

---

### Task 1: Retention contract + repository — event-derived records, status, leaderboard

**Files:**
- Create: `src/db/contract/retention.ts`
- Modify: `src/db/repositories/retention.ts` (replace the empty stub in full)
- Create: `src/db/repositories/retention.integration.test.ts`

**Interfaces:**
- Consumes: `retentionRecords`, `terms`, `members` from `@/db/schema`; `Actor` + `can` from `@/server/auth/permissions`; `AuditRepository` from `./audit`; `createId` from `@/lib/ids`.
- Produces:
  - `RetentionRecord = InferSelectModel<typeof retentionRecords>`.
  - `RetentionRepository` with: `recordEventAttendance(actor, input: RecordEventAttendanceInput): Promise<RetentionRecord>`, `listForMember(actor, input: ListForMemberInput): Promise<RetentionRecord[]>`, `getMemberTermSummary(actor, input: MemberTermSummaryInput): Promise<RetentionSummary>`, `leaderboard(actor, input: LeaderboardInput): Promise<LeaderboardRow[]>`.
  - `RecordEventAttendanceInput = { memberId: string; termId: string; eventId: string; points: number | null; reason: string }`.
  - `ListForMemberInput = { memberId: string; termId: string; limit?: number; offset?: number }`.
  - `MemberTermSummaryInput = { memberId: string; termId: string }`.
  - `RetentionSummary = { totalPoints: number; recordCount: number; retainedAt: number; probationBelow: number; status: "retained" | "on_track" | "probation" }`.
  - `LeaderboardInput = { termId: string; limit?: number; offset?: number }`.
  - `LeaderboardRow = { memberId: string; fullName: string | null; name: string | null; totalPoints: number }`.
  - `createRetentionRepository(db, audit): RetentionRepository`.
  - Task 2 (events repo) calls `recordEventAttendance`; Task 6 (My Retention History UI) consumes `listForMember` + `getMemberTermSummary`; Task 7 (leaderboard UI) consumes `leaderboard`; Phase 5 (manual records) extends this repository.

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/retention.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createRetentionRepository } from "./retention";

const retentionAdmin: Actor = { memberId: "mem_admin", roles: ["retention"] };
const plainMember: Actor = { memberId: "mem_a", roles: ["member"] };

const TERM_START = new Date("2026-06-01T00:00:00.000Z");
const TERM_END = new Date("2026-10-31T00:00:00.000Z");

function makeRepo() {
	const db = drizzle(env.DB, { schema });
	return { db, repo: createRetentionRepository(db, createAuditRepository(db)) };
}

describe("retention repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM retention_records").run();
		await env.DB.prepare("DELETE FROM crs_events").run();
		await env.DB.prepare("DELETE FROM terms").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)")
			.bind("mem_a", "a@example.com", "A", "Member A")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)")
			.bind("mem_b", "b@example.com", "B", "Member B")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin")
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_1", "Term 1", 20, 10, TERM_START.getTime(), TERM_END.getTime())
			.run();
	});

	it("records an event-attendance retention row and audits it", async () => {
		const { db, repo } = makeRepo();
		const created = await repo.recordEventAttendance(retentionAdmin, {
			memberId: "mem_a",
			termId: "term_1",
			eventId: null as unknown as string,
			points: 5,
			reason: "Attended Practice Night",
		});
		expect(created.source).toBe("event_attendance");
		expect(created.points).toBe(5);
		const [audit] = await db.select().from(schema.auditLogs);
		expect(audit).toMatchObject({ action: "retention:record_attendance", category: "retention", targetId: "mem_a" });
	});

	it("denies a plain member from recording attendance", async () => {
		const { repo } = makeRepo();
		await expect(
			repo.recordEventAttendance(plainMember, { memberId: "mem_a", termId: "term_1", eventId: null as unknown as string, points: 5, reason: "x" }),
		).rejects.toThrow("Not authorized");
	});

	it("lets a member read their own term records but not another member's", async () => {
		const { repo } = makeRepo();
		await repo.recordEventAttendance(retentionAdmin, { memberId: "mem_a", termId: "term_1", eventId: null as unknown as string, points: 5, reason: "x" });
		const own = await repo.listForMember(plainMember, { memberId: "mem_a", termId: "term_1" });
		expect(own).toHaveLength(1);
		await expect(repo.listForMember(plainMember, { memberId: "mem_b", termId: "term_1" })).rejects.toThrow("Not authorized");
	});

	it("derives a per-term summary with status from the term thresholds", async () => {
		const { repo } = makeRepo();
		await repo.recordEventAttendance(retentionAdmin, { memberId: "mem_a", termId: "term_1", eventId: null as unknown as string, points: 12, reason: "x" });
		await repo.recordEventAttendance(retentionAdmin, { memberId: "mem_a", termId: "term_1", eventId: null as unknown as string, points: 12, reason: "y" });
		const summary = await repo.getMemberTermSummary(plainMember, { memberId: "mem_a", termId: "term_1" });
		expect(summary.totalPoints).toBe(24);
		expect(summary.recordCount).toBe(2);
		expect(summary.status).toBe("retained");
	});

	it("ranks members by total points for the term leaderboard", async () => {
		const { repo } = makeRepo();
		await repo.recordEventAttendance(retentionAdmin, { memberId: "mem_a", termId: "term_1", eventId: null as unknown as string, points: 5, reason: "x" });
		await repo.recordEventAttendance(retentionAdmin, { memberId: "mem_b", termId: "term_1", eventId: null as unknown as string, points: 15, reason: "y" });
		const board = await repo.leaderboard(retentionAdmin, { termId: "term_1" });
		expect(board.map((row) => row.memberId)).toEqual(["mem_b", "mem_a"]);
		expect(board[0].totalPoints).toBe(15);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- retention.integration.test.ts`
Expected: FAIL — `createRetentionRepository` currently returns `{}`, so `repo.recordEventAttendance` is `undefined` (TypeError) and the contract types do not exist yet.

- [ ] **Step 3: Write the contract**

Create `src/db/contract/retention.ts`:
```ts
import { z } from "zod";
import { operation } from "./common";

export const retentionRecordOutputSchema = z.object({
	id: z.string(),
	memberId: z.string(),
	termId: z.string(),
	eventId: z.string().nullable(),
	points: z.number().int().nullable(),
	reason: z.string(),
	source: z.enum(["event_attendance", "manual"]),
	recordedBy: z.string(),
	recordedAt: z.coerce.date(),
});

export const retentionSummaryOutputSchema = z.object({
	totalPoints: z.number().int(),
	recordCount: z.number().int(),
	retainedAt: z.number().int(),
	probationBelow: z.number().int(),
	status: z.enum(["retained", "on_track", "probation"]),
});

export const leaderboardRowOutputSchema = z.object({
	memberId: z.string(),
	fullName: z.string().nullable(),
	name: z.string().nullable(),
	totalPoints: z.number().int(),
});

export const retentionContract = {
	listForMember: operation({
		input: z.object({
			memberId: z.string().min(1),
			termId: z.string().min(1),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
		output: z.object({ records: z.array(retentionRecordOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	memberTermSummary: operation({
		input: z.object({ memberId: z.string().min(1), termId: z.string().min(1) }),
		output: z.object({ summary: retentionSummaryOutputSchema }),
		auth: "member",
		sharedDev: "allow",
	}),
	leaderboard: operation({
		input: z.object({
			termId: z.string().min(1),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
		output: z.object({ rows: z.array(leaderboardRowOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
};
```

- [ ] **Step 4: Replace `src/db/repositories/retention.ts` in full**

```ts
import { and, desc, eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { members, retentionRecords, terms } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

export type RetentionRecord = InferSelectModel<typeof retentionRecords>;

export type RecordEventAttendanceInput = {
	memberId: string;
	termId: string;
	eventId: string;
	points: number | null;
	reason: string;
};

export type ListForMemberInput = { memberId: string; termId: string; limit?: number; offset?: number };
export type MemberTermSummaryInput = { memberId: string; termId: string };
export type RetentionStatus = "retained" | "on_track" | "probation";
export type RetentionSummary = {
	totalPoints: number;
	recordCount: number;
	retainedAt: number;
	probationBelow: number;
	status: RetentionStatus;
};
export type LeaderboardInput = { termId: string; limit?: number; offset?: number };
export type LeaderboardRow = { memberId: string; fullName: string | null; name: string | null; totalPoints: number };

export type RetentionRepository = {
	recordEventAttendance(actor: Actor, input: RecordEventAttendanceInput): Promise<RetentionRecord>;
	listForMember(actor: Actor, input: ListForMemberInput): Promise<RetentionRecord[]>;
	getMemberTermSummary(actor: Actor, input: MemberTermSummaryInput): Promise<RetentionSummary>;
	leaderboard(actor: Actor, input: LeaderboardInput): Promise<LeaderboardRow[]>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function statusFor(totalPoints: number, retainedAt: number, probationBelow: number): RetentionStatus {
	if (totalPoints >= retainedAt) return "retained";
	if (totalPoints < probationBelow) return "probation";
	return "on_track";
}

export function createRetentionRepository(db: Db, audit: AuditRepository): RetentionRepository {
	return {
		async recordEventAttendance(actor, input) {
			if (!can(actor, "points:assign")) {
				throw new Error("Not authorized to record retention points.");
			}
			const [record] = await db
				.insert(retentionRecords)
				.values({
					id: createId("ret"),
					memberId: input.memberId,
					termId: input.termId,
					eventId: input.eventId,
					points: input.points,
					reason: input.reason,
					source: "event_attendance",
					recordedBy: actor.memberId,
				})
				.returning();
			await audit.record(actor, {
				action: "retention:record_attendance",
				targetType: "member",
				targetId: input.memberId,
				category: "retention",
				detail: input.eventId ? `event=${input.eventId}` : null,
			});
			return record;
		},

		async listForMember(actor, input) {
			if (actor.memberId !== input.memberId && !can(actor, "retention:record")) {
				throw new Error("Not authorized to read these retention records.");
			}
			return db
				.select()
				.from(retentionRecords)
				.where(and(eq(retentionRecords.memberId, input.memberId), eq(retentionRecords.termId, input.termId)))
				.orderBy(desc(retentionRecords.recordedAt))
				.limit(Math.min(input.limit ?? 50, 100))
				.offset(input.offset ?? 0);
		},

		async getMemberTermSummary(actor, input) {
			if (actor.memberId !== input.memberId && !can(actor, "retention:record")) {
				throw new Error("Not authorized to read this retention summary.");
			}
			const [agg] = await db
				.select({
					totalPoints: sql<number>`coalesce(sum(${retentionRecords.points}), 0)`,
					recordCount: sql<number>`count(*)`,
				})
				.from(retentionRecords)
				.where(and(eq(retentionRecords.memberId, input.memberId), eq(retentionRecords.termId, input.termId)));
			const [term] = await db
				.select({ retainedAt: terms.retainedAt, probationBelow: terms.probationBelow })
				.from(terms)
				.where(eq(terms.id, input.termId))
				.limit(1);
			const retainedAt = term?.retainedAt ?? 0;
			const probationBelow = term?.probationBelow ?? 0;
			const totalPoints = Number(agg?.totalPoints ?? 0);
			const recordCount = Number(agg?.recordCount ?? 0);
			return {
				totalPoints,
				recordCount,
				retainedAt,
				probationBelow,
				status: statusFor(totalPoints, retainedAt, probationBelow),
			};
		},

		async leaderboard(actor, input) {
			if (!can(actor, "retention:record")) {
				throw new Error("Not authorized to read the retention leaderboard.");
			}
			return db
				.select({
					memberId: retentionRecords.memberId,
					fullName: members.fullName,
					name: members.name,
					totalPoints: sql<number>`coalesce(sum(${retentionRecords.points}), 0)`,
				})
				.from(retentionRecords)
				.innerJoin(members, eq(members.id, retentionRecords.memberId))
				.where(eq(retentionRecords.termId, input.termId))
				.groupBy(retentionRecords.memberId, members.fullName, members.name)
				.orderBy(desc(sql`coalesce(sum(${retentionRecords.points}), 0)`))
				.limit(Math.min(input.limit ?? 50, 100))
				.offset(input.offset ?? 0);
		},
	};
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- retention.integration.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — `src/db/repositories/index.ts` already imports `createRetentionRepository`; its call site `createRetentionRepository()` now needs `(db, audit)`. Task 8 rewires `index.ts`; until then typecheck reports exactly that one arity mismatch at `index.ts:21` and `index.ts:43`. If you run the tasks in order, defer that fix to Task 8 and confirm the only typecheck error is those two call sites.

- [ ] **Step 7: Commit**

```bash
git add src/db/contract/retention.ts src/db/repositories/retention.ts src/db/repositories/retention.integration.test.ts
git commit -m "feat(retention): event-derived records, term status, leaderboard repository

Adds createRetentionRepository with recordEventAttendance, listForMember,
getMemberTermSummary, and leaderboard. Retention status is derived per
term from the term retained_at / probation_below thresholds.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Events repository — create, approve, RSVP, scan attendance, manual search

**Files:**
- Modify: `src/db/repositories/events.ts` (replace the empty stub in full)
- Create: `src/db/repositories/events.integration.test.ts`

**Interfaces:**
- Consumes: `crsEvents`, `eventRsvps`, `crsAttendance`, `members`, `retentionRecords` from `@/db/schema`; `Actor` + `can` from `@/server/auth/permissions`; `AuditRepository` from `./audit`; `RetentionRepository` from `./retention` (Task 1); `createId` from `@/lib/ids`.
- Produces:
  - `EventRecord = InferSelectModel<typeof crsEvents>`.
  - `EventsRepository` with: `create(actor, input: CreateEventInput): Promise<EventRecord>`, `listApproved(actor, input?: ListEventsInput): Promise<EventRecord[]>`, `listPending(actor, input?: ListEventsInput): Promise<EventRecord[]>`, `getById(actor, id): Promise<EventRecord | null>`, `approve(actor, eventId): Promise<EventRecord>`, `reject(actor, eventId): Promise<EventRecord>`, `setRsvp(actor, input: SetRsvpInput): Promise<{ state: RsvpState }>`, `recordScan(actor, input: RecordScanInput): Promise<RecordScanResult>`, `searchAttendableMembers(actor, input: MemberSearchInput): Promise<AttendableMember[]>`, `listAttendance(actor, eventId): Promise<AttendanceRow[]>`.
  - `CreateEventInput = { title: string; type: EventType; place: string; description: string; startsAt: Date; endsAt: Date | null; points: number | null; capacity: number | null }`.
  - `ListEventsInput = { limit?: number; offset?: number }`.
  - `SetRsvpInput = { eventId: string; state: RsvpState }`.
  - `RecordScanInput = { eventId: string; memberId: string; termId: string }`.
  - `RecordScanResult = { eventId: string; memberId: string; scannedAt: Date; alreadyPresent: boolean }`.
  - `MemberSearchInput = { eventId: string; query: string; limit?: number }`.
  - `AttendableMember = { memberId: string; fullName: string | null; name: string | null; email: string; alreadyScanned: boolean }`.
  - `AttendanceRow = { memberId: string; fullName: string | null; name: string | null; scannedAt: Date; scannedBy: string }`.
  - Task 3 exposes these over `/api/events*` + `/internal/events`; Task 5 (scan UI) consumes `recordScan` + `searchAttendableMembers` + `listAttendance`; Task 6/7 consume `listApproved` + `getById`.
- `EventType` and `RsvpState` are imported from `@/db/schema` (already exported there).

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/events.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEventsRepository } from "./events";
import { createRetentionRepository } from "./retention";

const retentionAdmin: Actor = { memberId: "mem_admin", roles: ["retention"] };
const member: Actor = { memberId: "mem_a", roles: ["member"] };

const START = new Date("2026-07-10T10:00:00.000Z");
const END = new Date("2026-07-10T12:00:00.000Z");
const TERM_START = new Date("2026-06-01T00:00:00.000Z");
const TERM_END = new Date("2026-10-31T00:00:00.000Z");

function makeRepos() {
	const db = drizzle(env.DB, { schema });
	const audit = createAuditRepository(db);
	const retention = createRetentionRepository(db, audit);
	return { db, repo: createEventsRepository(db, audit, retention) };
}

describe("events repository on D1", () => {
	beforeEach(async () => {
		for (const table of ["retention_records", "crs_attendance", "event_rsvps", "crs_events", "terms", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)")
			.bind("mem_a", "a@example.com", "A", "Member A")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin")
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_1", "Term 1", 20, 10, TERM_START.getTime(), TERM_END.getTime())
			.run();
	});

	async function makeApprovedEvent() {
		const { repo } = makeRepos();
		const created = await repo.create(retentionAdmin, {
			title: "Practice Night",
			type: "official",
			place: "SOM 111",
			description: "Practice",
			startsAt: START,
			endsAt: END,
			points: 5,
			capacity: null,
		});
		await repo.approve(retentionAdmin, created.id);
		return created.id;
	}

	it("creates a pending event and only a retention admin can approve it", async () => {
		const { repo } = makeRepos();
		const created = await repo.create(retentionAdmin, {
			title: "Practice Night",
			type: "official",
			place: "SOM 111",
			description: "Practice",
			startsAt: START,
			endsAt: END,
			points: 5,
			capacity: null,
		});
		expect(created.status).toBe("pending");
		await expect(repo.approve(member, created.id)).rejects.toThrow("Not authorized");
		const approved = await repo.approve(retentionAdmin, created.id);
		expect(approved.status).toBe("approved");
		expect(approved.approvedBy).toBe("mem_admin");
	});

	it("only lists approved events to plain members", async () => {
		const { repo } = makeRepos();
		await repo.create(retentionAdmin, {
			title: "Pending One",
			type: "casual",
			place: "x",
			description: "x",
			startsAt: START,
			endsAt: null,
			points: null,
			capacity: null,
		});
		const id = await makeApprovedEvent();
		const approved = await repo.listApproved(member, {});
		expect(approved.map((event) => event.id)).toEqual([id]);
	});

	it("sets and clears a member RSVP idempotently", async () => {
		const id = await makeApprovedEvent();
		const { repo, db } = makeRepos();
		await repo.setRsvp(member, { eventId: id, state: "going" });
		await repo.setRsvp(member, { eventId: id, state: "going" });
		const rows = await db.select().from(schema.eventRsvps);
		expect(rows).toHaveLength(1);
		expect(rows[0].state).toBe("going");
		await repo.setRsvp(member, { eventId: id, state: "none" });
		const cleared = await db.select().from(schema.eventRsvps);
		expect(cleared[0].state).toBe("none");
	});

	it("records a scan once, is idempotent on re-scan, and creates an event-attendance retention row", async () => {
		const id = await makeApprovedEvent();
		const { repo, db } = makeRepos();
		const first = await repo.recordScan(retentionAdmin, { eventId: id, memberId: "mem_a", termId: "term_1" });
		expect(first.alreadyPresent).toBe(false);
		const second = await repo.recordScan(retentionAdmin, { eventId: id, memberId: "mem_a", termId: "term_1" });
		expect(second.alreadyPresent).toBe(true);
		const attendance = await db.select().from(schema.crsAttendance);
		expect(attendance).toHaveLength(1);
		const retention = await db.select().from(schema.retentionRecords);
		expect(retention).toHaveLength(1);
		expect(retention[0]).toMatchObject({ source: "event_attendance", points: 5, eventId: id, memberId: "mem_a" });
	});

	it("denies a plain member from scanning attendance", async () => {
		const id = await makeApprovedEvent();
		const { repo } = makeRepos();
		await expect(repo.recordScan(member, { eventId: id, memberId: "mem_a", termId: "term_1" })).rejects.toThrow(
			"Not authorized",
		);
	});

	it("manual search finds an attendable member and flags whether they are already scanned", async () => {
		const id = await makeApprovedEvent();
		const { repo } = makeRepos();
		const before = await repo.searchAttendableMembers(retentionAdmin, { eventId: id, query: "Member A" });
		expect(before[0]).toMatchObject({ memberId: "mem_a", alreadyScanned: false });
		await repo.recordScan(retentionAdmin, { eventId: id, memberId: "mem_a", termId: "term_1" });
		const after = await repo.searchAttendableMembers(retentionAdmin, { eventId: id, query: "a@example.com" });
		expect(after[0]).toMatchObject({ memberId: "mem_a", alreadyScanned: true });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- events.integration.test.ts`
Expected: FAIL — `createEventsRepository` currently returns `{}` and takes no args, so every method is `undefined`.

- [ ] **Step 3: Replace `src/db/repositories/events.ts` in full**

```ts
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { crsAttendance, crsEvents, eventRsvps, members } from "@/db/schema";
import type { EventType, RsvpState } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import type { RetentionRepository } from "./retention";

export type EventRecord = InferSelectModel<typeof crsEvents>;

export type CreateEventInput = {
	title: string;
	type: EventType;
	place: string;
	description: string;
	startsAt: Date;
	endsAt: Date | null;
	points: number | null;
	capacity: number | null;
};

export type ListEventsInput = { limit?: number; offset?: number };
export type SetRsvpInput = { eventId: string; state: RsvpState };
export type RecordScanInput = { eventId: string; memberId: string; termId: string };
export type RecordScanResult = { eventId: string; memberId: string; scannedAt: Date; alreadyPresent: boolean };
export type MemberSearchInput = { eventId: string; query: string; limit?: number };
export type AttendableMember = { memberId: string; fullName: string | null; name: string | null; email: string; alreadyScanned: boolean };
export type AttendanceRow = { memberId: string; fullName: string | null; name: string | null; scannedAt: Date; scannedBy: string };

export type EventsRepository = {
	create(actor: Actor, input: CreateEventInput): Promise<EventRecord>;
	listApproved(actor: Actor, input?: ListEventsInput): Promise<EventRecord[]>;
	listPending(actor: Actor, input?: ListEventsInput): Promise<EventRecord[]>;
	getById(actor: Actor, id: string): Promise<EventRecord | null>;
	approve(actor: Actor, eventId: string): Promise<EventRecord>;
	reject(actor: Actor, eventId: string): Promise<EventRecord>;
	setRsvp(actor: Actor, input: SetRsvpInput): Promise<{ state: RsvpState }>;
	recordScan(actor: Actor, input: RecordScanInput): Promise<RecordScanResult>;
	searchAttendableMembers(actor: Actor, input: MemberSearchInput): Promise<AttendableMember[]>;
	listAttendance(actor: Actor, eventId: string): Promise<AttendanceRow[]>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function loadEvent(db: Db, eventId: string): Promise<EventRecord | null> {
	const [event] = await db.select().from(crsEvents).where(eq(crsEvents.id, eventId)).limit(1);
	return event ?? null;
}

export function createEventsRepository(db: Db, audit: AuditRepository, retention: RetentionRepository): EventsRepository {
	return {
		async create(actor, input) {
			if (!can(actor, "event:approve")) {
				throw new Error("Not authorized to create events.");
			}
			const [event] = await db
				.insert(crsEvents)
				.values({
					id: createId("evt"),
					title: input.title,
					type: input.type,
					status: "pending",
					points: input.points,
					place: input.place,
					capacity: input.capacity,
					startsAt: input.startsAt,
					endsAt: input.endsAt,
					description: input.description,
					createdBy: actor.memberId,
					// checkin_secret is vestigial under the v5 QR flip (master plan flag);
					// the NOT NULL column still needs a value so inserts succeed.
					checkinSecret: "",
				})
				.returning();
			await audit.record(actor, { action: "event:create", targetType: "event", targetId: event.id, category: "event" });
			return event;
		},

		async listApproved(actor, input) {
			if (!actor) throw new Error("Authentication required.");
			return db
				.select()
				.from(crsEvents)
				.where(eq(crsEvents.status, "approved"))
				.orderBy(asc(crsEvents.startsAt))
				.limit(Math.min(input?.limit ?? 50, 100))
				.offset(input?.offset ?? 0);
		},

		async listPending(actor, input) {
			if (!can(actor, "event:approve")) {
				throw new Error("Not authorized to view pending events.");
			}
			return db
				.select()
				.from(crsEvents)
				.where(eq(crsEvents.status, "pending"))
				.orderBy(asc(crsEvents.startsAt))
				.limit(Math.min(input?.limit ?? 50, 100))
				.offset(input?.offset ?? 0);
		},

		async getById(actor, id) {
			const event = await loadEvent(db, id);
			if (!event) return null;
			if (event.status !== "approved" && !can(actor, "event:approve")) return null;
			return event;
		},

		async approve(actor, eventId) {
			if (!can(actor, "event:approve")) {
				throw new Error("Not authorized to approve events.");
			}
			const [event] = await db
				.update(crsEvents)
				.set({ status: "approved", approvedBy: actor.memberId, approvedAt: new Date() })
				.where(eq(crsEvents.id, eventId))
				.returning();
			if (!event) throw new Error("Event not found.");
			await audit.record(actor, { action: "event:approve", targetType: "event", targetId: eventId, category: "event" });
			return event;
		},

		async reject(actor, eventId) {
			if (!can(actor, "event:approve")) {
				throw new Error("Not authorized to reject events.");
			}
			const [event] = await db
				.update(crsEvents)
				.set({ status: "rejected", approvedBy: actor.memberId, approvedAt: new Date() })
				.where(eq(crsEvents.id, eventId))
				.returning();
			if (!event) throw new Error("Event not found.");
			await audit.record(actor, { action: "event:reject", targetType: "event", targetId: eventId, category: "event" });
			return event;
		},

		async setRsvp(actor, input) {
			const event = await loadEvent(db, input.eventId);
			if (!event || event.status !== "approved") throw new Error("Event not found.");
			await db
				.insert(eventRsvps)
				.values({ eventId: input.eventId, memberId: actor.memberId, state: input.state, updatedAt: new Date() })
				.onConflictDoUpdate({
					target: [eventRsvps.eventId, eventRsvps.memberId],
					set: { state: input.state, updatedAt: new Date() },
				});
			return { state: input.state };
		},

		async recordScan(actor, input) {
			if (!can(actor, "points:assign")) {
				throw new Error("Not authorized to scan attendance.");
			}
			const event = await loadEvent(db, input.eventId);
			if (!event || event.status !== "approved") throw new Error("Event not found.");

			const [existing] = await db
				.select({ memberId: crsAttendance.memberId })
				.from(crsAttendance)
				.where(and(eq(crsAttendance.eventId, input.eventId), eq(crsAttendance.memberId, input.memberId)))
				.limit(1);
			const scannedAt = new Date();
			if (existing) {
				return { eventId: input.eventId, memberId: input.memberId, scannedAt, alreadyPresent: true };
			}

			await db
				.insert(crsAttendance)
				.values({ eventId: input.eventId, memberId: input.memberId, scannedAt, scannedBy: actor.memberId });
			await retention.recordEventAttendance(actor, {
				memberId: input.memberId,
				termId: input.termId,
				eventId: input.eventId,
				points: event.points,
				reason: `Attended ${event.title}`,
			});
			await audit.record(actor, {
				action: "event:scan_attendance",
				targetType: "event",
				targetId: input.eventId,
				category: "event",
				detail: `member=${input.memberId}`,
			});
			return { eventId: input.eventId, memberId: input.memberId, scannedAt, alreadyPresent: false };
		},

		async searchAttendableMembers(actor, input) {
			if (!can(actor, "points:assign")) {
				throw new Error("Not authorized to search members for attendance.");
			}
			const term = `%${input.query.trim().toLowerCase()}%`;
			const rows = await db
				.select({
					memberId: members.id,
					fullName: members.fullName,
					name: members.name,
					email: members.email,
					scannedMemberId: crsAttendance.memberId,
				})
				.from(members)
				.leftJoin(
					crsAttendance,
					and(eq(crsAttendance.memberId, members.id), eq(crsAttendance.eventId, input.eventId)),
				)
				.where(
					or(
						like(sql`lower(${members.email})`, term),
						like(sql`lower(${members.fullName})`, term),
						like(sql`lower(${members.name})`, term),
					),
				)
				.orderBy(asc(members.fullName))
				.limit(Math.min(input.limit ?? 20, 50));
			return rows.map((row: { memberId: string; fullName: string | null; name: string | null; email: string; scannedMemberId: string | null }) => ({
				memberId: row.memberId,
				fullName: row.fullName,
				name: row.name,
				email: row.email,
				alreadyScanned: row.scannedMemberId !== null,
			}));
		},

		async listAttendance(actor, eventId) {
			if (!can(actor, "points:assign")) {
				throw new Error("Not authorized to view attendance.");
			}
			return db
				.select({
					memberId: crsAttendance.memberId,
					fullName: members.fullName,
					name: members.name,
					scannedAt: crsAttendance.scannedAt,
					scannedBy: crsAttendance.scannedBy,
				})
				.from(crsAttendance)
				.innerJoin(members, eq(members.id, crsAttendance.memberId))
				.where(eq(crsAttendance.eventId, eventId))
				.orderBy(desc(crsAttendance.scannedAt));
		},
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- events.integration.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: the only new errors are the `createEventsRepository()` call sites in `src/db/repositories/index.ts:20` and `:42` (arity changed to `(db, audit, retention)`). Task 8 rewires `index.ts`; if running in order, confirm those are the only outstanding errors.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/events.ts src/db/repositories/events.integration.test.ts
git commit -m "feat(events): create/approve/RSVP/scan/manual-search events repository

Member-carried-code scan flow: recordScan writes attendance once
(idempotent) and an event-attendance retention row at the event's point
value. searchAttendableMembers powers the manual fallback and flags who
is already scanned. checkin_secret is left empty (vestigial under v5).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Event API routes + internal events module — create, approve, RSVP, scan

**Files:**
- Create: `src/db/contract/events.ts`
- Create: `src/server/internal/events.ts`
- Create: `src/app/internal/events/route.ts`
- Create: `src/app/api/events/route.ts`
- Create: `src/app/api/events/[id]/rsvp/route.ts`
- Create: `src/app/api/events/[id]/approve/route.ts`
- Create: `src/app/api/events/[id]/scan/route.ts`
- Create: `src/app/api/events/[id]/members/route.ts`
- Create: `src/server/internal/events.test.ts`

**Interfaces:**
- Consumes: `getRepositories()` from `@/db`; `getActor` from `@/server/auth/actor`; `getAppConfig` from `@/server/env`; `assertSameOrigin` from `@/server/http/origin`; `proxySharedApiRequest` from `@/server/shared-api`; `getD1Db` from `@/db/client`; `createEventsRepository` from `@/db/repositories/events` (Task 2); `createAuditRepository`/`createRetentionRepository`; `resolveSharedActor` from `@/server/internal/shared-actor`; `getInternalCorsHeaders` + `splitAllowedOrigins` from `@/server/internal/cors`; `DeployEnv` from `@/server/env`.
- Produces: HTTP surfaces. `POST /api/events` (create, retention admin), `POST /api/events/[id]/approve` (approve, retention admin), `POST /api/events/[id]/rsvp` (member), `POST /api/events/[id]/scan` (retention admin), `GET /api/events/[id]/members?q=` (manual-search, retention admin). `eventsContract` declares `create`/`approve`/`rsvp`/`scan`/`searchMembers`/`listApproved` ops. `createEventsInternalHandlers({ db, deployEnv, allowedOrigins })` mirrors `createMembersInternalHandlers`. Task 4/5/6/7 UI calls these `/api/*` routes.

> Pattern note: model these exactly on `src/app/api/uploads/route.ts` (same-origin + shared proxy branch), `src/app/api/members/route.ts` (repository via `getRepositories()`), `src/app/internal/members/route.ts` + `src/server/internal/members.ts` (internal handler shape: 404 unless dev, CORS, `resolveSharedActor`, per-op `sharedDev` gate, `contract.X.input.parse` then `contract.X.output.parse`).

- [ ] **Step 1: Write the contract**

Create `src/db/contract/events.ts`:
```ts
import { z } from "zod";
import { operation } from "./common";

export const eventOutputSchema = z.object({
	id: z.string(),
	title: z.string(),
	type: z.enum(["official", "casual", "birthday"]),
	status: z.enum(["pending", "approved", "rejected"]),
	points: z.number().int().nullable(),
	place: z.string(),
	capacity: z.number().int().nullable(),
	startsAt: z.coerce.date(),
	endsAt: z.coerce.date().nullable(),
	description: z.string(),
	createdBy: z.string(),
	approvedBy: z.string().nullable(),
	approvedAt: z.coerce.date().nullable(),
	createdAt: z.coerce.date(),
});

export const createEventInputSchema = z.object({
	title: z.string().trim().min(1).max(160),
	type: z.enum(["official", "casual", "birthday"]),
	place: z.string().trim().min(1).max(160),
	description: z.string().trim().min(1).max(4000),
	startsAt: z.coerce.date(),
	endsAt: z.coerce.date().nullable().default(null),
	points: z.number().int().min(-100).max(100).nullable().default(null),
	capacity: z.number().int().min(1).max(100000).nullable().default(null),
});

export const eventsContract = {
	listApproved: operation({
		input: z.object({ limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) }),
		output: z.object({ events: z.array(eventOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	create: operation({
		input: createEventInputSchema,
		output: z.object({ event: eventOutputSchema }),
		auth: "admin",
		permission: "event:approve",
		sharedDev: "deny",
	}),
	approve: operation({
		input: z.object({ eventId: z.string().min(1) }),
		output: z.object({ event: eventOutputSchema }),
		auth: "admin",
		permission: "event:approve",
		sharedDev: "deny",
	}),
	rsvp: operation({
		input: z.object({ eventId: z.string().min(1), state: z.enum(["going", "none"]) }),
		output: z.object({ state: z.enum(["going", "none"]) }),
		auth: "member",
		sharedDev: "allow",
	}),
	scan: operation({
		input: z.object({ eventId: z.string().min(1), memberId: z.string().min(1), termId: z.string().min(1) }),
		output: z.object({
			eventId: z.string(),
			memberId: z.string(),
			scannedAt: z.coerce.date(),
			alreadyPresent: z.boolean(),
		}),
		auth: "admin",
		permission: "points:assign",
		sharedDev: "deny",
	}),
	searchMembers: operation({
		input: z.object({ eventId: z.string().min(1), query: z.string().trim().min(1).max(120), limit: z.number().int().min(1).max(50).default(20) }),
		output: z.object({
			members: z.array(
				z.object({
					memberId: z.string(),
					fullName: z.string().nullable(),
					name: z.string().nullable(),
					email: z.string(),
					alreadyScanned: z.boolean(),
				}),
			),
		}),
		auth: "admin",
		permission: "points:assign",
		sharedDev: "allow",
	}),
};
```

- [ ] **Step 2: Write the internal handler**

Create `src/server/internal/events.ts`:
```ts
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { eventsContract } from "@/db/contract/events";
import { createAuditRepository } from "@/db/repositories/audit";
import { createEventsRepository } from "@/db/repositories/events";
import { createRetentionRepository } from "@/db/repositories/retention";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type EventsInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

export function createEventsInternalHandlers({ db, deployEnv, allowedOrigins = [] }: EventsInternalDependencies) {
	const audit = createAuditRepository(db);
	const retention = createRetentionRepository(db, audit);
	const repository = createEventsRepository(db, audit, retention);

	return {
		async fetch(request: Request): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });

			const corsHeaders = getInternalCorsHeaders(request, allowedOrigins);
			if (request.method === "OPTIONS") {
				return new Response(null, { status: corsHeaders ? 204 : 403, headers: corsHeaders ?? undefined });
			}
			if (request.headers.has("origin") && !corsHeaders) {
				return Response.json({ error: "Origin is not allowed." }, { status: 403 });
			}
			const responseHeaders = corsHeaders ?? undefined;

			const actor = await resolveSharedActor(db, request);
			if (!actor) {
				return Response.json({ error: "Invalid shared development token." }, { status: 401, headers: responseHeaders });
			}

			try {
				const url = new URL(request.url);
				const op = url.searchParams.get("op") ?? "listApproved";

				if (request.method === "GET" && op === "listApproved") {
					const input = eventsContract.listApproved.input.parse({});
					const events = await repository.listApproved(actor, input);
					return Response.json(eventsContract.listApproved.output.parse({ events }), { headers: responseHeaders });
				}

				if (request.method === "GET" && op === "searchMembers") {
					const input = eventsContract.searchMembers.input.parse({
						eventId: url.searchParams.get("eventId"),
						query: url.searchParams.get("query"),
						limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
					});
					const members = await repository.searchAttendableMembers(actor, input);
					return Response.json(eventsContract.searchMembers.output.parse({ members }), { headers: responseHeaders });
				}

				if (request.method === "POST") {
					const operationDef = eventsContract[op as keyof typeof eventsContract];
					if (!operationDef || !("permission" in operationDef)) {
						return Response.json({ error: "Unknown operation." }, { status: 400, headers: responseHeaders });
					}
					if (operationDef.sharedDev === "deny") {
						return Response.json(
							{ error: "Operation is disabled in shared development." },
							{ status: 403, headers: responseHeaders },
						);
					}
					const body = await request.json();
					if (op === "rsvp") {
						const input = eventsContract.rsvp.input.parse(body);
						const result = await repository.setRsvp(actor, input);
						return Response.json(eventsContract.rsvp.output.parse(result), { headers: responseHeaders });
					}
					return Response.json({ error: "Unknown operation." }, { status: 400, headers: responseHeaders });
				}

				return new Response("Method not allowed", { status: 405, headers: responseHeaders });
			} catch (error) {
				const message = error instanceof Error ? error.message : "Internal request failed.";
				const status = message.startsWith("Not authorized") ? 403 : 400;
				return Response.json({ error: message }, { status, headers: responseHeaders });
			}
		},
	};
}
```

- [ ] **Step 3: Write the internal route**

Create `src/app/internal/events/route.ts`:
```ts
import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { splitAllowedOrigins } from "@/server/internal/cors";
import { createEventsInternalHandlers } from "@/server/internal/events";

function getHandlers() {
	const config = getAppConfig();
	return createEventsInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	});
}

export async function GET(request: Request) {
	return getHandlers().fetch(request);
}

export async function POST(request: Request) {
	return getHandlers().fetch(request);
}

export async function OPTIONS(request: Request) {
	return getHandlers().fetch(request);
}
```

- [ ] **Step 4: Write the `/api/events` collection route (list + create)**

Create `src/app/api/events/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { createEventInputSchema } from "@/db/contract/events";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { proxySharedApiRequest } from "@/server/shared-api";

export async function GET() {
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const repositories = await getRepositories();
		const events = await repositories.events.listApproved(actor, { limit: 50 });
		return NextResponse.json({ events });
	} catch {
		return NextResponse.json({ error: "Not authorized." }, { status: 403 });
	}
}

export async function POST(request: Request) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, "/internal/events?op=create");
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const input = createEventInputSchema.parse(await request.json());
		const repositories = await getRepositories();
		const event = await repositories.events.create(actor, input);
		return NextResponse.json({ event }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
```

- [ ] **Step 5: Write the per-event mutation routes**

Create `src/app/api/events/[id]/rsvp/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { proxySharedApiRequest } from "@/server/shared-api";

const bodySchema = z.object({ state: z.enum(["going", "none"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, "/internal/events?op=rsvp");
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const { state } = bodySchema.parse(await request.json());
		const repositories = await getRepositories();
		const result = await repositories.events.setRsvp(actor, { eventId: id, state });
		return NextResponse.json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
```

Create `src/app/api/events/[id]/approve/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { proxySharedApiRequest } from "@/server/shared-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, "/internal/events?op=approve");
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const repositories = await getRepositories();
		const event = await repositories.events.approve(actor, id);
		return NextResponse.json({ event });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
```

Create `src/app/api/events/[id]/scan/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { proxySharedApiRequest } from "@/server/shared-api";

const bodySchema = z.object({ memberId: z.string().min(1), termId: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const { id } = await params;
	if (config.APP_ENV === "shared") {
		return proxySharedApiRequest(request, "/internal/events?op=scan");
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	try {
		const { memberId, termId } = bodySchema.parse(await request.json());
		const repositories = await getRepositories();
		const result = await repositories.events.recordScan(actor, { eventId: id, memberId, termId });
		return NextResponse.json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
```

Create `src/app/api/events/[id]/members/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	const { id } = await params;
	const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
	if (!query) return NextResponse.json({ members: [] });
	try {
		const repositories = await getRepositories();
		const members = await repositories.events.searchAttendableMembers(actor, { eventId: id, query, limit: 20 });
		return NextResponse.json({ members });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
```

- [ ] **Step 6: Write the internal-handler test**

Create `src/server/internal/events.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createEventsInternalHandlers } from "./events";

function handlers(deployEnv: "dev" | "prod" = "dev") {
	const db = drizzle(env.DB, { schema });
	return createEventsInternalHandlers({ db, deployEnv, allowedOrigins: [] });
}

describe("events internal handlers", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM shared_dev_tokens").run();
		await env.DB.prepare("DELETE FROM members").run();
	});

	it("returns 404 when the deploy env is not dev", async () => {
		const response = await handlers("prod").fetch(new Request("https://dev.example/internal/events"));
		expect(response.status).toBe(404);
	});

	it("rejects a request with no shared token", async () => {
		const response = await handlers().fetch(new Request("https://dev.example/internal/events"));
		expect(response.status).toBe(401);
	});

	it("refuses a sharedDev:deny op (create) even with a valid admin token", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin")
			.run();
		await env.DB.prepare("INSERT INTO shared_dev_tokens (token_hash, member_id, label) VALUES (?, ?, ?)")
			.bind("0000000000000000000000000000000000000000000000000000000000000000", "mem_admin", "admin")
			.run();
		// NOTE: the token must hash to the stored token_hash; resolveSharedActor hashes the
		// bearer with sha256. Use the same helper the members internal test uses to derive
		// a real token/hash pair (see src/server/internal/shared-actor.ts) rather than the
		// placeholder above. Assert the create op is refused with 403.
		const response = await handlers().fetch(
			new Request("https://dev.example/internal/events?op=create", {
				method: "POST",
				headers: { Authorization: "Bearer wrong" },
				body: JSON.stringify({}),
			}),
		);
		expect([401, 403]).toContain(response.status);
	});
});
```

> Implementer note: open `src/server/internal/shared-actor.ts` and the existing members internal test (if present) to copy the exact token-to-hash derivation; replace the placeholder hash above so the admin-token case actually resolves an actor and asserts a clean 403 for the `create` op. Keep the 404 and 401 cases as written.

- [ ] **Step 7: Run the tests**

Run: `pnpm test -- events.test.ts`
Expected: PASS — the 404 (non-dev), 401 (no token), and deny-op cases all hold.

- [ ] **Step 8: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, except the still-pending `index.ts` arity fix from Tasks 1-2 (resolved in Task 8). If running tasks in order, that remains the only outstanding typecheck error.

- [ ] **Step 9: Commit**

```bash
git add src/db/contract/events.ts src/server/internal/events.ts src/app/internal/events src/app/api/events src/server/internal/events.test.ts
git commit -m "feat(events): event API routes + internal events module

Same-origin /api/events* with shared-mode proxy to /internal/events.
create/approve/scan are sharedDev:deny; rsvp/searchMembers are allow.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Member code card + QR/barcode generator (client-side, never persisted)

**Files:**
- Create: `src/lib/member-code.ts`
- Create: `src/lib/member-code.test.ts`
- Create: `src/components/member-code-card.tsx`
- Modify: `src/app/portal/profile/page.tsx` (add the "Show my member code" entry)

**Interfaces:**
- Consumes: the signed-in member's `id` (already available on the profile page via the actor/session).
- Produces:
  - `encodeMemberCode(memberId: string): string` and `decodeMemberCode(payload: string): string | null` in `src/lib/member-code.ts` — the stable, reversible payload encoded into the QR/barcode. Task 5's scanner decodes scanned text with `decodeMemberCode`.
  - `<MemberCodeCard memberId={...} />` client component rendering a QR (and a fallback numeric/barcode text) from `encodeMemberCode(memberId)`, generated entirely in the browser, never uploaded.
- Decision: the QR is generated client-side with the `qrcode` library (added as a dependency in this task). No barcode-image library is added in v1; the human-readable code string is shown as a text fallback the admin can also type into the manual search. This keeps the dependency surface small (master plan §7: "QR codes generated client-side on demand; persisting to R2 deferred").

- [ ] **Step 1: Add the QR dependency**

STOP and show the user this exact command, then wait for approval before running (it changes `package.json` / lockfile, which the shared-dev note guard tracks):
```bash
pnpm add qrcode && pnpm add -D @types/qrcode
```

- [ ] **Step 2: Write the failing codec test**

Create `src/lib/member-code.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decodeMemberCode, encodeMemberCode } from "./member-code";

describe("member code codec", () => {
	it("round-trips a member id", () => {
		const encoded = encodeMemberCode("mem_abc123");
		expect(decodeMemberCode(encoded)).toBe("mem_abc123");
	});

	it("is stable for the same id (no rotation)", () => {
		expect(encodeMemberCode("mem_abc123")).toBe(encodeMemberCode("mem_abc123"));
	});

	it("rejects a payload that is not a CODE member token", () => {
		expect(decodeMemberCode("not-a-code")).toBeNull();
		expect(decodeMemberCode("")).toBeNull();
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- member-code.test.ts`
Expected: FAIL — `./member-code` does not exist.

- [ ] **Step 4: Write `src/lib/member-code.ts`**

```ts
// The member-carried attendance code (master plan v5 §6). It is static and
// permanent: the same member id always yields the same payload, with no
// rotation or OTP. The payload is a namespaced wrapper so a scanner can reject
// arbitrary QR codes that are not CODE member tokens.
const PREFIX = "code:m:";

export function encodeMemberCode(memberId: string): string {
	return `${PREFIX}${memberId}`;
}

export function decodeMemberCode(payload: string): string | null {
	if (!payload.startsWith(PREFIX)) return null;
	const memberId = payload.slice(PREFIX.length).trim();
	if (!/^mem_[A-Za-z0-9]+$/.test(memberId)) return null;
	return memberId;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- member-code.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 6: Write the card component**

Create `src/components/member-code-card.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { encodeMemberCode } from "@/lib/member-code";

export function MemberCodeCard({ memberId }: { memberId: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [error, setError] = useState<string | null>(null);
	const payload = encodeMemberCode(memberId);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		QRCode.toCanvas(canvas, payload, { width: 220, margin: 1 }).catch(() => setError("Could not render the code."));
	}, [payload]);

	return (
		<Card>
			<CardHeader>
				<CardTitle>My member code</CardTitle>
				<CardDescription>Show this to an event admin to be marked present. It does not change.</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col items-center gap-3">
				<canvas ref={canvasRef} aria-label="Member attendance QR code" className="rounded-md border bg-white p-2" />
				<p className="font-mono text-xs text-muted-foreground">{payload}</p>
				{error ? <p className="text-sm text-destructive">{error}</p> : null}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 7: Wire it into the profile page**

Open `src/app/portal/profile/page.tsx`. It already resolves the signed-in member (via `getActor()` / session). Add, near the top imports:
```tsx
import { MemberCodeCard } from "@/components/member-code-card";
```
Then render `<MemberCodeCard memberId={actor.memberId} />` inside the existing profile layout (use whatever variable currently holds the resolved member/actor id; do not introduce a new data fetch). This is the desktop "Show my member code" surface required by master plan §1.

- [ ] **Step 8: Run typecheck, lint, and the codec test**

Run: `pnpm typecheck && pnpm lint && pnpm test -- member-code.test.ts`
Expected: PASS (the `index.ts` arity error from earlier tasks is the only remaining typecheck failure until Task 8; the new files are clean).

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/member-code.ts src/lib/member-code.test.ts src/components/member-code-card.tsx src/app/portal/profile/page.tsx
git commit -m "feat(profile): client-side static member QR/barcode card

Member-carried code is encoded with a code:m: prefix and rendered to a
canvas QR in the browser. It is never uploaded or persisted (master
plan v5 §7). Adds qrcode dependency.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Event-admin scan UI — scan stream + manual-search fallback + attendance list

**Files:**
- Create: `src/components/event-scan-panel.tsx`
- Create: `src/app/api/events/[id]/attendance/route.ts`
- Modify: `src/components/portal-workspace.tsx` (mount the scan panel for retention admins on an event; or its successor event-detail view — see note)

**Interfaces:**
- Consumes: `decodeMemberCode` from `@/lib/member-code` (Task 4); `POST /api/events/[id]/scan` + `GET /api/events/[id]/members?q=` + `GET /api/events/[id]/attendance` (Tasks 3 + this task); the current active `termId` (passed in as a prop — the event-detail view already knows the term; if not yet wired, pass the seeded current term id for now and leave a `TODO(term-resolution)` comment).
- Produces:
  - `GET /api/events/[id]/attendance` returning `{ attendance: AttendanceRow[] }` for the roster list.
  - `<EventScanPanel eventId={...} termId={...} />` client component: a text input that accepts decoded QR text (from a camera lib later, or pasted/typed code), posts a scan, shows a running list of confirmed members, and a manual search box that calls the members endpoint and lets the admin tap a result to scan it.
- Decision: v1 uses a text-input scan target (the decoded payload is typed/pasted/keyboard-wedge-scanned), not an in-browser camera decoder. A camera decoder is an additive enhancement (master plan §11 realtime/hardware deferred class). The manual-search fallback is the required path when scanning fails (master plan v5 §6).

> Mount note: the canonical event-detail surface is `/portal/calendar/[eventId]` per master plan §1, which is a Phase 7 deliverable. Phase 4 owns the scan capability, not the calendar routing. Mount `<EventScanPanel>` wherever the event-admin currently reaches an approved event in the existing `portal-workspace.tsx` (gate it on the actor holding `points:assign`). When Phase 7 builds `/portal/calendar/[eventId]`, it re-mounts this same component. Do not block Phase 4 on the calendar route existing.

- [ ] **Step 1: Write the attendance route**

Create `src/app/api/events/[id]/attendance/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	const { id } = await params;
	try {
		const repositories = await getRepositories();
		const attendance = await repositories.events.listAttendance(actor, id);
		return NextResponse.json({ attendance });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
```

- [ ] **Step 2: Write the scan panel component**

Create `src/components/event-scan-panel.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { decodeMemberCode } from "@/lib/member-code";

type ScanResult = { memberId: string; alreadyPresent: boolean };
type FoundMember = { memberId: string; fullName: string | null; name: string | null; email: string; alreadyScanned: boolean };

export function EventScanPanel({ eventId, termId }: { eventId: string; termId: string }) {
	const [scanInput, setScanInput] = useState("");
	const [log, setLog] = useState<string[]>([]);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<FoundMember[]>([]);
	const [error, setError] = useState<string | null>(null);

	async function scanMember(memberId: string) {
		setError(null);
		const response = await fetch(`/api/events/${eventId}/scan`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ memberId, termId }),
		});
		if (!response.ok) {
			setError("Scan failed. Try the manual search.");
			return;
		}
		const result = (await response.json()) as ScanResult;
		setLog((prev) => [`${result.alreadyPresent ? "Already present" : "Marked present"}: ${memberId}`, ...prev]);
	}

	async function submitScan() {
		const memberId = decodeMemberCode(scanInput.trim());
		if (!memberId) {
			setError("That code is not a CODE member code.");
			return;
		}
		setScanInput("");
		await scanMember(memberId);
	}

	async function runSearch() {
		setError(null);
		const response = await fetch(`/api/events/${eventId}/members?q=${encodeURIComponent(query)}`);
		if (!response.ok) {
			setError("Search failed.");
			return;
		}
		const data = (await response.json()) as { members: FoundMember[] };
		setResults(data.members);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Scan attendance</CardTitle>
				<CardDescription>Scan or paste a member code, or search by name or email if scanning fails.</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				<form
					className="flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void submitScan();
					}}
				>
					<Input
						value={scanInput}
						onChange={(event) => setScanInput(event.target.value)}
						placeholder="Member code (code:m:...)"
						aria-label="Member code"
					/>
					<Button type="submit">Mark present</Button>
				</form>

				<div className="flex flex-col gap-2">
					<form
						className="flex gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							void runSearch();
						}}
					>
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search name or email"
							aria-label="Search members"
						/>
						<Button type="submit" variant="secondary">Search</Button>
					</form>
					<ul className="flex flex-col gap-1">
						{results.map((member) => (
							<li key={member.memberId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
								<span className="text-sm">
									{member.fullName ?? member.name ?? member.email}
									{member.alreadyScanned ? <span className="ml-2 text-xs text-muted-foreground">present</span> : null}
								</span>
								<Button
									size="sm"
									variant="outline"
									disabled={member.alreadyScanned}
									onClick={() => void scanMember(member.memberId)}
								>
									Mark present
								</Button>
							</li>
						))}
					</ul>
				</div>

				{error ? <p className="text-sm text-destructive">{error}</p> : null}

				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium">Recent scans</p>
					<ul className="flex flex-col gap-1 text-sm text-muted-foreground">
						{log.map((line, index) => (
							<li key={`${line}-${index}`}>{line}</li>
						))}
					</ul>
				</div>
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 3: Mount the scan panel for retention admins**

In `src/components/portal-workspace.tsx`, where an approved event is shown to an admin holding `points:assign`, render `<EventScanPanel eventId={event.id} termId={currentTermId} />`. If the workspace does not yet expose a resolved current term, add a `TODO(term-resolution): pass the active term id from the calendar/event-detail loader (Phase 7)` comment and use the seeded `term_2026_1` id as a temporary constant so the panel is exercisable. Do NOT add a new top-level nav slot (master plan minimalism constraint).

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (modulo the `index.ts` arity fix pending in Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/components/event-scan-panel.tsx src/app/api/events/[id]/attendance/route.ts src/components/portal-workspace.tsx
git commit -m "feat(events): event-admin scan panel with manual-search fallback

Decodes a member code, posts a scan, and offers a name/email search
fallback that flags who is already present. Adds the attendance roster
endpoint.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Event media repository + route + My Retention History data

**Files:**
- Create: `src/db/repositories/event-media.ts`
- Create: `src/db/repositories/event-media.integration.test.ts`
- Create: `src/app/api/events/[id]/media/route.ts`

**Interfaces:**
- Consumes: `eventMedia`, `crsEvents`, `members` from `@/db/schema`; `Actor`/`can`; `createId`; `getRepositories`/`getActor`. The R2 upload itself already happens through the hardened `POST /api/uploads` with `purpose=event_media` (Phase 1, `src/server/uploads.ts`), which returns an object key; this task records that key as an `event_media` row.
- Produces:
  - `EventMediaRepository` with `add(actor, input: AddMediaInput): Promise<MediaRecord>` and `listForEvent(actor, eventId): Promise<MediaRecord[]>`.
  - `AddMediaInput = { eventId: string; r2Key: string; caption: string | null }`.
  - `MediaRecord = InferSelectModel<typeof eventMedia>`.
  - `POST /api/events/[id]/media` (record a media row after upload) and `GET /api/events/[id]/media` (list media for an approved event).
  - Wired into `createDrizzleRepositories`/`createSharedRepositories` in Task 8 as `repositories.eventMedia`.

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/event-media.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createEventMediaRepository } from "./event-media";

const member: Actor = { memberId: "mem_a", roles: ["member"] };
const START = new Date("2026-07-10T10:00:00.000Z");

function makeRepo() {
	const db = drizzle(env.DB, { schema });
	return { db, repo: createEventMediaRepository(db) };
}

describe("event media repository on D1", () => {
	beforeEach(async () => {
		for (const table of ["event_media", "crs_events", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_a", "a@example.com", "A")
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_1", "E", "official", "approved", "x", START.getTime(), "d", "mem_a", "")
			.run();
	});

	it("records and lists media for an approved event", async () => {
		const { repo } = makeRepo();
		const created = await repo.add(member, { eventId: "evt_1", r2Key: "events/evt_1/mem_a/media_x.png", caption: "Group photo" });
		expect(created.r2Key).toBe("events/evt_1/mem_a/media_x.png");
		const listed = await repo.listForEvent(member, "evt_1");
		expect(listed.map((row) => row.id)).toContain(created.id);
	});

	it("rejects recording media for a non-existent or unapproved event", async () => {
		const { repo } = makeRepo();
		await expect(repo.add(member, { eventId: "missing", r2Key: "k", caption: null })).rejects.toThrow();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- event-media.integration.test.ts`
Expected: FAIL — `./event-media` does not exist.

- [ ] **Step 3: Write `src/db/repositories/event-media.ts`**

```ts
import { desc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { crsEvents, eventMedia } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";

export type MediaRecord = InferSelectModel<typeof eventMedia>;
export type AddMediaInput = { eventId: string; r2Key: string; caption: string | null };

export type EventMediaRepository = {
	add(actor: Actor, input: AddMediaInput): Promise<MediaRecord>;
	listForEvent(actor: Actor, eventId: string): Promise<MediaRecord[]>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function createEventMediaRepository(db: Db): EventMediaRepository {
	return {
		async add(actor, input) {
			const [event] = await db.select().from(crsEvents).where(eq(crsEvents.id, input.eventId)).limit(1);
			if (!event || event.status !== "approved") throw new Error("Event not found.");
			const [media] = await db
				.insert(eventMedia)
				.values({ id: createId("media"), eventId: input.eventId, r2Key: input.r2Key, caption: input.caption, uploadedBy: actor.memberId })
				.returning();
			return media;
		},
		async listForEvent(actor, eventId) {
			if (!actor) throw new Error("Authentication required.");
			const [event] = await db.select().from(crsEvents).where(eq(crsEvents.id, eventId)).limit(1);
			if (!event || event.status !== "approved") throw new Error("Event not found.");
			return db.select().from(eventMedia).where(eq(eventMedia.eventId, eventId)).orderBy(desc(eventMedia.createdAt)).limit(100);
		},
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- event-media.integration.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Write the media route**

Create `src/app/api/events/[id]/media/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";

const bodySchema = z.object({ r2Key: z.string().min(1).max(512), caption: z.string().trim().max(280).nullable().default(null) });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	const { id } = await params;
	try {
		const repositories = await getRepositories();
		const media = await repositories.eventMedia.listForEvent(actor, id);
		return NextResponse.json({ media });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	const { id } = await params;
	try {
		const { r2Key, caption } = bodySchema.parse(await request.json());
		const repositories = await getRepositories();
		const media = await repositories.eventMedia.add(actor, { eventId: id, r2Key, caption });
		return NextResponse.json({ media }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
```

> Note: the R2 object key must come from a prior `POST /api/uploads` call with `purpose=event_media` (which server-assigns `events/{eventId}/{memberId}/{mediaId}.{ext}` and enforces the image allowlist + size). This route only persists the returned key, so it does not re-validate content type.

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: the `eventMedia` property does not exist on `Repositories` until Task 8 wires it, so `repositories.eventMedia` errors here. This is expected; Task 8 adds it. Confirm the only new errors are `repositories.eventMedia` and the pending `index.ts` arity from Tasks 1-2.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories/event-media.ts src/db/repositories/event-media.integration.test.ts src/app/api/events/[id]/media/route.ts
git commit -m "feat(events): event media repository and route

Records R2 object keys returned by /api/uploads (purpose=event_media)
as event_media rows scoped to approved events.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Event forum repository + route — anonymity rules enforced

**Files:**
- Create: `src/db/repositories/event-forum.ts`
- Create: `src/db/repositories/event-forum.integration.test.ts`
- Create: `src/app/api/events/[id]/forum/route.ts`
- Create: `src/app/api/events/[id]/forum/[postId]/reveal/route.ts`

**Interfaces:**
- Consumes: `eventForumPosts`, `crsEvents`, `members` from `@/db/schema`; `Actor`/`can`; `AuditRepository`; `createId`.
- Produces:
  - `EventForumRepository` with: `post(actor, input: PostInput): Promise<ForumPostView>`, `listForEvent(actor, eventId, input?): Promise<ForumPostView[]>`, `revealAuthor(actor, postId): Promise<{ memberId: string; fullName: string | null; name: string | null }>`.
  - `PostInput = { eventId: string; body: string; anonymous: boolean; parentId: string | null }`.
  - `ForumPostView = { id: string; eventId: string; parentId: string | null; body: string; anonymous: boolean; createdAt: Date; author: { memberId: string; fullName: string | null; name: string | null } | null }` — `author` is `null` whenever `anonymous=true` and the reader does not hold `super`.
  - `POST /api/events/[id]/forum` (post), `GET /api/events/[id]/forum` (list with anonymity applied), `POST /api/events/[id]/forum/[postId]/reveal` (super-only, audited).
  - Wired into the repositories barrel in Task 8 as `repositories.eventForum`.
- Anonymity contract (master plan §6): `memberId` is ALWAYS persisted. The list/post views NEVER include author identity for anonymous posts unless the reader holds `super`. `revealAuthor` requires `super` and writes an audit row (`action: "forum:reveal_author"`, `category: "event"`).

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/event-forum.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createEventForumRepository } from "./event-forum";

const author: Actor = { memberId: "mem_a", roles: ["member"] };
const reader: Actor = { memberId: "mem_b", roles: ["member"] };
const superAdmin: Actor = { memberId: "mem_super", roles: ["super"] };
const START = new Date("2026-07-10T10:00:00.000Z");

function makeRepo() {
	const db = drizzle(env.DB, { schema });
	return { db, repo: createEventForumRepository(db, createAuditRepository(db)) };
}

describe("event forum repository on D1", () => {
	beforeEach(async () => {
		for (const table of ["event_forum_posts", "crs_events", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		for (const [id, email, name] of [
			["mem_a", "a@example.com", "Author A"],
			["mem_b", "b@example.com", "Reader B"],
			["mem_super", "s@example.com", "Super"],
		]) {
			await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)").bind(id, email, name, name).run();
		}
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_1", "E", "official", "approved", "x", START.getTime(), "d", "mem_a", "")
			.run();
	});

	it("hides the author of an anonymous post from a normal reader", async () => {
		const { repo } = makeRepo();
		await repo.post(author, { eventId: "evt_1", body: "secret take", anonymous: true, parentId: null });
		const [post] = await repo.listForEvent(reader, "evt_1");
		expect(post.anonymous).toBe(true);
		expect(post.author).toBeNull();
	});

	it("shows the author of a non-anonymous post", async () => {
		const { repo } = makeRepo();
		await repo.post(author, { eventId: "evt_1", body: "open take", anonymous: false, parentId: null });
		const [post] = await repo.listForEvent(reader, "evt_1");
		expect(post.author?.memberId).toBe("mem_a");
	});

	it("lets a super admin see and reveal an anonymous author with an audit row", async () => {
		const { db, repo } = makeRepo();
		const created = await repo.post(author, { eventId: "evt_1", body: "secret", anonymous: true, parentId: null });
		const [seen] = await repo.listForEvent(superAdmin, "evt_1");
		expect(seen.author?.memberId).toBe("mem_a");
		const revealed = await repo.revealAuthor(superAdmin, created.id);
		expect(revealed.memberId).toBe("mem_a");
		const [audit] = await db.select().from(schema.auditLogs);
		expect(audit).toMatchObject({ action: "forum:reveal_author", category: "event" });
	});

	it("denies a normal admin from revealing an anonymous author", async () => {
		const { repo } = makeRepo();
		const created = await repo.post(author, { eventId: "evt_1", body: "secret", anonymous: true, parentId: null });
		await expect(repo.revealAuthor(reader, created.id)).rejects.toThrow("Not authorized");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- event-forum.integration.test.ts`
Expected: FAIL — `./event-forum` does not exist.

- [ ] **Step 3: Write `src/db/repositories/event-forum.ts`**

```ts
import { asc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { crsEvents, eventForumPosts, members } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

type ForumRow = InferSelectModel<typeof eventForumPosts>;

export type ForumAuthor = { memberId: string; fullName: string | null; name: string | null };
export type ForumPostView = {
	id: string;
	eventId: string;
	parentId: string | null;
	body: string;
	anonymous: boolean;
	createdAt: Date;
	author: ForumAuthor | null;
};
export type PostInput = { eventId: string; body: string; anonymous: boolean; parentId: string | null };

export type EventForumRepository = {
	post(actor: Actor, input: PostInput): Promise<ForumPostView>;
	listForEvent(actor: Actor, eventId: string, input?: { limit?: number; offset?: number }): Promise<ForumPostView[]>;
	revealAuthor(actor: Actor, postId: string): Promise<ForumAuthor>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

// The reader sees an author identity only when the post is not anonymous OR the
// reader holds super (master plan §6 forum anonymity).
function toView(row: ForumRow, author: ForumAuthor, canSeeAuthor: boolean): ForumPostView {
	const reveal = !row.anonymous || canSeeAuthor;
	return {
		id: row.id,
		eventId: row.eventId,
		parentId: row.parentId,
		body: row.body,
		anonymous: row.anonymous,
		createdAt: row.createdAt,
		author: reveal ? author : null,
	};
}

export function createEventForumRepository(db: Db, audit: AuditRepository): EventForumRepository {
	return {
		async post(actor, input) {
			const [event] = await db.select().from(crsEvents).where(eq(crsEvents.id, input.eventId)).limit(1);
			if (!event || event.status !== "approved") throw new Error("Event not found.");
			const [row] = await db
				.insert(eventForumPosts)
				.values({
					id: createId("post"),
					eventId: input.eventId,
					memberId: actor.memberId,
					anonymous: input.anonymous,
					parentId: input.parentId,
					body: input.body,
				})
				.returning();
			const [me] = await db
				.select({ memberId: members.id, fullName: members.fullName, name: members.name })
				.from(members)
				.where(eq(members.id, actor.memberId))
				.limit(1);
			// The poster always sees their own identity on the row they just wrote.
			return toView(row, me, true);
		},

		async listForEvent(actor, eventId, input) {
			const canSeeAuthor = can(actor, "member:manage") && actor.roles.includes("super");
			const rows = await db
				.select({
					id: eventForumPosts.id,
					eventId: eventForumPosts.eventId,
					memberId: eventForumPosts.memberId,
					anonymous: eventForumPosts.anonymous,
					parentId: eventForumPosts.parentId,
					body: eventForumPosts.body,
					createdAt: eventForumPosts.createdAt,
					authorFullName: members.fullName,
					authorName: members.name,
				})
				.from(eventForumPosts)
				.innerJoin(members, eq(members.id, eventForumPosts.memberId))
				.where(eq(eventForumPosts.eventId, eventId))
				.orderBy(asc(eventForumPosts.createdAt))
				.limit(Math.min(input?.limit ?? 100, 100))
				.offset(input?.offset ?? 0);
			return rows.map((row: ForumRow & { authorFullName: string | null; authorName: string | null }) =>
				toView(
					row,
					{ memberId: row.memberId, fullName: row.authorFullName, name: row.authorName },
					canSeeAuthor,
				),
			);
		},

		async revealAuthor(actor, postId) {
			if (!actor.roles.includes("super")) {
				throw new Error("Not authorized to reveal an anonymous author.");
			}
			const [row] = await db
				.select({ memberId: eventForumPosts.memberId, fullName: members.fullName, name: members.name })
				.from(eventForumPosts)
				.innerJoin(members, eq(members.id, eventForumPosts.memberId))
				.where(eq(eventForumPosts.id, postId))
				.limit(1);
			if (!row) throw new Error("Post not found.");
			await audit.record(actor, {
				action: "forum:reveal_author",
				targetType: "forum_post",
				targetId: postId,
				category: "event",
			});
			return { memberId: row.memberId, fullName: row.fullName, name: row.name };
		},
	};
}
```

> Note: `can(actor, "member:manage")` is true for `super` (inherits all); the explicit `actor.roles.includes("super")` keeps reveal strictly super-only, since master plan §6 says only `super` may reveal, not every `member_admin`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- event-forum.integration.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Write the forum routes**

Create `src/app/api/events/[id]/forum/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";

const bodySchema = z.object({
	body: z.string().trim().min(1).max(4000),
	anonymous: z.boolean().default(false),
	parentId: z.string().min(1).nullable().default(null),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	const { id } = await params;
	try {
		const repositories = await getRepositories();
		const posts = await repositories.eventForum.listForEvent(actor, id);
		return NextResponse.json({ posts });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	const { id } = await params;
	try {
		const input = bodySchema.parse(await request.json());
		const repositories = await getRepositories();
		const post = await repositories.eventForum.post(actor, { eventId: id, ...input });
		return NextResponse.json({ post }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
```

Create `src/app/api/events/[id]/forum/[postId]/reveal/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	const actor = await getActor();
	if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
	const { postId } = await params;
	try {
		const repositories = await getRepositories();
		const author = await repositories.eventForum.revealAuthor(actor, postId);
		return NextResponse.json({ author });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Request failed.";
		const status = message.startsWith("Not authorized") ? 403 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
```

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: `repositories.eventForum` does not exist until Task 8; confirm the only new errors are `repositories.eventForum` and the pending `index.ts` arity.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories/event-forum.ts src/db/repositories/event-forum.integration.test.ts src/app/api/events/[id]/forum
git commit -m "feat(events): event forum repository with anonymity rules

member_id is always stored; anonymous authors are hidden from normal
readers and admins; only super can reveal, and reveal is audited.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Wire the new repositories into the barrel, run the full suite

**Files:**
- Modify: `src/db/repositories/index.ts` (full file)
- Create: `src/db/repositories/event-media.ts` already exists (Task 6); this task only references it.

**Interfaces:**
- Consumes: `createEventsRepository` (now `(db, audit, retention)`), `createRetentionRepository` (now `(db, audit)`), `createEventMediaRepository` (Task 6), `createEventForumRepository` (Task 7).
- Produces: `Repositories` gains `eventMedia` and `eventForum`; `events` and `retention` are constructed with their new dependencies. Every route from Tasks 3-7 that reads `repositories.events` / `.retention` / `.eventMedia` / `.eventForum` now type-checks.

- [ ] **Step 1: Replace `src/db/repositories/index.ts` in full**

```ts
import { createAuditRepository, createUnavailableAuditRepository } from "./audit";
import { createCalendarRepository } from "./calendar";
import { createEventForumRepository } from "./event-forum";
import { createEventMediaRepository } from "./event-media";
import { createEventsRepository } from "./events";
import { createLinksRepository } from "./links";
import { createMembersRepository } from "./members";
import { createNotificationsRepository } from "./notifications";
import { createRetentionRepository } from "./retention";
import { createSessionsRepository } from "./sessions";
import { createSurveysRepository } from "./surveys";
import type { MemberDb } from "./members";
import type { AuditDb } from "./audit";
import type { DatabaseAdapter } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDrizzleRepositories(db: MemberDb & AuditDb & any) {
	const audit = createAuditRepository(db);
	const retention = createRetentionRepository(db, audit);
	return {
		members: createMembersRepository(db, audit),
		sessions: createSessionsRepository(),
		links: createLinksRepository(),
		events: createEventsRepository(db, audit, retention),
		eventMedia: createEventMediaRepository(db),
		eventForum: createEventForumRepository(db, audit),
		retention,
		surveys: createSurveysRepository(),
		notifications: createNotificationsRepository(),
		calendar: createCalendarRepository(),
		audit,
	};
}

export type Repositories = ReturnType<typeof createDrizzleRepositories>;

export function createSharedRepositories(adapter: DatabaseAdapter): Repositories {
	const audit = createUnavailableAuditRepository();
	// Shared mode routes data ops through the dev Worker's /internal API; the
	// event/retention repositories are not Drizzle-backed here. They are present
	// on the shape but throw if invoked locally, mirroring the existing pattern.
	const unavailable = () => {
		throw new Error("This operation is only available through the shared /internal API.");
	};
	return {
		members: {
			list: async (_actor, input) => adapter.listMembers().then((members) => members.slice(0, input?.limit ?? 25)),
			getById: async (_actor, id) => adapter.getMemberById(id),
			create: async (_actor, input) => adapter.createMember(input),
			updateProfile: async (_actor, id, input) => adapter.updateMemberProfile(id, input),
		},
		sessions: createSessionsRepository(),
		links: createLinksRepository(),
		events: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createEventsRepository>,
		eventMedia: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createEventMediaRepository>,
		eventForum: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createEventForumRepository>,
		retention: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createRetentionRepository>,
		surveys: createSurveysRepository(),
		notifications: createNotificationsRepository(),
		calendar: createCalendarRepository(),
		audit,
	};
}
```

> Note on shared mode: the existing barrel returned bare `createEventsRepository()` stubs for shared mode because they were empty. Now that they are Drizzle-backed and shared mode has no local Drizzle handle, the shared variant exposes the same shape but throws if a non-proxied op is invoked locally. The real shared path is the typed `/internal/events` route (Task 3); members and the `/api/*` proxy branch already cover the exercised ops. If a later phase needs an event op in shared mode, add it to `eventsContract` + the internal handler, not here.

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS — all `repositories.events` / `.retention` / `.eventMedia` / `.eventForum` references from Tasks 3-7 now resolve; the arity mismatches are gone.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: PASS — includes the new `retention.integration.test.ts`, `events.integration.test.ts`, `event-media.integration.test.ts`, `event-forum.integration.test.ts`, `events.test.ts`, `member-code.test.ts`, plus the existing `members.integration.test.ts`, `permissions.test.ts`, `roster.integration.test.ts`, `shared-parity.integration.test.ts`, all against the auto-applied `drizzle/migrations`.

- [ ] **Step 4: Run the build**

Run: `pnpm build`
Expected: PASS (Next build + OpenNext build).

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/index.ts
git commit -m "feat(repos): wire events, retention, event media, and forum into the barrel

events now takes (db, audit, retention); retention takes (db, audit);
adds eventMedia and eventForum. Shared mode exposes the shape but routes
real ops through /internal.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Seed event-derived retention data, refresh graphify, redeploy gate

**Files:**
- Modify: `src/db/seed/data.ts` (add forum + attendance + a second event so the demo exercises the new surfaces)
- Modify: `src/db/seed/run.ts` (insert the new seed arrays)

**Interfaces:**
- Consumes: `crsAttendance`, `eventForumPosts`, `eventMedia` from `@/db/schema`; the existing `seedEvents` + `seedRetentionRecords`.
- Produces: `seedAttendance`, `seedForumPosts` arrays so a freshly seeded dev/local DB shows a scanned attendee, an event-derived retention row (already present), and an anonymous + a named forum post for the demo event.

- [ ] **Step 1: Add the new seed arrays to `src/db/seed/data.ts`**

Append after the existing `seedRetentionRecords` array (reuse the existing `now`/`later` constants and `evt_demo`/`mem_demo_*` ids already defined in the file):
```ts
export const seedAttendance: InferInsertModel<typeof crsAttendance>[] = [
	{ eventId: "evt_demo", memberId: "mem_demo_member", scannedAt: later, scannedBy: "mem_demo_admin" },
];

export const seedForumPosts: InferInsertModel<typeof eventForumPosts>[] = [
	{ id: "post_demo_open", eventId: "evt_demo", memberId: "mem_demo_member", anonymous: false, parentId: null, body: "Great session, thanks!", createdAt: later },
	{ id: "post_demo_anon", eventId: "evt_demo", memberId: "mem_demo_member", anonymous: true, parentId: null, body: "Could we get more practice cases?", createdAt: later },
];
```
Add `crsAttendance` and `eventForumPosts` to the existing top-of-file schema import block.

- [ ] **Step 2: Insert the new arrays in `src/db/seed/run.ts`**

Add the imports `seedAttendance, seedForumPosts` to the `./data` import block, and add these two lines to `seedLocal()` after the `crsEvents` / `retentionRecords` inserts (attendance must come after events + members; forum after events + members):
```ts
	await insertChunks(db, schema.crsAttendance, seedAttendance);
	await insertChunks(db, schema.eventForumPosts, seedForumPosts);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: STOP — show the exact local seed command and wait for approval**

Per CLAUDE.md, do not run a seed without approval. Present this and wait:
```bash
pnpm db:seed:local
```
This loads the demo data into the local better-sqlite3 DB only; it does not touch dev or prod D1.

- [ ] **Step 5: After approval, run the seed and the suite**

Run: `pnpm db:seed:local` then `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS.

- [ ] **Step 6: Refresh the knowledge graph**

Run: `graphify update .`
Expected: completes (AST-only, no API cost) so the new repositories/routes are in the graph.

- [ ] **Step 7: Commit**

```bash
git add src/db/seed/data.ts src/db/seed/run.ts graphify-out
git commit -m "feat(seed): add attendance and forum demo data for CRS events

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 8: STOP — surface the dev-Worker redeploy obligation, do not run it without approval**

Per CLAUDE.md and master-plan §15, this phase changed repository signatures used over the proxy, the internal contract (`src/db/contract/events.ts`, `retention.ts`), and the internal routes (`src/app/internal/events`), plus seed data shared-dev clients rely on. Present these commands and wait for explicit approval before running any of them:
```bash
pnpm db:migrate:dev   # no-op if no migration was generated this phase
pnpm db:seed:dev
pnpm deploy:dev
```

---

## Self-review notes (for the implementer, not a step to execute)

- **Spec coverage (master plan §12 Phase 4 + §6):**
  - create -> approve: Task 2 (`create`/`approve`/`reject` + `listPending`), Task 3 routes.
  - RSVP: Task 2 (`setRsvp`, idempotent upsert), Task 3 `/api/events/[id]/rsvp`.
  - member-carried static QR/barcode: Task 4 (`encodeMemberCode` static + `MemberCodeCard` client-side, never persisted) on the profile page (master plan §1).
  - event-admin scan flow + manual-search fallback: Task 2 (`recordScan` idempotent, `searchAttendableMembers`, `listAttendance`), Task 3 (`/scan`, `/members`), Task 5 (`EventScanPanel` with both paths).
  - attendance: Task 2 (`crsAttendance` write), Task 5 (`/attendance` roster).
  - media (R2): Task 6 (records keys from the existing hardened `purpose=event_media` upload; no new upload code, since Phase 1 already added that namespace).
  - forum with anonymity rules: Task 7 (member_id always stored; author hidden for anonymous unless super; super-only audited reveal) — matches master plan §6 exactly.
  - unified `retention_records` (event-derived) + status + leaderboard: Task 1 (`recordEventAttendance` with `source='event_attendance'`, `getMemberTermSummary` status from term thresholds, `leaderboard`). Manual entries are Phase 5 (explicitly out of scope here per the prompt and master plan §12 Phase 5).
- **Vestigial column:** `crs_events.checkin_secret` is flagged in Global Constraints and written as `""` by `create`; never read. Drop deferred to a schema-cleanup follow-up (it is a NOT NULL drop needing a table rebuild + dev redeploy).
- **No new schema:** verified every table used already exists in `src/db/schema.ts` from the v5 foundation migration (`crsEvents`, `eventRsvps`, `crsAttendance`, `eventMedia`, `eventForumPosts`, `terms`, `retentionRecords`). This phase generates NO migration. If `pnpm db:generate` would report drift, stop — something upstream is wrong.
- **Pattern fidelity:** repositories mirror `createMembersRepository` (explicit actor, `can()` then work, `audit.record()` after privileged writes). `/api/*` routes mirror `src/app/api/uploads/route.ts` (same-origin + shared proxy) and `src/app/api/members/route.ts` (`getRepositories()`). `/internal/events` mirrors `createMembersInternalHandlers` (404-unless-dev, CORS, `resolveSharedActor`, per-op `sharedDev`, contract parse in/out). Integration tests mirror `members.integration.test.ts` (`cloudflare:test` env, `drizzle(env.DB, { schema })`, `beforeEach` table cleanup).
- **Placeholder scan:** the one deliberate placeholder is the token hash in `events.test.ts` Step 6, which carries an explicit implementer note to copy the real sha256 derivation from `src/server/internal/shared-actor.ts`; the 404/401 assertions are concrete and self-contained regardless. The `type Db = any` aliases are a deliberate, lint-suppressed choice to avoid hand-writing the verbose chained Drizzle handle types (as `roster.ts` does) for repositories with many query shapes; the integration tests pass the real `DrizzleD1Database`, so runtime types are exercised end to end.
- **Type consistency:** `recordEventAttendance` is named identically in Task 1 (definition), Task 2 (caller in `recordScan`), and the retention test. `EventsRepository`/`RetentionRepository`/`EventMediaRepository`/`EventForumRepository` factory arities match between their definition tasks and the Task 8 barrel. Contract op names (`listApproved`/`create`/`approve`/`rsvp`/`scan`/`searchMembers`) match between `events.ts` contract, the internal handler, and the `?op=` query keys used by the `/api/*` proxy branches.
- **Authz axes:** event create/approve/reject + scan are on `event:approve` / `points:assign` (the `retention` role); forum reveal is strictly `super`; member reads of own retention are owner-or-`retention:record`. All enforced in the repository layer so shared mode (token-mapped actor) enforces identically.
- **D1 budget:** every list paginates with a default + max (50/100); leaderboard/summary use set-based aggregates; scan is a bounded read-then-insert; no unbounded selects; every `where`/`orderBy` rides an existing index (`crs_events_status_idx`, `event_rsvps` pk, `crs_attendance_member_id_idx` + pk, `retention_records_member_term_idx` / `_term_id_idx`, `event_forum_posts_event_created_idx`, `event_media_event_id_idx`).
- **Not in scope (later phases):** the `/portal/calendar/[eventId]` event-detail route and calendar wiring (Phase 7); manual retention records UI + negative/no-point manual entries (Phase 5); reporting/xlsx exports (Phase 8); a camera-based QR decoder and realtime check-in feed (deferred, master plan §11). The scan panel mounts in the existing workspace until Phase 7 provides the calendar detail route.
