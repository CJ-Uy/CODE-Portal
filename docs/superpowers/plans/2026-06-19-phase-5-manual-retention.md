# Phase 5 — Manual Retention Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin UI and write path for logging non-event retention records, so a retention admin can pick one or more members, pick the term (and optionally an event), write a freeform reason, and attach an optional point value (which may be negative or absent) that lands in the existing `retention_records` table with `source = "manual"`.

**Architecture:** Bottom-up, matching the existing repository seam. A real `retention` repository (replacing the empty stub) owns the authorization-checked, audited write that fans a single manual entry across the selected members inside one `db.batch()`. A typed contract operation plus an `/internal/retention` route expose that write over the shared-dev proxy. A `/portal/admin/retention` server-component page reads the member roster, terms, and approved events for the pickers; a `"use server"` action validates the form and calls the repository. The page is gated by the `retention:record` permission in the admin layout and again in the repository, so authorization holds across access modes.

**Tech Stack:** Next.js 16 App Router (React 19 server components + server actions), Drizzle ORM (SQLite dialect, D1 / better-sqlite3), Zod, Auth.js v5 session via `getActor()`, Vitest + `@cloudflare/vitest-pool-workers` (the existing `vitest.config.mts` auto-applies `drizzle/migrations` to an ephemeral test D1), local shadcn-style components in `src/components/ui`, Tailwind CSS v4, lucide-react.

## Global Constraints

