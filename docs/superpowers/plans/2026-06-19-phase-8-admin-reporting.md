# Phase 8 — Admin, Reporting, Nav/Quick Links, Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CODE Portal admin module under `/portal/admin`: the three xlsx retention exports (per-member full-year history, per-event roster, whole-term master), the per-term member-roster admin screen, the admin-pinned nav-links screen, and the dashboard Quick Links CMS — each gated by the `roster:manage` / `nav:configure` / `retention:record` permission actions already present in `src/server/auth/permissions.ts`.

**Architecture:** Schema-and-repository-first, then routes/UI. New repository modules (`retention.ts` filled in, `navPins.ts`, `quickLinks.ts`, `roster.ts`) follow the existing `members` repository pattern exactly: pure async functions over a Drizzle handle that take an explicit `actor`, call `permissions.can()` before every privileged read/write, and call `audit.record()` after every privileged write. Reporting is read-only query views over `retentionRecords` + `crsEvents`/`eventRsvps`/`crsAttendance`/`members`/`terms`, serialized to xlsx by a small server-side helper and streamed from a same-origin admin download route. Admin screens are server components gated by a new `/portal/admin` layout; mutations run through server actions that call the repositories through `getRepositories()`.

**Tech Stack:** Next.js 16 App Router (server components + server actions), Drizzle ORM (SQLite/D1), Auth.js v5 actor via `getActor()`/`requireActor()`, Zod, the `xlsx` (SheetJS) package for workbook generation, shadcn/ui local registry (`src/components/ui`) + Tailwind CSS v4, Vitest + `@cloudflare/vitest-pool-workers` (D1 integration harness auto-applies `drizzle/migrations`).

## Global Constraints

- Keep `/` public and reader-first; the member workspace and admin live under `/portal` and `/portal/admin` (CLAUDE.md, master-plan §1). Admin is a module inside the signed-in workspace, not a separate top-level brand (master-plan Global Constraints).
- Drizzle schema at `src/db/schema.ts` is the ONE source of truth; one migration set under `drizzle/migrations`. No second migration tree (CLAUDE.md, master-plan Global Constraints). Phase 8 adds NO new tables or columns — `navPins`, `quickLinks`, `termMemberRoster`, `retentionRecords` already exist from the v5 foundation migration.
- Do not expose D1 as `DATABASE_URL`. Do not add raw SQL internal endpoints (CLAUDE.md).
- Every mutation and every admin read is authorization-checked server-side via the SAME `permissions.can()` regardless of access mode; checks live in the repository/service layer (master-plan §3.2, §5). Every successful admin mutation writes an `audit.record(...)` row (master-plan §5).
- `roster:manage` and `nav:configure` live under the `member_admin` role; `retention:record` (used for reporting reads) lives under the `retention` role. These are already wired in `src/server/auth/permissions.ts` (do not edit role/action lists in this phase).
- Mutating `/api/*` route handlers (cookie-authenticated, same-origin) MUST call `assertSameOrigin(request, config.APP_BASE_URL)` and return 403 on failure (master-plan §4.5; pattern in `src/app/api/uploads/route.ts`). Server actions are same-origin by Next's design; mutations in this phase use server actions, so the only new `/api/*` handler is the xlsx download (GET), which still asserts an authenticated admin actor.
- All repository queries respect the D1 budget: no unbounded `SELECT`; list endpoints paginate or cap with a sane max; every query has a backing index (master-plan §3.4). The reporting queries are bounded by `term_id` / `event_id` / `member_id`, all of which are indexed (master-plan §6).
- UI is built from the shadcn/ui local registry wherever one fits; add official components with `pnpm dlx shadcn@latest add <component>` and theme via the `globals.css` design tokens. Style with Tailwind v4 utility classes only; no CSS-in-JS, no ad-hoc global CSS. Cards stay shallow (no cards inside cards). (master-plan Global Constraints.)
- Minimalism (master-plan §31, §14 v5): favor one well-organized admin screen over scattering controls. The reporting, roster, nav-pins, and quick-links screens are each a single page; nav pins render as Menu-sheet rows / extra desktop nav items, never new fixed bottom-nav icons (the actual nav rendering is Phase 2 work; this phase only manages the data).
- Brand: headings Unna (`font-heading`), body Source Sans; navy `#06192F`, blue `#0C315C`, light blue `#D7DFE9`. No em dashes in UI copy, code comments, docs, or commits. Plain product language. Light + dark themes via existing tokens.
- Show the exact `pnpm exec wrangler` / `pnpm db:*` / `pnpm dlx` command and wait for approval before any dependency install, D1 reset, migration, seed, delete, or production-touching operation (CLAUDE.md). Phase 8 adds no migration, but the `xlsx` install (Task 1) and the dev-Worker redeploy (final task) are approval-gated.
- After changing internal contracts, permissions, or shared dev seed data, redeploy the dev Worker (`pnpm db:migrate:dev` then `pnpm deploy:dev`) per CLAUDE.md and master-plan §15. Phase 8 changes no schema/permissions/contract that the shared proxy depends on for its existing ops, but it does add new contract operations and seed rows, so the final task surfaces the redeploy obligation (approval-gated).

---

### Task 1: Add the xlsx dependency and the shared admin authorization helper

**Files:**
- Modify: `package.json` (add the `xlsx` dependency)
- Create: `src/server/auth/admin.ts`
- Create: `src/server/auth/admin.test.ts`

**Interfaces:**
- Produces: `xlsx` available for import as `import * as XLSX from "xlsx"`. `hasAnyAdminScope(actor: Actor | null): boolean` and `assertAdminScope(actor: Actor | null): Actor` from `src/server/auth/admin.ts` — consumed by the admin layout (Task 8) and every admin screen/server action in this plan.

- [ ] **Step 1: STOP — show the exact install command and wait for approval**

Per CLAUDE.md, do not install a dependency without approval. Present this command and wait:
```bash
pnpm add xlsx@0.18.5
```
Rationale: `xlsx` (SheetJS community build) is pure JavaScript with no Node `fs`/native bindings, so it runs in the Workers runtime. It produces a workbook as an in-memory `Uint8Array` via `XLSX.write(wb, { type: "array", bookType: "xlsx" })`, which the download route (Task 7) returns directly. Pinned to `0.18.5` (the last npm-registry community release) for a reproducible install.

- [ ] **Step 2: After approval, run the install and confirm the dependency landed**

Run: `pnpm add xlsx@0.18.5`
Expected: `package.json` `dependencies` now lists `"xlsx": "0.18.5"` (or `^0.18.5`); `pnpm-lock.yaml` updated; no build errors.

- [ ] **Step 3: Write the failing test for the admin-scope helper**

Create `src/server/auth/admin.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Actor } from "./permissions";
import { assertAdminScope, hasAnyAdminScope } from "./admin";

const memberOnly: Actor = { memberId: "m1", roles: ["member"] };
const rosterAdmin: Actor = { memberId: "m2", roles: ["member", "member_admin"] };
const retentionAdmin: Actor = { memberId: "m3", roles: ["member", "retention"] };
const linkAdmin: Actor = { memberId: "m4", roles: ["member", "link"] };
const superAdmin: Actor = { memberId: "m5", roles: ["super"] };

describe("hasAnyAdminScope", () => {
	it("denies a null actor and a base member", () => {
		expect(hasAnyAdminScope(null)).toBe(false);
		expect(hasAnyAdminScope(memberOnly)).toBe(false);
	});

	it("allows any actor holding at least one admin-capable scope", () => {
		expect(hasAnyAdminScope(rosterAdmin)).toBe(true);
		expect(hasAnyAdminScope(retentionAdmin)).toBe(true);
		expect(hasAnyAdminScope(linkAdmin)).toBe(true);
		expect(hasAnyAdminScope(superAdmin)).toBe(true);
	});
});

describe("assertAdminScope", () => {
	it("returns the actor when an admin scope is present", () => {
		expect(assertAdminScope(rosterAdmin)).toBe(rosterAdmin);
	});

	it("throws for a base member or null actor", () => {
		expect(() => assertAdminScope(memberOnly)).toThrow("Not authorized");
		expect(() => assertAdminScope(null)).toThrow("Not authorized");
	});
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test -- admin.test.ts`
Expected: FAIL — `./admin` does not exist yet.

- [ ] **Step 5: Write `src/server/auth/admin.ts`**

```ts
import type { Actor } from "./permissions";
import { can, permissionActions } from "./permissions";

/**
 * True when the actor holds at least one permission action, i.e. any elevated
 * scope (super, or any role with a non-empty permission set). Used by the
 * /portal/admin layout to decide whether to render the admin module at all;
 * per-screen access is still gated by the specific action via can().
 */
export function hasAnyAdminScope(actor: Actor | null): boolean {
	if (!actor) return false;
	return permissionActions.some((action) => can(actor, action));
}

export function assertAdminScope(actor: Actor | null): Actor {
	if (!actor || !hasAnyAdminScope(actor)) {
		throw new Error("Not authorized to access the admin module.");
	}
	return actor;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- admin.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add package.json pnpm-lock.yaml src/server/auth/admin.ts src/server/auth/admin.test.ts
git commit -m "feat(admin): add xlsx dependency and shared admin-scope helper"
```

---

### Task 2: Nav pins repository — CRUD with actor authz and audit

**Files:**
- Create: `src/db/repositories/navPins.ts`
- Create: `src/db/repositories/navPins.integration.test.ts`
- Modify: `src/db/repositories/index.ts` (full file — register `navPins`)

**Interfaces:**
- Consumes: `navPins` table from `@/db/schema`; `Actor` + `can` from `@/server/auth/permissions`; `AuditRepository` from `./audit`; `createId` from `@/lib/ids`.
- Produces: `createNavPinsRepository(db: NavPinDb, audit: AuditRepository): NavPinsRepository` with `list(actor)`, `create(actor, input)`, `update(actor, id, input)`, `remove(actor, id)`. `NavPinInput = { label: string; url: string; icon: string; position: number }`. `Repositories.navPins` added to both repository factories. Tasks 4 (contract), 5 (server actions), 8 (UI) consume this exact shape.

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/navPins.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createNavPinsRepository } from "./navPins";

