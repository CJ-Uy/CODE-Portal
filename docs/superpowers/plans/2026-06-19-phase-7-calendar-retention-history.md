# Phase 7 — Calendar + My Retention History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the derived calendar (the sole events-discovery surface in v5) with event detail pages at `/portal/calendar/[eventId]`, repurpose the old "Events" tab into "My Retention History" (current-term summary card + full record list + term selector), and wire notification derive+materialize so per-member notifications are produced on event approval, survey assignment, forum reply, and points-awarded.

**Architecture:** This is a backend-derivation-first phase. Three currently-empty repository stubs (`calendar`, `retention`, `notifications`) are filled with `Actor`-first, `can()`-gated, index-backed query functions following the established `members` repository pattern (structural `Db` type, explicit `actor`, `audit.record()` after privileged writes). The calendar repository assembles a bounded month window from three sources (approved `crsEvents`, public birthdays, `terms` deadlines) per the master-plan §6 contract; the retention repository derives a member's current-term summary and full history from `retentionRecords` keyed by `termId`; the notifications repository both materializes per-member rows (master-plan §6: reply / attendance / points / link milestone) and derives survey + event-availability counts from `memberFeedState` cursors without fan-out. Thin server-rendered pages under `src/app/portal/calendar/` and `src/app/portal/events/` consume these repositories through `getRepositories()` + `requireActor()`. A `notify(...)` derive+materialize helper is then called from the four trigger points (event approve, survey assign, forum reply, retention points-awarded).

**Tech Stack:** Drizzle ORM (SQLite dialect, D1), Auth.js v5 actor seam (`getActor()`/`requireActor()`), Next.js 16 App Router server components, Vitest + `@cloudflare/vitest-pool-workers` (existing `vitest.config.mts` auto-applies `drizzle/migrations` to an ephemeral test D1), Tailwind CSS v4 + local shadcn/ui registry.

## Global Constraints

- Keep `/` public and reader-first; the member workspace lives under `/portal`; everything Phase 7 adds is under `/portal/calendar*` and `/portal/events` (CLAUDE.md, master-plan §1).
- Drizzle schema at `src/db/schema.ts` is the ONE source of truth; one migration set under `drizzle/migrations`. Phase 7 adds NO schema changes — every table it reads (`crsEvents`, `eventRsvps`, `crsAttendance`, `eventMedia`, `eventForumPosts`, `retentionRecords`, `terms`, `members`, `notifications`, `memberFeedState`, `surveyAssignments`) already exists from the v5 foundation migration (master-plan §6, CLAUDE.md).
- Do not expose D1 as `DATABASE_URL`; do not add raw SQL internal endpoints (CLAUDE.md). All data access goes through repositories and (for shared mode) the typed contract under `src/db/contract/*` + `src/server/internal/*`.
- Every repository function takes an explicit `actor` (resolved `{ memberId, roles }`) and calls `can()` before any privileged read/write; every privileged write calls `audit.record(...)` after (master-plan §3.2, §5). Notifications materialized for another member are a system side effect of an already-audited admin action, not a separately-audited mutation (see Task 7 note).
- All repository queries respect the D1 budget (master-plan §3.4): a bounded date window on the calendar, paginated/limited history lists, and a backing index on every query. No unbounded `SELECT`. Notification derivation must NOT fan out one row per member per item (master-plan §6 notifications) — survey/event-availability counts are derived from `memberFeedState` cursors at read time.
- Birthday privacy is enforced inside the calendar contract: a birthday source row is included only when `birthdayPrivate=false` OR the actor has `member:manage` (master-plan §6 calendar, §10).
- Timestamps are integer epoch-ms via Drizzle `mode:"timestamp_ms"`; repository code passes/receives `Date` objects. IDs are app-generated prefixed strings via `createId(prefix)` from `src/lib/ids.ts`.
- Styling is Tailwind CSS v4 bound to `src/app/globals.css` tokens; build UI from the local shadcn/ui registry (`src/components/ui/*`) — reuse `card`, `tabs`, `select`, `badge`, `button` before adding anything; add a missing official component with `pnpm dlx shadcn@latest add <component>`. No CSS-in-JS, no card-inside-card. No em dashes in UI copy, code comments, docs, or commits. Brand headings Unna, body Source Sans (already wired through tokens).
- Show the exact `pnpm exec wrangler` / `pnpm db:*` / `pnpm deploy:*` command and wait for approval before any D1 reset, migration, seed, delete, or production-touching operation (CLAUDE.md). Phase 7 adds no migration, so the only approval-gated step is the final dev-Worker redeploy (Task 9 Step 4), required because the internal contract (`src/db/contract/*`) and repository signatures used over the proxy change (master-plan §15 trigger 2).

## Dependencies (read before starting)

- **Depends on Phase 4 (CRS events + retention).** Phase 7 reads and derives from `crsEvents`, `eventRsvps`, `crsAttendance`, `eventMedia`, `eventForumPosts`, and `retentionRecords`, and it calls the Phase 4 events repository at the event-approve and points-awarded notification trigger points (Task 7). The TABLES all exist (v5 foundation migration), but the `events` and `retention` repositories are still empty stubs (`src/db/repositories/events.ts`, `src/db/repositories/retention.ts` each return `{}`). **If Phase 4 has not landed its event-approve / retention-record write paths, Tasks 4-6 still stand on their own (they read the tables directly), but Task 7's two event-side triggers must be wired INTO whatever function Phase 4 named for "approve an event" and "award retention points." Where Task 7 references a Phase 4 function that does not yet exist, add the `notify(...)` call as the marked TODO-free hook described in that task and surface the missing dependency to the reviewer rather than inventing a Phase 4 signature.**
- **Depends on Phase 2 (portal shell + notifications module).** The notifications repository stub (`src/db/repositories/notifications.ts`) and `memberFeedState` cursor are introduced for Phase 2 to own the bell/feed UI; Phase 7 fills in the derive+materialize LOGIC those surfaces consume. Phase 7 does NOT build the notification bell component or the portal bottom-nav shell (those are Phase 2). Phase 7's pages are plain server-rendered routes that will slot under whatever shell Phase 2 ships; they do not depend on the shell existing to compile or test.
- This plan does not modify `src/components/portal-workspace.tsx` (the hardcoded demo workspace). That component is replaced wholesale by the Phase 2 shell; Phase 7's calendar/event-detail/retention pages are new URL-addressable routes, not edits to that file.

---

### Task 1: Calendar contract types and shared date helpers

**Files:**
- Create: `src/db/contract/calendar.ts`
- Create: `src/lib/calendar.ts`
- Create: `src/lib/calendar.test.ts`
- Modify: `src/db/contract/index.ts` (add the calendar export)

**Interfaces:**
- Consumes: `operation` from `src/db/contract/common.ts`; `crsEvents`, `members`, `terms` table names only as documentation.
- Produces:
  - `src/lib/calendar.ts`: `monthRange(year: number, month: number): { start: Date; end: Date }` (month is 1-12; `start` is 00:00:00.000 UTC of the 1st, `end` is the first instant of the next month, half-open `[start, end)`); `toIsoDate(date: Date): string` (UTC `YYYY-MM-DD`); `CalendarSource = "event" | "birthday" | "term_deadline"`; `CalendarItem` type (below).
  - `src/db/contract/calendar.ts`: `calendarContract.getMonth` operation (`auth: "member"`, `sharedDev: "allow"`), `calendarContract.getEvent` operation (`auth: "member"`, `sharedDev: "allow"`), and the exported zod schemas `calendarItemSchema`, `getMonthInputSchema`, `eventDetailSchema`.