- Member workspace lives under `/portal`; admin is a module at `/portal/admin/*`, not a separate top-level brand (master plan §1).
- Drizzle schema at `src/db/schema.ts` is the ONE schema source; one migration set under `drizzle/migrations`. Phase 5 adds NO new tables and NO schema change — `retention_records`, `terms`, `term_member_roster`, and `crs_events` already exist (verified in `src/db/schema.ts`). Do not edit `schema.ts` in this phase.
- Only infrastructure/adapter code touches raw bindings. Feature code uses repositories obtained from `getRepositories()`. Authorization runs inside the repository via `permissions.can()`; every successful privileged write calls `audit.record()` (master plan §3.2, §5).
- The write permission is `retention:record` (already present in `src/server/auth/permissions.ts`, mapped to the `retention` role; `super` inherits it). Audit category for these writes is `"retention"` (already present in `AuditCategory` and `audit.ts`).
- Mutating same-origin handlers/actions are cookie-authenticated; `/internal/*` is cross-origin, bearer-authenticated, guarded by `deployEnv === "dev"` (404 otherwise), CORS-allowlisted, no cookie auth (master plan §3.3, §4.5). The manual-write op is destructive/admin, so its contract entry is `sharedDev: "deny"`.
- D1 budget: one manual entry across N members must be a single set-based `db.batch()` write, not N round trips; cap the number of members per submission to stay within the 100-bound-param / 100 KB statement budget; every read query is date- or key-bounded and backed by an existing index (master plan §3.4).
- `points` is nullable AND may be negative (deductions allowed); `reason` is freeform text with no admin-managed catalog (master plan §6, §14 v5 #1). `event_id` is optional on a manual record.
- UI is built from the existing local shadcn-style registry (`src/components/ui`: `button`, `card`, `checkbox`, `input`, `select`, `textarea`, `badge`, `tabs`); theme via the `globals.css` tokens. The repo's `Select` is a plain styled `<select>` (single-select); the member checklist is a checkbox list, NOT a multi-select dropdown. Add a new shadcn component with `pnpm dlx shadcn@latest add <component>` only if a genuinely new control is needed; reuse before adding.
- No em dashes in UI copy, code comments, docs, or commit messages (master plan Global Constraints).
- Show the exact `pnpm exec wrangler` / `pnpm db:*` command and wait for approval before any D1 migration, seed, reset, or production-touching operation (CLAUDE.md). Phase 5 needs no migration; the only gated step is the final dev-Worker redeploy obligation in Task 7.

## Sequencing note (read before starting)

This phase **depends on the `retention_records` table** (already in `src/db/schema.ts`, lines 292-316) and is intended to sit after Phase 4. **As of this writing Phase 4 has NOT landed:** `src/db/repositories/retention.ts` and `src/db/repositories/events.ts` are both still the empty stub `export type X = Record<string, never>; export function createX() { return {}; }`. There is no event-attendance code populating `retention_records` yet.

This plan is therefore written to be **independent of Phase 4** — it implements the `retention` repository's manual-write path itself (the empty stub is replaced in Task 2) and does not call any events-repository function. Two consequences to honor while implementing:

- **If Phase 4 lands first** and has already replaced `createRetentionRepository()` with a real implementation, do NOT discard it. Instead, ADD the `createManual` method described in Task 2 to that existing `RetentionRepository` shape, keep its other methods, and keep the same method name/signature this plan specifies so Tasks 3-6 still type-check. Reconcile by merging, not overwriting.
- **If Phase 5 lands first** (this plan), Task 2 turns the stub into a real repository with exactly one method (`createManual`). Phase 4 then adds event-attendance methods to the same object. The `Repositories.retention` shape stays additive.

The seed already contains a manual record (`ret_demo_manual` in `src/db/seed/data.ts`) and term/roster/event rows, so the read pickers and the integration test have data to work against without new seed changes.

---

## File Structure

- `src/db/types.ts` (modify) — add `createManualRetentionRecordInputSchema` + `CreateManualRetentionRecordInput` (Zod is the single validation source, mirroring the existing member schemas).
- `src/db/repositories/retention.ts` (replace stub) — `RetentionRepository` with `createManual(actor, input)`; authorization via `can(actor, "retention:record")`, write via `db.batch()`, audit one row per affected member.
- `src/db/repositories/retention.integration.test.ts` (create) — D1 integration test for `createManual` (authz, fan-out, negative/absent points, audit, term validation).
- `src/db/repositories/index.ts` (modify) — pass `db`+`audit` into `createRetentionRepository` in BOTH the Drizzle and shared factory; widen the `db` param type so the retention repo's Drizzle handle is available.
- `src/db/contract/retention.ts` (create) — `retentionContract.createManual` operation (`auth: "admin"`, `permission: "retention:record"`, `sharedDev: "deny"`) + output schema.
- `src/db/contract/index.ts` (modify) — re-export `retentionContract`.
- `src/server/internal/retention.ts` (create) — `/internal/retention` POST handler mirroring `internal/members.ts` (dev guard, CORS, shared-actor resolve, `sharedDev:"deny"` refusal).
- `src/app/internal/retention/route.ts` (create) — thin Next route delegating to the handler.
- `src/app/portal/admin/layout.tsx` (create) — admin section gate (redirect non-admins); first file under `/portal/admin`.
- `src/app/portal/admin/retention/page.tsx` (create) — server component: reads pickers, renders the form.
- `src/app/portal/admin/retention/actions.ts` (create) — `"use server"` action: parse form, call `repositories.retention.createManual`.
- `src/app/portal/admin/retention/member-checklist.tsx` (create) — client component: searchable multi-select checkbox list of members.

---

### Task 1: Manual-retention input schema

**Files:**
- Modify: `src/db/types.ts` (append after `updateMemberProfileInputSchema`, before the `DatabaseAdapter` interface)
- Test: covered by Task 2's integration test (a pure-schema unit test is added here as a fast guard)
- Create: `src/db/types.test.ts`

**Interfaces:**
- Consumes: `zod` (already imported in `src/db/types.ts`).
- Produces: `createManualRetentionRecordInputSchema` (Zod) and `CreateManualRetentionRecordInput` (type), consumed by the repository (Task 2), the contract (Task 4), and the server action (Task 6). Shape:
  - `memberIds: string[]` (min 1, max 100, each non-empty, de-duplicated)
  - `termId: string` (non-empty)
  - `eventId: string | null` (optional, defaults `null`)
  - `points: number | null` (optional integer, may be negative, defaults `null`)
  - `reason: string` (trimmed, min 1, max 500)

- [ ] **Step 1: Write the failing unit test**

Create `src/db/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createManualRetentionRecordInputSchema } from "./types";

describe("createManualRetentionRecordInputSchema", () => {
	it("accepts a minimal valid manual entry and defaults optional fields", () => {
		const parsed = createManualRetentionRecordInputSchema.parse({
			memberIds: ["mem_a"],
			termId: "term_1",
			reason: "Submitted the required medical waiver",
		});
		expect(parsed).toEqual({
			memberIds: ["mem_a"],
			termId: "term_1",
			eventId: null,
			points: null,
			reason: "Submitted the required medical waiver",
		});
	});

	it("allows a negative point value", () => {
		const parsed = createManualRetentionRecordInputSchema.parse({
			memberIds: ["mem_a"],
			termId: "term_1",
			points: -5,
			reason: "Logged violation",
		});
		expect(parsed.points).toBe(-5);
	});

	it("de-duplicates member ids", () => {
		const parsed = createManualRetentionRecordInputSchema.parse({
			memberIds: ["mem_a", "mem_a", "mem_b"],
			termId: "term_1",
			reason: "Attended makeup session",
		});
		expect(parsed.memberIds).toEqual(["mem_a", "mem_b"]);
	});

	it("rejects an empty member list", () => {
		expect(() =>
			createManualRetentionRecordInputSchema.parse({ memberIds: [], termId: "term_1", reason: "x" }),
		).toThrow();
	});

	it("rejects a blank reason", () => {
		expect(() =>
			createManualRetentionRecordInputSchema.parse({ memberIds: ["mem_a"], termId: "term_1", reason: "   " }),
		).toThrow();
	});

	it("rejects a non-integer point value", () => {
		expect(() =>
			createManualRetentionRecordInputSchema.parse({
				memberIds: ["mem_a"],
				termId: "term_1",
				points: 2.5,
				reason: "x",
			}),
		).toThrow();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- types.test.ts`
Expected: FAIL with an import/resolution error — `createManualRetentionRecordInputSchema` is not exported from `./types` yet.

- [ ] **Step 3: Add the schema**

In `src/db/types.ts`, immediately after the `export type UpdateMemberProfileInput = ...` line and before `export interface DatabaseAdapter`, add:

```ts
export const createManualRetentionRecordInputSchema = z.object({
	memberIds: z
		.array(z.string().trim().min(1))
		.min(1, "Select at least one member.")
		.max(100, "Select at most 100 members per entry.")
		.transform((ids) => Array.from(new Set(ids))),
	termId: z.string().trim().min(1),
	eventId: z.string().trim().min(1).nullable().default(null),
	points: z.number().int().nullable().default(null),
	reason: z.string().trim().min(1, "A reason is required.").max(500),
});

export type CreateManualRetentionRecordInput = z.infer<typeof createManualRetentionRecordInputSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- types.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/db/types.ts src/db/types.test.ts
git commit -m "feat(retention): add manual retention record input schema"
```

---

### Task 2: Retention repository — real `createManual` write path

**IMPORTANT — read before touching this file:** By the time this phase is implemented, `src/db/repositories/retention.ts` is no longer the empty stub. Phase 4 (CRS events) already replaced it with a real file exporting `createRetentionRepository(db, audit): RetentionRepository` with FOUR existing methods: `recordEventAttendance`, `listForMember`, `getMemberTermSummary`, `leaderboard`. **Do not replace this file.** Read its current contents first, then ADD `createManual` as a fifth method on the same returned object and the same `RetentionRepository` type. The factory signature `(db, audit)` already matches what this task needs — do not change it. If Phase 4 has NOT landed yet (file is still the empty stub `{}`), create the file fresh with only `createManual` and flag that Phase 4's four methods must be merged in later — but the expected order is Phase 4 first.

**Files:**
- Modify: `src/db/repositories/retention.ts` (add `createManual` to the existing exported object; do not remove `recordEventAttendance`, `listForMember`, `getMemberTermSummary`, or `leaderboard`)
- Test: `src/db/repositories/retention.integration.test.ts` (Task 3 — add cases to the existing test file from Phase 4, do not replace it)

**Interfaces:**
- Consumes: `CreateManualRetentionRecordInput` (Task 1); `Actor` + `can` from `@/server/auth/permissions`; `AuditRepository` from `./audit`; `createId` from `@/lib/ids`; `retentionRecords` + `terms` from `@/db/schema`; the same Drizzle `db` handle already used by Phase 4's `recordEventAttendance`/etc (typed `any` in Phase 4 — keep it that way, do not narrow it for this task alone).
- Produces: `RetentionRepository` gains `createManual(actor, input): Promise<{ recordIds: string[] }>` alongside the four Phase-4 methods. `createRetentionRepository(db, audit): RetentionRepository` signature is unchanged — Phase 4 already wires `(db, audit)` everywhere this is called, so `index.ts` needs no changes for this task.

Behavior of `createManual`:
1. `if (!can(actor, "retention:record")) throw new Error("Not authorized to record retention records.")`.
2. Validate the term exists: `select` from `terms` where `id = input.termId` limit 1; if none, `throw new Error("Term not found.")`.
3. Build one `retentionRecords` insert row per member id, all sharing the same `termId`, `eventId`, `points`, `reason`, with `source: "manual"`, `recordedBy: actor.memberId`, a fresh `createId("ret")` each, and `recordedAt: new Date()`.
4. Insert all rows in a single `db.batch([...inserts])` (one round trip, implicit transaction; D1 has no interactive transactions, master plan §3.4).
5. Write ONE audit row per member via `audit.record(actor, { action: "retention:record_manual", targetType: "member", targetId: memberId, category: "retention", detail })`, where `detail` summarizes points + reason. (Auditing per target member keeps attribution queryable per member, consistent with the per-target rows the members repo writes.)
6. Return `{ recordIds }`.

- [ ] **Step 1: Read the existing file, then ADD `createManual` to it**

Open `src/db/repositories/retention.ts` as it stands after Phase 4. It already exports `RetentionRecord`, `RecordEventAttendanceInput`, `ListForMemberInput`, `MemberTermSummaryInput`, `RetentionStatus`, `RetentionSummary`, `LeaderboardInput`, `LeaderboardRow`, the `RetentionRepository` type with four methods, and `createRetentionRepository(db, audit)` returning an object literal with those four methods implemented. Leave every one of those untouched. Make exactly these additions:

1. Add the import: `import type { CreateManualRetentionRecordInput } from "../types";` (alongside the existing imports).
2. Extend the `RetentionRepository` type with a fifth method signature:

```ts
export type RetentionRepository = {
	recordEventAttendance(actor: Actor, input: RecordEventAttendanceInput): Promise<RetentionRecord>;
	listForMember(actor: Actor, input: ListForMemberInput): Promise<RetentionRecord[]>;
	getMemberTermSummary(actor: Actor, input: MemberTermSummaryInput): Promise<RetentionSummary>;
	leaderboard(actor: Actor, input: LeaderboardInput): Promise<LeaderboardRow[]>;
	createManual(actor: Actor, input: CreateManualRetentionRecordInput): Promise<{ recordIds: string[] }>;
};
```

3. Inside the object literal returned by `createRetentionRepository`, add `createManual` as a new property alongside the existing four (do not touch their bodies):

```ts
		async createManual(actor, input) {
			if (!can(actor, "retention:record")) {
				throw new Error("Not authorized to record retention records.");
			}

			const [term] = await db.select().from(terms).where(eq(terms.id, input.termId)).limit(1);
			if (!term) {
				throw new Error("Term not found.");
			}

			const recordedAt = new Date();
			const rows = input.memberIds.map((memberId) => ({
				id: createId("ret"),
				memberId,
				termId: input.termId,
				eventId: input.eventId,
				points: input.points,
				reason: input.reason,
				source: "manual" as const,
				recordedBy: actor.memberId,
				recordedAt,
			}));

			const inserts = rows.map((row) => db.insert(retentionRecords).values(row));
			await db.batch(inserts);

			const pointsLabel = input.points === null ? "no points" : `${input.points} points`;
			for (const row of rows) {
				await audit.record(actor, {
					action: "retention:record_manual",
					targetType: "member",
					targetId: row.memberId,
					category: "retention",
					detail: `${pointsLabel}: ${input.reason}`,
				});
			}

			return { recordIds: rows.map((row) => row.id) };
		},
```

`db` here is the same loosely-typed handle Phase 4 already uses for the other four methods (Phase 4 types it `any` — do not introduce a stricter `RetentionDb` type for this one method, it would conflict with the existing methods' usage). `eq` is already imported by Phase 4's version of the file; reuse it.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASSES with no changes needed anywhere else — `createRetentionRepository(db, audit)` callers in `index.ts` already match this signature because Phase 4 established it. If you see an error in `index.ts` about a missing `audit` argument, Phase 4 has not actually landed yet; stop and resolve the phase ordering before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/db/repositories/retention.ts
git commit -m "feat(retention): add manual retention record write path

Adds createManual alongside the existing event-attendance methods:
authorization-checked, fans one manual entry across selected members
in a single db.batch, and audits one row per member. Points may be
negative or absent."
```

---

### Task 3: Retention repository D1 integration test

**Files:**
- Create: `src/db/repositories/retention.integration.test.ts`

**Interfaces:**
- Consumes: `createRetentionRepository` + `createAuditRepository`; `retentionRecords`, `auditLogs` schema tables; the ephemeral `env.DB` from `cloudflare:test` with `drizzle/migrations` already applied by `vitest.config.mts`.
- Produces: nothing consumed elsewhere; this is the binding acceptance test for Task 2.

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/retention.integration.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs, retentionRecords } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createRetentionRepository } from "./retention";

const retentionAdmin: Actor = { memberId: "mem_admin", roles: ["retention"] };
const plainMember: Actor = { memberId: "mem_plain", roles: ["member"] };

const NOW = new Date("2026-06-19T00:00:00.000Z");

async function seedBaseRows() {
	await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
		.bind("mem_admin", "admin@example.com", "Admin")
		.run();
	await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
		.bind("mem_one", "one@example.com", "Member One")
		.run();
	await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
		.bind("mem_two", "two@example.com", "Member Two")
		.run();
	await env.DB.prepare(
		"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
	)
		.bind("term_1", "Term 1", 20, 10, NOW.getTime() - 1000, NOW.getTime() + 1000)
		.run();
}

describe("retention repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM retention_records").run();
		await env.DB.prepare("DELETE FROM terms").run();
		await env.DB.prepare("DELETE FROM members").run();
		await seedBaseRows();
	});

	it("records one manual entry across multiple members in a single batch", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRetentionRepository(db, createAuditRepository(db));

		const result = await repository.createManual(retentionAdmin, {
			memberIds: ["mem_one", "mem_two"],
			termId: "term_1",
			eventId: null,
			points: null,
			reason: "Submitted the required medical waiver",
		});

		const rows = await db.select().from(retentionRecords);
		expect(result.recordIds).toHaveLength(2);
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.source === "manual")).toBe(true);
		expect(rows.every((row) => row.points === null)).toBe(true);
		expect(rows.every((row) => row.recordedBy === "mem_admin")).toBe(true);
		expect(rows.map((row) => row.memberId).sort()).toEqual(["mem_one", "mem_two"]);
	});

	it("stores a negative point value as a deduction", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRetentionRepository(db, createAuditRepository(db));

		await repository.createManual(retentionAdmin, {
			memberIds: ["mem_one"],
			termId: "term_1",
			eventId: null,
			points: -5,
			reason: "Logged violation",
		});

		const [row] = await db.select().from(retentionRecords);
		expect(row.points).toBe(-5);
	});

	it("writes one retention audit row per member", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRetentionRepository(db, createAuditRepository(db));

		await repository.createManual(retentionAdmin, {
			memberIds: ["mem_one", "mem_two"],
			termId: "term_1",
			eventId: null,
			points: 3,
			reason: "Attended makeup session",
		});

		const audits = await db.select().from(auditLogs);
		expect(audits).toHaveLength(2);
		expect(audits.every((row) => row.category === "retention")).toBe(true);
		expect(audits.every((row) => row.action === "retention:record_manual")).toBe(true);
	});

	it("rejects an actor without the retention:record permission", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRetentionRepository(db, createAuditRepository(db));

		await expect(
			repository.createManual(plainMember, {
				memberIds: ["mem_one"],
				termId: "term_1",
				eventId: null,
				points: null,
				reason: "Nope",
			}),
		).rejects.toThrow("Not authorized");
		expect(await db.select().from(retentionRecords)).toHaveLength(0);
	});

	it("rejects an unknown term and writes nothing", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRetentionRepository(db, createAuditRepository(db));

		await expect(
			repository.createManual(retentionAdmin, {
				memberIds: ["mem_one"],
				termId: "term_missing",
				eventId: null,
				points: null,
				reason: "Bad term",
			}),
		).rejects.toThrow("Term not found");
		expect(await db.select().from(retentionRecords)).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails for the right reason**

Run: `pnpm test -- retention.integration.test.ts`
Expected: FAIL — the test imports `createRetentionRepository(db, audit)`; because `index.ts` does not yet pass those args this test is the first place exercising the new two-arg factory. If `index.ts` still fails to compile the whole suite, this is expected; proceed to Task 5 which fixes the wiring, then re-run. (If running this single test file compiles in isolation it should already PASS against Task 2's implementation; the cross-file typecheck is what Task 5 resolves.)

- [ ] **Step 3: Commit**

```bash
git add src/db/repositories/retention.integration.test.ts
git commit -m "test(retention): D1 integration test for manual record fan-out"
```

---

### Task 4: Retention contract operation

**Files:**
- Create: `src/db/contract/retention.ts`
- Modify: `src/db/contract/index.ts`

**Interfaces:**
- Consumes: `operation` from `./common`; `createManualRetentionRecordInputSchema` from `@/db/types`; `z` from `zod`.
- Produces: `retentionContract.createManual` (`InternalOperation`), with `auth: "admin"`, `permission: "retention:record"`, `sharedDev: "deny"`. Consumed by the internal handler (Task 5b). Output schema: `{ recordIds: z.array(z.string()) }`.

- [ ] **Step 1: Create `src/db/contract/retention.ts`**

```ts
import { z } from "zod";
import { createManualRetentionRecordInputSchema } from "@/db/types";
import { operation } from "./common";

export const retentionContract = {
	createManual: operation({
		input: createManualRetentionRecordInputSchema,
		output: z.object({ recordIds: z.array(z.string()) }),
		auth: "admin",
		permission: "retention:record",
		sharedDev: "deny",
	}),
};
```

- [ ] **Step 2: Re-export from the contract index**

In `src/db/contract/index.ts`, add the export line so the file reads:

```ts
export { membersContract } from "./members";
export { authContract } from "./auth";
export { uploadsContract } from "./uploads";
export { retentionContract } from "./retention";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: still failing only in `src/db/repositories/index.ts` (Task 5). The new contract files themselves are clean.

- [ ] **Step 4: Commit**

```bash
git add src/db/contract/retention.ts src/db/contract/index.ts
git commit -m "feat(retention): add createManual internal contract operation"
```

---

### Task 5: Wire the retention repository into the repository factories

**Files:**
- Modify: `src/db/repositories/index.ts`

**Interfaces:**
- Consumes: `createRetentionRepository(db, audit)` (Task 2); the existing `MemberDb & AuditDb` handle plus the new `RetentionDb` shape it satisfies (the real Drizzle handle satisfies all three).
- Produces: `Repositories.retention` is now the real `RetentionRepository` from Task 2 in both Drizzle and shared factories. Consumed by `getRepositories()` callers (the server action, Task 6) and unchanged elsewhere.

Note on the shared factory: shared mode (`createSharedRepositories`) builds repositories over the HTTP `DatabaseAdapter`, which has no Drizzle handle. Manual retention is `sharedDev: "deny"`, so the shared path must NOT silently no-op. Give the shared factory a retention repo whose `createManual` throws "Manual retention records are not available in shared mode." That keeps the deny faithful and matches how `createUnavailableAuditRepository` rejects.

- [ ] **Step 1: Replace `src/db/repositories/index.ts` in full**

```ts
import { createAuditRepository, createUnavailableAuditRepository } from "./audit";
import { createCalendarRepository } from "./calendar";
import { createEventsRepository } from "./events";
import { createLinksRepository } from "./links";
import { createMembersRepository } from "./members";
import { createNotificationsRepository } from "./notifications";
import { createRetentionRepository } from "./retention";
import { createUnavailableRetentionRepository } from "./retention-unavailable";
import { createSessionsRepository } from "./sessions";
import { createSurveysRepository } from "./surveys";
import type { MemberDb } from "./members";
import type { AuditDb } from "./audit";
import type { RetentionDb } from "./retention";
import type { DatabaseAdapter } from "../types";

export function createDrizzleRepositories(db: MemberDb & AuditDb & RetentionDb) {
	const audit = createAuditRepository(db);
	return {
		members: createMembersRepository(db, audit),
		sessions: createSessionsRepository(),
		links: createLinksRepository(),
		events: createEventsRepository(),
		retention: createRetentionRepository(db, audit),
		surveys: createSurveysRepository(),
		notifications: createNotificationsRepository(),
		calendar: createCalendarRepository(),
		audit,
	};
}

export type Repositories = ReturnType<typeof createDrizzleRepositories>;

export function createSharedRepositories(adapter: DatabaseAdapter): Repositories {
	const audit = createUnavailableAuditRepository();
	return {
		members: {
			list: async (_actor, input) => adapter.listMembers().then((members) => members.slice(0, input?.limit ?? 25)),
			getById: async (_actor, id) => adapter.getMemberById(id),
			create: async (_actor, input) => adapter.createMember(input),
			updateProfile: async (_actor, id, input) => adapter.updateMemberProfile(id, input),
		},
		sessions: createSessionsRepository(),
		links: createLinksRepository(),
		events: createEventsRepository(),
		retention: createUnavailableRetentionRepository(),
		surveys: createSurveysRepository(),
		notifications: createNotificationsRepository(),
		calendar: createCalendarRepository(),
		audit,
	};
}
```

- [ ] **Step 2: Create the shared-mode unavailable retention repo**

Create `src/db/repositories/retention-unavailable.ts`:

```ts
import type { RetentionRepository } from "./retention";

export function createUnavailableRetentionRepository(): RetentionRepository {
	return {
		async createManual() {
			throw new Error("Manual retention records are not available in shared mode.");
		},
	};
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS project-wide. The `db` handle passed to `createDrizzleRepositories` (the real Drizzle client from `getDb()`) structurally satisfies `MemberDb & AuditDb & RetentionDb`.

- [ ] **Step 4: Run the full repository test layer**

Run: `pnpm test -- retention.integration.test.ts members.integration.test.ts`
Expected: PASS — all retention cases from Task 3 green, members tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/index.ts src/db/repositories/retention-unavailable.ts
git commit -m "feat(retention): wire retention repository into drizzle and shared factories"
```

---

### Task 5b: Internal `/internal/retention` route (shared-dev proxy)

**Files:**
- Create: `src/server/internal/retention.ts`
- Create: `src/app/internal/retention/route.ts`

**Interfaces:**
- Consumes: `retentionContract` (Task 4); `createRetentionRepository` + `createAuditRepository`; `resolveSharedActor` from `./shared-actor`; `getInternalCorsHeaders` from `./cors`; `DeployEnv` from `@/server/env`; the dev Worker's `DrizzleD1Database<typeof schema>`.
- Produces: `createRetentionInternalHandlers({ db, deployEnv, allowedOrigins })` with a `fetch(request)` method; consumed by the route file. Mirrors `src/server/internal/members.ts` exactly for guards, CORS, actor resolution, and the `sharedDev:"deny"` refusal.

Because `retentionContract.createManual.sharedDev === "deny"`, the POST branch returns 403 "Operation is disabled in shared development." BEFORE touching the repository — same shape as the `members.create` deny branch. This keeps the route present and inert (the shared-mode parity story: the op is reachable but refused).

- [ ] **Step 1: Create `src/server/internal/retention.ts`**

```ts
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { retentionContract } from "@/db/contract/retention";
import { createAuditRepository } from "@/db/repositories/audit";
import { createRetentionRepository } from "@/db/repositories/retention";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type RetentionInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

export function createRetentionInternalHandlers({
	db,
	deployEnv,
	allowedOrigins = [],
}: RetentionInternalDependencies) {
	const repository = createRetentionRepository(db, createAuditRepository(db));

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

			if (request.method !== "POST") {
				return new Response("Method not allowed", { status: 405, headers: responseHeaders });
			}

			if (retentionContract.createManual.sharedDev === "deny") {
				return Response.json(
					{ error: "Operation is disabled in shared development." },
					{ status: 403, headers: responseHeaders },
				);
			}

			try {
				const input = retentionContract.createManual.input.parse(await request.json());
				const result = await repository.createManual(actor, input);
				const output = retentionContract.createManual.output.parse(result);
				return Response.json(output, { status: 201, headers: responseHeaders });
			} catch (error) {
				const message = error instanceof Error ? error.message : "Internal request failed.";
				const status = message.startsWith("Not authorized") ? 403 : 400;
				return Response.json({ error: message }, { status, headers: responseHeaders });
			}
		},
	};
}
```

- [ ] **Step 2: Create the route delegating to the handler**

First confirm the wiring used by the existing route so this one matches it exactly.

Run: `cat src/app/internal/members/route.ts`
Expected: shows how `createMembersInternalHandlers` is constructed (how it obtains `db`, `deployEnv`, and `allowedOrigins`). Mirror that construction precisely.

Then create `src/app/internal/retention/route.ts` following the SAME construction pattern the members route uses (same db acquisition, same `deployEnv`/`allowedOrigins` source), swapping in `createRetentionInternalHandlers` and exporting `POST` (and `OPTIONS` if the members route exports it):

```ts
// Mirror src/app/internal/members/route.ts. Replace the handler factory with
// createRetentionInternalHandlers and export the same HTTP verbs that route
// exports for a write endpoint (at minimum POST and OPTIONS). Do not invent a
// different db/deployEnv acquisition path; copy the one already in use.
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/internal/retention.ts src/app/internal/retention/route.ts
git commit -m "feat(retention): add /internal/retention shared-dev route (deny-guarded)"
```

---

### Task 6: Admin layout gate + retention page + server action

**Files:**
- Create: `src/app/portal/admin/layout.tsx`
- Create: `src/app/portal/admin/retention/page.tsx`
- Create: `src/app/portal/admin/retention/actions.ts`
- Create: `src/app/portal/admin/retention/member-checklist.tsx`

**Interfaces:**
- Consumes: `getActor`/`requireActor` from `@/server/auth/actor`; `can` from `@/server/auth/permissions`; `getRepositories` from `@/db`; `getDb` (read-only) via repositories OR a small read helper; `createManualRetentionRecordInputSchema` from `@/db/types`; UI components from `@/components/ui`.
- Produces: the `/portal/admin/retention` screen and `recordRetentionAction(formData)`. No later phase consumes these directly; Phase 8 adds sibling admin screens under the same `/portal/admin` layout.

The admin layout is the first file under `/portal/admin`; it gates the whole admin module. Phase 8 will extend it (per-scope nav). For Phase 5 it does the minimal correct thing: require an actor, and for the retention page require `retention:record`. Because each admin screen needs a DIFFERENT scope, the layout itself only requires "some admin-ish actor is signed in" and each PAGE re-checks its specific permission. Concretely: the layout requires a signed-in actor (redirect to `/signin` otherwise) and renders an "Admin" heading shell; the retention page checks `can(actor, "retention:record")` and calls `notFound()` if false, so a non-retention member cannot see or reach it. The server action re-checks via the repository (defense in depth).

- [ ] **Step 1: Create the admin layout**

Create `src/app/portal/admin/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
	const actor = await getActor();
	if (!actor) redirect("/signin");

	return (
		<div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
			<div className="mb-6">
				<p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Admin</p>
			</div>
			{children}
		</div>
	);
}
```

- [ ] **Step 2: Create the member-checklist client component**

Create `src/app/portal/admin/retention/member-checklist.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export type MemberOption = { id: string; label: string; sublabel: string };

export function MemberChecklist({ members }: { members: MemberOption[] }) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return members;
		return members.filter(
			(m) => m.label.toLowerCase().includes(needle) || m.sublabel.toLowerCase().includes(needle),
		);
	}, [members, query]);

	function toggle(id: string, checked: boolean) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	}

	return (
		<div className="grid gap-3">
			<Input
				aria-label="Search members"
				placeholder="Search members by name or email"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
			/>
			<p className="text-sm text-muted-foreground">{selected.size} selected</p>
			<ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
				{filtered.map((member) => (
					<li key={member.id}>
						<label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
							<Checkbox
								checked={selected.has(member.id)}
								onCheckedChange={(value) => toggle(member.id, value === true)}
							/>
							<span className="grid">
								<span className="font-medium">{member.label}</span>
								<span className="text-xs text-muted-foreground">{member.sublabel}</span>
							</span>
						</label>
					</li>
				))}
				{filtered.length === 0 ? (
					<li className="px-3 py-3 text-sm text-muted-foreground">No members match that search.</li>
				) : null}
			</ul>
			{Array.from(selected).map((id) => (
				<input key={id} type="hidden" name="memberIds" value={id} />
			))}
		</div>
	);
}
```

Note for the implementer: before relying on `onCheckedChange`/`checked`, open `src/components/ui/checkbox.tsx` and confirm its props. If that `Checkbox` is a plain `<input type="checkbox">` (likely, given `select.tsx` is a plain `<select>`), use `checked` + `onChange={(e) => toggle(member.id, e.target.checked)}` instead, and drop `onCheckedChange`. Keep the hidden-input emission of `name="memberIds"` either way; that is how the multi-select reaches the server action as a repeated form field.

- [ ] **Step 3: Create the server action**

Create `src/app/portal/admin/retention/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/db";
import { createManualRetentionRecordInputSchema } from "@/db/types";
import { requireActor } from "@/server/auth/actor";

export type RecordRetentionResult = { ok: true; count: number } | { ok: false; error: string };

export async function recordRetentionAction(_prev: RecordRetentionResult | null, formData: FormData): Promise<RecordRetentionResult> {
	const actor = await requireActor();

	const parsed = createManualRetentionRecordInputSchema.safeParse({
		memberIds: formData.getAll("memberIds").map(String),
		termId: nullableText(formData.get("termId")) ?? "",
		eventId: nullableText(formData.get("eventId")),
		points: parsePoints(formData.get("points")),
		reason: nullableText(formData.get("reason")) ?? "",
	});
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
	}

	try {
		const repositories = await getRepositories();
		const result = await repositories.retention.createManual(actor, parsed.data);
		revalidatePath("/portal/admin/retention");
		return { ok: true, count: result.recordIds.length };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to record retention.";
		return { ok: false, error: message };
	}
}

function nullableText(value: FormDataEntryValue | null): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}

function parsePoints(value: FormDataEntryValue | null): number | null {
	if (typeof value !== "string" || value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}
```

Note: `parsePoints` returns `null` for a non-numeric string so the Zod `points: z.number().int().nullable()` check produces a clean validation error rather than a NaN. An empty points field means "no points" (informational record), which is valid.

- [ ] **Step 4: Create the retention page**

Create `src/app/portal/admin/retention/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { loadRetentionPickers } from "./data";
import { MemberChecklist } from "./member-checklist";
import { RetentionForm } from "./retention-form";

export const dynamic = "force-dynamic";

export default async function RetentionAdminPage() {
	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "retention:record")) notFound();

	const { members, terms, events } = await loadRetentionPickers(actor);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-3xl">Log retention records</CardTitle>
				<CardDescription>
					Record non-event retention items. Pick the members, the term, optionally an event, write the reason,
					and add a point value if it applies. Points may be left blank or set negative for a deduction.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<RetentionForm
					members={members}
					termOptions={terms}
					eventOptions={events}
				/>
			</CardContent>
		</Card>
	);
}
```

Implementer note: `RetentionForm` (next step) is a small client wrapper that owns the `useActionState` hook around `recordRetentionAction` and renders the term/event `<Select>`, the points `<Input>`, the reason `<Textarea>`, the `<MemberChecklist>`, the submit `<Button>`, and the result banner. Keeping the stateful form in a client component lets the page stay a server component that only loads data. The imports of `Input`/`Select`/`Textarea` shown above belong in `retention-form.tsx`; if the page does not use them directly, move them there to satisfy lint.

- [ ] **Step 5: Create the form client component**

Create `src/app/portal/admin/retention/retention-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { recordRetentionAction, type RecordRetentionResult } from "./actions";
import { MemberChecklist, type MemberOption } from "./member-checklist";

type Option = { id: string; label: string };

export function RetentionForm({
	members,
	termOptions,
	eventOptions,
}: {
	members: MemberOption[];
	termOptions: Option[];
	eventOptions: Option[];
}) {
	const [state, formAction, pending] = useActionState<RecordRetentionResult | null, FormData>(
		recordRetentionAction,
		null,
	);

	return (
		<form action={formAction} className="grid gap-6">
			<fieldset className="grid gap-2">
				<legend className="text-sm font-medium">Members</legend>
				<MemberChecklist members={members} />
			</fieldset>

			<label className="grid gap-2 text-sm font-medium">
				Term
				<Select name="termId" defaultValue={termOptions[0]?.id ?? ""} required>
					{termOptions.map((term) => (
						<option key={term.id} value={term.id}>
							{term.label}
						</option>
					))}
				</Select>
			</label>

			<label className="grid gap-2 text-sm font-medium">
				Event (optional)
				<Select name="eventId" defaultValue="">
					<option value="">No event</option>
					{eventOptions.map((event) => (
						<option key={event.id} value={event.id}>
							{event.label}
						</option>
					))}
				</Select>
			</label>

			<label className="grid gap-2 text-sm font-medium">
				Points (optional, may be negative)
				<Input name="points" type="number" inputMode="numeric" step="1" placeholder="Leave blank for none" />
			</label>

			<label className="grid gap-2 text-sm font-medium">
				Reason
				<Textarea name="reason" required maxLength={500} placeholder="Submitted the required medical waiver" />
			</label>

			{state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
			{state && state.ok ? (
				<p className="text-sm text-emerald-600">Recorded {state.count} retention record(s).</p>
			) : null}

			<div>
				<Button type="submit" disabled={pending}>
					{pending ? "Recording..." : "Record retention"}
				</Button>
			</div>
		</form>
	);
}
```

- [ ] **Step 6: Create the picker data loader**

Create `src/app/portal/admin/retention/data.ts`. It loads the three picker lists through the repository seam. The members list reuses `repositories.members.list` (already `retention`-and-`super`-callable? NO: `members.list` requires `member:manage`). Since a retention admin may not hold `member:manage`, do NOT call `members.list` here. Instead load members, terms, and approved events with a small read that does not require `member:manage`. Use a read-only Drizzle query guarded by the page's `retention:record` check (the page already gated access before calling this):

```ts
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { crsEvents, members, terms } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { MemberOption } from "./member-checklist";

export async function loadRetentionPickers(actor: Actor): Promise<{
	members: MemberOption[];
	terms: { id: string; label: string }[];
	events: { id: string; label: string }[];
}> {
	if (!can(actor, "retention:record")) {
		throw new Error("Not authorized to load retention pickers.");
	}
	const db = getDb();

	const memberRows = await db
		.select({ id: members.id, name: members.name, fullName: members.fullName, email: members.email })
		.from(members)
		.where(inArray(members.status, ["active", "pending"]))
		.orderBy(members.email)
		.limit(500);

	const termRows = await db
		.select({ id: terms.id, name: terms.name })
		.from(terms)
		.orderBy(desc(terms.startsAt))
		.limit(50);

	const eventRows = await db
		.select({ id: crsEvents.id, title: crsEvents.title })
		.from(crsEvents)
		.where(eq(crsEvents.status, "approved"))
		.orderBy(desc(crsEvents.startsAt))
		.limit(200);

	return {
		members: memberRows.map((row) => ({
			id: row.id,
			label: row.fullName ?? row.name ?? row.email,
			sublabel: row.email,
		})),
		terms: termRows.map((row) => ({ id: row.id, label: row.name })),
		events: eventRows.map((row) => ({ id: row.id, label: row.title })),
	};
}
```

Implementer notes:
- `getDb()` throws in shared mode by design; admin pages run in real modes only (the dev Worker and local), consistent with how the profile page already calls repositories that resolve to Drizzle. The `can()` check makes the privileged read explicit, matching the "authorization in the data layer" rule (master plan §3.2).
- All three reads are bounded (`limit`) and key/index-backed: `members.status` (idx `members_status_idx`), `terms.starts_at` (idx `terms_starts_ends_idx`), `crs_events.status`/`starts_at` (idxs `crs_events_status_idx`, `crs_events_starts_at_idx`). The 500-member cap matches the schema-side 100-per-submission limit (the page can show more than can be submitted at once).

- [ ] **Step 7: Typecheck, lint, build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. If lint flags an unused import in `page.tsx` (Input/Select/Textarea moved into `retention-form.tsx`), remove it from `page.tsx`.

- [ ] **Step 8: Commit**

```bash
git add src/app/portal/admin
git commit -m "feat(retention): admin UI to log manual retention records

Adds the /portal/admin/retention screen: member checklist, term and
optional event pickers, freeform reason, optional signed point value.
Gated by retention:record; the server action revalidates on success."
```

---

### Task 7: Full suite, graph update, and dev-Worker redeploy obligation

**Files:**
- None (verification + ops gate)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a green suite and the surfaced (not auto-run) redeploy step.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS — includes `types.test.ts`, `retention.integration.test.ts`, and the pre-existing `permissions.test.ts`, `members.integration.test.ts`, `roster.integration.test.ts`, `shared-parity.integration.test.ts`, all against the migrated schema via `vitest.config.mts`.

- [ ] **Step 2: Run typecheck, lint, build (CI gates)**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS.

- [ ] **Step 3: Update the knowledge graph (AST-only, no API cost)**

Run: `graphify update .`
Expected: completes; new retention repository, contract, internal route, and admin pages are indexed. (Per CLAUDE.md graphify rules, keep the graph current after modifying code.)

- [ ] **Step 4: STOP — surface the dev-Worker redeploy obligation, do not run it without approval**

Per CLAUDE.md and master-plan §15, changes to the internal contract (`src/db/contract/retention.ts`), the internal API (`src/app/internal/retention/route.ts`, `src/server/internal/retention.ts`), and repository signatures used over the proxy require redeploying the dev Worker so shared-mode developers do not break. No schema or migration changed in this phase, so `db:migrate:dev` is NOT required; only a redeploy is. Present this command to the user and wait for explicit approval before running it:

```bash
pnpm deploy:dev
```

(If the implementer is unsure whether the dev D1 seed needs refreshing — it does not for Phase 5, since no seed data changed — do not run `db:seed:dev`.)

---

## Self-review notes (for the implementer, not a step to execute)

- **Spec coverage (master plan §12 Phase 5, §6 retention records, §14 v5 #1):**
  - "member checklist (multi-select)" → `member-checklist.tsx` (Task 6) + `memberIds: string[]` schema (Task 1) + fan-out in `createManual` (Task 2).
  - "term/event picker" → term `<Select>` (required) + optional event `<Select>` in `retention-form.tsx`; `loadRetentionPickers` supplies both (Task 6).
  - "freeform reason" → `reason` Textarea + `reason: z.string().min(1).max(500)` (Tasks 1, 6).
  - "optional (possibly negative) points" → `points: z.number().int().nullable()` accepting negatives and blanks (Task 1); negative-value integration test (Task 3); points `<Input type=number>` with "may be negative" label (Task 6).
  - "share the same `retention_records` table with `source: 'manual'`" → every inserted row sets `source: "manual"` (Task 2); the table already exists (no schema task).
  - "depends on Phase 4's `retention_records` table" → table verified present in `src/db/schema.ts`; Phase 4 dependency on the events code is explicitly avoided (Sequencing note); the empty `retention` stub is replaced here, with a documented merge path if Phase 4 lands first.
  - `retention:record` permission + `retention` role → enforced in the repository (Task 2), the page (Task 6), and the contract (Task 4); already defined in `permissions.ts`.
  - audit on every privileged write → one `category: "retention"` row per member (Task 2), asserted in Task 3.
  - shared-dev faithfulness → `sharedDev: "deny"` contract + 403 in the internal route + throwing shared repo (Tasks 4, 5, 5b).
- **Placeholder scan:** the only deliberately non-literal steps are Task 5b Step 2 (route file: copy the existing members route's exact db/deployEnv wiring rather than guess it) and Task 6 Step 2's note to confirm `checkbox.tsx`'s prop shape before choosing `onCheckedChange` vs `onChange`. Both are "read this one existing file and mirror it" instructions, not undefined behavior, because the exact wiring is environment-specific and must match the in-repo convention verbatim.
- **Type consistency:** `createManual(actor, input): Promise<{ recordIds: string[] }>` is named identically in Task 2 (impl), Task 3 (test), Task 4 (contract output `{ recordIds }`), Task 5 (wiring), Task 5b (internal route), Task 6 (action result `count = recordIds.length`). `createRetentionRepository(db, audit)` is two-arg everywhere it is called (Tasks 2, 5, 5b). `MemberOption`/`Option` shapes match between `member-checklist.tsx`, `retention-form.tsx`, and `data.ts`. The audit action string `"retention:record_manual"` and category `"retention"` are identical in impl (Task 2) and test (Task 3).
- **Open implementation checks left to the engineer (not plan gaps):** (a) confirm `Checkbox` props; (b) confirm the members internal route's construction signature before writing the retention route; (c) confirm `Textarea` exists in `src/components/ui` (it does, listed in the registry). None of these change the data model or contract.
