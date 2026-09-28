# Phase 2 — Portal Shell + Overview + Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder single-file portal workspace with an authed, URL-addressable portal shell (desktop sidebar + mobile bottom nav with a Menu sheet), a real DB-backed Overview module, and a notifications feed/bell that is materialized for per-member events and derived for survey/event availability.

**Architecture:** The shell is a server-rendered `/portal` layout that resolves the actor once and passes a serializable view-model (member, roles, unread counts, nav pins) to a thin client nav shell. Each module is its own URL-addressable route segment under `/portal`. Two new repositories (`notifications`, `overview`) own all query logic behind the existing `getRepositories()` seam, take an explicit `actor`, and respect the D1 budget. Notification reads are a hybrid: materialized rows from the `notifications` table UNION-ed with counts derived from `survey_assignments` + `crs_events` against the `member_feed_state` cursor, so we never fan out a row per member per item.

**Tech Stack:** Next.js 16 App Router (Server Components + server actions), React 19, Drizzle ORM on D1 / better-sqlite3, Auth.js v5 (`getActor()`), Tailwind CSS v4 + local shadcn/ui registry (`src/components/ui`), lucide-react, Vitest + `@cloudflare/vitest-pool-workers`.

## Global Constraints

These are copied from the master plan (`docs/superpowers/plans/2026-06-18-code-portal-master-plan.md`) Global Constraints + CLAUDE.md and apply to EVERY task below.

- Public site stays reader-first at `/` (already a static page — **do not touch `src/app/page.tsx`**). The member workspace lives under `/portal`; modules are URL-addressable route segments.
- Drizzle schema at `src/db/schema.ts` is the ONE source of truth. **This phase adds NO schema changes** — every table it needs (`notifications`, `member_feed_state`, `surveys`, `survey_assignments`, `crs_events`, `retention_records`, `nav_pins`, `members`, `member_roles`, `roles`) already exists post v5-foundation migration. If a task appears to need a column that does not exist, STOP and raise it; do not edit `schema.ts` in this plan.
- No raw SQL internal endpoints; D1 is never exposed as `DATABASE_URL`. Feature code uses repositories via `getRepositories()`; only adapters/internal modules touch bindings.
- Every repository function takes an explicit `actor` (`{ memberId, roles, context? }`) and authorizes server-side via `permissions.can()` before any privileged read/write. Overview/notifications reads here are all self-scoped (`actor.memberId`), so they need an actor but no elevated permission.
- D1 budget: no unbounded `SELECT`; every list is bounded (`limit`) and date/owner-scoped; every query has a backing index (all indexes used here already exist in `schema.ts`). Keep per-request query count modest.
- Settings/preferences page is CUT (master plan §11 #4). Build the feed/bell only; model NO notification-preference data.
- Deferred and must NOT appear in this UI: Library, Announcements, guided tours / "Replay tour" / "Start tour", the portal search bar, the duplicate top-right profile/account icon (master plan §1, §11, §14 v5 items 10-13, 15-16).
- Mobile bottom nav stays fixed at ~4-5 slots forever (Overview, Calendar, center Menu, Profile). Nav pins and the member-code card live INSIDE the Menu sheet, never as new fixed bottom-nav icons (master plan Global Constraints minimalism note).
- UI is built from the local shadcn/ui registry (`src/components/ui` + `components.json`). Add a missing component with `pnpm dlx shadcn@latest add <component>` and theme it via the tokens in `src/app/globals.css`. Reuse before adding; bespoke only when shadcn has no equivalent. Style with Tailwind utility classes bound to design tokens; no CSS-in-JS, no ad-hoc global CSS beyond `globals.css`.
- Brand copy: headings Unna (`font-heading`), body Source Sans. No em dashes in UI copy, code comments, docs, or commit messages. Plain product language; no AI-stock phrasing. Cards stay shallow (no cards inside cards). Light + dark via tokens.
- `/portal/*` is dynamic: every new route/layout sets `export const dynamic = "force-dynamic"` (matches existing `src/app/portal/layout.tsx`).
- After this phase lands (it changes repository signatures consumed over the shared proxy and `getRepositories()` shape), the dev Worker must be redeployed per CLAUDE.md / master-plan §15. Surfaced as the final approval-gated step (Task 9). Show the exact `pnpm exec wrangler` / `pnpm db:*` command and wait for approval before any deploy.

---

## File Structure

New and modified files, grouped by responsibility.

**Repositories (query logic, behind `getRepositories()`):**
- `src/db/repositories/notifications.ts` — modify: replace the empty stub with `NotificationsRepository` (list feed, unread count, mark read, mark all read, derived survey/event counts).
- `src/db/repositories/overview.ts` — create: `OverviewRepository` (per-member dashboard summary: retention this term, pending survey count, upcoming event count, owned-link clicks).
- `src/db/repositories/notifications.integration.test.ts` — create: D1 integration test.
- `src/db/repositories/overview.integration.test.ts` — create: D1 integration test.
- `src/db/repositories/index.ts` — modify: wire `overview` into `createDrizzleRepositories` + `createSharedRepositories`, and pass `db` to `createNotificationsRepository`.

**Shell (layout + client nav):**
- `src/app/portal/layout.tsx` — modify (full replace): resolve actor + shell view-model, render the desktop sidebar / mobile bottom nav around `{children}`.
- `src/components/portal/portal-shell.tsx` — create: client nav shell (desktop sidebar, mobile bottom bar, Menu sheet with nav pins + member-code card placeholder, notification bell trigger).
- `src/components/portal/nav-items.ts` — create: the single source of the fixed module list (id, label, href, icon) shared by desktop + mobile.

**Overview module:**
- `src/app/portal/page.tsx` — modify (full replace): server component rendering the Overview from `OverviewRepository`.
- `src/components/portal/overview-metrics.tsx` — create: presentational metric cards + retention progress (server-friendly, no client state).

**Notifications module:**
- `src/app/portal/notifications/page.tsx` — create: server-rendered full notifications list.
- `src/app/portal/notifications/actions.ts` — create: `markNotificationReadAction`, `markAllNotificationsReadAction` server actions.
- `src/components/portal/notification-bell.tsx` — create: client bell with unread badge + dropdown of recent items.

**Deletion:**
- `src/components/portal-workspace.tsx` — delete: replaced wholesale by the shell + per-module routes (master-plan §12 Phase 2; the v5-foundation self-review notes this file is "replaced wholesale in the Phase 2 plan, not patched here").

---

### Task 1: OverviewRepository — per-member dashboard summary

**Files:**
- Create: `src/db/repositories/overview.ts`
- Create: `src/db/repositories/overview.integration.test.ts`

**Interfaces:**
- Consumes: `members`, `memberRoles`, `roles`, `terms`, `retentionRecords`, `surveyAssignments`, `crsEvents`, `shortLinks`, `linkDailyStats` from `@/db/schema`; `Actor` from `@/server/auth/permissions`; `getDb` return type from `@/db/client` (the Drizzle handle).
- Produces: `OverviewRepository` with `getSummary(actor: Actor): Promise<OverviewSummary>`, and the exported type:
  ```ts
  export type OverviewSummary = {
    retention: { points: number; retainedAt: number | null; termName: string | null };
    pendingSurveys: number;
    upcomingEvents: number;
    linkClicks: number;
  };
  ```
  Consumed by Task 6 (`/portal/page.tsx`). `createOverviewRepository(db)` factory matches the existing `create*Repository(db)` convention (see `members.ts`, `audit.ts`).

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/overview.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createOverviewRepository } from "./overview";