const navAdmin: Actor = { memberId: "mem_nav_admin", roles: ["member", "member_admin"] };
const member: Actor = { memberId: "mem_plain", roles: ["member"] };

async function seedMember(id: string, email: string) {
	await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)").bind(id, email, id).run();
}

describe("nav pins repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM nav_pins").run();
		await env.DB.prepare("DELETE FROM members").run();
		await seedMember(navAdmin.memberId, "nav@example.com");
	});

	it("lets a member_admin create, list, update, and remove a pin, auditing writes", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createNavPinsRepository(db, createAuditRepository(db));

		const created = await repository.create(navAdmin, {
			label: "Masterfile",
			url: "https://example.com/masterfile",
			icon: "file-spreadsheet",
			position: 1,
		});
		expect(created.label).toBe("Masterfile");

		const updated = await repository.update(navAdmin, created.id, {
			label: "Org Masterfile",
			url: "https://example.com/masterfile",
			icon: "file-spreadsheet",
			position: 2,
		});
		expect(updated.label).toBe("Org Masterfile");
		expect(updated.position).toBe(2);

		const listed = await repository.list(navAdmin);
		expect(listed.map((pin) => pin.id)).toContain(created.id);

		await repository.remove(navAdmin, created.id);
		const afterRemove = await repository.list(navAdmin);
		expect(afterRemove.map((pin) => pin.id)).not.toContain(created.id);

		const audits = await db.select().from(auditLogs);
		expect(audits.map((row) => row.action)).toEqual(
			expect.arrayContaining(["nav_pin:create", "nav_pin:update", "nav_pin:delete"]),
		);
		expect(audits.every((row) => row.category === "member")).toBe(true);
	});

	it("rejects a plain member from listing or mutating pins", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createNavPinsRepository(db, createAuditRepository(db));

		await expect(repository.list(member)).rejects.toThrow("Not authorized");
		await expect(
			repository.create(member, { label: "x", url: "https://x.test", icon: "link", position: 1 }),
		).rejects.toThrow("Not authorized");
	});

	it("returns pins ordered by ascending position", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createNavPinsRepository(db, createAuditRepository(db));
		await repository.create(navAdmin, { label: "B", url: "https://b.test", icon: "link", position: 2 });
		await repository.create(navAdmin, { label: "A", url: "https://a.test", icon: "link", position: 1 });

		const listed = await repository.list(navAdmin);
		expect(listed.map((pin) => pin.label)).toEqual(["A", "B"]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- navPins.integration.test.ts`
Expected: FAIL — `./navPins` does not exist yet.

- [ ] **Step 3: Write `src/db/repositories/navPins.ts`**

```ts
import { asc, eq } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { navPins } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

export type NavPin = InferSelectModel<typeof navPins>;
type NavPinInsert = InferInsertModel<typeof navPins>;

export type NavPinInput = {
	label: string;
	url: string;
	icon: string;
	position: number;
};

export type NavPinDb = {
	select(): {
		from(table: typeof navPins): {
			orderBy(column: unknown): Promise<NavPin[]> | NavPin[];
			where(condition: unknown): { limit(limit: number): Promise<NavPin[]> | NavPin[] };
		};
	};
	insert(table: typeof navPins): { values(value: NavPinInsert): { returning(): Promise<NavPin[]> | NavPin[] } };
	update(table: typeof navPins): {
		set(value: Partial<NavPinInsert>): { where(condition: unknown): { returning(): Promise<NavPin[]> | NavPin[] } };
	};
	delete(table: typeof navPins): { where(condition: unknown): Promise<unknown> | { then: Promise<unknown>["then"] } };
};

export type NavPinsRepository = {
	list(actor: Actor): Promise<NavPin[]>;
	create(actor: Actor, input: NavPinInput): Promise<NavPin>;
	update(actor: Actor, id: string, input: NavPinInput): Promise<NavPin>;
	remove(actor: Actor, id: string): Promise<void>;
};

export function createNavPinsRepository(db: NavPinDb, audit: AuditRepository): NavPinsRepository {
	return {
		async list(actor) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to list nav pins.");
			}
			return db.select().from(navPins).orderBy(asc(navPins.position));
		},
		async create(actor, input) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to create nav pins.");
			}
			const [pin] = await db
				.insert(navPins)
				.values({
					id: createId("nav"),
					label: input.label,
					url: input.url,
					icon: input.icon,
					position: input.position,
					createdBy: actor.memberId,
				})
				.returning();
			await audit.record(actor, {
				action: "nav_pin:create",
				targetType: "nav_pin",
				targetId: pin.id,
				category: "member",
			});
			return pin;
		},
		async update(actor, id, input) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to update nav pins.");
			}
			const [pin] = await db
				.update(navPins)
				.set({
					label: input.label,
					url: input.url,
					icon: input.icon,
					position: input.position,
					updatedAt: new Date(),
				})
				.where(eq(navPins.id, id))
				.returning();
			if (!pin) {
				throw new Error("Nav pin not found.");
			}
			await audit.record(actor, {
				action: "nav_pin:update",
				targetType: "nav_pin",
				targetId: pin.id,
				category: "member",
			});
			return pin;
		},
		async remove(actor, id) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to remove nav pins.");
			}
			await db.delete(navPins).where(eq(navPins.id, id));
			await audit.record(actor, {
				action: "nav_pin:delete",
				targetType: "nav_pin",
				targetId: id,
				category: "member",
			});
		},
	};
}
```

- [ ] **Step 4: Register the repository in `src/db/repositories/index.ts`**

Replace `src/db/repositories/index.ts` in full:
```ts
import { createAuditRepository, createUnavailableAuditRepository } from "./audit";
import { createCalendarRepository } from "./calendar";
import { createEventsRepository } from "./events";
import { createLinksRepository } from "./links";
import { createMembersRepository } from "./members";
import { createNavPinsRepository } from "./navPins";
import { createNotificationsRepository } from "./notifications";
import { createQuickLinksRepository } from "./quickLinks";
import { createRetentionRepository } from "./retention";
import { createRosterRepository } from "./roster";
import { createSessionsRepository } from "./sessions";
import { createSurveysRepository } from "./surveys";
import type { MemberDb } from "./members";
import type { AuditDb } from "./audit";
import type { NavPinDb } from "./navPins";
import type { QuickLinkDb } from "./quickLinks";
import type { RetentionDb } from "./retention";
import type { RosterDb } from "./roster";
import type { DatabaseAdapter } from "../types";

type DrizzleDb = MemberDb & AuditDb & NavPinDb & QuickLinkDb & RosterDb & RetentionDb;

export function createDrizzleRepositories(db: DrizzleDb) {
	const audit = createAuditRepository(db);
	return {
		members: createMembersRepository(db, audit),
		sessions: createSessionsRepository(),
		links: createLinksRepository(),
		events: createEventsRepository(),
		retention: createRetentionRepository(db),
		navPins: createNavPinsRepository(db, audit),
		quickLinks: createQuickLinksRepository(db, audit),
		roster: createRosterRepository(db, audit),
		surveys: createSurveysRepository(),
		notifications: createNotificationsRepository(),
		calendar: createCalendarRepository(),
		audit,
	};
}

export type Repositories = ReturnType<typeof createDrizzleRepositories>;

export function createSharedRepositories(adapter: DatabaseAdapter): Repositories {
	const audit = createUnavailableAuditRepository();
	const unavailable = () => {
		throw new Error("This repository is unavailable through the shared API adapter.");
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
		events: createEventsRepository(),
		retention: { listForTerm: unavailable, listMemberTermHistory: unavailable, listForEvent: unavailable },
		navPins: { list: unavailable, create: unavailable, update: unavailable, remove: unavailable },
		quickLinks: { list: unavailable, create: unavailable, update: unavailable, remove: unavailable },
		roster: { listForTerm: unavailable, add: unavailable, remove: unavailable },
		surveys: createSurveysRepository(),
		notifications: createNotificationsRepository(),
		calendar: createCalendarRepository(),
		audit,
	};
}
```

Note: this file imports `createQuickLinksRepository`, `createRosterRepository`, and the updated `createRetentionRepository` which do not exist until Tasks 3, 6, and 7. Typecheck will fail until those land; that is expected and is resolved at the end of Task 7. Run the navPins test in isolation now (it imports `./navPins` directly, not the index).

- [ ] **Step 5: Run the nav pins test to verify it passes**

Run: `pnpm test -- navPins.integration.test.ts`
Expected: PASS (all 3 cases). (`pnpm typecheck` will still fail project-wide until Tasks 3/6/7 add the other repos — do not run it yet.)

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/navPins.ts src/db/repositories/navPins.integration.test.ts src/db/repositories/index.ts
git commit -m "feat(repo): add nav pins repository with actor authz and audit"
```

---

### Task 3: Quick links repository — CRUD with actor authz and audit

**Files:**
- Create: `src/db/repositories/quickLinks.ts`
- Create: `src/db/repositories/quickLinks.integration.test.ts`

**Interfaces:**
- Consumes: `quickLinks` table from `@/db/schema`; `Actor` + `can` from `@/server/auth/permissions`; `AuditRepository`; `createId`.
- Produces: `createQuickLinksRepository(db: QuickLinkDb, audit: AuditRepository): QuickLinksRepository` with `list(actor)`, `create(actor, input)`, `update(actor, id, input)`, `remove(actor, id)`. `QuickLinkInput = { label: string; url: string; position: number }`. Already referenced by Task 2's `index.ts`. Tasks 4/5/8 consume this shape.

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/quickLinks.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createQuickLinksRepository } from "./quickLinks";