- These names are consumed by Task 2 (calendar repository), Task 3 (calendar pages), and Task 8 (internal route).

- [ ] **Step 1: Write the failing test for the date helpers**

Create `src/lib/calendar.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { monthRange, toIsoDate } from "./calendar";

describe("monthRange", () => {
	it("returns a half-open UTC month window", () => {
		const { start, end } = monthRange(2026, 6);
		expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
		expect(end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
	});

	it("rolls over the year at December", () => {
		const { start, end } = monthRange(2026, 12);
		expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
		expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
	});
});

describe("toIsoDate", () => {
	it("formats a date as a UTC calendar day", () => {
		expect(toIsoDate(new Date("2026-06-19T23:59:00.000Z"))).toBe("2026-06-19");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- calendar.test.ts`
Expected: FAIL — `./calendar` does not exist yet.

- [ ] **Step 3: Write `src/lib/calendar.ts`**

```ts
export type CalendarSource = "event" | "birthday" | "term_deadline";

export type CalendarItem = {
	id: string;
	source: CalendarSource;
	title: string;
	date: string; // UTC YYYY-MM-DD the item renders on
	startsAt: string | null; // ISO instant for events, null for all-day items
	endsAt: string | null;
	eventId: string | null; // set only when source === "event", links to detail page
	href: string | null; // /portal/calendar/[eventId] for events, null otherwise
};

/**
 * Half-open UTC month window [start, end). `month` is 1-12. Callers query
 * `startsAt >= start AND startsAt < end` so an event at 00:00 on the last day
 * is included and the next month's first instant never double-counts.
 */
export function monthRange(year: number, month: number): { start: Date; end: Date } {
	const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
	const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
	return { start, end };
}

export function toIsoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- calendar.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Write the calendar contract**

Create `src/db/contract/calendar.ts`:
```ts
import { z } from "zod";
import { operation } from "./common";

export const calendarItemSchema = z.object({
	id: z.string(),
	source: z.enum(["event", "birthday", "term_deadline"]),
	title: z.string(),
	date: z.string(),
	startsAt: z.string().nullable(),
	endsAt: z.string().nullable(),
	eventId: z.string().nullable(),
	href: z.string().nullable(),
});

export const getMonthInputSchema = z.object({
	year: z.number().int().min(2000).max(2100),
	month: z.number().int().min(1).max(12),
});

export const eventDetailSchema = z.object({
	id: z.string(),
	title: z.string(),
	type: z.enum(["official", "casual", "birthday"]),
	status: z.enum(["pending", "approved", "rejected"]),
	points: z.number().nullable(),
	place: z.string(),
	capacity: z.number().nullable(),
	startsAt: z.coerce.date(),
	endsAt: z.coerce.date().nullable(),
	description: z.string(),
	myRsvp: z.enum(["going", "none"]),
	attendingCount: z.number(),
	iAttended: z.boolean(),
	media: z.array(z.object({ id: z.string(), r2Key: z.string(), caption: z.string().nullable() })),
});