const NOW = new Date("2026-06-18T00:00:00.000Z");
const memberActor: Actor = { memberId: "mem_ov", roles: ["member"] };

describe("overview repository on D1", () => {
	beforeEach(async () => {
		for (const table of [
			"retention_records",
			"survey_assignments",
			"surveys",
			"link_daily_stats",
			"short_links",
			"crs_events",
			"term_member_roster",
			"terms",
			"members",
		]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_ov", "ov@example.com", "Overview Member", "active")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin", "active")
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_now", "Term 1", 20, 10, NOW.getTime() - 1000, NOW.getTime() + 1000 * 60 * 60 * 24 * 60)
			.run();
	});

	it("sums this term's retention points, counts pending surveys, upcoming events, and owned-link clicks", async () => {
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("ret_1", "mem_ov", "term_now", 5, "Attended", "event_attendance", "mem_admin", NOW.getTime())
			.run();
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("ret_2", "mem_ov", "term_now", 3, "Waiver", "manual", "mem_admin", NOW.getTime())
			.run();
		await env.DB.prepare("INSERT INTO surveys (id, title, status, created_by) VALUES (?, ?, ?, ?)")
			.bind("srv_1", "Feedback", "running", "mem_admin")
			.run();
		await env.DB.prepare(
			"INSERT INTO survey_assignments (survey_id, member_id, response_token_hash, completed_at) VALUES (?, ?, ?, ?)",
		)
			.bind("srv_1", "mem_ov", "hash_pending", null)
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_up", "Upcoming", "official", "approved", "SOM", NOW.getTime() + 1000 * 60 * 60 * 24, "Soon", "mem_admin", "s1")
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_past", "Past", "official", "approved", "SOM", NOW.getTime() - 1000 * 60 * 60 * 24, "Old", "mem_admin", "s2")
			.run();
		await env.DB.prepare(
			"INSERT INTO short_links (id, slug, destination_url, title, owner_member_id, click_count) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("lnk_1", "mine", "https://example.com", "Mine", "mem_ov", 0)
			.run();
		await env.DB.prepare(
			"INSERT INTO link_daily_stats (link_id, date, referrer_bucket, device_bucket, count) VALUES (?, ?, ?, ?, ?)",
		)
			.bind("lnk_1", "2026-06-18", "direct", "desktop", 12)
			.run();

		const db = drizzle(env.DB, { schema });
		const repository = createOverviewRepository(db);
		const summary = await repository.getSummary(memberActor, NOW);

		expect(summary.retention).toMatchObject({ points: 8, retainedAt: 20, termName: "Term 1" });
		expect(summary.pendingSurveys).toBe(1);
		expect(summary.upcomingEvents).toBe(1);
		expect(summary.linkClicks).toBe(12);
	});

	it("returns zeroed counts and a null term when the member has no activity and no active term", async () => {
		await env.DB.prepare("DELETE FROM terms").run();
		const db = drizzle(env.DB, { schema });
		const repository = createOverviewRepository(db);
		const summary = await repository.getSummary(memberActor, NOW);

		expect(summary).toEqual({
			retention: { points: 0, retainedAt: null, termName: null },
			pendingSurveys: 0,
			upcomingEvents: 0,
			linkClicks: 0,
		});
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- overview.integration.test.ts`
Expected: FAIL with a module-resolution error ("Cannot find module './overview'").

- [ ] **Step 3: Implement `src/db/repositories/overview.ts`**

```ts
import { and, desc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import {
	crsEvents,
	linkDailyStats,
	retentionRecords,
	shortLinks,
	surveyAssignments,
	surveys,
	terms,
} from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import type { getDb } from "@/db/client";

type Db = ReturnType<typeof getDb>;

export type OverviewSummary = {
	retention: { points: number; retainedAt: number | null; termName: string | null };
	pendingSurveys: number;
	upcomingEvents: number;
	linkClicks: number;
};

export type OverviewRepository = {
	getSummary(actor: Actor, now?: Date): Promise<OverviewSummary>;
};

async function getCurrentTerm(db: Db, now: Date): Promise<{ id: string; name: string; retainedAt: number } | null> {
	const [term] = await db
		.select({ id: terms.id, name: terms.name, retainedAt: terms.retainedAt })
		.from(terms)
		.where(and(lte(terms.startsAt, now), gte(terms.endsAt, now)))
		.orderBy(desc(terms.startsAt))
		.limit(1);
	return term ?? null;
}

export function createOverviewRepository(db: Db): OverviewRepository {
	return {
		async getSummary(actor, now = new Date()) {
			const term = await getCurrentTerm(db, now);

			let points = 0;
			if (term) {
				const [row] = await db
					.select({ total: sql<number>`coalesce(sum(${retentionRecords.points}), 0)` })
					.from(retentionRecords)
					.where(and(eq(retentionRecords.memberId, actor.memberId), eq(retentionRecords.termId, term.id)));
				points = Number(row?.total ?? 0);
			}

			const [surveyRow] = await db
				.select({ count: sql<number>`count(*)` })
				.from(surveyAssignments)
				.innerJoin(surveys, eq(surveys.id, surveyAssignments.surveyId))
				.where(
					and(
						eq(surveyAssignments.memberId, actor.memberId),
						isNull(surveyAssignments.completedAt),
						eq(surveys.status, "running"),
					),
				);

			const [eventRow] = await db
				.select({ count: sql<number>`count(*)` })
				.from(crsEvents)
				.where(and(eq(crsEvents.status, "approved"), gt(crsEvents.startsAt, now)));

			const [linkRow] = await db
				.select({ total: sql<number>`coalesce(sum(${linkDailyStats.count}), 0)` })
				.from(linkDailyStats)
				.innerJoin(shortLinks, eq(shortLinks.id, linkDailyStats.linkId))
				.where(eq(shortLinks.ownerMemberId, actor.memberId));

			return {
				retention: {
					points,
					retainedAt: term?.retainedAt ?? null,
					termName: term?.name ?? null,
				},
				pendingSurveys: Number(surveyRow?.count ?? 0),
				upcomingEvents: Number(eventRow?.count ?? 0),
				linkClicks: Number(linkRow?.total ?? 0),
			};
		},
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- overview.integration.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/overview.ts src/db/repositories/overview.integration.test.ts
git commit -m "feat(repos): add overview repository for the portal dashboard summary

Sums this term's retention points, counts pending running-survey
assignments and upcoming approved events, and totals the actor's
owned-link clicks. All reads are self-scoped to the actor."
```

---

### Task 2: NotificationsRepository — materialized feed + derived counts

**Files:**
- Modify: `src/db/repositories/notifications.ts` (replace the empty stub in full)
- Create: `src/db/repositories/notifications.integration.test.ts`

**Interfaces:**
- Consumes: `notifications` from `@/db/schema`; `Actor` from `@/server/auth/permissions`; `createId` from `@/lib/ids`; `getDb` return type from `@/db/client`.
- Produces (these exact names are consumed by Task 3 index wiring, Task 7 notifications page, Task 8 actions, Task 5 bell, AND Phase 7 Task 7, which is the first phase to call `notify()`):
  ```ts
  export type NotificationKind = "event_approved" | "survey_assigned" | "forum_reply" | "points_awarded";
  export type FeedItem = {
    id: string;
    kind: NotificationKind;
    title: string;
    body: string;
    href: string | null;
    readAt: number | null;
    createdAt: number;
  };
  export type NotifyInput = {
    memberId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    href?: string | null;
  };
  export type NotificationsRepository = {
    listFeed(actor: Actor, input?: { limit?: number }): Promise<FeedItem[]>;
    unreadCount(actor: Actor): Promise<number>;
    markRead(actor: Actor, id: string): Promise<void>;
    markAllRead(actor: Actor): Promise<void>;
  };
  export function createNotificationsRepository(db: Db): NotificationsRepository;
  export function notify(db: Db, input: NotifyInput): Promise<void>;
  ```
- **Design (master plan §6 Notifications):** every notification is a materialized row in `notifications`, written by the single `notify(db, input)` function. `notify` is a system side effect of an already-authorized, already-audited action (event approval, survey assignment, forum reply, points awarded) — it takes no `actor` and is not itself audited; it is the ONLY write path into this table. `listFeed` reads the member's own rows newest-first, `limit`-bounded (default 25, max 50). `unreadCount` counts unread rows for the member. `markRead`/`markAllRead` are owner-scoped updates. No live "derive pending surveys/events" computation lives here — Phase 6 (survey assignment) and Phase 4 (event approval) call `notify()` directly at the moment those events happen, per Phase 7 Task 7, which wires the four trigger points. The `member_feed_state` table is unused by this design (it was sized for a cursor-based derive approach this task does not use); leave it in the schema as a no-op follow-up, do not read or write it here. All queries are member-scoped and backed by the `notifications_member_read_created_idx` index.

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/notifications.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { notifications } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createNotificationsRepository, notify } from "./notifications";

const NOW = new Date("2026-06-18T00:00:00.000Z");
const actor: Actor = { memberId: "mem_nf", roles: ["member"] };

async function seedMember() {
	await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
		.bind("mem_nf", "nf@example.com", "Notif Member", "active")
		.run();
	await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
		.bind("mem_admin", "admin@example.com", "Admin", "active")
		.run();
}

describe("notifications repository on D1", () => {
	beforeEach(async () => {
		for (const table of ["notifications", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await seedMember();
	});

	it("materializes a notification via notify() and lists it newest-first", async () => {
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_nf", kind: "points_awarded", title: "Points added", body: "5 points" });
		await notify(db, { memberId: "mem_nf", kind: "event_approved", title: "Approved", body: "Your event is live." });
		const repository = createNotificationsRepository(db);

		const feed = await repository.listFeed(actor, { limit: 20 });

		expect(feed.map((item) => item.kind)).toEqual(["event_approved", "points_awarded"]);
		expect(await repository.unreadCount(actor)).toBe(2);
	});

	it("only lists the requesting member's own notifications", async () => {
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_admin", kind: "forum_reply", title: "Reply", body: "Someone replied." });
		const repository = createNotificationsRepository(db);

		expect(await repository.listFeed(actor, { limit: 20 })).toHaveLength(0);
		expect(await repository.unreadCount(actor)).toBe(0);
	});

	it("marks a single notification read", async () => {
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_nf", kind: "survey_assigned", title: "Survey", body: "You were selected." });
		const repository = createNotificationsRepository(db);
		const [created] = await repository.listFeed(actor);

		await repository.markRead(actor, created.id);
		const [row] = await db.select().from(notifications).where(schema.eq(notifications.id, created.id));

		expect(row.readAt).not.toBeNull();
		expect(await repository.unreadCount(actor)).toBe(0);
	});

	it("ignores markRead for a notification owned by another member", async () => {
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_admin", kind: "forum_reply", title: "Reply", body: "x" });
		const repository = createNotificationsRepository(db);
		const [created] = await db.select().from(notifications).where(schema.eq(notifications.memberId, "mem_admin"));

		await repository.markRead(actor, created.id);
		const [row] = await db.select().from(notifications).where(schema.eq(notifications.id, created.id));

		expect(row.readAt).toBeNull();
	});

	it("markAllRead clears every unread notification for the member", async () => {
		const db = drizzle(env.DB, { schema });
		await notify(db, { memberId: "mem_nf", kind: "points_awarded", title: "A", body: "x" });
		await notify(db, { memberId: "mem_nf", kind: "forum_reply", title: "B", body: "y" });
		const repository = createNotificationsRepository(db);

		await repository.markAllRead(actor);

		expect(await repository.unreadCount(actor)).toBe(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- notifications.integration.test.ts`
Expected: FAIL — the current stub exports `Record<string, never>` with no `notify`/`listFeed`/`unreadCount`/`markRead` (`repository.listFeed is not a function`).

- [ ] **Step 3: Replace `src/db/repositories/notifications.ts` in full**

```ts
import { and, desc, eq, isNull } from "drizzle-orm";
import { notifications } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import type { getDb } from "@/db/client";

type Db = ReturnType<typeof getDb>;

export type NotificationKind = "event_approved" | "survey_assigned" | "forum_reply" | "points_awarded";

export type FeedItem = {
	id: string;
	kind: NotificationKind;
	title: string;
	body: string;
	href: string | null;
	readAt: number | null;
	createdAt: number;
};

export type NotifyInput = {
	memberId: string;
	kind: NotificationKind;
	title: string;
	body: string;
	href?: string | null;
};

export type NotificationsRepository = {
	listFeed(actor: Actor, input?: { limit?: number }): Promise<FeedItem[]>;
	unreadCount(actor: Actor): Promise<number>;
	markRead(actor: Actor, id: string): Promise<void>;
	markAllRead(actor: Actor): Promise<void>;
};

function toMs(value: Date | number | null): number | null {
	if (value === null) return null;
	return value instanceof Date ? value.getTime() : value;
}

/**
 * Materialize one per-member notification row. This is a system side effect of
 * an already-authorized, already-audited action (event approval, survey
 * assignment, forum reply, points awarded), so it takes no actor and is not
 * itself audited. It is the ONLY write path for the notifications table.
 * Phase 7 Task 7 calls this from the event-approve and survey-assign
 * triggers; Phase 4's forum-reply and points-award write paths call it too.
 */
export async function notify(db: Db, input: NotifyInput): Promise<void> {
	await db.insert(notifications).values({
		id: createId("ntf"),
		memberId: input.memberId,
		kind: input.kind,
		title: input.title,
		body: input.body,
		href: input.href ?? null,
	});
}

export function createNotificationsRepository(db: Db): NotificationsRepository {
	return {
		async listFeed(actor, input) {
			const limit = Math.min(input?.limit ?? 25, 50);
			const rows = await db
				.select()
				.from(notifications)
				.where(eq(notifications.memberId, actor.memberId))
				.orderBy(desc(notifications.createdAt))
				.limit(limit);

			return rows.map((row) => ({
				id: row.id,
				kind: row.kind as NotificationKind,
				title: row.title,
				body: row.body,
				href: row.href,
				readAt: toMs(row.readAt),
				createdAt: toMs(row.createdAt) ?? 0,
			}));
		},

		async unreadCount(actor) {
			const rows = await db
				.select({ id: notifications.id })
				.from(notifications)
				.where(and(eq(notifications.memberId, actor.memberId), isNull(notifications.readAt)));
			return rows.length;
		},

		async markRead(actor, id) {
			await db
				.update(notifications)
				.set({ readAt: new Date() })
				.where(and(eq(notifications.id, id), eq(notifications.memberId, actor.memberId)));
		},

		async markAllRead(actor) {
			await db
				.update(notifications)
				.set({ readAt: new Date() })
				.where(and(eq(notifications.memberId, actor.memberId), isNull(notifications.readAt)));
		},
	};
}
```

`member_feed_state` is not read or written here — it was sized for a cursor-based derive mechanism this design replaced with direct materialization. Flag dropping the unused table/columns as a schema-cleanup follow-up; do not drop it in this task.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- notifications.integration.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/notifications.ts src/db/repositories/notifications.integration.test.ts
git commit -m "feat(repos): implement notifications feed with a single notify() write path

Every notification is a materialized row written by notify(), the one
write path into the table. listFeed/unreadCount/markRead/markAllRead
are member-scoped reads and owner-scoped updates over those rows.
Phase 7 wires notify() into the event-approve and survey-assign
triggers; Phase 4 wires it into forum-reply and points-awarded."
```

---

### Task 3: Wire overview + notifications into the repositories registry

**Files:**
- Modify: `src/db/repositories/index.ts` (full file)

**Interfaces:**
- Consumes: `createOverviewRepository` (Task 1), `createNotificationsRepository(db)` (Task 2, now takes `db`).
- Produces: `Repositories.overview` and a `Repositories.notifications` with the real method shape, available from `getRepositories()`. Tasks 6, 7, 8 consume `repositories.overview` / `repositories.notifications`.
- **Note on shared mode:** `createSharedRepositories` currently builds notifications/calendar/overview from a Drizzle factory that needs a `db` it does not have in shared mode. To keep this phase scoped and the shared proxy honest, the shared-mode overview/notifications throw "unavailable through this adapter" (mirrors `createUnavailableAuditRepository`). Shared-mode portal UI is out of scope for Phase 2 (master plan ships the portal UI for real `local`/`production` actors; shared mode exercises repositories via tests + the `/internal` proxy in later phases).

- [ ] **Step 1: Replace `src/db/repositories/index.ts` in full**

```ts
import { createAuditRepository, createUnavailableAuditRepository } from "./audit";
import { createCalendarRepository } from "./calendar";
import { createEventsRepository } from "./events";
import { createLinksRepository } from "./links";
import { createMembersRepository } from "./members";
import { createNotificationsRepository, type NotificationsRepository } from "./notifications";
import { createOverviewRepository, type OverviewRepository } from "./overview";
import { createRetentionRepository } from "./retention";
import { createSessionsRepository } from "./sessions";
import { createSurveysRepository } from "./surveys";
import type { MemberDb } from "./members";
import type { AuditDb } from "./audit";
import type { getDb } from "../client";
import type { DatabaseAdapter } from "../types";

type DrizzleDb = ReturnType<typeof getDb>;

export function createDrizzleRepositories(db: DrizzleDb) {
	const audit = createAuditRepository(db);
	return {
		members: createMembersRepository(db as unknown as MemberDb & AuditDb, audit),
		sessions: createSessionsRepository(),
		links: createLinksRepository(),
		events: createEventsRepository(),
		retention: createRetentionRepository(),
		surveys: createSurveysRepository(),
		notifications: createNotificationsRepository(db),
		overview: createOverviewRepository(db),
		calendar: createCalendarRepository(),
		audit,
	};
}

export type Repositories = ReturnType<typeof createDrizzleRepositories>;

function createUnavailableNotificationsRepository(): NotificationsRepository {
	const unavailable = () => {
		throw new Error("Notifications are unavailable through this repository adapter.");
	};
	return {
		listFeed: unavailable,
		unreadCount: unavailable,
		markRead: unavailable,
		markAllRead: unavailable,
	};
}

function createUnavailableOverviewRepository(): OverviewRepository {
	return {
		getSummary() {
			throw new Error("Overview is unavailable through this repository adapter.");
		},
	};
}

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
		notifications: createUnavailableNotificationsRepository(),
		overview: createUnavailableOverviewRepository(),
		calendar: createCalendarRepository(),
		audit,
	};
}
```

> **Note on the `db as unknown as MemberDb & AuditDb` cast:** the existing `index.ts` already passed `getDb()` into `createMembersRepository` whose param is the narrow structural `MemberDb & AuditDb` type. The pre-Phase-2 file did this implicitly because `getDb()`'s real Drizzle type is assignable. If `pnpm typecheck` reports the cast is unnecessary, delete `as unknown as MemberDb & AuditDb` and pass `db` directly. Do not loosen any other types.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS. If it fails only on the members cast, apply the note above and re-run.

- [ ] **Step 3: Run the repository tests**

Run: `pnpm test -- overview.integration.test.ts notifications.integration.test.ts members.integration.test.ts`
Expected: PASS (the registry change does not alter the directly-constructed repositories the tests use; this confirms no import regression).

- [ ] **Step 4: Commit**

```bash
git add src/db/repositories/index.ts
git commit -m "feat(repos): register overview and notifications in the repository registry

Drizzle mode wires the real repositories; shared mode returns explicit
unavailable adapters, matching the existing audit pattern."
```

---

### Task 4: Add the shadcn primitives the shell needs

**Files:**
- Create (generated): `src/components/ui/sheet.tsx`
- Create (generated): `src/components/ui/dropdown-menu.tsx`
- Create (generated): `src/components/ui/separator.tsx`
- Modify (generated, dependency bumps only): `package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces: `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle` (mobile Menu sheet, Task 5); `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator` (notification bell dropdown, Task 5); `Separator`. These are the only new UI primitives the shell uses; `Button`, `Badge`, `Card` already exist.

- [ ] **Step 1: Generate the three primitives via the shadcn CLI**

Run: `pnpm dlx shadcn@latest add sheet dropdown-menu separator`
Expected: writes `src/components/ui/sheet.tsx`, `src/components/ui/dropdown-menu.tsx`, `src/components/ui/separator.tsx`, and installs the Radix peer deps (`@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-separator`). If the CLI prompts, accept the existing `components.json` config and do not overwrite `button`/`badge`/`card`/`input`/`select`/`tabs`/`textarea`/`checkbox`.

- [ ] **Step 2: Verify the generated files theme via tokens, not hardcoded colors**

Read each generated file. Confirm they use token classes (`bg-background`, `text-foreground`, `bg-popover`, `border`) and `cn` from `@/lib/utils`. If the CLI emitted any literal hex or `text-white`/`bg-black`, replace with the matching token class so light/dark theming works (master plan Global Constraints).

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/sheet.tsx src/components/ui/dropdown-menu.tsx src/components/ui/separator.tsx package.json pnpm-lock.yaml components.json
git commit -m "chore(ui): add sheet, dropdown-menu, and separator primitives for the portal shell"
```

---

### Task 5: Portal shell components — nav items, client shell, notification bell

**Files:**
- Create: `src/components/portal/nav-items.ts`
- Create: `src/components/portal/portal-shell.tsx`
- Create: `src/components/portal/notification-bell.tsx`

**Interfaces:**
- Consumes: `FeedItem` from `@/db/repositories/notifications` (type-only); `Sheet*`, `DropdownMenu*`, `Button`, `Badge` from `@/components/ui/*`; `markNotificationReadAction`, `markAllNotificationsReadAction` from `@/app/portal/notifications/actions` (Task 8). To avoid a Task-5-before-Task-8 import gap, the bell receives the two actions as props from the layout (Task 6) rather than importing them directly.
- Produces:
  ```ts
  // nav-items.ts
  export type NavItem = { id: string; label: string; href: string; icon: LucideIcon };
  export const primaryNav: NavItem[];   // Overview, Calendar, Profile (desktop sidebar + mobile bar core)
  export const sheetNav: NavItem[];      // Notifications + future module links shown in the Menu sheet
  // portal-shell.tsx
  export type PortalShellProps = {
    member: { displayName: string; initials: string };
    navPins: { id: string; label: string; url: string }[];
    bell: React.ReactNode;
    children: React.ReactNode;
  };
  export function PortalShell(props: PortalShellProps): JSX.Element;
  // notification-bell.tsx
  export type NotificationBellProps = {
    items: FeedItem[];
    unreadCount: number;
    onMarkRead: (id: string) => Promise<void>;
    onMarkAllRead: () => Promise<void>;
  };
  export function NotificationBell(props: NotificationBellProps): JSX.Element;
  ```
  Consumed by Task 6 (`layout.tsx`).

- [ ] **Step 1: Create `src/components/portal/nav-items.ts`**

```ts
import { CalendarDays, CircleUserRound, House, Bell } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = { id: string; label: string; href: string; icon: LucideIcon };

// Fixed core slots. The mobile bottom bar shows these plus a center Menu button.
// Keep this at four entries or fewer so the bar stays at the ~4-5 slot budget.
export const primaryNav: NavItem[] = [
	{ id: "overview", label: "Overview", href: "/portal", icon: House },
	{ id: "calendar", label: "Calendar", href: "/portal/calendar", icon: CalendarDays },
	{ id: "profile", label: "Profile", href: "/portal/profile", icon: CircleUserRound },
];

// Links that live inside the desktop sidebar and the mobile Menu sheet, not the fixed bar.
export const sheetNav: NavItem[] = [
	{ id: "notifications", label: "Notifications", href: "/portal/notifications", icon: Bell },
];
```

> **Note:** `/portal/calendar` is a Phase 7 route and does not exist yet. Linking to it now is intentional (the slot is fixed per the master plan); Next renders a 404 for it until Phase 7 ships. Do not create a placeholder calendar route in this phase.

- [ ] **Step 2: Create `src/components/portal/notification-bell.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import type { FeedItem } from "@/db/repositories/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type NotificationBellProps = {
	items: FeedItem[];
	unreadCount: number;
	onMarkRead: (id: string) => Promise<void>;
	onMarkAllRead: () => Promise<void>;
};

export function NotificationBell({ items, unreadCount, onMarkRead, onMarkAllRead }: NotificationBellProps) {
	const [isPending, startTransition] = useTransition();
	const [open, setOpen] = useState(false);
	const recent = items.slice(0, 6);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
					<Bell />
					{unreadCount > 0 ? (
						<Badge
							variant="success"
							className="absolute -right-1 -top-1 h-5 min-w-5 justify-center px-1 text-[10px]"
						>
							{unreadCount > 9 ? "9+" : unreadCount}
						</Badge>
					) : null}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-80">
				<div className="flex items-center justify-between px-2 py-1.5">
					<span className="text-sm font-semibold">Notifications</span>
					<Button
						variant="ghost"
						size="sm"
						disabled={isPending || unreadCount === 0}
						onClick={() => startTransition(() => void onMarkAllRead())}
					>
						<CheckCheck />
						Mark all read
					</Button>
				</div>
				<DropdownMenuSeparator />
				{recent.length === 0 ? (
					<p className="px-2 py-6 text-center text-sm text-muted-foreground">You are all caught up.</p>
				) : (
					recent.map((item) => (
						<DropdownMenuItem
							key={item.id}
							className="flex flex-col items-start gap-0.5"
							onSelect={() => {
								if (item.readAt === null) {
									startTransition(() => void onMarkRead(item.id));
								}
							}}
							asChild
						>
							<Link href={item.href ?? "/portal/notifications"}>
								<span className="flex w-full items-center justify-between gap-2">
									<span className="text-sm font-medium">{item.title}</span>
									{item.readAt === null ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
								</span>
								<span className="text-xs text-muted-foreground">{item.body}</span>
							</Link>
						</DropdownMenuItem>
					))
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/portal/notifications" className="justify-center text-sm font-medium">
						See all notifications
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
```

- [ ] **Step 3: Create `src/components/portal/portal-shell.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { primaryNav, sheetNav } from "./nav-items";

export type PortalShellProps = {
	member: { displayName: string; initials: string };
	navPins: { id: string; label: string; url: string }[];
	bell: React.ReactNode;
	children: React.ReactNode;
};

function isActive(pathname: string, href: string): boolean {
	return href === "/portal" ? pathname === "/portal" : pathname.startsWith(href);
}

export function PortalShell({ member, navPins, bell, children }: PortalShellProps) {
	const pathname = usePathname();
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<div className="min-h-screen bg-background text-foreground">
			<header className="sticky top-0 z-30 border-b border-border bg-card text-card-foreground">
				<div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
					<Link className="font-heading text-2xl" href="/portal">
						CODE Portal
					</Link>
					<div className="flex items-center gap-2">
						{bell}
						<span className="hidden text-sm text-muted-foreground sm:inline">{member.displayName}</span>
					</div>
				</div>
			</header>

			<div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 pb-24 sm:px-6 lg:grid-cols-[230px_1fr] lg:px-8 lg:pb-6">
				<aside className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
					<nav className="grid gap-1" aria-label="Portal modules">
						{[...primaryNav, ...sheetNav].map((item) => {
							const Icon = item.icon;
							return (
								<Button
									key={item.id}
									asChild
									variant={isActive(pathname, item.href) ? "default" : "ghost"}
									className="justify-start"
								>
									<Link href={item.href}>
										<Icon />
										{item.label}
									</Link>
								</Button>
							);
						})}
					</nav>
					{navPins.length > 0 ? (
						<>
							<Separator className="my-4" />
							<nav className="grid gap-1" aria-label="Pinned links">
								{navPins.map((pin) => (
									<Button key={pin.id} asChild variant="ghost" className="justify-start">
										<Link href={pin.url}>{pin.label}</Link>
									</Button>
								))}
							</nav>
						</>
					) : null}
				</aside>

				<main className="min-w-0">{children}</main>
			</div>

			{/* Mobile bottom nav: fixed core slots + a center Menu button. */}
			<nav
				className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card lg:hidden"
				aria-label="Portal modules"
			>
				<div className="mx-auto grid max-w-md grid-cols-4 items-center">
					{primaryNav.map((item) => {
						const Icon = item.icon;
						return (
							<Link
								key={item.id}
								href={item.href}
								className={cn(
									"flex flex-col items-center gap-1 py-2 text-xs",
									isActive(pathname, item.href) ? "text-primary" : "text-muted-foreground",
								)}
							>
								<Icon className="h-5 w-5" />
								{item.label}
							</Link>
						);
					})}
					<Sheet open={menuOpen} onOpenChange={setMenuOpen}>
						<SheetTrigger asChild>
							<button className="flex flex-col items-center gap-1 py-2 text-xs text-muted-foreground" type="button">
								<Menu className="h-5 w-5" />
								Menu
							</button>
						</SheetTrigger>
						<SheetContent side="bottom">
							<SheetHeader>
								<SheetTitle>Menu</SheetTitle>
							</SheetHeader>
							<div className="grid gap-3 py-4">
								<div className="flex items-center gap-3 rounded-md border p-3">
									<QrCode className="h-10 w-10 text-foreground" />
									<div>
										<p className="text-sm font-medium">Your member code</p>
										<p className="text-xs text-muted-foreground">Show this to an event admin to record attendance.</p>
									</div>
								</div>
								{sheetNav.map((item) => {
									const Icon = item.icon;
									return (
										<Link
											key={item.id}
											href={item.href}
											className="flex items-center gap-2 rounded-md border p-3 text-sm font-medium"
											onClick={() => setMenuOpen(false)}
										>
											<Icon className="h-4 w-4" />
											{item.label}
										</Link>
									);
								})}
								{navPins.map((pin) => (
									<Link
										key={pin.id}
										href={pin.url}
										className="rounded-md border p-3 text-sm font-medium"
										onClick={() => setMenuOpen(false)}
									>
										{pin.label}
									</Link>
								))}
							</div>
						</SheetContent>
					</Sheet>
				</div>
			</nav>
		</div>
	);
}
```

> **Note:** the member-code card is a static placeholder in Phase 2 (the real client-generated QR/barcode is Phase 4 per master plan §6/§7). Keep the card and copy; do not implement code generation here.

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (Type-only import of `FeedItem` resolves against Task 2; actions are passed as props so there is no dependency on Task 8 yet.)

- [ ] **Step 5: Commit**

```bash
git add src/components/portal/nav-items.ts src/components/portal/portal-shell.tsx src/components/portal/notification-bell.tsx
git commit -m "feat(portal): add the portal shell, fixed nav, and notification bell

Desktop sidebar plus a mobile bottom bar capped at four core slots with
a center Menu sheet that holds nav pins and the member-code card. The
bell shows derived plus materialized items and an unread badge."
```

---

### Task 6: Portal layout — resolve the actor, build the view-model, mount the shell

**Files:**
- Modify: `src/app/portal/layout.tsx` (full replace)

**Interfaces:**
- Consumes: `getActor` from `@/server/auth/actor`; `getRepositories` from `@/db`; `navPins` from `@/db/schema` (read directly via a one-off bounded query through `getDb`? NO — see note); `PortalShell` (Task 5), `NotificationBell` (Task 5); `markNotificationReadAction`, `markAllNotificationsReadAction` (Task 8).
- Produces: the authed shell wrapping every `/portal/*` page. Replaces the current header-only layout.
- **Nav pins source:** Phase 2 reads nav pins with a small bounded query inside the layout using `getRepositories()` is not possible (there is no nav-pins repository until Phase 8). For this phase, render an EMPTY `navPins={[]}` and add a `// TODO(phase-8): load nav_pins via a navPins repository` comment. Do not add a nav-pins repository here (that is Phase 8 scope and would balloon this task). The shell already handles an empty list.

- [ ] **Step 1: Replace `src/app/portal/layout.tsx` in full**

```tsx
import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { NotificationBell } from "@/components/portal/notification-bell";
import { PortalShell } from "@/components/portal/portal-shell";
import { getActor } from "@/server/auth/actor";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./notifications/actions";

export const dynamic = "force-dynamic";

function initialsFrom(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);
	return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "M";
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
	const actor = await getActor();
	if (!actor) redirect("/signin");

	const repositories = await getRepositories();
	const [member, feed, unreadCount] = await Promise.all([
		repositories.members.getById(actor, actor.memberId),
		repositories.notifications.listFeed(actor, { limit: 10 }),
		repositories.notifications.unreadCount(actor),
	]);
	if (!member) redirect("/signin");

	const displayName = member.nickname ?? member.fullName ?? member.name ?? member.email;

	// TODO(phase-8): load nav_pins via a navPins repository once Phase 8 adds it.
	const navPins: { id: string; label: string; url: string }[] = [];

	return (
		<PortalShell
			member={{ displayName, initials: initialsFrom(displayName) }}
			navPins={navPins}
			bell={
				<NotificationBell
					items={feed}
					unreadCount={unreadCount}
					onMarkRead={markNotificationReadAction}
					onMarkAllRead={markAllNotificationsReadAction}
				/>
			}
		>
			{children}
		</PortalShell>
	);
}
```

> **Sign-out:** the previous layout had an inline sign-out form. Phase 2 moves sign-out to the Profile page (Profile is already a fixed nav slot and is where account actions belong; the master plan §14 v5 item 16 removed the duplicate top-right account icon). Add the sign-out form to the Profile page in this same task (Step 2) so the action is not lost.

- [ ] **Step 2: Add sign-out to the Profile page**

In `src/app/portal/profile/page.tsx`, add the imports at the top (alongside the existing imports):
```tsx
import { LogOut } from "lucide-react";
import { signOut } from "@/auth";
```

Then, immediately before the final closing `</main>` tag of `ProfilePage`, add:
```tsx
			<form
				className="mt-6"
				action={async () => {
					"use server";
					await signOut({ redirectTo: "/" });
				}}
			>
				<Button type="submit" variant="outline">
					<LogOut />
					Sign out
				</Button>
			</form>
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS once Task 8's actions exist. If running tasks in order and Task 8 is not done, this step fails on the missing `./notifications/actions` import. Implement Task 8 before this step, OR reorder so Task 8 lands first. (Recommended execution order: 1, 2, 3, 4, 5, 8, 6, 7. The reviewer should run Task 8 before Task 6's typecheck.)

- [ ] **Step 4: Commit**

```bash
git add src/app/portal/layout.tsx src/app/portal/profile/page.tsx
git commit -m "feat(portal): mount the authed shell in the portal layout

Resolves the actor once, loads the member and notification feed, and
wraps every portal page in the shell. Moves sign-out to the Profile
page now that the duplicate top-right account control is gone."
```

---

### Task 7: Overview module — server-rendered dashboard from OverviewRepository

**Files:**
- Modify: `src/app/portal/page.tsx` (full replace)
- Create: `src/components/portal/overview-metrics.tsx`
- Delete: `src/components/portal-workspace.tsx`

**Interfaces:**
- Consumes: `getActor` from `@/server/auth/actor`; `getRepositories` from `@/db`; `OverviewSummary` from `@/db/repositories/overview` (Task 1).
- Produces: the `/portal` Overview page. After this task, nothing imports `portal-workspace.tsx`, so it is deleted.

- [ ] **Step 1: Confirm nothing else imports the old workspace**

Run: `pnpm exec grep -rn "portal-workspace" src/`
Expected: exactly one match — `src/app/portal/page.tsx` (which this task rewrites). If any other file matches, stop and report; do not delete the workspace until this is the only reference.

- [ ] **Step 2: Create `src/components/portal/overview-metrics.tsx`**

```tsx
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

export function MetricCard({
	label,
	value,
	description,
	icon: Icon,
}: {
	label: string;
	value: string;
	description: string;
	icon: LucideIcon;
}) {
	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
				<CardDescription>{label}</CardDescription>
				<Icon className="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-semibold">{value}</div>
				<p className="mt-1 text-xs text-muted-foreground">{description}</p>
			</CardContent>
		</Card>
	);
}

export function RetentionProgress({ points, retainedAt }: { points: number; retainedAt: number | null }) {
	const target = retainedAt ?? 0;
	const pct = target > 0 ? Math.min(100, Math.round((points / target) * 100)) : 0;
	return (
		<div className="space-y-2">
			<div className="h-2 rounded-full bg-muted">
				<div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
			</div>
			<p className="text-xs text-muted-foreground">
				{target > 0 ? `${points} of ${target} points toward retained status.` : "No active term target set."}
			</p>
		</div>
	);
}
```

- [ ] **Step 3: Replace `src/app/portal/page.tsx` in full**

```tsx
import { redirect } from "next/navigation";
import { CalendarDays, ClipboardCheck, Link2, MessageSquare } from "lucide-react";
import { getRepositories } from "@/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard, RetentionProgress } from "@/components/portal/overview-metrics";
import { getActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";

export default async function PortalOverviewPage() {
	const actor = await getActor();
	if (!actor) redirect("/signin");

	const repositories = await getRepositories();
	const summary = await repositories.overview.getSummary(actor);

	return (
		<div className="grid gap-5">
			<div>
				<p className="text-xs font-semibold uppercase text-primary">Member workspace</p>
				<h1 className="font-heading text-3xl">Overview</h1>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
					Your retention progress, pending surveys, upcoming events, and link activity for the current term.
				</p>
			</div>

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<MetricCard
					label="Retention"
					value={summary.retention.termName ? String(summary.retention.points) : "0"}
					description={summary.retention.termName ?? "No active term"}
					icon={ClipboardCheck}
				/>
				<MetricCard
					label="Surveys"
					value={String(summary.pendingSurveys)}
					description="Pending responses"
					icon={MessageSquare}
				/>
				<MetricCard
					label="Events"
					value={String(summary.upcomingEvents)}
					description="Upcoming approved events"
					icon={CalendarDays}
				/>
				<MetricCard
					label="Links"
					value={String(summary.linkClicks)}
					description="Clicks on your short links"
					icon={Link2}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Retention path</CardTitle>
					<CardDescription>{summary.retention.termName ?? "Current term"}</CardDescription>
				</CardHeader>
				<CardContent>
					<RetentionProgress points={summary.retention.points} retainedAt={summary.retention.retainedAt} />
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 4: Delete the old workspace component**

```bash
git rm src/components/portal-workspace.tsx
```

- [ ] **Step 5: Typecheck, lint, and run the overview test**

Run: `pnpm typecheck && pnpm lint && pnpm test -- overview.integration.test.ts`
Expected: PASS, with no remaining references to `portal-workspace`.

- [ ] **Step 6: Commit**

```bash
git add src/app/portal/page.tsx src/components/portal/overview-metrics.tsx src/components/portal-workspace.tsx
git commit -m "feat(portal): replace the placeholder workspace with a real Overview module

The Overview page renders live retention, survey, event, and link
metrics from the overview repository. Deletes the single-file mock
workspace it replaces."
```

---

### Task 8: Notifications module — full list page + server actions

**Files:**
- Create: `src/app/portal/notifications/actions.ts`
- Create: `src/app/portal/notifications/page.tsx`

**Interfaces:**
- Consumes: `getRepositories` from `@/db`; `requireActor`, `getActor` from `@/server/auth/actor`; `FeedItem` from `@/db/repositories/notifications`.
- Produces: `markNotificationReadAction(id: string): Promise<void>` and `markAllNotificationsReadAction(): Promise<void>` (consumed by Task 6's layout and Task 5's bell via props); the `/portal/notifications` page.
- **Execution-order note (repeated from Task 6):** implement this task before running Task 6 Step 3's typecheck, because Task 6's layout imports these two actions.

- [ ] **Step 1: Create `src/app/portal/notifications/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";

const idSchema = z.string().trim().min(1).max(64);

export async function markNotificationReadAction(id: string): Promise<void> {
	const notificationId = idSchema.parse(id);
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.notifications.markRead(actor, notificationId);
	revalidatePath("/portal/notifications");
	revalidatePath("/portal");
}

export async function markAllNotificationsReadAction(): Promise<void> {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.notifications.markAllRead(actor);
	revalidatePath("/portal/notifications");
	revalidatePath("/portal");
}
```

> **Note:** every feed item is a materialized row owned by the member, so `markRead` is always a real owner-scoped update. There is no derived/synthetic item class in this design (see Task 2) — `markRead` cannot be called with an id that matches no row except by a stale client cache, in which case it is a safe no-op.

- [ ] **Step 2: Create `src/app/portal/notifications/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActor } from "@/server/auth/actor";
import { markAllNotificationsReadAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
	const actor = await getActor();
	if (!actor) redirect("/signin");

	const repositories = await getRepositories();
	const items = await repositories.notifications.listFeed(actor, { limit: 50 });

	return (
		<div className="grid gap-5">
			<div className="flex items-end justify-between gap-4">
				<div>
					<p className="text-xs font-semibold uppercase text-primary">Member workspace</p>
					<h1 className="font-heading text-3xl">Notifications</h1>
				</div>
				<form action={markAllNotificationsReadAction}>
					<Button type="submit" variant="outline" size="sm">
						<CheckCheck />
						Mark all read
					</Button>
				</form>
			</div>

			{items.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center gap-2 py-12 text-center">
						<Bell className="h-8 w-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">You are all caught up.</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-3">
					{items.map((item) => {
						const content = (
							<Card className={item.readAt === null ? "border-primary/40" : undefined}>
								<CardHeader>
									<div className="flex items-center justify-between gap-3">
										<CardTitle className="text-base">{item.title}</CardTitle>
										{item.readAt === null ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
									</div>
									<CardDescription>{item.body}</CardDescription>
								</CardHeader>
							</Card>
						);
						return item.href ? (
							<Link key={item.id} href={item.href}>
								{content}
							</Link>
						) : (
							<div key={item.id}>{content}</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. With this task done, Task 6's layout import of the two actions resolves.

- [ ] **Step 4: Commit**

```bash
git add src/app/portal/notifications/actions.ts src/app/portal/notifications/page.tsx
git commit -m "feat(portal): add the notifications list page and read actions

Server-rendered feed of materialized notification items with mark-read
and mark-all-read server actions that revalidate the portal and feed."
```

---

### Task 9: Full verification + dev-Worker redeploy gate

**Files:**
- None (verification + approval-gated ops only).

**Interfaces:**
- Consumes: every prior task.
- Produces: a green tree (typecheck, lint, full test suite, build) and the surfaced, approval-gated dev-Worker redeploy.

- [ ] **Step 1: Run the full local gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. The suite includes `overview.integration.test.ts`, `notifications.integration.test.ts`, plus the existing `members.integration.test.ts`, `permissions.test.ts`, `access.test.ts`, `roster.integration.test.ts`, and `shared-parity.integration.test.ts`, all green against the auto-applied `drizzle/migrations`.

- [ ] **Step 2: Run the OpenNext build**

Run: `pnpm build`
Expected: PASS (Next build + OpenNext bundle). Confirms the new server components, server actions, and client shell compile under the Worker target.

- [ ] **Step 3: Manual smoke (optional, local)**

Run: `pnpm dev`, sign in (or use a seeded local session), and confirm: `/portal` shows the Overview metrics; the bell shows an unread badge when seeded notifications exist; `/portal/notifications` lists items and "Mark all read" clears the badge; the mobile layout (narrow viewport) shows the bottom bar and the Menu sheet with the member-code card. Stop the dev server when done.

- [ ] **Step 4: STOP — surface the dev-Worker redeploy obligation, do not run without approval**

Per CLAUDE.md and master-plan §15, this phase changed repository signatures consumed over the shared proxy (`notifications`, `overview`) and the `getRepositories()` shape. No schema or migration changed, so `db:migrate:dev` is NOT required, but the dev Worker must be redeployed so shared clients see the new repository surface. Present this command to the user and wait for explicit approval before running it:
```bash
pnpm deploy:dev
```
Do not run it non-interactively. If the user declines, leave the dev Worker as-is and note that shared-mode portal reads are out of scope this phase (Task 3 note).

---

## Self-review notes (for the implementer, not a step to execute)

**Spec coverage (master plan §1, §6, §11, §12 Phase 2):**
- "authed shell, URL-addressable modules" → Tasks 5 + 6 (shell with desktop sidebar / mobile bottom nav, each module is its own route segment: `/portal`, `/portal/notifications`, `/portal/profile`, plus the fixed `/portal/calendar` slot for Phase 7).
- "overview" → Tasks 1 + 7 (`OverviewRepository.getSummary` + the `/portal` Overview page).
- "notifications (materialized + derived)" → Tasks 2 + 8 (materialized `notifications` rows UNION derived survey/event counts off `member_feed_state` cursors; the §6 hybrid is honored, no per-member fan-out).
- "settings page cut per §11" → no settings route, no preference data modeled (Global Constraints + §11 #4).
- "simple static `/`" → explicitly NOT touched; `src/app/page.tsx` is already the static landing page from the v5-foundation plan (Task 7 there). Confirmed out of scope.
- Mobile bottom nav fixed at 4-5 slots; nav pins + member-code card live in the Menu sheet (Task 5, master plan minimalism Global Constraint, §14 v5 items 7, 17).
- Deferred surfaces removed from the old workspace: Library, Announcements, guided tours/"Replay tour"/"Start tour", the search bar, and the duplicate top-right account icon are all absent from the new shell (Task 5/6/7), satisfying §11 and §14 v5 items 10-13, 15-16.

**Out of scope for this plan (intentionally deferred to later phases per §12):**
- The `/portal/calendar` route and the `CalendarRepository` (empty stub) — Phase 7. Task 5 links to the fixed slot but creates no route; it 404s until Phase 7.
- The real client-generated member QR/barcode — Phase 4 (§6/§7). Task 5 ships a static placeholder card only.
- A `navPins` repository and the admin nav-pins screen — Phase 8 (§6). Task 6 renders `navPins={[]}` with a `TODO(phase-8)` marker; the shell already handles a populated list so Phase 8 only wires the data source.
- Quick Links widget, retention history, surveys response flow, links module, CRS, admin/audit/reporting — Phases 3-8.
- Shared-mode portal UI — Task 3 returns explicit "unavailable" adapters for overview/notifications in shared mode (mirrors the existing audit pattern); shared mode is exercised via repository tests and the `/internal` proxy in later phases, not portal pages here.

**Type consistency check:**
- `OverviewSummary` shape is identical in Task 1 (definition), Task 3 (re-export), and Task 7 (consumption).
- `FeedItem` and the four `NotificationsRepository` method names (`listFeed`, `unreadCount`, `markRead`, `markAllRead`) are identical across Task 2 (definition), Task 3 (unavailable adapter + re-export), Task 5 (`NotificationBellProps`), Task 6 (layout calls `listFeed`/`unreadCount`), and Task 8 (actions call `markRead`/`markAllRead`).
- `createOverviewRepository(db)` / `createNotificationsRepository(db)` factory signatures match the existing `create*Repository` convention and the `db: ReturnType<typeof getDb>` type used in Tasks 1, 2, 3.
- Server-action signatures `markNotificationReadAction(id: string)` / `markAllNotificationsReadAction()` are identical in Task 8 (definition) and Task 6 (passed as `onMarkRead`/`onMarkAllRead` props, whose types in Task 5 are `(id: string) => Promise<void>` and `() => Promise<void>`).

**Execution-order caveat:** Task 6's typecheck depends on Task 8's actions module existing. Run tasks in the order 1, 2, 3, 4, 5, 8, 6, 7, 9 (Task 8 before Task 6), or implement Task 8's `actions.ts` file before Task 6 Step 3. This is called out inline in both tasks.

**No schema changes:** this plan adds zero migrations. If any step appears to need a new column or table, that is a planning error to raise, not a `schema.ts` edit to make here.