const navAdmin: Actor = { memberId: "mem_ql_admin", roles: ["member", "member_admin"] };
const member: Actor = { memberId: "mem_plain", roles: ["member"] };

describe("quick links repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM quick_links").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(navAdmin.memberId, "ql@example.com", "QL Admin")
			.run();
	});

	it("lets a member_admin create, update, list, and remove a quick link with audit", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createQuickLinksRepository(db, createAuditRepository(db));

		const created = await repository.create(navAdmin, {
			label: "Member Directory",
			url: "https://example.com/directory",
			position: 1,
		});
		const updated = await repository.update(navAdmin, created.id, {
			label: "Directory",
			url: "https://example.com/directory",
			position: 3,
		});
		expect(updated.position).toBe(3);

		const listed = await repository.list(navAdmin);
		expect(listed.map((link) => link.id)).toContain(created.id);

		await repository.remove(navAdmin, created.id);
		const after = await repository.list(navAdmin);
		expect(after.map((link) => link.id)).not.toContain(created.id);

		const audits = await db.select().from(auditLogs);
		expect(audits.map((row) => row.action)).toEqual(
			expect.arrayContaining(["quick_link:create", "quick_link:update", "quick_link:delete"]),
		);
	});

	it("rejects a plain member", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createQuickLinksRepository(db, createAuditRepository(db));
		await expect(repository.list(member)).rejects.toThrow("Not authorized");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- quickLinks.integration.test.ts`
Expected: FAIL — `./quickLinks` does not exist yet.

- [ ] **Step 3: Write `src/db/repositories/quickLinks.ts`**

```ts
import { asc, eq } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { quickLinks } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

export type QuickLink = InferSelectModel<typeof quickLinks>;
type QuickLinkInsert = InferInsertModel<typeof quickLinks>;

export type QuickLinkInput = {
	label: string;
	url: string;
	position: number;
};

export type QuickLinkDb = {
	select(): {
		from(table: typeof quickLinks): {
			orderBy(column: unknown): Promise<QuickLink[]> | QuickLink[];
			where(condition: unknown): { limit(limit: number): Promise<QuickLink[]> | QuickLink[] };
		};
	};
	insert(table: typeof quickLinks): {
		values(value: QuickLinkInsert): { returning(): Promise<QuickLink[]> | QuickLink[] };
	};
	update(table: typeof quickLinks): {
		set(value: Partial<QuickLinkInsert>): {
			where(condition: unknown): { returning(): Promise<QuickLink[]> | QuickLink[] };
		};
	};
	delete(table: typeof quickLinks): {
		where(condition: unknown): Promise<unknown> | { then: Promise<unknown>["then"] };
	};
};

export type QuickLinksRepository = {
	list(actor: Actor): Promise<QuickLink[]>;
	create(actor: Actor, input: QuickLinkInput): Promise<QuickLink>;
	update(actor: Actor, id: string, input: QuickLinkInput): Promise<QuickLink>;
	remove(actor: Actor, id: string): Promise<void>;
};

export function createQuickLinksRepository(db: QuickLinkDb, audit: AuditRepository): QuickLinksRepository {
	return {
		async list(actor) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to list quick links.");
			}
			return db.select().from(quickLinks).orderBy(asc(quickLinks.position));
		},
		async create(actor, input) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to create quick links.");
			}
			const [link] = await db
				.insert(quickLinks)
				.values({
					id: createId("qlk"),
					label: input.label,
					url: input.url,
					position: input.position,
					createdBy: actor.memberId,
				})
				.returning();
			await audit.record(actor, {
				action: "quick_link:create",
				targetType: "quick_link",
				targetId: link.id,
				category: "member",
			});
			return link;
		},
		async update(actor, id, input) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to update quick links.");
			}
			const [link] = await db
				.update(quickLinks)
				.set({ label: input.label, url: input.url, position: input.position, updatedAt: new Date() })
				.where(eq(quickLinks.id, id))
				.returning();
			if (!link) {
				throw new Error("Quick link not found.");
			}
			await audit.record(actor, {
				action: "quick_link:update",
				targetType: "quick_link",
				targetId: link.id,
				category: "member",
			});
			return link;
		},
		async remove(actor, id) {
			if (!can(actor, "nav:configure")) {
				throw new Error("Not authorized to remove quick links.");
			}
			await db.delete(quickLinks).where(eq(quickLinks.id, id));
			await audit.record(actor, {
				action: "quick_link:delete",
				targetType: "quick_link",
				targetId: id,
				category: "member",
			});
		},
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- quickLinks.integration.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/quickLinks.ts src/db/repositories/quickLinks.integration.test.ts
git commit -m "feat(repo): add quick links repository with actor authz and audit"
```

---

### Task 4: Roster repository — per-term add/remove with actor authz and audit

**Files:**
- Create: `src/db/repositories/roster.ts`
- Create: `src/db/repositories/roster.integration.test.ts`

**Interfaces:**
- Consumes: `termMemberRoster`, `members` tables from `@/db/schema`; `Actor` + `can`; `AuditRepository`. Composite PK is `(termId, email)`.
- Produces: `createRosterRepository(db: RosterDb, audit: AuditRepository): RosterRepository` with `listForTerm(actor, termId)`, `add(actor, input)`, `remove(actor, termId, email)`. `RosterAddInput = { termId: string; email: string }`. `RosterEntry` includes `termId`, `email`, `memberId`, `addedBy`, `addedAt`. Email is normalized to trimmed-lowercase on `add` (mirrors `src/server/auth/roster.ts`'s `normalizeEmail` so the auth gate matches stored rows). Already referenced by Task 2's `index.ts`. Tasks 5/8 consume this shape.

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/roster.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs, termMemberRoster } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createRosterRepository } from "./roster";

const rosterAdmin: Actor = { memberId: "mem_roster_admin", roles: ["member", "member_admin"] };
const member: Actor = { memberId: "mem_plain", roles: ["member"] };
const TERM = "term_x";

describe("roster repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM term_member_roster").run();
		await env.DB.prepare("DELETE FROM terms").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(rosterAdmin.memberId, "admin@example.com", "Roster Admin")
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind(TERM, "Term X", 20, 10, 0, 9999999999999)
			.run();
	});

	it("adds an email (normalized), lists it, and removes it with audit", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRosterRepository(db, createAuditRepository(db));

		const entry = await repository.add(rosterAdmin, { termId: TERM, email: "  New.Member@Example.COM " });
		expect(entry.email).toBe("new.member@example.com");
		expect(entry.addedBy).toBe(rosterAdmin.memberId);

		const listed = await repository.listForTerm(rosterAdmin, TERM);
		expect(listed.map((row) => row.email)).toContain("new.member@example.com");

		await repository.remove(rosterAdmin, TERM, "new.member@example.com");
		const after = await repository.listForTerm(rosterAdmin, TERM);
		expect(after).toHaveLength(0);

		const audits = await db.select().from(auditLogs);
		expect(audits.map((row) => row.action)).toEqual(
			expect.arrayContaining(["roster:add", "roster:remove"]),
		);
		expect(audits.every((row) => row.category === "retention")).toBe(true);
	});

	it("rejects a plain member from listing or mutating the roster", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRosterRepository(db, createAuditRepository(db));
		await expect(repository.listForTerm(member, TERM)).rejects.toThrow("Not authorized");
		await expect(repository.add(member, { termId: TERM, email: "x@example.com" })).rejects.toThrow("Not authorized");
	});

	it("is idempotent on re-adding the same email (no duplicate row)", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRosterRepository(db, createAuditRepository(db));
		await repository.add(rosterAdmin, { termId: TERM, email: "dup@example.com" });
		await repository.add(rosterAdmin, { termId: TERM, email: "dup@example.com" });
		const rows = await db.select().from(termMemberRoster);
		expect(rows).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- roster.integration.test.ts`
Expected: FAIL — `./roster` does not exist yet.

- [ ] **Step 3: Write `src/db/repositories/roster.ts`**

```ts
import { and, asc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { members, termMemberRoster } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

export type RosterEntry = InferSelectModel<typeof termMemberRoster>;

export type RosterAddInput = {
	termId: string;
	email: string;
};

export type RosterDb = {
	select(columns?: unknown): {
		from(table: typeof termMemberRoster | typeof members): {
			where(condition: unknown): {
				orderBy(column: unknown): Promise<RosterEntry[]> | RosterEntry[];
				limit(limit: number): Promise<Array<{ id: string }>> | Array<{ id: string }>;
			};
		};
	};
	insert(table: typeof termMemberRoster): {
		values(value: {
			termId: string;
			email: string;
			memberId: string | null;
			addedBy: string;
		}): {
			onConflictDoNothing(): Promise<unknown> | { then: Promise<unknown>["then"] };
		};
	};
	delete(table: typeof termMemberRoster): {
		where(condition: unknown): Promise<unknown> | { then: Promise<unknown>["then"] };
	};
};

export type RosterRepository = {
	listForTerm(actor: Actor, termId: string): Promise<RosterEntry[]>;
	add(actor: Actor, input: RosterAddInput): Promise<RosterEntry>;
	remove(actor: Actor, termId: string, email: string): Promise<void>;
};

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function createRosterRepository(db: RosterDb, audit: AuditRepository): RosterRepository {
	return {
		async listForTerm(actor, termId) {
			if (!can(actor, "roster:manage")) {
				throw new Error("Not authorized to list the roster.");
			}
			return db.select().from(termMemberRoster).where(eq(termMemberRoster.termId, termId)).orderBy(asc(termMemberRoster.email));
		},
		async add(actor, input) {
			if (!can(actor, "roster:manage")) {
				throw new Error("Not authorized to edit the roster.");
			}
			const email = normalizeEmail(input.email);
			const [existingMember] = await db
				.select({ id: members.id })
				.from(members)
				.where(eq(members.email, email))
				.limit(1);

			await db
				.insert(termMemberRoster)
				.values({ termId: input.termId, email, memberId: existingMember?.id ?? null, addedBy: actor.memberId })
				.onConflictDoNothing();

			await audit.record(actor, {
				action: "roster:add",
				targetType: "term_member_roster",
				targetId: `${input.termId}:${email}`,
				category: "retention",
			});

			const [entry] = await db
				.select()
				.from(termMemberRoster)
				.where(and(eq(termMemberRoster.termId, input.termId), eq(termMemberRoster.email, email)))
				.orderBy(asc(termMemberRoster.email));
			return entry;
		},
		async remove(actor, termId, email) {
			if (!can(actor, "roster:manage")) {
				throw new Error("Not authorized to edit the roster.");
			}
			const normalized = normalizeEmail(email);
			await db
				.delete(termMemberRoster)
				.where(and(eq(termMemberRoster.termId, termId), eq(termMemberRoster.email, normalized)));
			await audit.record(actor, {
				action: "roster:remove",
				targetType: "term_member_roster",
				targetId: `${termId}:${normalized}`,
				category: "retention",
			});
		},
	};
}
```