export const calendarContract = {
	getMonth: operation({
		input: getMonthInputSchema,
		output: z.object({ items: z.array(calendarItemSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	getEvent: operation({
		input: z.object({ eventId: z.string().min(1) }),
		output: z.object({ event: eventDetailSchema.nullable() }),
		auth: "member",
		sharedDev: "allow",
	}),
};
```

- [ ] **Step 6: Register the contract in the index**

Read `src/db/contract/index.ts` first. Add an export line alongside the existing contract exports (the file re-exports each domain contract):
```ts
export { calendarContract } from "./calendar";
```
If `index.ts` aggregates into a single object literal (e.g. `export const contract = { members: membersContract, ... }`), add `calendar: calendarContract,` to that object and import `calendarContract` at the top. Match the existing file's exact shape rather than imposing a new one.

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — the new contract and helpers compile; nothing else references them yet.

- [ ] **Step 8: Commit**

```bash
git add src/lib/calendar.ts src/lib/calendar.test.ts src/db/contract/calendar.ts src/db/contract/index.ts
git commit -m "feat(calendar): add calendar contract types and month-range helpers

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Calendar repository — derived month assembly + event detail

**Files:**
- Modify: `src/db/repositories/calendar.ts` (full file, replaces the stub)
- Create: `src/db/repositories/calendar.integration.test.ts`

**Interfaces:**
- Consumes: `crsEvents`, `members`, `terms`, `eventRsvps`, `crsAttendance`, `eventMedia` from `@/db/schema`; `can` + `Actor` from `@/server/auth/permissions`; `CalendarItem` from `@/lib/calendar`; `eventDetailSchema` shape from the contract (Task 1).
- Produces: `CalendarRepository` with `getMonth(actor, input): Promise<CalendarItem[]>` and `getEvent(actor, eventId): Promise<EventDetail | null>`; `createCalendarRepository(db: CalendarDb): CalendarRepository`. `EventDetail` is exported. Task 3 (pages), Task 8 (internal route), and `src/db/repositories/index.ts` (Task 9) consume these.

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/calendar.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createCalendarRepository } from "./calendar";

const memberActor: Actor = { memberId: "mem_view", roles: ["member"] };
const adminActor: Actor = { memberId: "mem_admin", roles: ["super"] };

function db() {
	return drizzle(env.DB, { schema });
}

describe("calendar repository on D1", () => {
	beforeEach(async () => {
		for (const table of ["event_media", "crs_attendance", "event_rsvps", "crs_events", "terms", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name, birthday, birthday_private) VALUES (?, ?, ?, ?, ?)")
			.bind("mem_view", "view@example.com", "Viewer", "1990-06-10", 1)
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name, birthday, birthday_private) VALUES (?, ?, ?, ?, ?)")
			.bind("mem_public_bday", "pub@example.com", "Public Bday", "2000-06-15", 0)
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name, birthday, birthday_private) VALUES (?, ?, ?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin", "1995-06-20", 1)
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_1", "Term 1", 20, 10, Date.UTC(2026, 5, 1), Date.UTC(2026, 5, 30))
			.run();
		// approved event inside June 2026
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_in", "Approved June Event", "official", "approved", "SOM 111", Date.UTC(2026, 5, 12, 9), "desc", "mem_admin", "s1")
			.run();
		// pending event must be hidden from the derived calendar
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_pending", "Pending Event", "official", "pending", "SOM 112", Date.UTC(2026, 5, 13, 9), "desc", "mem_admin", "s2")
			.run();
		// approved event outside the window (July) must not appear
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("evt_out", "July Event", "official", "approved", "SOM 113", Date.UTC(2026, 6, 2, 9), "desc", "mem_admin", "s3")
			.run();
	});

	it("includes approved in-window events and excludes pending and out-of-window ones", async () => {
		const repo = createCalendarRepository(db());
		const items = await repo.getMonth(memberActor, { year: 2026, month: 6 });
		const eventIds = items.filter((i) => i.source === "event").map((i) => i.eventId);
		expect(eventIds).toContain("evt_in");
		expect(eventIds).not.toContain("evt_pending");
		expect(eventIds).not.toContain("evt_out");
	});

	it("includes a public birthday but hides a private one from a normal member", async () => {
		const repo = createCalendarRepository(db());
		const items = await repo.getMonth(memberActor, { year: 2026, month: 6 });
		const birthdayTitles = items.filter((i) => i.source === "birthday").map((i) => i.title);
		expect(birthdayTitles.some((t) => t.includes("Public Bday"))).toBe(true);
		expect(birthdayTitles.some((t) => t.includes("Viewer"))).toBe(false);
	});

	it("reveals private birthdays to an actor with member:manage", async () => {
		const repo = createCalendarRepository(db());
		const items = await repo.getMonth(adminActor, { year: 2026, month: 6 });
		const birthdayTitles = items.filter((i) => i.source === "birthday").map((i) => i.title);
		expect(birthdayTitles.some((t) => t.includes("Viewer"))).toBe(true);
	});

	it("includes a term deadline that falls inside the window", async () => {
		const repo = createCalendarRepository(db());
		const items = await repo.getMonth(memberActor, { year: 2026, month: 6 });
		expect(items.some((i) => i.source === "term_deadline")).toBe(true);
	});

	it("returns event detail with my rsvp, attendance count, and a links-to href", async () => {
		await env.DB.prepare("INSERT INTO event_rsvps (event_id, member_id, state) VALUES (?, ?, ?)")
			.bind("evt_in", "mem_view", "going")
			.run();
		await env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES (?, ?, ?, ?)")
			.bind("evt_in", "mem_view", Date.UTC(2026, 5, 12, 10), "mem_admin")
			.run();
		const repo = createCalendarRepository(db());
		const detail = await repo.getEvent(memberActor, "evt_in");
		expect(detail?.myRsvp).toBe("going");
		expect(detail?.attendingCount).toBe(1);
		expect(detail?.iAttended).toBe(true);
	});

	it("returns null event detail for a pending (non-approved) event", async () => {
		const repo = createCalendarRepository(db());
		expect(await repo.getEvent(memberActor, "evt_pending")).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- calendar.integration.test.ts`
Expected: FAIL — `createCalendarRepository` takes no `db` argument yet and has no `getMonth`/`getEvent`.

- [ ] **Step 3: Replace `src/db/repositories/calendar.ts` in full**

```ts
import { and, count, eq, gte, lt } from "drizzle-orm";
import { crsAttendance, crsEvents, eventMedia, eventRsvps, members, terms } from "@/db/schema";
import { can, type Actor } from "@/server/auth/permissions";
import { monthRange, toIsoDate, type CalendarItem } from "@/lib/calendar";

export type EventDetail = {
	id: string;
	title: string;
	type: "official" | "casual" | "birthday";
	status: "pending" | "approved" | "rejected";
	points: number | null;
	place: string;
	capacity: number | null;
	startsAt: Date;
	endsAt: Date | null;
	description: string;
	myRsvp: "going" | "none";
	attendingCount: number;
	iAttended: boolean;
	media: Array<{ id: string; r2Key: string; caption: string | null }>;
};

type AnyDb = {
	select: (...args: never[]) => any;
};

export type CalendarDb = AnyDb;

function birthdayInMonth(birthday: string | null, year: number, month: number): string | null {
	if (!birthday) return null;
	const monthPart = birthday.slice(5, 7);
	const dayPart = birthday.slice(8, 10);
	if (Number(monthPart) !== month) return null;
	return `${year}-${monthPart}-${dayPart}`;
}

export type CalendarRepository = {
	getMonth(actor: Actor, input: { year: number; month: number }): Promise<CalendarItem[]>;
	getEvent(actor: Actor, eventId: string): Promise<EventDetail | null>;
};

export function createCalendarRepository(db: CalendarDb): CalendarRepository {
	return {
		async getMonth(actor, input) {
			const { start, end } = monthRange(input.year, input.month);
			const items: CalendarItem[] = [];

			// Source 1: approved events whose start falls inside the window.
			const events = await db
				.select({
					id: crsEvents.id,
					title: crsEvents.title,
					startsAt: crsEvents.startsAt,
					endsAt: crsEvents.endsAt,
				})
				.from(crsEvents)
				.where(and(eq(crsEvents.status, "approved"), gte(crsEvents.startsAt, start), lt(crsEvents.startsAt, end)));
			for (const event of events) {
				items.push({
					id: `event:${event.id}`,
					source: "event",
					title: event.title,
					date: toIsoDate(event.startsAt),
					startsAt: event.startsAt.toISOString(),
					endsAt: event.endsAt ? event.endsAt.toISOString() : null,
					eventId: event.id,
					href: `/portal/calendar/${event.id}`,
				});
			}

			// Source 2: birthdays. Private ones are hidden unless the actor can manage members.
			const canSeePrivate = can(actor, "member:manage");
			const memberRows = await db
				.select({ id: members.id, name: members.name, birthday: members.birthday, birthdayPrivate: members.birthdayPrivate })
				.from(members);
			for (const member of memberRows) {
				if (member.birthdayPrivate && !canSeePrivate) continue;
				const date = birthdayInMonth(member.birthday, input.year, input.month);
				if (!date) continue;
				items.push({
					id: `birthday:${member.id}`,
					source: "birthday",
					title: `${member.name ?? "Member"} birthday`,
					date,
					startsAt: null,
					endsAt: null,
					eventId: null,
					href: null,
				});
			}

			// Source 3: term deadlines (term end dates that land inside the window).
			const termRows = await db
				.select({ id: terms.id, name: terms.name, endsAt: terms.endsAt })
				.from(terms)
				.where(and(gte(terms.endsAt, start), lt(terms.endsAt, end)));
			for (const term of termRows) {
				items.push({
					id: `term_deadline:${term.id}`,
					source: "term_deadline",
					title: `${term.name} ends`,
					date: toIsoDate(term.endsAt),
					startsAt: null,
					endsAt: null,
					eventId: null,
					href: null,
				});
			}

			items.sort((a, b) => a.date.localeCompare(b.date));
			return items;
		},

		async getEvent(actor, eventId) {
			const [event] = await db.select().from(crsEvents).where(eq(crsEvents.id, eventId)).limit(1);
			if (!event || event.status !== "approved") return null;

			const [myRsvp] = await db
				.select({ state: eventRsvps.state })
				.from(eventRsvps)
				.where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.memberId, actor.memberId)))
				.limit(1);

			const [attending] = await db
				.select({ value: count() })
				.from(crsAttendance)
				.where(eq(crsAttendance.eventId, eventId));

			const [mine] = await db
				.select({ memberId: crsAttendance.memberId })
				.from(crsAttendance)
				.where(and(eq(crsAttendance.eventId, eventId), eq(crsAttendance.memberId, actor.memberId)))
				.limit(1);

			const media = await db
				.select({ id: eventMedia.id, r2Key: eventMedia.r2Key, caption: eventMedia.caption })
				.from(eventMedia)
				.where(eq(eventMedia.eventId, eventId));

			return {
				id: event.id,
				title: event.title,
				type: event.type,
				status: event.status,
				points: event.points,
				place: event.place,
				capacity: event.capacity,
				startsAt: event.startsAt,
				endsAt: event.endsAt,
				description: event.description,
				myRsvp: myRsvp?.state ?? "none",
				attendingCount: attending?.value ?? 0,
				iAttended: Boolean(mine),
				media,
			};
		},
	};
}
```

Note on the `AnyDb`/`select(...): any` shape: this matches the established pattern of declaring a narrow structural DB type per repository (see `MemberDb` in `members.ts`). The query builders here use enough Drizzle surface that a hand-written structural type would be noise; if the repo index (Task 9) passes `DrizzleD1Database<typeof schema>`, this stays assignable. Do not import the concrete D1 type here to keep the local-sqlite path assignable too.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- calendar.integration.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/calendar.ts src/db/repositories/calendar.integration.test.ts
git commit -m "feat(calendar): derive month items and event detail from events, birthdays, terms

Births privacy enforced in the contract; only approved events surface;
month window is half-open and date-bounded per the D1 budget.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Calendar pages — month view and event detail

**Files:**
- Create: `src/app/portal/calendar/page.tsx`
- Create: `src/app/portal/calendar/[eventId]/page.tsx`
- Create: `src/components/calendar-month.tsx`

**Interfaces:**
- Consumes: `getRepositories()` from `@/db`, `requireActor()` from `@/server/auth/actor`, `CalendarRepository.getMonth`/`getEvent` (Task 2), `CalendarItem` from `@/lib/calendar`, shadcn `card`/`badge`/`button` from `@/components/ui/*`.
- Produces: the `/portal/calendar` route (month agenda, defaults to the current UTC month, `?year=&month=` query params to page) and `/portal/calendar/[eventId]` route (event detail). No new exported types other phases consume.

- [ ] **Step 1: Write the month view component**

Create `src/components/calendar-month.tsx`:
```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CalendarItem } from "@/lib/calendar";

const SOURCE_LABEL: Record<CalendarItem["source"], string> = {
	event: "Event",
	birthday: "Birthday",
	term_deadline: "Deadline",
};

export function CalendarMonth({ items, monthLabel }: { items: CalendarItem[]; monthLabel: string }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{monthLabel}</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				{items.length === 0 ? (
					<p className="text-sm text-muted-foreground">Nothing scheduled this month.</p>
				) : (
					items.map((item) => {
						const row = (
							<div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
								<div className="flex flex-col">
									<span className="text-sm font-medium">{item.title}</span>
									<span className="text-xs text-muted-foreground">{item.date}</span>
								</div>
								<Badge variant="secondary">{SOURCE_LABEL[item.source]}</Badge>
							</div>
						);
						return item.href ? (
							<Link key={item.id} href={item.href} className="block transition hover:opacity-80">
								{row}
							</Link>
						) : (
							<div key={item.id}>{row}</div>
						);
					})
				)}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 2: Write the month page**

Create `src/app/portal/calendar/page.tsx`:
```tsx
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { CalendarMonth } from "@/components/calendar-month";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

export default async function CalendarPage({
	searchParams,
}: {
	searchParams: Promise<{ year?: string; month?: string }>;
}) {
	const actor = await requireActor();
	const params = await searchParams;
	const now = new Date();
	const year = Number(params.year) || now.getUTCFullYear();
	const month = Number(params.month) || now.getUTCMonth() + 1;

	const repositories = await getRepositories();
	const items = await repositories.calendar.getMonth(actor, { year, month });

	return (
		<main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
			<h1 className="mb-4 font-heading text-2xl">Calendar</h1>
			<CalendarMonth items={items} monthLabel={`${MONTH_NAMES[month - 1]} ${year}`} />
		</main>
	);
}
```

- [ ] **Step 3: Write the event detail page**

Create `src/app/portal/calendar/[eventId]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
	const actor = await requireActor();
	const { eventId } = await params;
	const repositories = await getRepositories();
	const event = await repositories.calendar.getEvent(actor, eventId);
	if (!event) notFound();

	return (
		<main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between gap-3">
						<CardTitle>{event.title}</CardTitle>
						<Badge variant={event.iAttended ? "default" : "secondary"}>
							{event.iAttended ? "Attended" : event.myRsvp === "going" ? "Going" : "Not going"}
						</Badge>
					</div>
					<CardDescription>
						{event.place} · {event.startsAt.toISOString().slice(0, 16).replace("T", " ")}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 text-sm">
					<p>{event.description}</p>
					<p className="text-muted-foreground">{event.attendingCount} attending</p>
				</CardContent>
			</Card>
		</main>
	);
}
```

Note on scope: RSVP/forum/media WRITE actions on this page (RSVP toggle, forum post, media upload) are Phase 4 deliverables (master-plan §12 Phase 4). This page renders the read-only detail Phase 7 owns (RSVP state, attendance count, media list). When Phase 4 lands its RSVP/forum/media server actions, they attach to this same route; do not stub them here.

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. If `badge` is not yet in `src/components/ui`, add it first with `pnpm dlx shadcn@latest add badge` and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/app/portal/calendar src/components/calendar-month.tsx
git commit -m "feat(calendar): add month view and event detail pages

Calendar is the sole events-discovery surface; clicking an event opens
its detail at /portal/calendar/[eventId].

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Retention contract types and term helpers

**Files:**
- Create: `src/db/contract/retention.ts`
- Modify: `src/db/contract/index.ts` (add the retention export)

**Interfaces:**
- Consumes: `operation` from `src/db/contract/common.ts`.
- Produces: `retentionContract.myHistory` operation (`auth: "member"`, `sharedDev: "allow"`), `retentionContract.myTerms` operation (`auth: "member"`, `sharedDev: "allow"`), and exported zod schemas `retentionRecordSchema`, `retentionSummarySchema`, `termOptionSchema`. Consumed by Task 5 (retention repository), Task 6 (history page), Task 8 (internal route).

- [ ] **Step 1: Write the retention contract**

Create `src/db/contract/retention.ts`:
```ts
import { z } from "zod";
import { operation } from "./common";

export const retentionRecordSchema = z.object({
	id: z.string(),
	termId: z.string(),
	eventId: z.string().nullable(),
	points: z.number().nullable(),
	reason: z.string(),
	source: z.enum(["event_attendance", "manual"]),
	recordedAt: z.coerce.date(),
});

export const retentionSummarySchema = z.object({
	termId: z.string(),
	termName: z.string(),
	totalPoints: z.number(),
	retainedAt: z.number(),
	probationBelow: z.number(),
	status: z.enum(["retained", "on_track", "probation"]),
	recordCount: z.number(),
});

export const termOptionSchema = z.object({
	id: z.string(),
	name: z.string(),
	isCurrent: z.boolean(),
});

export const retentionContract = {
	myHistory: operation({
		input: z.object({ termId: z.string().min(1).optional() }),
		output: z.object({
			summary: retentionSummarySchema.nullable(),
			records: z.array(retentionRecordSchema),
		}),
		auth: "member",
		sharedDev: "allow",
	}),
	myTerms: operation({
		input: z.object({}),
		output: z.object({ terms: z.array(termOptionSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
};
```

- [ ] **Step 2: Register the contract in the index**

Read `src/db/contract/index.ts` first, then add (matching the file's existing shape, as in Task 1 Step 6):
```ts
export { retentionContract } from "./retention";
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/db/contract/retention.ts src/db/contract/index.ts
git commit -m "feat(retention): add my-retention-history contract types

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Retention repository — per-member derived summary + history

**IMPORTANT — read before touching this file:** By the time this phase is implemented, `src/db/repositories/retention.ts` is no longer the v5-foundation stub. Phase 4 (CRS events) and Phase 5 (manual records) already populated it with `createRetentionRepository(db, audit): RetentionRepository` exporting `RetentionRecord` (a full `InferSelectModel<typeof retentionRecords>`, a superset of the narrow shape this task needs), `RetentionSummary` (a *different* shape than the one this task wants — `{ totalPoints, recordCount, retainedAt, probationBelow, status }`, no `termId`/`termName`), and methods `recordEventAttendance`, `listForMember`, `getMemberTermSummary`, `leaderboard`, `createManual`. A private `statusFor(totalPoints, retainedAt, probationBelow)` helper already exists in the file with the exact logic this task needs — reuse it, do not redeclare it. **Do not replace this file.** Read its current contents first, then ADD `myHistory` and `listTerms` as two more methods on the same returned object and the same `RetentionRepository` type. To avoid colliding with the already-exported `RetentionSummary` name, this task's per-term-with-name summary shape is named `MyHistorySummary` instead.

**Files:**
- Modify: `src/db/repositories/retention.ts` (add `myHistory` + `listTerms` to the existing exported object; do not remove or rename the four-or-five existing methods, and do not redeclare `statusFor` or `RetentionRecord`)
- Create: `src/db/repositories/retention.integration.test.ts` if it does not already exist from an earlier phase; otherwise add these test cases to the existing file rather than replacing it

**Interfaces:**
- Consumes: `retentionRecords`, `terms` from `@/db/schema`; `type Actor` from `@/server/auth/permissions`; the existing `RetentionRecord` and `statusFor` already in the file (do not redefine).
- Produces: `RetentionRepository` gains `myHistory(actor, input: { termId?: string }, now?: Date): Promise<{ summary: MyHistorySummary | null; records: RetentionRecord[] }>` and `listTerms(actor, now?: Date): Promise<TermOption[]>`. New exported types `MyHistorySummary`, `TermOption`. `createRetentionRepository(db, audit): RetentionRepository` signature is unchanged from Phase 4/5 — the `audit` parameter is simply unused by these two read-only methods. Consumed by Task 6 (page), Task 8 (internal route), Task 9 (repo index).

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

const me: Actor = { memberId: "mem_me", roles: ["member"] };
const NOW = Date.UTC(2026, 5, 19);

function makeRepo() {
	const d = drizzle(env.DB, { schema });
	return createRetentionRepository(d, createAuditRepository(d));
}

describe("retention repository on D1", () => {
	beforeEach(async () => {
		for (const table of ["retention_records", "terms", "members"]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_me", "me@example.com", "Me")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind("mem_other", "other@example.com", "Other")
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_now", "Current Term", 20, 10, Date.UTC(2026, 4, 1), Date.UTC(2026, 6, 30))
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind("term_past", "Past Term", 20, 10, Date.UTC(2025, 4, 1), Date.UTC(2025, 6, 30))
			.run();
		// my current-term records: 5 + null + (-2) = 3 net points
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("ret_1", "mem_me", "term_now", 5, "Attended", "event_attendance", "mem_other", NOW)
			.run();
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("ret_2", "mem_me", "term_now", null, "Waiver submitted", "manual", "mem_other", NOW)
			.run();
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("ret_3", "mem_me", "term_now", -2, "Violation", "manual", "mem_other", NOW)
			.run();
		// a past-term record that must not pollute the current total
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("ret_past", "mem_me", "term_past", 50, "Old points", "event_attendance", "mem_other", Date.UTC(2025, 5, 1))
			.run();
		// another member's record must never appear in mine
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("ret_other", "mem_other", "term_now", 99, "Theirs", "manual", "mem_me", NOW)
			.run();
	});

	it("summarizes the current term and excludes past-term and other members' records", async () => {
		const repo = makeRepo();
		const { summary, records } = await repo.myHistory(me, { termId: "term_now" }, new Date(NOW));
		expect(summary?.totalPoints).toBe(3);
		expect(summary?.recordCount).toBe(3);
		expect(summary?.status).toBe("on_track");
		expect(records.map((r) => r.id).sort()).toEqual(["ret_1", "ret_2", "ret_3"]);
	});

	it("flags probation when points fall below the threshold", async () => {
		await env.DB.prepare("DELETE FROM retention_records WHERE id IN ('ret_1','ret_2')").run();
		const repo = makeRepo();
		const { summary } = await repo.myHistory(me, { termId: "term_now" }, new Date(NOW));
		// only the -2 record remains -> below probation_below (10)
		expect(summary?.totalPoints).toBe(-2);
		expect(summary?.status).toBe("probation");
	});

	it("defaults to the current term when no termId is given", async () => {
		const repo = makeRepo();
		const { summary } = await repo.myHistory(me, {}, new Date(NOW));
		expect(summary?.termId).toBe("term_now");
	});

	it("lists the member's terms with the current one flagged", async () => {
		const repo = makeRepo();
		const terms = await repo.listTerms(me, new Date(NOW));
		const current = terms.find((t) => t.isCurrent);
		expect(current?.id).toBe("term_now");
		expect(terms.map((t) => t.id)).toContain("term_past");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- retention.integration.test.ts`
Expected: FAIL — `createRetentionRepository` takes no `db` and has no `myHistory`/`listTerms`.

- [ ] **Step 3: Add `myHistory` + `listTerms` to the existing `src/db/repositories/retention.ts`**

Open the file as it stands after Phase 4 (and Phase 5, if landed). It already has `import { and, desc, eq, ... } from "drizzle-orm"` — extend that import with `gte, lte` rather than duplicating the line. It already exports `RetentionRecord` (a full row type — a superset of what this task reads, so reuse it as-is) and a private `statusFor(totalPoints, retainedAt, probationBelow)` with the exact three-tier logic this task needs — reuse it, do not write a second copy. Make exactly these additions:

1. Add new types (these names do not collide with anything already in the file):

```ts
export type MyHistorySummary = {
	termId: string;
	termName: string;
	totalPoints: number;
	retainedAt: number;
	probationBelow: number;
	status: "retained" | "on_track" | "probation";
	recordCount: number;
};

export type TermOption = { id: string; name: string; isCurrent: boolean };
```

2. Add a new helper function (does not collide with the existing `statusFor`):

```ts
async function getCurrentTermId(db: Db, now: Date): Promise<string | null> {
	const [term] = await db
		.select({ id: terms.id })
		.from(terms)
		.where(and(lte(terms.startsAt, now), gte(terms.endsAt, now)))
		.orderBy(desc(terms.startsAt))
		.limit(1);
	return term?.id ?? null;
}
```

(`Db` here is the same loosely-typed `any` alias Phase 4 already declares in this file for its other methods — reuse it, do not introduce a second `RetentionDb`/`AnyDb` type.)

3. Extend the `RetentionRepository` type with two more method signatures, alongside the existing four-or-five:

```ts
	myHistory(
		actor: Actor,
		input: { termId?: string },
		now?: Date,
	): Promise<{ summary: MyHistorySummary | null; records: RetentionRecord[] }>;
	listTerms(actor: Actor, now?: Date): Promise<TermOption[]>;
```

4. Inside the object literal returned by `createRetentionRepository`, add `myHistory` and `listTerms` alongside the existing methods (the `audit` parameter already in scope from Phase 4/5 is simply unused here — that is expected, these are read-only):

```ts
		async myHistory(actor, input, now = new Date()) {
			const termId = input.termId ?? (await getCurrentTermId(db, now));
			if (!termId) return { summary: null, records: [] };

			const [term] = await db
				.select({ id: terms.id, name: terms.name, retainedAt: terms.retainedAt, probationBelow: terms.probationBelow })
				.from(terms)
				.where(eq(terms.id, termId))
				.limit(1);
			if (!term) return { summary: null, records: [] };

			const rows = await db
				.select()
				.from(retentionRecords)
				.where(and(eq(retentionRecords.memberId, actor.memberId), eq(retentionRecords.termId, termId)))
				.orderBy(desc(retentionRecords.recordedAt));

			const totalPoints = rows.reduce((sum: number, row: RetentionRecord) => sum + (row.points ?? 0), 0);
			const summary: MyHistorySummary = {
				termId: term.id,
				termName: term.name,
				totalPoints,
				retainedAt: term.retainedAt,
				probationBelow: term.probationBelow,
				status: statusFor(totalPoints, term.retainedAt, term.probationBelow),
				recordCount: rows.length,
			};
			return { summary, records: rows };
		},

		async listTerms(actor, now = new Date()) {
			const currentTermId = await getCurrentTermId(db, now);
			const rows = await db.select({ id: terms.id, name: terms.name }).from(terms).orderBy(desc(terms.startsAt));
			return rows.map((row: { id: string; name: string }) => ({
				id: row.id,
				name: row.name,
				isCurrent: row.id === currentTermId,
			}));
		},
```

`select()` (no column projection) on `retentionRecords` returns the full row shape, which matches the already-exported `RetentionRecord` type from Phase 4 — do not project a narrower column set, it would create a second incompatible "record" shape.

Note on authz: `myHistory`/`listTerms` are scoped by `actor.memberId` in the WHERE clause (a member reads only their own records), so they need no `can()` gate beyond being authenticated. This mirrors `members.getById`'s self-access path. An admin-facing per-member history is a separate Phase 8 reporting deliverable, not this method.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- retention.integration.test.ts`
Expected: PASS (all 4 new cases, plus every case from earlier phases still in this file).

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS. If `index.ts` errors about a missing `audit` argument to `createRetentionRepository`, Phase 4 has not actually landed yet — stop and resolve phase ordering before continuing; do not "fix" it by dropping the `audit` parameter.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/retention.ts src/db/repositories/retention.integration.test.ts
git commit -m "feat(retention): derive current-term summary and history per member

Adds myHistory and listTerms alongside the existing event-attendance
and manual-record methods. Total resets per term because every query
is keyed by term_id; points may be null or negative; status derives
from the term thresholds.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: My Retention History page — summary card, record list, term selector

**Files:**
- Create: `src/app/portal/events/page.tsx`
- Create: `src/components/retention-history.tsx`

**Interfaces:**
- Consumes: `getRepositories()` from `@/db`, `requireActor()` from `@/server/auth/actor`, `RetentionRepository.myHistory`/`listTerms` (Task 5), shadcn `card`/`select`/`badge` from `@/components/ui/*`.
- Produces: the `/portal/events` route (repurposed as "My Retention History"), with a `?termId=` query param driving the term selector. No exported types other phases consume.

- [ ] **Step 1: Write the history component (server-rendered, term selector via a GET form)**

Create `src/components/retention-history.tsx`:
```tsx
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RetentionRecord, RetentionSummary, TermOption } from "@/db/repositories/retention";

const STATUS_LABEL: Record<RetentionSummary["status"], string> = {
	retained: "Retained",
	on_track: "On track",
	probation: "Probation",
};

export function RetentionHistory({
	summary,
	records,
	terms,
	selectedTermId,
}: {
	summary: RetentionSummary | null;
	records: RetentionRecord[];
	terms: TermOption[];
	selectedTermId: string;
}) {
	return (
		<div className="flex flex-col gap-4">
			<form method="get" className="flex items-center gap-2">
				<label className="text-sm text-muted-foreground" htmlFor="termId">
					Term
				</label>
				<select
					id="termId"
					name="termId"
					defaultValue={selectedTermId}
					className="rounded-md border border-border bg-background px-2 py-1 text-sm"
				>
					{terms.map((term) => (
						<option key={term.id} value={term.id}>
							{term.name}
							{term.isCurrent ? " (current)" : ""}
						</option>
					))}
				</select>
				<button type="submit" className="rounded-md border border-border px-3 py-1 text-sm">
					View
				</button>
			</form>

			{summary ? (
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between gap-3">
							<CardTitle>{summary.termName}</CardTitle>
							<Badge variant={summary.status === "probation" ? "destructive" : "secondary"}>
								{STATUS_LABEL[summary.status]}
							</Badge>
						</div>
						<CardDescription>
							{summary.totalPoints} points · retained at {summary.retainedAt} · {summary.recordCount} records
						</CardDescription>
					</CardHeader>
				</Card>
			) : (
				<p className="text-sm text-muted-foreground">No retention data for this term yet.</p>
			)}

			<Card>
				<CardHeader>
					<CardTitle>Records</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					{records.length === 0 ? (
						<p className="text-sm text-muted-foreground">No records in this term.</p>
					) : (
						records.map((record) => (
							<div
								key={record.id}
								className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
							>
								<div className="flex flex-col">
									<span className="text-sm font-medium">{record.reason}</span>
									<span className="text-xs text-muted-foreground">
										{record.recordedAt.toISOString().slice(0, 10)} · {record.source === "event_attendance" ? "Event" : "Manual"}
									</span>
								</div>
								<span className="text-sm tabular-nums">{record.points ?? "n/a"}</span>
							</div>
						))
					)}
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 2: Write the page**

Create `src/app/portal/events/page.tsx`:
```tsx
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { RetentionHistory } from "@/components/retention-history";

export const dynamic = "force-dynamic";

export default async function RetentionHistoryPage({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string }>;
}) {
	const actor = await requireActor();
	const params = await searchParams;

	const repositories = await getRepositories();
	const terms = await repositories.retention.listTerms(actor);
	const { summary, records } = await repositories.retention.myHistory(actor, { termId: params.termId });
	const selectedTermId = summary?.termId ?? params.termId ?? terms.find((t) => t.isCurrent)?.id ?? "";

	return (
		<main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
			<h1 className="mb-4 font-heading text-2xl">My Retention History</h1>
			<RetentionHistory summary={summary} records={records} terms={terms} selectedTermId={selectedTermId} />
		</main>
	);
}
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. Add any missing shadcn component (`badge`) first if lint/typecheck flags a missing import.

- [ ] **Step 4: Commit**

```bash
git add src/app/portal/events/page.tsx src/components/retention-history.tsx
git commit -m "feat(retention): repurpose the events tab as My Retention History

Current-term summary card plus the full chronological record list and a
term selector, replacing the old events list.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Wire `notify()` into the event-approve and survey-assign triggers

**IMPORTANT — read before touching this file:** Phase 2 (Task 2) already owns `src/db/repositories/notifications.ts` in full: `NotificationsRepository` (`listFeed`/`unreadCount`/`markRead`/`markAllRead`), the `notify(db, input: NotifyInput)` writer, and the `NotificationKind`/`NotifyInput`/`FeedItem` types. **This task does not touch `notifications.ts` at all.** It only adds `notify(...)` call sites inside `events.ts` and `surveys.ts` at the moments those phases approve an event or assign a survey.

**Files:**
- Modify: `src/db/repositories/events.ts` (add a `notify(...)` call at the event-approve trigger, OR document the hook if Phase 4 has not built approve yet — see note)
- Modify: `src/db/repositories/surveys.ts` (add a `notify(...)` call at the assignment trigger, OR document the hook)

**Interfaces:**
- Consumes: `notify`, `type NotifyInput` from `./notifications` (Phase 2, already built).
- Produces: nothing new. This task is two call sites, not a contract change.

- [ ] **Step 1: Wire `notify(...)` into the event-approve trigger**

Open `src/db/repositories/events.ts`. If Phase 4 has implemented an approve method (e.g. `approve(actor, eventId)`), add, immediately after the event status update + `audit.record(...)` and before returning:
```ts
await notify(db, {
	memberId: event.createdBy,
	kind: "event_approved",
	title: "Event approved",
	body: `${event.title} is now on the calendar.`,
	href: `/portal/calendar/${event.id}`,
});
```
and add the import `import { notify } from "./notifications";` at the top.

If `events.ts` is still the empty stub (Phase 4 not yet landed), do NOT invent an approve method. Instead leave a single-line code comment at the top of the stub recording the obligation, and surface it to the reviewer:
```ts
// Phase 7 trigger: when Phase 4 adds the event-approve path, call
// notify(db, { memberId: event.createdBy, kind: "event_approved", ... }).
```

- [ ] **Step 2: Wire `notify(...)` into the survey-assignment trigger**

Open `src/db/repositories/surveys.ts`. If Phase 6 has implemented the sample/assign method, add a `notify(db, { memberId, kind: "survey_assigned", title: "Survey assigned", body: "You were selected for a survey.", href: "/portal/surveys/" + surveyId })` call for each newly inserted assignment, and import `notify` from `./notifications`. If `surveys.ts` is still the empty stub, leave the same kind of single-line obligation comment instead and surface it to the reviewer.

Note on the forum-reply and points-awarded triggers: the forum-reply `notify(...)` call belongs in Phase 4's forum-post write path (notify the parent post's author), and the points-awarded `notify(...)` call belongs in Phase 4/5's `retentionRecords` insert path (notify the member the points went to). Those repositories are owned by Phase 4/5; they import `notify` from Phase 2's `./notifications` directly. Where those write paths do not exist yet, record the obligation as a one-line comment in the relevant stub and surface it to the reviewer rather than inventing the Phase 4/5 signature.

- [ ] **Step 3: Run typecheck, lint, and the existing notifications test**

Run: `pnpm typecheck && pnpm lint && pnpm test -- notifications.integration.test.ts`
Expected: all PASS. (The notifications test suite is Phase 2's; this task does not add to it because it makes no contract change.)

- [ ] **Step 4: Commit**

```bash
git add src/db/repositories/events.ts src/db/repositories/surveys.ts
git commit -m "feat(notifications): wire notify() into event-approve and survey-assign

Calls Phase 2's notify() at the two trigger points this phase owns.
The forum-reply and points-awarded triggers are Phase 4/5's call sites
into the same function.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Internal routes for calendar, retention, notifications (shared-dev parity)

**Files:**
- Create: `src/server/internal/calendar.ts`
- Create: `src/server/internal/retention.ts`
- Create: `src/server/internal/notifications.ts`
- Create: `src/app/internal/calendar/route.ts`
- Create: `src/app/internal/retention/route.ts`
- Create: `src/app/internal/notifications/route.ts`

**Interfaces:**
- Consumes: `calendarContract` (Task 1), `retentionContract` (Task 4), the three repositories (Tasks 2, 5, 7); `resolveSharedActor` from `@/server/internal/shared-actor`; `getInternalCorsHeaders` from `@/server/internal/cors`; the `DeployEnv` guard pattern from `src/server/internal/members.ts`.
- Produces: `/internal/calendar`, `/internal/retention`, `/internal/notifications` GET endpoints, each `DEPLOY_ENV==='dev'`-guarded, bearer-token-authenticated, CORS-allowlisted, returning the contract-validated output. These keep shared-mode parity for the new read paths.

- [ ] **Step 1: Read the reference handler and route**

Read `src/server/internal/members.ts` (the handler factory pattern, already in context) and locate the matching `src/app/internal/members/route.ts` to copy its wiring:
```bash
ls src/app/internal
```
Match whatever route file shape the members route uses (it constructs the handler with `db`, `deployEnv`, `allowedOrigins` from env and calls `.fetch(request)`).

- [ ] **Step 2: Write `src/server/internal/calendar.ts`**

```ts
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { calendarContract } from "@/db/contract/calendar";
import { createCalendarRepository } from "@/db/repositories/calendar";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type Dependencies = { db: DrizzleD1Database<typeof schema>; deployEnv: DeployEnv; allowedOrigins?: string[] };

export function createCalendarInternalHandlers({ db, deployEnv, allowedOrigins = [] }: Dependencies) {
	const repository = createCalendarRepository(db);
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
				if (request.method === "GET") {
					const url = new URL(request.url);
					const eventId = url.searchParams.get("eventId");
					if (eventId) {
						const input = calendarContract.getEvent.input.parse({ eventId });
						const event = await repository.getEvent(actor, input.eventId);
						const output = calendarContract.getEvent.output.parse({ event });
						return Response.json(output, { status: event ? 200 : 404, headers: responseHeaders });
					}
					const input = calendarContract.getMonth.input.parse({
						year: Number(url.searchParams.get("year")),
						month: Number(url.searchParams.get("month")),
					});
					const items = await repository.getMonth(actor, input);
					const output = calendarContract.getMonth.output.parse({ items });
					return Response.json(output, { headers: responseHeaders });
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

- [ ] **Step 3: Write `src/server/internal/retention.ts`**

Mirror Step 2's structure with the retention repository and `retentionContract`. GET with no params returns `myHistory(actor, {})`; GET with `?termId=` returns `myHistory(actor, { termId })`; GET `?terms=1` returns `listTerms(actor)` shaped as `{ terms }` via `retentionContract.myTerms.output.parse(...)`:
```ts
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { retentionContract } from "@/db/contract/retention";
import { createRetentionRepository } from "@/db/repositories/retention";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type Dependencies = { db: DrizzleD1Database<typeof schema>; deployEnv: DeployEnv; allowedOrigins?: string[] };

export function createRetentionInternalHandlers({ db, deployEnv, allowedOrigins = [] }: Dependencies) {
	const repository = createRetentionRepository(db);
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
				if (request.method === "GET") {
					const url = new URL(request.url);
					if (url.searchParams.get("terms")) {
						const terms = await repository.listTerms(actor);
						const output = retentionContract.myTerms.output.parse({ terms });
						return Response.json(output, { headers: responseHeaders });
					}
					const input = retentionContract.myHistory.input.parse({
						termId: url.searchParams.get("termId") ?? undefined,
					});
					const result = await repository.myHistory(actor, input);
					const output = retentionContract.myHistory.output.parse(result);
					return Response.json(output, { headers: responseHeaders });
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

- [ ] **Step 4: Write `src/server/internal/notifications.ts`**

Mirror the same structure with the notifications repository. GET returns `{ ...derive(actor) }` merged with `{ notifications: await list(actor) }`. There is no `notify`/materialize over the proxy (materialize is a server-internal side effect, never a shared-dev op):
```ts
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "@/db/schema";
import { createNotificationsRepository } from "@/db/repositories/notifications";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type Dependencies = { db: DrizzleD1Database<typeof schema>; deployEnv: DeployEnv; allowedOrigins?: string[] };

const outputSchema = z.object({
	unread: z.number(),
	surveyPending: z.number(),
	eventsNew: z.number(),
	notifications: z.array(
		z.object({
			id: z.string(),
			kind: z.string(),
			title: z.string(),
			body: z.string(),
			href: z.string().nullable(),
			readAt: z.coerce.date().nullable(),
			createdAt: z.coerce.date(),
		}),
	),
});

export function createNotificationsInternalHandlers({ db, deployEnv, allowedOrigins = [] }: Dependencies) {
	const repository = createNotificationsRepository(db);
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
				if (request.method === "GET") {
					const counts = await repository.derive(actor);
					const notifications = await repository.list(actor);
					return Response.json(outputSchema.parse({ ...counts, notifications }), { headers: responseHeaders });
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

- [ ] **Step 5: Write the three App Router route files**

Open `src/app/internal/members/route.ts` and copy its exact wiring (how it reads `getDb()`/`env`, `DEPLOY_ENV`, and the CORS allowlist) into three new files, swapping the handler factory:
- `src/app/internal/calendar/route.ts` → `createCalendarInternalHandlers`
- `src/app/internal/retention/route.ts` → `createRetentionInternalHandlers`
- `src/app/internal/notifications/route.ts` → `createNotificationsInternalHandlers`

Each exports `GET` (and `OPTIONS` if the members route does) delegating to the handler's `.fetch(request)`. Do not introduce a new wiring style; match the members route so the `DEPLOY_ENV` guard and env access stay identical.

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/internal/calendar.ts src/server/internal/retention.ts src/server/internal/notifications.ts src/app/internal/calendar src/app/internal/retention src/app/internal/notifications
git commit -m "feat(internal): add calendar, retention, and notifications shared-dev routes

DEPLOY_ENV=dev guarded, bearer-authenticated, CORS-allowlisted read
endpoints keep shared-mode parity for the new derived surfaces.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Wire repositories into the index, full suite, dev-Worker redeploy

**Files:**
- Modify: `src/db/repositories/index.ts` (pass `db` to the three repositories now that they take it)

**Interfaces:**
- Consumes: `createCalendarRepository`, `createRetentionRepository`, `createNotificationsRepository` (now taking `db`).
- Produces: `Repositories.calendar`/`.retention`/`.notifications` backed by the live Drizzle handle in `local`/`production`, so the pages in Tasks 3 and 6 resolve real data through `getRepositories()`.

- [ ] **Step 1: Update `createDrizzleRepositories` to pass `db`**

In `src/db/repositories/index.ts`, change the three stub calls inside `createDrizzleRepositories(db)`:
```ts
		events: createEventsRepository(),
		retention: createRetentionRepository(),
```
to:
```ts
		events: createEventsRepository(),
		retention: createRetentionRepository(db),
```
and:
```ts
		notifications: createNotificationsRepository(),
		calendar: createCalendarRepository(),
```
to:
```ts
		notifications: createNotificationsRepository(db),
		calendar: createCalendarRepository(db),
```
(Leave `events` and the others Phase 4 owns as-is.)

- [ ] **Step 2: Update `createSharedRepositories` to keep the shape**

The `shared` branch returns the same `Repositories` shape but is backed by the HTTP adapter, not the Drizzle handle. For the three Phase 7 repositories, the shared path should proxy to the `/internal` routes from Task 8. If the existing `createSharedRepositories` does not yet have an HTTP-backed implementation for these three (it currently passes the stubs), keep them assignable by giving `createSharedRepositories` an HTTP-backed object literal for `calendar`/`retention`/`notifications` that calls the Task 8 endpoints through the `DatabaseAdapter`'s fetch surface, mirroring how `members` is proxied there. If that adapter surface does not exist for these domains yet, leave the three as the no-arg stubs in the shared branch ONLY and add a one-line comment that shared-mode parity for these reads lands with the adapter wiring, surfacing it to the reviewer. The `local`/`production` path (Step 1) is the one the Phase 7 pages exercise.

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. The `Repositories` type derives from `createDrizzleRepositories`, so the shared branch must stay structurally assignable; if it errors, the shared branch's three entries do not match the new method shapes. Reconcile per Step 2.

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: PASS — includes `calendar.test.ts`, `calendar.integration.test.ts`, `retention.integration.test.ts`, `notifications.integration.test.ts` (Phase 7), plus the existing `members.integration.test.ts`, `permissions.test.ts`, `roster.integration.test.ts`, and `shared-parity.integration.test.ts`, all against the migrated schema via `vitest.config.mts`.

- [ ] **Step 5: Run typecheck, lint, and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS (OpenNext build clean).

- [ ] **Step 6: Update the graph**

Run: `graphify update .`
Expected: completes (AST-only, no API cost) so the knowledge graph reflects the new repositories, contract, and routes.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories/index.ts
git commit -m "feat(db): back calendar, retention, and notifications repositories with the live handle

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 8: STOP — surface the dev-Worker redeploy obligation, do not run it without approval**

Per CLAUDE.md and master-plan §15 trigger 2 (internal contract + repository signatures used over the proxy changed), the dev Worker must be redeployed so shared-mode developers see the new `/internal/calendar`, `/internal/retention`, and `/internal/notifications` routes. No schema changed this phase, so no `db:migrate:dev` is needed. Present this command to the user and wait for explicit approval before running:
```bash
pnpm deploy:dev
```

---

## Self-review notes (for the implementer, not a step to execute)

- **Spec coverage:** master-plan §12 Phase 7 lists four deliverables, each mapped to a task: (1) derived calendar with the §6 contract (announcement source removed) as the sole events-discovery surface → Tasks 1-3; (2) event detail at `/portal/calendar/[eventId]` → Task 3 + Task 2's `getEvent`; (3) the repurposed "Events" tab as My Retention History (current-term summary card + full record list + term selector) → Tasks 4-6; (4) notification derive+materialize on approve/assign/reply/points-awarded → Task 7. §6's calendar contract (approved events + public birthdays + term deadlines, birthday privacy enforced) is Task 2. §6's notifications hybrid (materialize only per-member events; derive survey/event-availability from `memberFeedState` without fan-out) is Task 7. §15's redeploy obligation is Task 9 Step 8 (gated).
- **Dependency honesty:** Phase 7 depends on Phase 4 (events/retention tables + write paths) and Phase 2 (notifications module / portal shell). The tables exist from the v5 foundation migration, so the read/derive logic (Tasks 2, 5, 7) stands alone and is fully testable. The two event-side `notify(...)` triggers (event-approved, points-awarded) and the forum-reply trigger live in Phase 4's write paths; Task 7 wires them where those paths exist and records a one-line obligation comment (surfaced to the reviewer) where they do not, rather than inventing Phase 4 signatures. This is the explicit dependency the prompt asked to call out.
- **No schema change:** Phase 7 reads only tables already present in `src/db/schema.ts` (confirmed against the file: `crsEvents`, `eventRsvps`, `crsAttendance`, `eventMedia`, `eventForumPosts`, `retentionRecords`, `terms`, `members`, `notifications`, `memberFeedState`, `surveyAssignments`). No `db:generate`, no migration, no `db:migrate:dev`. The only deploy obligation is `deploy:dev` for the new internal routes/contract.
- **D1 budget:** the calendar query is date-bounded to one half-open month per source and each source has a backing index (`crs_events_starts_at_idx`, `members` full scan is acceptable at org scale but is the one to watch — flagged for a future birthday-month index if the member table grows; `terms_starts_ends_idx`). Retention queries are keyed by `(member_id, term_id)` via `retention_records_member_term_idx`. Notification derivation uses `notifications_member_read_created_idx` and `survey_assignments_member_id_idx`, and never fans out per-member rows.
- **Authorization:** calendar `getMonth` enforces birthday privacy via `can(actor, "member:manage")` inside the contract; retention `myHistory`/`listTerms` are self-scoped by `actor.memberId` (no extra gate, mirroring `members.getById` self-access); `notify(...)` is an unaudited system side effect of an already-audited action, consistent with master-plan §6's "materialize only per-member events." No new `permissions.ts` actions are required by Phase 7.
- **Placeholder scan:** every code step contains complete code; test steps contain full assertions; the two genuinely-conditional steps (Task 7 Steps 5-6 and Task 9 Step 2) give exact code for the "path exists" case and an exact one-line comment for the "Phase 4/adapter not landed" case, with an explicit instruction to surface the gap rather than fabricate a signature. This is a real cross-phase dependency, not a deferred detail.
- **Type consistency:** `CalendarItem` (Task 1) is the single shape returned by `getMonth` (Task 2) and consumed by the page (Task 3). `EventDetail` (Task 2) matches `eventDetailSchema` (Task 1). `RetentionRecord`/`RetentionSummary`/`TermOption` (Task 5) match the contract schemas (Task 4) and the page props (Task 6). `NotifyInput`/`MaterializedNotification` (Task 7) match the internal route's output schema (Task 8). The repository constructors all take `db` after Task 9, matching the index wiring.
