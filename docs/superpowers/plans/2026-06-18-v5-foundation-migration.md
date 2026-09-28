# v5 Foundation Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the already-built Phase 0/1 schema, permissions, auth, repositories, seed data, and public landing page from the v4 shape they were built against up to the v5 shape locked in `docs/superpowers/plans/2026-06-18-code-portal-master-plan.md` (§5, §6, §11, §12 Phase 1), so every later phase (2-9) builds on the correct foundation instead of the deferred content/publishing/teams/announcements/tours model.

**Architecture:** This is a schema-and-contract-first migration. Edit `src/db/schema.ts` to match the v5 data model exactly, then propagate the rename/removal through permissions, the auth `signIn` callback (new roster gate), repositories, contract types, and seed data — in that dependency order, since later edits reference the renamed/added symbols from earlier ones. The public landing page rewrite (no DB dependency) can happen independently.

**Tech Stack:** Drizzle ORM (SQLite dialect, D1), drizzle-kit, Auth.js v5 `signIn` callback, Vitest + `@cloudflare/vitest-pool-workers` (existing `vitest.config.mts` auto-applies `drizzle/migrations` to a test D1 instance).

## Global Constraints

- Drizzle schema at `src/db/schema.ts` is the ONE source of truth; one migration set under `drizzle/migrations` (master plan Global Constraints).
- No raw SQL internal endpoints; D1 never exposed as `DATABASE_URL` (CLAUDE.md).
- Show the exact `pnpm exec wrangler` / `pnpm db:*` command and wait for approval before any D1 reset, migration, seed, delete, or production-touching operation (CLAUDE.md). This applies to Task 8's `db:generate`-apply step and any dev-Worker redeploy — do not run those non-interactively.
- After this migration (schema, permissions, auth config) lands, the dev Worker must be redeployed (`pnpm db:migrate:dev` then `pnpm deploy:dev`) per CLAUDE.md and master-plan §15 — surfaced as the final, approval-gated step.
- `roster:manage` and `nav:configure` live under the `member_admin` permission scope (this plan resolves the ambiguity flagged inline in master-plan §6: membership gating and admin-pinned nav are general admin housekeeping, not point-scoring, so they don't belong on the renamed `retention` role).
- No em dashes in code comments, docs, or commits (master plan Global Constraints).

---

### Task 1: Schema — drop deferred subsystems, rename points to retention, add v5 tables

**Files:**
- Modify: `src/db/schema.ts` (whole-file edit, see below for exact before/after blocks)

**Interfaces:**
- Produces: `termMemberRoster`, `retentionRecords`, `navPins`, `quickLinks` tables; `AuditCategory` type now `"role" | "event" | "retention" | "survey" | "link" | "member"`. Removes `consultancyTeams`, `teamMembers`, `articles`, `articleSections`, `articleComponents`, `articleQuestions`, `articleRefs`, `topics`, `articleTopics`, `articleRelated`, `articleAcl`, `favorites`, `lists`, `listItems`, `comments`, `announcements`, `pointAwards`, `ArticleKind`, `ArticleConfidentiality`, `PrincipalType`, `AnnouncementAudienceKind` exports. Every later task in this plan consumes these new/removed names.

- [ ] **Step 1: Remove the deferred-content type unions**

In `src/db/schema.ts`, delete these three lines (lines 5-7, 13):

```ts
export type ArticleKind = "article" | "case";
export type ArticleConfidentiality = "public" | "members" | "confidential";
export type PrincipalType = "member" | "role" | "team";
```
```ts
export type AnnouncementAudienceKind = "all" | "role" | "batch";
```

Update the audit category union (line 15) from:
```ts
export type AuditCategory = "role" | "event" | "content" | "survey" | "link" | "member";
```
to:
```ts
export type AuditCategory = "role" | "event" | "retention" | "survey" | "link" | "member";
```

- [ ] **Step 2: Drop `tour_member_done` / `tour_admin_done` from `members`**

In the `members` table definition, delete these two lines:
```ts
		tourMemberDone: integer("tour_member_done", { mode: "boolean" }).notNull().default(false),
		tourAdminDone: integer("tour_admin_done", { mode: "boolean" }).notNull().default(false),
```

- [ ] **Step 3: Delete the consultancy-teams tables**

Delete the entire `consultancyTeams` and `teamMembers` table definitions (the two `export const` blocks immediately after `sharedDevTokens`, ending right before `export const articles`).

- [ ] **Step 4: Delete the entire content/publishing block**

Delete every `export const` table definition from `articles` through `comments` inclusive: `articles`, `articleSections`, `articleComponents`, `articleQuestions`, `articleRefs`, `topics`, `articleTopics`, `articleRelated`, `articleAcl`, `favorites`, `lists`, `listItems`, `comments`. This is everything between the (now-deleted) `teamMembers` block and the `shortLinks` block.

- [ ] **Step 5: Add embed/OG preview columns to `short_links`**

Replace the `shortLinks` table definition with:
```ts
export const shortLinks = sqliteTable(
	"short_links",
	{
		id: text("id").primaryKey(),
		slug: text("slug").notNull().unique(),
		destinationUrl: text("destination_url").notNull(),
		title: text("title").notNull(),
		ownerMemberId: text("owner_member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		clickCount: integer("click_count").notNull().default(0),
		previewTitle: text("preview_title"),
		previewDescription: text("preview_description"),
		previewImageKey: text("preview_image_key"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("short_links_slug_idx").on(table.slug), index("short_links_owner_member_id_idx").on(table.ownerMemberId)],
);
```

- [ ] **Step 6: Add `term_member_roster`**

Immediately after the `terms` table definition, add:
```ts
export const termMemberRoster = sqliteTable(
	"term_member_roster",
	{
		termId: text("term_id")
			.notNull()
			.references(() => terms.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		memberId: text("member_id").references(() => members.id, { onDelete: "set null" }),
		addedBy: text("added_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		primaryKey({ columns: [table.termId, table.email] }),
		index("term_member_roster_term_id_idx").on(table.termId),
		index("term_member_roster_email_idx").on(table.email),
	],
);
```

- [ ] **Step 7: Replace `point_awards` with `retention_records`**

Add this new type alias near the other type unions at the top of the file (with the other `export type` declarations):
```ts
export type RetentionRecordSource = "event_attendance" | "manual";
```

Replace the entire `pointAwards` table definition with:
```ts
export const retentionRecords = sqliteTable(
	"retention_records",
	{
		id: text("id").primaryKey(),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		termId: text("term_id")
			.notNull()
			.references(() => terms.id, { onDelete: "cascade" }),
		eventId: text("event_id").references(() => crsEvents.id, { onDelete: "set null" }),
		points: integer("points"),
		reason: text("reason").notNull(),
		source: text("source").$type<RetentionRecordSource>().notNull().default("manual"),
		recordedBy: text("recorded_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		index("retention_records_member_term_idx").on(table.memberId, table.termId),
		index("retention_records_term_id_idx").on(table.termId),
		index("retention_records_event_id_idx").on(table.eventId),
	],
);
```

- [ ] **Step 8: Drop `announcements`, drop `announcements_seen_at` from `member_feed_state`**

Delete the entire `announcements` table definition.

Replace the `memberFeedState` table definition with:
```ts
export const memberFeedState = sqliteTable("member_feed_state", {
	memberId: text("member_id")
		.primaryKey()
		.references(() => members.id, { onDelete: "cascade" }),
	surveysSeenAt: integer("surveys_seen_at", { mode: "timestamp_ms" }),
	eventsSeenAt: integer("events_seen_at", { mode: "timestamp_ms" }),
});
```

- [ ] **Step 9: Add `nav_pins` and `quick_links`**

Immediately after the `auditLogs` table definition (end of file, before the final newline), add:
```ts
export const navPins = sqliteTable(
	"nav_pins",
	{
		id: text("id").primaryKey(),
		label: text("label").notNull(),
		url: text("url").notNull(),
		icon: text("icon").notNull(),
		position: integer("position").notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("nav_pins_position_idx").on(table.position)],
);

export const quickLinks = sqliteTable(
	"quick_links",
	{
		id: text("id").primaryKey(),
		label: text("label").notNull(),
		url: text("url").notNull(),
		position: integer("position").notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("quick_links_position_idx").on(table.position)],
);
```

- [ ] **Step 10: Typecheck the schema file in isolation**

Run: `pnpm typecheck`
Expected: FAILS at this point, listing every file that still imports a removed export (`articles`, `announcements`, `consultancyTeams`, `teamMembers`, `pointAwards`, `ArticleKind`, etc). This failure list is exactly the file set Tasks 2-7 fix. Do not fix them here — confirm the list matches: `src/db/contract/members.ts`, `src/db/repositories/index.ts`, `src/db/repositories/articles.ts` (about to be deleted), `src/db/repositories/announcements.ts` (about to be deleted), `src/db/repositories/teams.ts` (about to be deleted), `src/db/repositories/points.ts` (about to be renamed), `src/db/seed/data.ts`, `src/db/seed/run.ts`, `src/server/auth/permissions.ts`, `src/server/auth/permissions.test.ts`, `src/db/repositories/audit.ts`.

- [ ] **Step 11: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(schema): migrate to v5 data model

Drop content/publishing, teams, announcements, tour-tracking columns.
Rename point_awards to retention_records (unified event + manual
entries). Add term_member_roster, nav_pins, quick_links, short_links
embed-preview columns."
```

---

### Task 2: Permissions — rename `crs` to `retention`, drop `publishing`, add v5 actions

**Files:**
- Modify: `src/server/auth/permissions.ts` (full file)
- Modify: `src/server/auth/permissions.test.ts` (full file)

**Interfaces:**
- Consumes: nothing from Task 1 directly (this file has no schema import), but is consumed by Task 1's `retentionRecords`/`navPins` naming convention.
- Produces: `roleKeys = ["super", "member", "calendar", "link", "retention", "member_admin"]`, `permissionActions` including `"retention:record"`, `"roster:manage"`, `"nav:configure"`. `can(actor, action)` signature unchanged. Tasks 3 (auth.ts roster gate import), 4 (contract), 6 (audit.ts) and every future admin-UI phase rely on these exact role/action strings.

- [ ] **Step 1: Update the failing test first**

Replace `src/server/auth/permissions.test.ts` in full:
```ts
import { describe, expect, it } from "vitest";
import { can, type Actor, type PermissionAction, type RoleKey } from "./permissions";

const cases: Array<{ role: RoleKey; allowed: PermissionAction[] }> = [
	{ role: "member", allowed: [] },
	{ role: "calendar", allowed: [] },
	{ role: "link", allowed: ["link:moderate"] },
	{ role: "retention", allowed: ["event:approve", "points:assign", "retention:record"] },
	{ role: "member_admin", allowed: ["member:manage", "role:assign", "roster:manage", "nav:configure"] },
];

const actions: PermissionAction[] = [
	"event:approve",
	"points:assign",
	"retention:record",
	"link:moderate",
	"role:assign",
	"survey:configure",
	"member:manage",
	"roster:manage",
	"nav:configure",
];

describe("permissions", () => {
	it("denies anonymous actors", () => {
		expect(actions.every((action) => !can(null, action))).toBe(true);
	});

	it("grants every permission to super admins", () => {
		const actor: Actor = { memberId: "super", roles: ["member", "super"] };
		expect(actions.every((action) => can(actor, action))).toBe(true);
	});

	it.each(cases)("maps $role to its scoped permissions", ({ role, allowed }) => {
		const actor: Actor = { memberId: role, roles: ["member", role] };
		for (const action of actions) {
			expect(can(actor, action)).toBe(allowed.includes(action));
		}
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- permissions.test.ts`
Expected: FAIL — `roleKeys`/`permissionActions` in `permissions.ts` don't yet include `"retention"`, `"roster:manage"`, `"nav:configure"`, and still include `"publishing"`/`"crs"`/`"content:publish"`/`"library:read_confidential"`, so the type and the runtime cases mismatch.

- [ ] **Step 3: Replace `src/server/auth/permissions.ts` in full**

```ts
export const roleKeys = ["super", "member", "calendar", "link", "retention", "member_admin"] as const;

export type RoleKey = (typeof roleKeys)[number];

export const permissionActions = [
	"event:approve",
	"points:assign",
	"retention:record",
	"link:moderate",
	"role:assign",
	"survey:configure",
	"member:manage",
	"roster:manage",
	"nav:configure",
] as const;

export type PermissionAction = (typeof permissionActions)[number];

export type Actor = {
	memberId: string;
	roles: RoleKey[];
	context?: "session" | "shared_dev_token";
	sharedTokenHash?: string | null;
	sharedTokenLabel?: string | null;
};

const rolePermissions: Record<Exclude<RoleKey, "super" | "member">, PermissionAction[]> = {
	calendar: [],
	link: ["link:moderate"],
	retention: ["event:approve", "points:assign", "retention:record"],
	member_admin: ["member:manage", "role:assign", "roster:manage", "nav:configure"],
};

export function can(actor: Actor | null, action: PermissionAction): boolean {
	if (!actor) return false;
	if (actor.roles.includes("super")) return true;
	return actor.roles.some((role) => {
		if (role === "member" || role === "super") return false;
		return rolePermissions[role].includes(action);
	});
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- permissions.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/permissions.ts src/server/auth/permissions.test.ts
git commit -m "feat(auth): rename crs role to retention, drop publishing

Adds retention:record, roster:manage, nav:configure actions for the
v5 manual-retention, roster-gate, and nav-pins admin surfaces."
```

---

### Task 3: Audit category and contract — drop `content`, add `retention`; drop tour fields

**Files:**
- Modify: `src/db/repositories/audit.ts:10` (the `AuditRecordInput.category` union)
- Modify: `src/db/contract/members.ts:18-20` (drop tour fields from `memberOutputSchema`)

**Interfaces:**
- Consumes: `src/db/schema.ts`'s `AuditCategory` (Task 1).
- Produces: `AuditRecordInput.category` matching `AuditCategory` exactly so `createAuditRepository(...).record()` callers (Task 6's roster gate, every future admin mutation) type-check against the same union.

- [ ] **Step 1: Fix the audit category union**

In `src/db/repositories/audit.ts`, change line 10 from:
```ts
	category: "role" | "event" | "content" | "survey" | "link" | "member";
```
to:
```ts
	category: "role" | "event" | "retention" | "survey" | "link" | "member";
```

- [ ] **Step 2: Drop tour fields from the members contract output schema**

In `src/db/contract/members.ts`, delete these two lines from `memberOutputSchema`:
```ts
	tourMemberDone: z.boolean(),
	tourAdminDone: z.boolean(),
```

- [ ] **Step 3: Run typecheck to confirm these two files are clean**

Run: `pnpm typecheck`
Expected: no errors reference `audit.ts` or `contract/members.ts` anymore (other files from Task 1 Step 10's list still fail until later tasks).

- [ ] **Step 4: Commit**

```bash
git add src/db/repositories/audit.ts src/db/contract/members.ts
git commit -m "fix(contract): align audit category and member contract with v5 schema"
```

---

### Task 4: Repositories — delete deferred stubs, rename points to retention

**Files:**
- Delete: `src/db/repositories/articles.ts`
- Delete: `src/db/repositories/announcements.ts`
- Delete: `src/db/repositories/teams.ts`
- Delete: `src/db/repositories/points.ts`
- Create: `src/db/repositories/retention.ts`
- Modify: `src/db/repositories/index.ts` (full file)

**Interfaces:**
- Produces: `createRetentionRepository(): RetentionRepository` (still an empty stub — Phase 4/5 fill it in), `Repositories.retention` replacing `Repositories.points`/`.articles`/`.announcements`/`.teams`. Phase 2+ plans that touch `getRepositories()` consume this shape.

- [ ] **Step 1: Delete the four deferred/renamed stub files**

```bash
git rm src/db/repositories/articles.ts src/db/repositories/announcements.ts src/db/repositories/teams.ts src/db/repositories/points.ts
```

- [ ] **Step 2: Create the renamed stub**

Create `src/db/repositories/retention.ts`:
```ts
export type RetentionRepository = Record<string, never>;
export function createRetentionRepository(): RetentionRepository {
	return {};
}
```

- [ ] **Step 3: Replace `src/db/repositories/index.ts` in full**

```ts
import { createAuditRepository, createUnavailableAuditRepository } from "./audit";
import { createCalendarRepository } from "./calendar";
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

export function createDrizzleRepositories(db: MemberDb & AuditDb) {
	const audit = createAuditRepository(db);
	return {
		members: createMembersRepository(db, audit),
		sessions: createSessionsRepository(),
		links: createLinksRepository(),
		events: createEventsRepository(),
		retention: createRetentionRepository(),
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
		retention: createRetentionRepository(),
		surveys: createSurveysRepository(),
		notifications: createNotificationsRepository(),
		calendar: createCalendarRepository(),
		audit,
	};
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors reference `repositories/index.ts` or the deleted stub files anymore.

- [ ] **Step 5: Commit**

```bash
git add -A src/db/repositories
git commit -m "refactor(repos): drop deferred article/announcement/team stubs, rename points to retention"
```

---

### Task 5: Auth roster gate — `term_member_roster` becomes a real sign-in gate

**Files:**
- Create: `src/server/auth/roster.ts`
- Create: `src/server/auth/roster.integration.test.ts`
- Modify: `src/auth.ts:35-47` (the `signIn` callback)

**Interfaces:**
- Consumes: `terms`, `termMemberRoster`, `members`, `memberRoles`, `roles` from `@/db/schema` (Task 1); `getDb` return type from `@/db/client`.
- Produces: `isRosterSignInAllowed(db, email, now?): Promise<boolean>` — the single function `src/auth.ts`'s `signIn` callback calls after the existing domain/allowlist check.

- [ ] **Step 1: Write the failing integration test**

Create `src/server/auth/roster.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { isRosterSignInAllowed } from "./roster";

const NOW = new Date("2026-06-18T00:00:00.000Z");

describe("isRosterSignInAllowed", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM term_member_roster").run();
		await env.DB.prepare("DELETE FROM member_roles").run();
		await env.DB.prepare("DELETE FROM terms").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("DELETE FROM roles").run();

		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_current", "Term Current", 20, 10, NOW.getTime() - 1000, NOW.getTime() + 1000 * 60 * 60 * 24 * 30)
			.run();
		await env.DB.prepare("INSERT INTO roles (id, key, label, description, kind) VALUES (?, ?, ?, ?, ?)")
			.bind("role_super", "super", "Super admin", "Full access.", "admin")
			.run();
	});

	it("allows an email present on the current term's roster", async () => {
		await env.DB.prepare("INSERT INTO term_member_roster (term_id, email, added_by, added_at) VALUES (?, ?, ?, ?)")
			.bind("term_current", "roster@example.com", "seed", NOW.getTime())
			.run();
		const db = drizzle(env.DB, { schema });

		await expect(isRosterSignInAllowed(db, "Roster@Example.com", NOW)).resolves.toBe(true);
	});

	it("rejects a new sign-in for an email absent from the current term's roster", async () => {
		const db = drizzle(env.DB, { schema });

		await expect(isRosterSignInAllowed(db, "outsider@example.com", NOW)).resolves.toBe(false);
	});

	it("deactivates and rejects an existing member who fell off the roster", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_dropped", "dropped@example.com", "Dropped Member", "active")
			.run();
		const db = drizzle(env.DB, { schema });

		await expect(isRosterSignInAllowed(db, "dropped@example.com", NOW)).resolves.toBe(false);
		const [member] = await db.select({ status: schema.members.status }).from(schema.members).where(
			schema.eq ? schema.eq(schema.members.id, "mem_dropped") : undefined,
		);
		expect(member?.status).toBe("inactive");
	});

	it("lets a super admin sign in even without a roster row", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_super", "super@example.com", "Super Admin", "active")
			.run();
		await env.DB.prepare("INSERT INTO member_roles (member_id, role_id, assigned_at) VALUES (?, ?, ?)")
			.bind("mem_super", "role_super", NOW.getTime())
			.run();
		const db = drizzle(env.DB, { schema });

		await expect(isRosterSignInAllowed(db, "super@example.com", NOW)).resolves.toBe(true);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- roster.integration.test.ts`
Expected: FAIL — `./roster` does not exist yet.

- [ ] **Step 3: Write `src/server/auth/roster.ts`**

```ts
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { members, memberRoles, roles, termMemberRoster, terms } from "@/db/schema";
import type { getDb } from "@/db/client";

type Db = ReturnType<typeof getDb>;

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

async function getCurrentTermId(db: Db, now: Date): Promise<string | null> {
	const [term] = await db
		.select({ id: terms.id })
		.from(terms)
		.where(and(lte(terms.startsAt, now), gte(terms.endsAt, now)))
		.orderBy(desc(terms.startsAt))
		.limit(1);
	return term?.id ?? null;
}

async function isMemberSuperAdmin(db: Db, memberId: string): Promise<boolean> {
	const rows = await db
		.select({ key: roles.key })
		.from(memberRoles)
		.innerJoin(roles, eq(roles.id, memberRoles.roleId))
		.where(eq(memberRoles.memberId, memberId));
	return rows.some((row) => row.key === "super");
}

async function isEmailOnRoster(db: Db, termId: string, email: string): Promise<boolean> {
	const [row] = await db
		.select({ email: termMemberRoster.email })
		.from(termMemberRoster)
		.where(and(eq(termMemberRoster.termId, termId), eq(termMemberRoster.email, email)))
		.limit(1);
	return Boolean(row);
}

async function deactivateMemberByEmail(db: Db, email: string): Promise<void> {
	await db.update(members).set({ status: "inactive", updatedAt: new Date() }).where(eq(members.email, email));
}

/**
 * The v5 sign-in gate: an email must be on the CURRENT active term's roster to
 * sign in, unless the existing member already holds the super role (so a
 * misconfigured or stale roster can never lock out the org's own admins).
 * An existing member who falls off the roster is flipped to inactive so
 * admin reporting can see they were removed, not merely never seen.
 */
export async function isRosterSignInAllowed(db: Db, email: string, now: Date = new Date()): Promise<boolean> {
	const normalized = normalizeEmail(email);
	const [existing] = await db.select({ id: members.id }).from(members).where(eq(members.email, normalized)).limit(1);

	if (existing && (await isMemberSuperAdmin(db, existing.id))) return true;

	const termId = await getCurrentTermId(db, now);
	if (!termId) {
		if (existing) await deactivateMemberByEmail(db, normalized);
		return false;
	}

	const onRoster = await isEmailOnRoster(db, termId, normalized);
	if (!onRoster) {
		if (existing) await deactivateMemberByEmail(db, normalized);
		return false;
	}

	return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- roster.integration.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Wire the gate into the `signIn` callback**

In `src/auth.ts`, replace the `signIn` callback (currently lines 35-47):
```ts
			async signIn({ account, profile }) {
				return isGoogleSignInAllowed(
					{
						provider: account?.provider,
						email: profile?.email,
						emailVerified: profile?.email_verified === true,
					},
					{
						allowedDomains,
						allowlistEmails: splitAuthList(config.AUTH_ALLOWLIST_EMAILS),
					},
				);
			},
```
with:
```ts
			async signIn({ account, profile }) {
				const allowedByDomain = isGoogleSignInAllowed(
					{
						provider: account?.provider,
						email: profile?.email,
						emailVerified: profile?.email_verified === true,
					},
					{
						allowedDomains,
						allowlistEmails: splitAuthList(config.AUTH_ALLOWLIST_EMAILS),
					},
				);
				if (!allowedByDomain || !profile?.email) return false;
				return isRosterSignInAllowed(db, profile.email);
			},
```

Add the import at the top of `src/auth.ts` (alongside the other `@/server/auth/...` imports):
```ts
import { isRosterSignInAllowed } from "@/server/auth/roster";
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors reference `src/auth.ts` or `src/server/auth/roster.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/server/auth/roster.ts src/server/auth/roster.integration.test.ts src/auth.ts
git commit -m "feat(auth): gate sign-in on the current term's member roster

Off-roster sign-ins are rejected; existing members who fall off a
roster are flipped to inactive. Super admins bypass the gate so a
misconfigured roster can never lock out the org's own admins."
```

---

### Task 6: Seed data — drop teams/articles/announcements, add roster + retention records

**Files:**
- Modify: `src/db/seed/data.ts` (full file)
- Modify: `src/db/seed/run.ts:1-27, 52-76` (imports + `seedLocal`)

**Interfaces:**
- Consumes: `termMemberRoster`, `retentionRecords` from `@/db/schema` (Task 1).
- Produces: `seedTermMemberRoster`, `seedRetentionRecords` arrays consumed by `seed/run.ts`'s `seedLocal()`.

- [ ] **Step 1: Replace `src/db/seed/data.ts` in full**

```ts
import type { InferInsertModel } from "drizzle-orm";
import {
	auditLogs,
	crsEvents,
	linkDailyStats,
	members,
	memberRoles,
	reservedSlugs,
	retentionRecords,
	roles,
	sharedDevTokens,
	shortLinks,
	surveyAssignments,
	surveyQuestions,
	surveys,
	termMemberRoster,
	terms,
} from "@/db/schema";

const now = new Date("2026-06-18T00:00:00.000Z");
const later = new Date("2026-07-10T10:00:00.000Z");

export const seedRoles: InferInsertModel<typeof roles>[] = [
	{ id: "role_super", key: "super", label: "Super admin", description: "Full portal access.", kind: "admin" },
	{ id: "role_calendar", key: "calendar", label: "Calendar", description: "Manages shared dates.", kind: "admin" },
	{ id: "role_link", key: "link", label: "Links", description: "Moderates short links.", kind: "admin" },
	{ id: "role_retention", key: "retention", label: "Retention", description: "Approves events and logs retention records.", kind: "admin" },
	{ id: "role_member_admin", key: "member_admin", label: "Member admin", description: "Manages member profiles, roles, roster, and nav pins.", kind: "admin" },
];

export const seedMembers: InferInsertModel<typeof members>[] = [
	{ id: "mem_demo_admin", email: "admin@example.com", name: "Demo Admin", fullName: "Demo Admin", batch: "2026", status: "active" },
	{ id: "mem_demo_member", email: "member@example.com", name: "Demo Member", fullName: "Demo Member", batch: "2027", status: "active" },
];

export const seedMemberRoles: InferInsertModel<typeof memberRoles>[] = [
	{ memberId: "mem_demo_admin", roleId: "role_super", assignedBy: "mem_demo_admin" },
];

export const seedTerms: InferInsertModel<typeof terms>[] = [
	{ id: "term_2026_1", name: "Term 1 2026", retainedAt: 20, probationBelow: 10, startsAt: now, endsAt: new Date("2026-10-31T00:00:00.000Z") },
];

export const seedTermMemberRoster: InferInsertModel<typeof termMemberRoster>[] = [
	{ termId: "term_2026_1", email: "admin@example.com", memberId: "mem_demo_admin", addedBy: "mem_demo_admin", addedAt: now },
	{ termId: "term_2026_1", email: "member@example.com", memberId: "mem_demo_member", addedBy: "mem_demo_admin", addedAt: now },
];

export const seedReservedSlugs: InferInsertModel<typeof reservedSlugs>[] = [{ slug: "portal" }, { slug: "admin" }, { slug: "api" }];

export const seedShortLinks: InferInsertModel<typeof shortLinks>[] = [
	{
		id: "lnk_demo",
		slug: "welcome",
		destinationUrl: "https://example.com/code",
		title: "Welcome link",
		ownerMemberId: "mem_demo_admin",
		clickCount: 5,
	},
];

export const seedLinkDailyStats: InferInsertModel<typeof linkDailyStats>[] = [
	{ linkId: "lnk_demo", date: "2026-06-18", referrerBucket: "direct", deviceBucket: "desktop", count: 5 },
];

export const seedEvents: InferInsertModel<typeof crsEvents>[] = [
	{
		id: "evt_demo",
		title: "Consulting Practice Night",
		type: "official",
		status: "approved",
		points: 5,
		place: "SOM 111",
		startsAt: later,
		endsAt: new Date("2026-07-10T12:00:00.000Z"),
		description: "A sample CRS event for portal modules.",
		createdBy: "mem_demo_admin",
		approvedBy: "mem_demo_admin",
		approvedAt: now,
		checkinSecret: "demo-checkin-secret",
	},
];

export const seedRetentionRecords: InferInsertModel<typeof retentionRecords>[] = [
	{
		id: "ret_demo_event",
		memberId: "mem_demo_member",
		termId: "term_2026_1",
		eventId: "evt_demo",
		points: 5,
		reason: "Attended Consulting Practice Night",
		source: "event_attendance",
		recordedBy: "mem_demo_admin",
		recordedAt: later,
	},
	{
		id: "ret_demo_manual",
		memberId: "mem_demo_member",
		termId: "term_2026_1",
		eventId: null,
		points: null,
		reason: "Submitted the required medical waiver",
		source: "manual",
		recordedBy: "mem_demo_admin",
		recordedAt: now,
	},
];

export const seedSurveys: InferInsertModel<typeof surveys>[] = [
	{ id: "srv_demo", title: "Practice Night Feedback", status: "running", sampleSize: 1, eventId: "evt_demo", createdBy: "mem_demo_admin" },
];

export const seedSurveyQuestions: InferInsertModel<typeof surveyQuestions>[] = [
	{ id: "srvq_demo_1", surveyId: "srv_demo", position: 1, type: "scale", prompt: "How useful was the session?", optionsJson: "[1,2,3,4,5]" },
];

export const seedSurveyAssignments: InferInsertModel<typeof surveyAssignments>[] = [
	{ surveyId: "srv_demo", memberId: "mem_demo_member", responseTokenHash: "demo-response-token-hash" },
];

export const seedAuditLogs: InferInsertModel<typeof auditLogs>[] = [
	{ id: "aud_demo", actorMemberId: "mem_demo_admin", action: "seed:load", targetType: "database", targetId: "local", category: "member", detail: "Initial demo seed loaded." },
];

export const seedSharedDevTokens: InferInsertModel<typeof sharedDevTokens>[] = [
	{ tokenHash: "shared-dev-admin-token-hash", memberId: "mem_demo_admin", label: "Shared admin token" },
	{ tokenHash: "shared-dev-member-token-hash", memberId: "mem_demo_member", label: "Shared member token" },
];
```

- [ ] **Step 2: Update `src/db/seed/run.ts` imports**

Replace the import block (lines 8-27) with:
```ts
import {
	seedAuditLogs,
	seedEvents,
	seedLinkDailyStats,
	seedMemberRoles,
	seedMembers,
	seedReservedSlugs,
	seedRetentionRecords,
	seedRoles,
	seedSharedDevTokens,
	seedShortLinks,
	seedSurveyAssignments,
	seedSurveyQuestions,
	seedSurveys,
	seedTermMemberRoster,
	seedTerms,
} from "./data";
```

- [ ] **Step 3: Update `seedLocal()`'s insert sequence**

Replace the body of `seedLocal()` (lines 58-75) with:
```ts
	await insertChunks(db, schema.roles, seedRoles);
	await insertChunks(db, schema.members, seedMembers);
	await insertChunks(db, schema.memberRoles, seedMemberRoles);
	await insertChunks(db, schema.terms, seedTerms);
	await insertChunks(db, schema.termMemberRoster, seedTermMemberRoster);
	await insertChunks(db, schema.reservedSlugs, seedReservedSlugs);
	await insertChunks(db, schema.shortLinks, seedShortLinks);
	await insertChunks(db, schema.linkDailyStats, seedLinkDailyStats);
	await insertChunks(db, schema.crsEvents, seedEvents);
	await insertChunks(db, schema.retentionRecords, seedRetentionRecords);
	await insertChunks(db, schema.surveys, seedSurveys);
	await insertChunks(db, schema.surveyQuestions, seedSurveyQuestions);
	await insertChunks(db, schema.surveyAssignments, seedSurveyAssignments);
	await insertChunks(db, schema.auditLogs, seedAuditLogs);
	await insertChunks(db, schema.sharedDevTokens, seedSharedDevTokens);
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors reference `seed/data.ts` or `seed/run.ts`. This should be the last file from Task 1 Step 10's failure list — typecheck should now be fully clean project-wide except the public-landing files handled in Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/db/seed/data.ts src/db/seed/run.ts
git commit -m "feat(seed): drop teams/articles/announcements seed data, add roster + retention records"
```

---

### Task 7: Public landing page — replace the article-driven home page with a static one

**Files:**
- Modify: `src/app/page.tsx` (full file)
- Delete: `src/app/articles/page.tsx`
- Delete: `src/app/articles/[slug]/page.tsx`
- Delete: `src/lib/public-content.ts`

**Interfaces:**
- Produces: a `/` route with no DB or `@/lib/public-content` dependency, matching master-plan §1: "simple static landing page (org info, services/about/contact, low-emphasis Google `/signin` entry). No DB-backed article/case-study content engine in v1."

- [ ] **Step 1: Delete the deferred public-content routes and data module**

```bash
git rm -r src/app/articles src/lib/public-content.ts
```

- [ ] **Step 2: Replace `src/app/page.tsx` in full**

```tsx
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
	return (
		<main className="min-h-screen bg-background text-foreground">
			<header className="border-b bg-card">
				<div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
					<Link className="flex items-center gap-3" href="/" aria-label="CODE home">
						<Image src="/code-logo-full-navy.png" alt="CODE" width={140} height={48} priority style={{ height: "auto" }} />
					</Link>
					<Button asChild variant="ghost" size="sm" className="text-muted-foreground">
						<Link href="/signin">
							<KeyRound />
							Member sign in
						</Link>
					</Button>
				</div>
			</header>

			<section className="relative isolate overflow-hidden bg-primary text-primary-foreground">
				<div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#06192F_0%,rgba(6,25,47,0.92)_48%,rgba(6,25,47,0.76)_100%)]" />
				<div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
					<div className="max-w-3xl">
						<Image src="/code-logo-full-white.png" alt="CODE" width={176} height={60} priority style={{ height: "auto" }} />
						<h1 className="mt-5 text-6xl font-bold text-white sm:text-7xl lg:text-8xl">CODE</h1>
						<p className="mt-6 max-w-2xl text-lg leading-8 text-white/85">
							Ateneo CODE runs student consulting practice, retention programming, and member events. This page
							is the public front door; member records, retention tools, and internal tools live in the portal.
						</p>
						<div className="mt-8">
							<Button asChild variant="secondary">
								<Link href="/signin">
									Member sign in
									<ArrowRight />
								</Link>
							</Button>
						</div>
					</div>
				</div>
			</section>

			<section className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-3 lg:px-8">
				<Card>
					<CardHeader>
						<CardTitle>Services</CardTitle>
						<CardDescription>
							Student-run consulting engagements for partner organizations, paired with formation programming
							for members.
						</CardDescription>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>About</CardTitle>
						<CardDescription>
							Ateneo CODE is a student organization. Membership runs on a per-term retention system tracked
							inside the member portal.
						</CardDescription>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Contact</CardTitle>
						<CardDescription>Reach the officer team through the org's usual contact channels.</CardDescription>
					</CardHeader>
				</Card>
			</section>

			<footer className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
				<p>CODE public site.</p>
				<Link className="text-xs hover:text-foreground" href="/signin">Member sign in</Link>
			</footer>
		</main>
	);
}
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, no references to `@/lib/public-content` or `/articles` remain anywhere in `src/`.

- [ ] **Step 4: Commit**

```bash
git add -A src/app/page.tsx src/app/articles src/lib/public-content.ts
git commit -m "feat(public): replace article-driven landing page with a static one

Content/publishing is deferred (master plan §11); / no longer reads
from a DB-backed content engine."
```

---

### Task 8: Generate and apply the v5 migration, run the full suite

**Files:**
- Generate: `drizzle/migrations/0001_<name>.sql` (name chosen by drizzle-kit)

**Interfaces:**
- Consumes: the finished `src/db/schema.ts` from Task 1.
- Produces: the migration file `vitest.config.mts`'s `readD1Migrations` picks up automatically for every test run from here on.

- [ ] **Step 1: Generate the migration (writes a SQL file locally, no D1 touched yet)**

Run: `pnpm db:generate`
Expected: drizzle-kit prints the new migration file path (e.g. `drizzle/migrations/0001_xxx.sql`) and a list of detected changes — confirm it lists: drop `consultancy_teams`, `team_members`, `articles`, `article_sections`, `article_components`, `article_questions`, `article_refs`, `topics`, `article_topics`, `article_related`, `article_acl`, `favorites`, `lists`, `list_items`, `comments`, `announcements`, `point_awards`; create `term_member_roster`, `retention_records`, `nav_pins`, `quick_links`; alter `short_links` (add 3 columns), `members` (drop 2 columns), `member_feed_state` (drop 1 column).

- [ ] **Step 2: STOP — show the exact apply command and wait for approval**

Per CLAUDE.md, do not run a D1 migration without explicit approval. Present this command to the user and wait:
```bash
pnpm db:migrate:local:sqlite
```
This applies the new migration to the local better-sqlite3 dev database (`./.local/dev.db` by default). It does not touch the dev or prod D1 Worker.

- [ ] **Step 3: After approval, run it and verify**

Run: `pnpm db:migrate:local:sqlite`
Expected: completes with no error.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: PASS — this includes `permissions.test.ts` (Task 2), `roster.integration.test.ts` (Task 5), `members.integration.test.ts`, `access.test.ts`, and `shared-parity.integration.test.ts`, all running against the migrated schema via `vitest.config.mts`'s auto-applied `drizzle/migrations`.

- [ ] **Step 5: Run typecheck, lint, and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS.

- [ ] **Step 6: Commit the generated migration**

```bash
git add drizzle/migrations
git commit -m "chore(db): generate v5 migration for schema changes"
```

- [ ] **Step 7: STOP — surface the dev-Worker redeploy obligation, do not run it without approval**

Per CLAUDE.md and master-plan §15, schema + permissions + auth changes require redeploying the dev Worker. Present these two commands to the user and wait for explicit approval before running either:
```bash
pnpm db:migrate:dev
pnpm deploy:dev
```

---

## Self-review notes (for the implementer, not a step to execute)

- Spec coverage: every v5 §6 schema delta (drop tables/columns, rename `point_awards`, add `term_member_roster`/`retention_records`/`nav_pins`/`quick_links`/`short_links` preview columns) is in Task 1. §4.2's roster-gates-sign-in is Task 5. §5's role/permission rename is Task 2. §1's static landing page is Task 7. §15's redeploy obligation is Task 8 Step 7 (gated, not auto-run).
- Not in scope for this plan (intentionally — they're separate phases per master-plan §12): the portal shell/overview UI rewrite (`src/components/portal-workspace.tsx`, Phase 2), `/l/[slug]` embed/OG preview logic (Phase 3), CRS QR-flip + retention-records UI (Phase 4/5), admin nav-pins/quick-links/roster/reporting screens (Phase 8). `portal-workspace.tsx` still compiles after this plan because it uses only hardcoded local data, not the schema — it is replaced wholesale in the Phase 2 plan, not patched here.