Note: `.select()` (no args) and `.select({ id })` both flow through the same loose `RosterDb` type; the real Drizzle handle satisfies both. The `add` path re-selects the row after the insert so it returns the canonical `RosterEntry` (D1 does not return rows on `INSERT ... ON CONFLICT DO NOTHING`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- roster.integration.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/roster.ts src/db/repositories/roster.integration.test.ts
git commit -m "feat(repo): add per-term roster repository with actor authz and audit"
```

---

### Task 5: Retention reporting repository — three read-only views over retention_records

**IMPORTANT — read before touching this file:** By the time this phase is implemented, `src/db/repositories/retention.ts` is no longer the empty stub. Phases 4, 5, and 7 already populated it with `createRetentionRepository(db, audit): RetentionRepository` and several existing methods, including a `listForMember(actor, input: { memberId, termId, limit?, offset? })` from Phase 4 that takes a single options object. **Do not replace this file, and do not reuse the name `listForMember`** — it would collide with Phase 4's method of the same name but an incompatible (positional-args) signature. This task's third method is named `listMemberTermHistory(actor, memberId, termId)` instead (already applied below and throughout this document). Read the file's current contents first, then ADD `listForTerm`, `listMemberTermHistory`, and `listForEvent` as three more methods on the same returned object and the same `RetentionRepository` type. These are read-only reporting views with their own row-shaped `select()` calls — they do not need the `audit` parameter, but the constructor signature stays `(db, audit)` to match what Phases 4/5/7 already established; do not drop `audit` from the signature.

**Files:**
- Modify: `src/db/repositories/retention.ts` (add `listForTerm`, `listMemberTermHistory`, `listForEvent` to the existing exported object; do not remove or rename any pre-existing method, and do not redeclare `RetentionRecord` or the constructor signature)
- Create: `src/db/repositories/retention.integration.test.ts` if it does not already exist from an earlier phase; otherwise add these test cases to the existing file rather than replacing it

**Interfaces:**
- Consumes: `retentionRecords`, `crsEvents`, `eventRsvps`, `crsAttendance`, `members`, `terms` from `@/db/schema`; `Actor` + `can`.
- Produces: `RetentionRepository` gains three more read methods (no writes here, so no new audit calls — reads are not audited per master-plan §5):
  - `listForTerm(actor, termId): Promise<TermMasterRow[]>` — every retention record in the term, joined to member + event, for the whole-term master export.
  - `listMemberTermHistory(actor, memberId, termId): Promise<MemberHistoryRow[]>` — one member's full chronological record list in a term, for the per-member history export. (Distinct from Phase 4's `listForMember`, which takes one options object and serves a different self-access use case; this method is admin-only reporting.)
  - `listForEvent(actor, eventId): Promise<EventRosterRow[]>` — per-event roster: every RSVP'd or attended member for an event with their attendance flag and any points, for the per-event roster export.
  - All three require `can(actor, "retention:record")`. Row shapes are exported types consumed by Task 6 (the xlsx serializers). Already referenced by Task 2's `index.ts`.

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

const retentionAdmin: Actor = { memberId: "mem_ret_admin", roles: ["member", "retention"] };
const member: Actor = { memberId: "mem_plain", roles: ["member"] };
const TERM = "term_r";
const MEMBER = "mem_target";
const EVENT = "evt_r";

describe("retention reporting repository on D1", () => {
	beforeEach(async () => {
		for (const table of [
			"retention_records",
			"crs_attendance",
			"event_rsvps",
			"crs_events",
			"term_member_roster",
			"terms",
			"members",
		]) {
			await env.DB.prepare(`DELETE FROM ${table}`).run();
		}
		await env.DB.prepare("INSERT INTO members (id, email, name, full_name) VALUES (?, ?, ?, ?)")
			.bind(MEMBER, "target@example.com", "Target", "Target Member")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(retentionAdmin.memberId, "ret@example.com", "Ret Admin")
			.run();
		await env.DB.prepare(
			"INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind(TERM, "Term R", 20, 10, 0, 9999999999999)
			.run();
		await env.DB.prepare(
			"INSERT INTO crs_events (id, title, type, status, points, place, starts_at, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind(EVENT, "Practice Night", "official", "approved", 5, "SOM 111", 1000, "x", retentionAdmin.memberId, "s")
			.run();
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, event_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("ret_1", MEMBER, TERM, EVENT, 5, "Attended Practice Night", "event_attendance", retentionAdmin.memberId, 2000)
			.run();
		await env.DB.prepare(
			"INSERT INTO retention_records (id, member_id, term_id, event_id, points, reason, source, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind("ret_2", MEMBER, TERM, null, null, "Submitted waiver", "manual", retentionAdmin.memberId, 3000)
			.run();
		await env.DB.prepare("INSERT INTO event_rsvps (event_id, member_id, state) VALUES (?, ?, ?)")
			.bind(EVENT, MEMBER, "going")
			.run();
		await env.DB.prepare("INSERT INTO crs_attendance (event_id, member_id, scanned_at, scanned_by) VALUES (?, ?, ?, ?)")
			.bind(EVENT, MEMBER, 2500, retentionAdmin.memberId)
			.run();
	});

	it("listForTerm returns every record in the term joined to member and event", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRetentionRepository(db, createAuditRepository(db));
		const rows = await repository.listForTerm(retentionAdmin, TERM);
		expect(rows).toHaveLength(2);
		const eventRow = rows.find((row) => row.recordId === "ret_1");
		expect(eventRow).toMatchObject({ memberEmail: "target@example.com", eventTitle: "Practice Night", points: 5 });
	});

	it("listMemberTermHistory returns a single member's chronological records in the term", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRetentionRepository(db, createAuditRepository(db));
		const rows = await repository.listMemberTermHistory(retentionAdmin, MEMBER, TERM);
		expect(rows.map((row) => row.recordId)).toEqual(["ret_1", "ret_2"]);
	});

	it("listForEvent returns RSVP'd or attended members with an attendance flag", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRetentionRepository(db, createAuditRepository(db));
		const rows = await repository.listForEvent(retentionAdmin, EVENT);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ memberEmail: "target@example.com", rsvped: true, attended: true });
	});

	it("rejects an actor without the retention scope", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createRetentionRepository(db, createAuditRepository(db));
		await expect(repository.listForTerm(member, TERM)).rejects.toThrow("Not authorized");
		await expect(repository.listMemberTermHistory(member, MEMBER, TERM)).rejects.toThrow("Not authorized");
		await expect(repository.listForEvent(member, EVENT)).rejects.toThrow("Not authorized");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- retention.integration.test.ts`
Expected: FAIL — the current `retention.ts` stub has no `listForTerm`/`listMemberTermHistory`/`listForEvent`.

- [ ] **Step 3: Add the three reporting methods to the existing `src/db/repositories/retention.ts`**

Open the file as it stands after Phases 4/5/7. It already imports `eq` and `can` from the modules below — extend rather than duplicate those import lines (add `and`, `asc`, `sql`, `crsAttendance`, `crsEvents`, `eventRsvps`, `RetentionRecordSource` to the existing imports). Do not redeclare `RetentionRecord`, the constructor signature, or any existing method. Add the following new types and methods:

```ts
export type TermMasterRow = {
	recordId: string;
	memberId: string;
	memberEmail: string;
	memberName: string | null;
	eventId: string | null;
	eventTitle: string | null;
	points: number | null;
	reason: string;
	source: RetentionRecordSource;
	recordedAt: Date;
};

export type MemberHistoryRow = TermMasterRow;

export type EventRosterRow = {
	memberId: string;
	memberEmail: string;
	memberName: string | null;
	rsvped: boolean;
	attended: boolean;
	scannedAt: Date | null;
};

const reportBaseColumns = {
	recordId: retentionRecords.id,
	memberId: retentionRecords.memberId,
	memberEmail: members.email,
	memberName: members.fullName,
	eventId: retentionRecords.eventId,
	eventTitle: crsEvents.title,
	points: retentionRecords.points,
	reason: retentionRecords.reason,
	source: retentionRecords.source,
	recordedAt: retentionRecords.recordedAt,
};
```

Extend the existing `RetentionRepository` type (do not redeclare it from scratch) with the three new method signatures:

```ts
	listForTerm(actor: Actor, termId: string): Promise<TermMasterRow[]>;
	listMemberTermHistory(actor: Actor, memberId: string, termId: string): Promise<MemberHistoryRow[]>;
	listForEvent(actor: Actor, eventId: string): Promise<EventRosterRow[]>;
```

Inside the object literal returned by `createRetentionRepository`, add the three methods alongside the existing ones. `db` here is the same `any`-typed handle Phase 4 already uses (declared `type Db = any` once in this file) — no new cast or `eslint-disable` is needed, that exemption already exists on the original type alias:

```ts
		async listForTerm(actor, termId) {
			if (!can(actor, "retention:record")) {
				throw new Error("Not authorized to read retention reports.");
			}
			return db
				.select(reportBaseColumns)
				.from(retentionRecords)
				.innerJoin(members, eq(members.id, retentionRecords.memberId))
				.leftJoin(crsEvents, eq(crsEvents.id, retentionRecords.eventId))
				.where(eq(retentionRecords.termId, termId))
				.orderBy(asc(retentionRecords.recordedAt)) as Promise<TermMasterRow[]>;
		},
		async listMemberTermHistory(actor, memberId, termId) {
			if (!can(actor, "retention:record")) {
				throw new Error("Not authorized to read retention reports.");
			}
			return db
				.select(reportBaseColumns)
				.from(retentionRecords)
				.innerJoin(members, eq(members.id, retentionRecords.memberId))
				.leftJoin(crsEvents, eq(crsEvents.id, retentionRecords.eventId))
				.where(and(eq(retentionRecords.memberId, memberId), eq(retentionRecords.termId, termId)))
				.orderBy(asc(retentionRecords.recordedAt)) as Promise<MemberHistoryRow[]>;
		},
		async listForEvent(actor, eventId) {
			if (!can(actor, "retention:record")) {
				throw new Error("Not authorized to read retention reports.");
			}
			return db
				.select({
					memberId: members.id,
					memberEmail: members.email,
					memberName: members.fullName,
					rsvped: sql<boolean>`${eventRsvps.state} = 'going'`,
					attended: sql<boolean>`${crsAttendance.memberId} IS NOT NULL`,
					scannedAt: crsAttendance.scannedAt,
				})
				.from(eventRsvps)
				.innerJoin(members, eq(members.id, eventRsvps.memberId))
				.leftJoin(
					crsAttendance,
					and(eq(crsAttendance.eventId, eventRsvps.eventId), eq(crsAttendance.memberId, eventRsvps.memberId)),
				)
				.where(eq(eventRsvps.eventId, eventId))
				.orderBy(asc(members.email)) as Promise<EventRosterRow[]>;
		},
```

Note: the reporting reads lean on the already-`any` `db` handle because the multi-join builder type is more than the existing repo's typed shapes model; the row types are still strongly typed at the boundary. The `listForEvent` view is driven off `event_rsvps` (every member who RSVP'd) left-joined to attendance, matching the master-plan §6 "per-event roster" intent (who signed up vs. who was scanned in).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- retention.integration.test.ts`
Expected: PASS (all 4 new cases, plus every case from earlier phases still in this file).

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/retention.ts src/db/repositories/retention.integration.test.ts
git commit -m "feat(repo): add retention reporting views (term, member, event)"
```

---

### Task 6: xlsx serializers — turn report rows into workbook bytes

**Files:**
- Create: `src/server/reporting/xlsx.ts`
- Create: `src/server/reporting/xlsx.test.ts`

**Interfaces:**
- Consumes: `TermMasterRow`, `MemberHistoryRow`, `EventRosterRow` from `@/db/repositories/retention`; `xlsx` (SheetJS).
- Produces: three pure functions returning a `Uint8Array` of a valid `.xlsx` workbook:
  - `buildTermMasterWorkbook(rows: TermMasterRow[], termName: string): Uint8Array`
  - `buildMemberHistoryWorkbook(rows: MemberHistoryRow[], memberLabel: string, termName: string): Uint8Array`
  - `buildEventRosterWorkbook(rows: EventRosterRow[], eventTitle: string): Uint8Array`
  - Plus `XLSX_CONTENT_TYPE` constant. Consumed by the download route (Task 7). Pure, no DB, no actor — authz happens before these are called.

- [ ] **Step 1: Write the failing test**

Create `src/server/reporting/xlsx.test.ts`:
```ts
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import type { EventRosterRow, MemberHistoryRow, TermMasterRow } from "@/db/repositories/retention";
import {
	XLSX_CONTENT_TYPE,
	buildEventRosterWorkbook,
	buildMemberHistoryWorkbook,
	buildTermMasterWorkbook,
} from "./xlsx";

const termRows: TermMasterRow[] = [
	{
		recordId: "ret_1",
		memberId: "mem_1",
		memberEmail: "a@example.com",
		memberName: "Alpha Member",
		eventId: "evt_1",
		eventTitle: "Practice Night",
		points: 5,
		reason: "Attended Practice Night",
		source: "event_attendance",
		recordedAt: new Date("2026-06-18T00:00:00.000Z"),
	},
];

const rosterRows: EventRosterRow[] = [
	{ memberId: "mem_1", memberEmail: "a@example.com", memberName: "Alpha", rsvped: true, attended: true, scannedAt: new Date("2026-06-18T01:00:00.000Z") },
	{ memberId: "mem_2", memberEmail: "b@example.com", memberName: null, rsvped: true, attended: false, scannedAt: null },
];

function firstSheet(bytes: Uint8Array): Record<string, unknown>[] {
	const wb = XLSX.read(bytes, { type: "array" });
	const sheet = wb.Sheets[wb.SheetNames[0]];
	return XLSX.utils.sheet_to_json(sheet);
}

describe("reporting xlsx serializers", () => {
	it("exposes the spreadsheet content type", () => {
		expect(XLSX_CONTENT_TYPE).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
	});

	it("builds a term master workbook with a header row and one data row", () => {
		const bytes = buildTermMasterWorkbook(termRows, "Term 1 2026");
		const json = firstSheet(bytes);
		expect(json).toHaveLength(1);
		expect(json[0]).toMatchObject({ Email: "a@example.com", Event: "Practice Night", Points: 5, Source: "event_attendance" });
	});

	it("builds a member history workbook", () => {
		const rows: MemberHistoryRow[] = termRows;
		const bytes = buildMemberHistoryWorkbook(rows, "Alpha Member", "Term 1 2026");
		const json = firstSheet(bytes);
		expect(json).toHaveLength(1);
		expect(json[0]).toMatchObject({ Reason: "Attended Practice Night" });
	});

	it("builds an event roster workbook flagging attendance with Yes/No", () => {
		const bytes = buildEventRosterWorkbook(rosterRows, "Practice Night");
		const json = firstSheet(bytes);
		expect(json).toHaveLength(2);
		expect(json[0]).toMatchObject({ Email: "a@example.com", RSVP: "Yes", Attended: "Yes" });
		expect(json[1]).toMatchObject({ Email: "b@example.com", Attended: "No" });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- xlsx.test.ts`
Expected: FAIL — `./xlsx` does not exist yet.

- [ ] **Step 3: Write `src/server/reporting/xlsx.ts`**

```ts
import * as XLSX from "xlsx";
import type { EventRosterRow, MemberHistoryRow, TermMasterRow } from "@/db/repositories/retention";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function toBytes(workbook: XLSX.WorkBook): Uint8Array {
	return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

function formatDate(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function sheetFromRows(rows: Record<string, string | number>[], sheetName: string): XLSX.WorkBook {
	const workbook = XLSX.utils.book_new();
	const sheet = XLSX.utils.json_to_sheet(rows);
	XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
	return workbook;
}

export function buildTermMasterWorkbook(rows: TermMasterRow[], termName: string): Uint8Array {
	const data = rows.map((row) => ({
		Email: row.memberEmail,
		Member: row.memberName ?? "",
		Event: row.eventTitle ?? "",
		Points: row.points ?? "",
		Reason: row.reason,
		Source: row.source,
		Recorded: formatDate(row.recordedAt),
	}));
	return toBytes(sheetFromRows(data, `Master ${termName}`));
}

export function buildMemberHistoryWorkbook(rows: MemberHistoryRow[], memberLabel: string, termName: string): Uint8Array {
	const data = rows.map((row) => ({
		Event: row.eventTitle ?? "",
		Points: row.points ?? "",
		Reason: row.reason,
		Source: row.source,
		Recorded: formatDate(row.recordedAt),
	}));
	return toBytes(sheetFromRows(data, `${memberLabel} ${termName}`));
}

export function buildEventRosterWorkbook(rows: EventRosterRow[], eventTitle: string): Uint8Array {
	const data = rows.map((row) => ({
		Email: row.memberEmail,
		Member: row.memberName ?? "",
		RSVP: row.rsvped ? "Yes" : "No",
		Attended: row.attended ? "Yes" : "No",
		Scanned: row.scannedAt ? formatDate(row.scannedAt) : "",
	}));
	return toBytes(sheetFromRows(data, `Roster ${eventTitle}`));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- xlsx.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/server/reporting/xlsx.ts src/server/reporting/xlsx.test.ts
git commit -m "feat(reporting): add xlsx serializers for the three retention exports"
```

---

### Task 7: Reporting download route — authenticated admin xlsx export endpoint

**Files:**
- Create: `src/app/api/reporting/export/route.ts`
- Create: `src/app/api/reporting/export/route.test.ts`

**Interfaces:**
- Consumes: `getActor`/`requireActor` from `@/server/auth/actor`; `can` from `@/server/auth/permissions`; `getRepositories` from `@/db`; the three workbook builders + `XLSX_CONTENT_TYPE` from `@/server/reporting/xlsx`; `getAppConfig` from `@/server/env`.
- Produces: `GET(request)` at `/api/reporting/export` taking query params `kind` ∈ `term|member|event` plus `termId` (term/member), `memberId` (member), `eventId` (event). Returns the xlsx bytes with `Content-Type: <XLSX_CONTENT_TYPE>` and a `Content-Disposition: attachment; filename="..."` header, or a JSON error with the right status. This is the only new `/api/*` handler; it is a GET (download) so it does not need `assertSameOrigin`, but it MUST resolve an authenticated actor with `retention:record` and 403 otherwise.
- After this task, `pnpm typecheck` is clean project-wide (all repos from Tasks 2-5 now exist, satisfying Task 2's `index.ts`).

- [ ] **Step 1: Write the failing route test**

Create `src/app/api/reporting/export/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/permissions";

const retentionAdmin: Actor = { memberId: "mem_admin", roles: ["member", "retention"] };
const plainMember: Actor = { memberId: "mem_plain", roles: ["member"] };

const listForTerm = vi.fn();
const listMemberTermHistory = vi.fn();
const listForEvent = vi.fn();
const getActor = vi.fn();

vi.mock("@/server/auth/actor", () => ({ getActor: () => getActor() }));
vi.mock("@/server/env", () => ({ getAppConfig: () => ({ APP_ENV: "production", APP_BASE_URL: "https://app.test" }) }));
vi.mock("@/db", () => ({
	getRepositories: async () => ({ retention: { listForTerm, listMemberTermHistory, listForEvent } }),
}));

import { GET } from "./route";

describe("GET /api/reporting/export", () => {
	beforeEach(() => {
		listForTerm.mockReset().mockResolvedValue([]);
		listMemberTermHistory.mockReset().mockResolvedValue([]);
		listForEvent.mockReset().mockResolvedValue([]);
		getActor.mockReset().mockResolvedValue(retentionAdmin);
	});

	it("returns 403 for an actor without the retention scope", async () => {
		getActor.mockResolvedValue(plainMember);
		const response = await GET(new Request("https://app.test/api/reporting/export?kind=term&termId=t1"));
		expect(response.status).toBe(403);
	});

	it("returns 401 when there is no actor", async () => {
		getActor.mockResolvedValue(null);
		const response = await GET(new Request("https://app.test/api/reporting/export?kind=term&termId=t1"));
		expect(response.status).toBe(401);
	});

	it("returns 400 for an unknown kind or missing params", async () => {
		const bad = await GET(new Request("https://app.test/api/reporting/export?kind=bogus"));
		expect(bad.status).toBe(400);
		const missing = await GET(new Request("https://app.test/api/reporting/export?kind=member&termId=t1"));
		expect(missing.status).toBe(400);
	});

	it("streams a term master workbook with attachment headers", async () => {
		const response = await GET(new Request("https://app.test/api/reporting/export?kind=term&termId=t1"));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
		expect(response.headers.get("content-disposition")).toContain("attachment");
		expect(listForTerm).toHaveBeenCalledWith(retentionAdmin, "t1");
		const body = new Uint8Array(await response.arrayBuffer());
		expect(body.byteLength).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- route.test.ts`
Expected: FAIL — `./route` does not exist yet.

- [ ] **Step 3: Write `src/app/api/reporting/export/route.ts`**

```ts
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import {
	XLSX_CONTENT_TYPE,
	buildEventRosterWorkbook,
	buildMemberHistoryWorkbook,
	buildTermMasterWorkbook,
} from "@/server/reporting/xlsx";

function fileResponse(bytes: Uint8Array, filename: string): Response {
	return new Response(bytes, {
		status: 200,
		headers: {
			"Content-Type": XLSX_CONTENT_TYPE,
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
}

export async function GET(request: Request): Promise<Response> {
	const actor = await getActor();
	if (!actor) {
		return Response.json({ error: "Authentication required." }, { status: 401 });
	}
	if (!can(actor, "retention:record")) {
		return Response.json({ error: "Not authorized." }, { status: 403 });
	}

	const url = new URL(request.url);
	const kind = url.searchParams.get("kind");
	const repositories = await getRepositories();

	if (kind === "term") {
		const termId = url.searchParams.get("termId");
		if (!termId) return Response.json({ error: "termId is required." }, { status: 400 });
		const rows = await repositories.retention.listForTerm(actor, termId);
		return fileResponse(buildTermMasterWorkbook(rows, termId), `retention-master-${termId}.xlsx`);
	}

	if (kind === "member") {
		const termId = url.searchParams.get("termId");
		const memberId = url.searchParams.get("memberId");
		if (!termId || !memberId) return Response.json({ error: "termId and memberId are required." }, { status: 400 });
		const rows = await repositories.retention.listMemberTermHistory(actor, memberId, termId);
		return fileResponse(buildMemberHistoryWorkbook(rows, memberId, termId), `retention-${memberId}-${termId}.xlsx`);
	}

	if (kind === "event") {
		const eventId = url.searchParams.get("eventId");
		if (!eventId) return Response.json({ error: "eventId is required." }, { status: 400 });
		const rows = await repositories.retention.listForEvent(actor, eventId);
		return fileResponse(buildEventRosterWorkbook(rows, eventId), `roster-${eventId}.xlsx`);
	}

	return Response.json({ error: "Unknown export kind." }, { status: 400 });
}
```

- [ ] **Step 4: Run the route test to verify it passes**

Run: `pnpm test -- route.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Run typecheck across the project**

Run: `pnpm typecheck`
Expected: PASS — every repository referenced by `src/db/repositories/index.ts` (Task 2) now exists.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/reporting/export/route.ts src/app/api/reporting/export/route.test.ts
git commit -m "feat(reporting): add authenticated admin xlsx export download route"
```

---

### Task 8: Admin layout and dashboard — gated module shell

**Files:**
- Create: `src/app/portal/admin/layout.tsx`
- Create: `src/app/portal/admin/page.tsx`

**Interfaces:**
- Consumes: `getActor` from `@/server/auth/actor`; `hasAnyAdminScope` from `@/server/auth/admin`; `can` from `@/server/auth/permissions`; `getRepositories` from `@/db`.
- Produces: the `/portal/admin` route segment. The layout redirects non-admin actors to `/portal`; the page renders the admin dashboard with a Quick Links widget (read via `quickLinks.list`) and links to the four Phase 8 screens, each shown only when the actor holds the matching scope.

- [ ] **Step 1: Add the shadcn table component (used by Tasks 9-11)**

STOP — per CLAUDE.md, show the command and wait for approval before running `pnpm dlx`:
```bash
pnpm dlx shadcn@latest add table
```
After approval, run it. Expected: `src/components/ui/table.tsx` created, themed via the existing `globals.css` tokens. (Button, card, input, select, checkbox, textarea, badge already exist; no dialog is needed because the admin screens use inline forms, not modals, to keep cards shallow.)

- [ ] **Step 2: Write `src/app/portal/admin/layout.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/actor";
import { hasAnyAdminScope } from "@/server/auth/admin";
import { can } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!hasAnyAdminScope(actor)) redirect("/portal");

	const tabs = [
		{ href: "/portal/admin", label: "Dashboard", show: true },
		{ href: "/portal/admin/reporting", label: "Reporting", show: can(actor, "retention:record") },
		{ href: "/portal/admin/roster", label: "Roster", show: can(actor, "roster:manage") },
		{ href: "/portal/admin/nav-pins", label: "Nav pins", show: can(actor, "nav:configure") },
		{ href: "/portal/admin/quick-links", label: "Quick links", show: can(actor, "nav:configure") },
	].filter((tab) => tab.show);

	return (
		<div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
			<h1 className="font-heading text-3xl">Admin</h1>
			<nav className="mt-4 flex flex-wrap gap-2 border-b border-border pb-3">
				{tabs.map((tab) => (
					<Link
						key={tab.href}
						href={tab.href}
						className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						{tab.label}
					</Link>
				))}
			</nav>
			<div className="mt-6">{children}</div>
		</div>
	);
}
```

- [ ] **Step 3: Write `src/app/portal/admin/page.tsx`**

```tsx
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getRepositories } from "@/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/server/auth/permissions";
import { requireActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const quickLinks = can(actor, "nav:configure") ? await repositories.quickLinks.list(actor) : [];

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Quick links</CardTitle>
					<CardDescription>Shared org resources surfaced on the member dashboard.</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					{quickLinks.length === 0 ? (
						<p className="text-sm text-muted-foreground">No quick links yet.</p>
					) : (
						quickLinks.map((link) => (
							<a
								key={link.id}
								href={link.url}
								className="flex items-center gap-2 text-sm hover:text-primary"
								target="_blank"
								rel="noreferrer"
							>
								<ExternalLink className="size-4" />
								{link.label}
							</a>
						))
					)}
					{can(actor, "nav:configure") ? (
						<Link href="/portal/admin/quick-links" className="mt-2 text-sm text-primary hover:underline">
							Manage quick links
						</Link>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 4: Run typecheck, lint, and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS; `/portal/admin` compiles.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/table.tsx src/app/portal/admin/layout.tsx src/app/portal/admin/page.tsx
git commit -m "feat(admin): add gated admin module layout and dashboard with quick links widget"
```

---

### Task 9: Roster admin screen — list, add, remove per term

**Files:**
- Create: `src/app/portal/admin/roster/page.tsx`
- Create: `src/app/portal/admin/roster/actions.ts`

**Interfaces:**
- Consumes: `getRepositories` from `@/db`; `requireActor` from `@/server/auth/actor`; the `roster` repository (Task 4); `getDb` from `@/db/client` for the term list; `terms` from `@/db/schema`.
- Produces: the `/portal/admin/roster` screen (term selector via `?termId=`, current roster table, add-by-email form, remove buttons) and two server actions `addRosterEntryAction(formData)` / `removeRosterEntryAction(formData)`.

- [ ] **Step 1: Write `src/app/portal/admin/roster/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";

const addSchema = z.object({
	termId: z.string().min(1),
	email: z.string().trim().toLowerCase().email(),
});

const removeSchema = z.object({
	termId: z.string().min(1),
	email: z.string().min(1),
});

export async function addRosterEntryAction(formData: FormData) {
	const actor = await requireActor();
	const input = addSchema.parse({ termId: formData.get("termId"), email: formData.get("email") });
	const repositories = await getRepositories();
	await repositories.roster.add(actor, input);
	revalidatePath("/portal/admin/roster");
}

export async function removeRosterEntryAction(formData: FormData) {
	const actor = await requireActor();
	const input = removeSchema.parse({ termId: formData.get("termId"), email: formData.get("email") });
	const repositories = await getRepositories();
	await repositories.roster.remove(actor, input.termId, input.email);
	revalidatePath("/portal/admin/roster");
}
```

- [ ] **Step 2: Write `src/app/portal/admin/roster/page.tsx`**

```tsx
import { asc } from "drizzle-orm";
import { getRepositories } from "@/db";
import { getDb } from "@/db/client";
import { terms } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActor } from "@/server/auth/actor";
import { addRosterEntryAction, removeRosterEntryAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RosterAdminPage({ searchParams }: { searchParams: Promise<{ termId?: string }> }) {
	const actor = await requireActor();
	const { termId } = await searchParams;
	const termList = await getDb().select().from(terms).orderBy(asc(terms.startsAt));
	const activeTermId = termId ?? termList.at(-1)?.id ?? null;

	const repositories = await getRepositories();
	const roster = activeTermId ? await repositories.roster.listForTerm(actor, activeTermId) : [];

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Pick a term</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-wrap gap-2">
					{termList.map((term) => (
						<Button key={term.id} asChild size="sm" variant={term.id === activeTermId ? "default" : "outline"}>
							<a href={`/portal/admin/roster?termId=${term.id}`}>{term.name}</a>
						</Button>
					))}
				</CardContent>
			</Card>

			{activeTermId ? (
				<Card>
					<CardHeader>
						<CardTitle>Roster ({roster.length})</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<form action={addRosterEntryAction} className="flex flex-wrap items-end gap-2">
							<input type="hidden" name="termId" value={activeTermId} />
							<Input name="email" type="email" placeholder="member@example.com" required className="max-w-xs" />
							<Button type="submit">Add to roster</Button>
						</form>

						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Email</TableHead>
									<TableHead>Linked member</TableHead>
									<TableHead className="text-right">Action</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{roster.map((entry) => (
									<TableRow key={entry.email}>
										<TableCell>{entry.email}</TableCell>
										<TableCell>{entry.memberId ? "Yes" : "Not yet signed in"}</TableCell>
										<TableCell className="text-right">
											<form action={removeRosterEntryAction}>
												<input type="hidden" name="termId" value={activeTermId} />
												<input type="hidden" name="email" value={entry.email} />
												<Button type="submit" size="sm" variant="outline">Remove</Button>
											</form>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			) : (
				<p className="text-sm text-muted-foreground">No terms exist yet. Create a term first.</p>
			)}
		</div>
	);
}
```

- [ ] **Step 3: Run typecheck, lint, and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS; `/portal/admin/roster` compiles.

- [ ] **Step 4: Commit**

```bash
git add src/app/portal/admin/roster
git commit -m "feat(admin): add per-term roster management screen"
```

---

### Task 10: Nav pins admin screen — list, add, edit, remove

**Files:**
- Create: `src/app/portal/admin/nav-pins/page.tsx`
- Create: `src/app/portal/admin/nav-pins/actions.ts`

**Interfaces:**
- Consumes: `getRepositories`; `requireActor`; the `navPins` repository (Task 2).
- Produces: the `/portal/admin/nav-pins` screen and three server actions `createNavPinAction` / `updateNavPinAction` / `deleteNavPinAction`. Form fields: `label`, `url` (http/https), `icon` (lucide icon name string), `position` (integer).

- [ ] **Step 1: Write `src/app/portal/admin/nav-pins/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";

const pinSchema = z.object({
	label: z.string().trim().min(1).max(80),
	url: z.string().trim().url().refine((value) => /^https?:\/\//.test(value), "URL must be http or https."),
	icon: z.string().trim().min(1).max(40),
	position: z.coerce.number().int().min(0).max(999),
});

function parsePin(formData: FormData) {
	return pinSchema.parse({
		label: formData.get("label"),
		url: formData.get("url"),
		icon: formData.get("icon"),
		position: formData.get("position"),
	});
}

export async function createNavPinAction(formData: FormData) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.navPins.create(actor, parsePin(formData));
	revalidatePath("/portal/admin/nav-pins");
}

export async function updateNavPinAction(formData: FormData) {
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.navPins.update(actor, id, parsePin(formData));
	revalidatePath("/portal/admin/nav-pins");
}

export async function deleteNavPinAction(formData: FormData) {
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.navPins.remove(actor, id);
	revalidatePath("/portal/admin/nav-pins");
}
```

- [ ] **Step 2: Write `src/app/portal/admin/nav-pins/page.tsx`**

```tsx
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActor } from "@/server/auth/actor";
import { createNavPinAction, deleteNavPinAction, updateNavPinAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NavPinsAdminPage() {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const pins = await repositories.navPins.list(actor);

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Add a nav pin</CardTitle>
					<CardDescription>Pinned links every signed-in member sees in the top nav and the mobile Menu sheet.</CardDescription>
				</CardHeader>
				<CardContent>
					<form action={createNavPinAction} className="grid gap-2 sm:grid-cols-5">
						<Input name="label" placeholder="Label" required />
						<Input name="url" type="url" placeholder="https://" required className="sm:col-span-2" />
						<Input name="icon" placeholder="Icon (e.g. link)" required />
						<Input name="position" type="number" defaultValue={0} min={0} required />
						<Button type="submit" className="sm:col-span-5">Add pin</Button>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Current pins ({pins.length})</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Position</TableHead>
								<TableHead>Label</TableHead>
								<TableHead>URL</TableHead>
								<TableHead>Icon</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{pins.map((pin) => (
								<TableRow key={pin.id}>
									<TableCell>
										<form action={updateNavPinAction} className="flex items-center gap-1">
											<input type="hidden" name="id" value={pin.id} />
											<input type="hidden" name="label" value={pin.label} />
											<input type="hidden" name="url" value={pin.url} />
											<input type="hidden" name="icon" value={pin.icon} />
											<Input name="position" type="number" defaultValue={pin.position} className="w-20" min={0} />
											<Button type="submit" size="sm" variant="outline">Save</Button>
										</form>
									</TableCell>
									<TableCell>{pin.label}</TableCell>
									<TableCell className="max-w-xs truncate">{pin.url}</TableCell>
									<TableCell>{pin.icon}</TableCell>
									<TableCell className="text-right">
										<form action={deleteNavPinAction}>
											<input type="hidden" name="id" value={pin.id} />
											<Button type="submit" size="sm" variant="outline">Remove</Button>
										</form>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 3: Run typecheck, lint, and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS; `/portal/admin/nav-pins` compiles.

- [ ] **Step 4: Commit**

```bash
git add src/app/portal/admin/nav-pins
git commit -m "feat(admin): add nav pins management screen"
```

---

### Task 11: Quick links admin screen and reporting screen

**Files:**
- Create: `src/app/portal/admin/quick-links/page.tsx`
- Create: `src/app/portal/admin/quick-links/actions.ts`
- Create: `src/app/portal/admin/reporting/page.tsx`

**Interfaces:**
- Consumes: `getRepositories`; `requireActor`; the `quickLinks` repository (Task 3); `getDb` + `terms`/`crsEvents` for the reporting screen's selectors; the export route at `/api/reporting/export` for download links.
- Produces: the `/portal/admin/quick-links` screen (mirrors nav-pins minus the icon field) with `createQuickLinkAction` / `updateQuickLinkAction` / `deleteQuickLinkAction`, and the `/portal/admin/reporting` screen with the three export download links.

- [ ] **Step 1: Write `src/app/portal/admin/quick-links/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";

const linkSchema = z.object({
	label: z.string().trim().min(1).max(80),
	url: z.string().trim().url().refine((value) => /^https?:\/\//.test(value), "URL must be http or https."),
	position: z.coerce.number().int().min(0).max(999),
});

function parseLink(formData: FormData) {
	return linkSchema.parse({
		label: formData.get("label"),
		url: formData.get("url"),
		position: formData.get("position"),
	});
}

export async function createQuickLinkAction(formData: FormData) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.quickLinks.create(actor, parseLink(formData));
	revalidatePath("/portal/admin/quick-links");
}

export async function updateQuickLinkAction(formData: FormData) {
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.quickLinks.update(actor, id, parseLink(formData));
	revalidatePath("/portal/admin/quick-links");
}

export async function deleteQuickLinkAction(formData: FormData) {
	const actor = await requireActor();
	const id = z.string().min(1).parse(formData.get("id"));
	const repositories = await getRepositories();
	await repositories.quickLinks.remove(actor, id);
	revalidatePath("/portal/admin/quick-links");
}
```

- [ ] **Step 2: Write `src/app/portal/admin/quick-links/page.tsx`**

```tsx
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireActor } from "@/server/auth/actor";
import { createQuickLinkAction, deleteQuickLinkAction, updateQuickLinkAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function QuickLinksAdminPage() {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const links = await repositories.quickLinks.list(actor);

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Add a quick link</CardTitle>
					<CardDescription>Resources shown in the dashboard Quick Links widget.</CardDescription>
				</CardHeader>
				<CardContent>
					<form action={createQuickLinkAction} className="grid gap-2 sm:grid-cols-4">
						<Input name="label" placeholder="Label" required />
						<Input name="url" type="url" placeholder="https://" required className="sm:col-span-2" />
						<Input name="position" type="number" defaultValue={0} min={0} required />
						<Button type="submit" className="sm:col-span-4">Add link</Button>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Current links ({links.length})</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Position</TableHead>
								<TableHead>Label</TableHead>
								<TableHead>URL</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{links.map((link) => (
								<TableRow key={link.id}>
									<TableCell>
										<form action={updateQuickLinkAction} className="flex items-center gap-1">
											<input type="hidden" name="id" value={link.id} />
											<input type="hidden" name="label" value={link.label} />
											<input type="hidden" name="url" value={link.url} />
											<Input name="position" type="number" defaultValue={link.position} className="w-20" min={0} />
											<Button type="submit" size="sm" variant="outline">Save</Button>
										</form>
									</TableCell>
									<TableCell>{link.label}</TableCell>
									<TableCell className="max-w-xs truncate">{link.url}</TableCell>
									<TableCell className="text-right">
										<form action={deleteQuickLinkAction}>
											<input type="hidden" name="id" value={link.id} />
											<Button type="submit" size="sm" variant="outline">Remove</Button>
										</form>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 3: Write `src/app/portal/admin/reporting/page.tsx`**

```tsx
import { asc, desc } from "drizzle-orm";
import { Download } from "lucide-react";
import { getDb } from "@/db/client";
import { crsEvents, terms } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";

export default async function ReportingAdminPage() {
	await requireActor();
	const db = getDb();
	const [termList, eventList] = await Promise.all([
		db.select().from(terms).orderBy(asc(terms.startsAt)),
		db.select().from(crsEvents).orderBy(desc(crsEvents.startsAt)).limit(50),
	]);

	return (
		<div className="grid gap-6 lg:grid-cols-3">
			<Card>
				<CardHeader>
					<CardTitle>Whole-term master</CardTitle>
					<CardDescription>Every retention record in a term, one row per record.</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					{termList.map((term) => (
						<Button key={term.id} asChild size="sm" variant="outline">
							<a href={`/api/reporting/export?kind=term&termId=${term.id}`}>
								<Download className="size-4" />
								{term.name}
							</a>
						</Button>
					))}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Per-event roster</CardTitle>
					<CardDescription>Who signed up and who was scanned in, per event.</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					{eventList.map((event) => (
						<Button key={event.id} asChild size="sm" variant="outline">
							<a href={`/api/reporting/export?kind=event&eventId=${event.id}`}>
								<Download className="size-4" />
								{event.title}
							</a>
						</Button>
					))}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Per-member history</CardTitle>
					<CardDescription>Use a member id and term id to export one member's full-year history.</CardDescription>
				</CardHeader>
				<CardContent>
					<form action="/api/reporting/export" method="get" className="flex flex-col gap-2">
						<input type="hidden" name="kind" value="member" />
						<select name="termId" className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" required>
							{termList.map((term) => (
								<option key={term.id} value={term.id}>{term.name}</option>
							))}
						</select>
						<input
							name="memberId"
							placeholder="Member id (mem_...)"
							required
							className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
						/>
						<Button type="submit" size="sm" variant="outline">
							<Download className="size-4" />
							Export member history
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
```

Note: the per-member form is a plain GET form that navigates the browser to `/api/reporting/export`, which streams the file; no client JS is needed. The term/event lists are read with `getDb()` directly (a bounded admin read, capped at 50 events) rather than through a repository, mirroring the existing `src/app/api/uploads/route.ts` pattern of reading reference data inline; the authorization that matters (`retention:record`) is enforced by the download route before any rows are returned.

- [ ] **Step 4: Run typecheck, lint, and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS; all four Phase 8 admin screens compile.

- [ ] **Step 5: Commit**

```bash
git add src/app/portal/admin/quick-links src/app/portal/admin/reporting
git commit -m "feat(admin): add quick links management and retention reporting screens"
```

---

### Task 12: Seed sample nav pins and quick links, refresh graph, surface redeploy

**Files:**
- Modify: `src/db/seed/data.ts` (add `seedNavPins`, `seedQuickLinks`)
- Modify: `src/db/seed/run.ts` (import + insert the two new arrays)

**Interfaces:**
- Consumes: `navPins`, `quickLinks` from `@/db/schema`.
- Produces: `seedNavPins`, `seedQuickLinks` arrays inserted by `seedLocal()` so the admin screens and the dashboard widget have demo rows in local/dev.

- [ ] **Step 1: Add the seed arrays to `src/db/seed/data.ts`**

Add `navPins` and `quickLinks` to the existing schema import in `src/db/seed/data.ts`, then append (after `seedSharedDevTokens`):
```ts
export const seedNavPins: InferInsertModel<typeof navPins>[] = [
	{ id: "nav_master", label: "Masterfile", url: "https://example.com/masterfile", icon: "file-spreadsheet", position: 1, createdBy: "mem_demo_admin" },
	{ id: "nav_guide", label: "Admin guidebook", url: "https://example.com/guidebook", icon: "book-open", position: 2, createdBy: "mem_demo_admin" },
];

export const seedQuickLinks: InferInsertModel<typeof quickLinks>[] = [
	{ id: "qlk_directory", label: "Member directory", url: "https://example.com/directory", position: 1, createdBy: "mem_demo_admin" },
	{ id: "qlk_constitution", label: "Constitution", url: "https://example.com/constitution", position: 2, createdBy: "mem_demo_admin" },
	{ id: "qlk_finance", label: "Finance guide", url: "https://example.com/finance", position: 3, createdBy: "mem_demo_admin" },
];
```

- [ ] **Step 2: Insert them in `src/db/seed/run.ts`**

Add `seedNavPins` and `seedQuickLinks` to the import from `./data`, then append to the end of `seedLocal()`'s insert sequence:
```ts
	await insertChunks(db, schema.navPins, seedNavPins);
	await insertChunks(db, schema.quickLinks, seedQuickLinks);
```

- [ ] **Step 3: Run the full suite, typecheck, lint, build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS — `permissions.test.ts`, `admin.test.ts`, the four new repository integration tests, `xlsx.test.ts`, the reporting route test, and all pre-existing tests are green against the migrated schema (`vitest.config.mts` auto-applies `drizzle/migrations`; no new migration is needed this phase).

- [ ] **Step 4: Refresh the knowledge graph (AST-only, no API cost)**

Run: `graphify update .`
Expected: completes; new repositories, routes, and admin screens are added to `graphify-out/graph.json` per CLAUDE.md.

- [ ] **Step 5: Commit**

```bash
git add src/db/seed/data.ts src/db/seed/run.ts graphify-out
git commit -m "feat(seed): add sample nav pins and quick links, refresh graph"
```

- [ ] **Step 6: STOP — surface the dev-Worker redeploy and dev-seed obligation, do not run without approval**

Per CLAUDE.md and master-plan §15, the new seed rows (4) and any contract/permission-adjacent change require redeploying + reseeding the dev Worker so shared-mode developers see the new admin data. Phase 8 added no schema migration, so present these and wait for explicit approval before running:
```bash
pnpm db:seed:dev
pnpm deploy:dev
```
(`db:migrate:dev` is not needed this phase — no new migration was generated.)

---

## Self-review notes (for the implementer, not a step to execute)

- **Spec coverage (master-plan §12 Phase 8 + §6 Reporting):**
  - Three xlsx exports over `retention_records`: per-member history (Task 5 `listMemberTermHistory` + Task 6 `buildMemberHistoryWorkbook` + Task 7 `kind=member`), per-event roster (Task 5 `listForEvent` + Task 6 `buildEventRosterWorkbook` + Task 7 `kind=event`), whole-term master (Task 5 `listForTerm` + Task 6 `buildTermMasterWorkbook` + Task 7 `kind=term`), all surfaced on the reporting screen (Task 11).
  - Per-term roster admin screen (`term_member_roster`): repository Task 4, screen Task 9. Same table Phase 1's sign-in gate reads (`src/server/auth/roster.ts`); email normalization matches so gate and admin edits agree.
  - Admin-pinned nav links (`nav_pins`): repository Task 2, screen Task 10.
  - Dashboard Quick Links CMS (`quick_links`): repository Task 3, screen Task 11, widget on the dashboard Task 8.
  - Permission gating: `roster:manage` (roster), `nav:configure` (nav pins + quick links), `retention:record` (reporting reads) — all already in `permissions.ts`; this phase consumes them, the admin layout (Task 8) and each repository enforce them, and Task 1's `hasAnyAdminScope` gates the module shell.
  - Audit on every mutation: nav pins, quick links, roster all call `audit.record(...)` with category `member` (nav/quick housekeeping) or `retention` (roster), matching the v5 `AuditCategory` union. Reporting reads are not audited (reads, per §5).
- **Out of scope (other phases, intentionally):** roles management UI, CRS approval/link-moderation queues, audit-log viewer, member-management screen (master-plan §12 Phase 8 also lists these, but the task brief scopes this plan to reporting + nav pins + quick links + roster; those other admin surfaces are their own follow-up tasks and reuse the same layout from Task 8). The actual rendering of nav pins in the member nav / Menu sheet is Phase 2 shell work; this phase only manages the data. Manual retention-record entry UI is Phase 5.
- **Placeholder scan:** no "TBD"/"add validation"/"similar to" placeholders; every code step has complete code and every command step has an expected result.
- **Type consistency:** repository method names are stable across tasks — `navPins.{list,create,update,remove}`, `quickLinks.{list,create,update,remove}`, `roster.{listForTerm,add,remove}`, `retention.{listForTerm,listMemberTermHistory,listForEvent}`. The `index.ts` in Task 2 references all of them; Tasks 3-5 provide the missing ones; Task 7 Step 5 is the first project-wide typecheck gate, by which point every referenced symbol exists. `XLSX_CONTENT_TYPE` and the three `build*Workbook` names match between Task 6 (definition), its test, and Task 7 (consumer). `hasAnyAdminScope`/`assertAdminScope` match between Task 1 and Task 8.
- **D1 budget:** every reporting query is bounded by an indexed key (`retention_records.term_id`, `(member_id, term_id)`, `event_rsvps.event_id`); the events selector is capped at 50; roster list is bounded by `term_id`. No unbounded scans.
- **CLAUDE.md gates:** dependency install (Task 1), `pnpm dlx shadcn add` (Task 8), and dev seed/redeploy (Task 12) are all STOP-and-approve steps. No D1 migration is generated this phase, so no migration-apply gate is needed.
