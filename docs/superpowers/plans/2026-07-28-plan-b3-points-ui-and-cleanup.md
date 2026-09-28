# Plan B3 Points UI and Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the member and admin UI for typed points, then remove the temporary single-value points compatibility path without dropping the legacy database column.

**Architecture:** Build a small point-type policy repository over the B1 tables, then build the screens on B2's `setAwards` and typed-history behavior. Keep React components focused on rendering and actions, move parsing and row-shaping into pure `.ts` helpers with Workers Vitest coverage, and preserve retired awards until an admin explicitly removes them. Replace the old event points panel with `setAwards` before deleting `setPointsAction`, the repository shim, and the `crs_events.points` mirror write.

**Tech Stack:** Next.js App Router, React 19 server and client components, TypeScript, Tailwind CSS v4 tokens, shadcn-style local UI components, lucide-react, Zod, Drizzle ORM with SQLite/D1, Cloudflare Workers Vitest pool.

## Global Constraints

- Work on branch `beta` in the existing checkout. Do not create or use a worktree.
- B1 and B2 must be complete before starting B3. B3 consumes their point tables, repository validation, typed history rows, `setAwards`, and aggregation behavior.
- Scope is spec section 9 Plan B3 only: point-types admin, event-detail per-type awards, profile breakdown, member history labels, leaderboard point-type selection, and compatibility cleanup.
- Add no dependencies.
- Do not create or modify a D1 migration.
- Do not run any D1 migration, reset, seed, remote SQL, or deployment command.
- Do not rebuild, drop, or rename any table or column.
- Do not drop `crs_events.points`. Leave the column in `src/db/schema.ts` and all existing migrations.
- Remove the `crs_events.points` mirror write only after the shipped event editor calls `setAwards` and no UI reads `event.points`.
- Remove `setPointsAction`, `EventsRepository.setPoints`, and `eventsContract.setPoints` only after the new event editor is wired and tested.
- `setAwards` continues to accept only active point types. Existing awards for inactive types remain outside normal replacement and need a separate explicit remove operation.
- A retired award is read-only and says `retired, no longer grants points`. Removing it deletes only the event award row and never deletes historical retention rows.
- The event editor renders one editable row per active point type, including active types with no current award, followed by read-only retired rows for inactive types still awarded by the event.
- The profile renders one row per active point type, including zero totals. The Retention row keeps retained, on-track, and probation status styling; other rows are plain counts.
- Member history rows show the point-type label beside every points value.
- The leaderboard selector defaults to Retention and the ranking query filters by exactly the selected point type.
- Do not add component render tests, jsdom, or React Testing Library. Extract non-trivial parsing, selection, formatting, and row-shaping into pure `.ts` modules and test those modules.
- All tests remain Workers `.ts` tests under the existing `vitest.config.mts` include pattern.
- No test file may import `better-sqlite3`.
- Use existing components from `src/components/ui`, including `Button`, `Input`, `Select`, `Checkbox`, `Badge`, and `Card`.
- Use lucide icons inside buttons when an icon exists.
- Keep cards shallow. Do not place cards inside cards.
- Use Tailwind tokens from `src/app/globals.css` and the supplied CODE palette. Do not add raw one-off brand colours.
- Keep Unna headings and Source Sans body typography through the existing global tokens.
- Do not use an em dash in UI copy, comments, docs, or commit messages.
- Run focused tests after each task, then run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- Check 390px mobile and 1440px desktop layouts for horizontal overflow.
- Run `graphify update .` after implementation code changes. Do not use dirty `graphify-out` files as a reason to skip it, and do not overwrite unrelated graph changes.

## B2 Preconditions

B3 starts only when B2 exposes these exact interfaces from `src/db/types.ts` and `src/db/repositories/retention.ts`:

```ts
export type EventAwardInput = {
	pointTypeId: string;
	points: number;
};

export type TypedRetentionRecord = RetentionRecord & {
	pointTypeId: string;
	pointTypeLabel: string;
};
```

Required B2 repository method:

```ts
repositories.events.setAwards(
	actor: Actor,
	eventId: string,
	awards: EventAwardInput[],
): Promise<{ updated: number }>;
```

Required B2 behavior:

- `events.setAwards()` validates unique active IDs and integer points from `-100` through `100`.
- `events.setAwards()` restricts retention-history deletion to active point types, so inactive historical rows survive.
- `retention.myHistory()` returns `TypedRetentionRecord[]`; its summary total still includes only retention-bearing types.

If any precondition is absent, stop B3 and complete the missing B2 behavior first. B3 itself adds the point-type repository, award-list projection, inactive award-definition preservation, and explicit retired-award removal required by its screens.

---

## File Structure

- Create: `src/db/repositories/pointTypes.ts`
  - Lists point types and enforces configuration permission, immutable keys, and both last-flag guards.
- Create: `src/db/repositories/pointTypes.integration.test.ts`
  - Covers ordering, create/update, authorization, immutable keys, and last-flag refusal.
- Modify: `src/db/repositories/index.ts`
  - Registers the point-type repository locally and as fail-loud in shared mode.
- Create: `src/app/portal/admin/system/point-types/input.ts`
  - Parses point-type admin `FormData` into the B3 `PointTypeUpsertInput`.
- Create: `src/app/portal/admin/system/point-types/input.test.ts`
  - Covers checkbox absence, integer position, immutable existing identity, and malformed creation keys.
- Create: `src/app/portal/admin/system/point-types/actions.ts`
  - Calls the B2 point-type repository and revalidates affected portal pages.
- Create: `src/app/portal/admin/system/point-types/point-types-manager.tsx`
  - Renders one shallow editable row per point type and one create row.
- Create: `src/app/portal/admin/system/point-types/page.tsx`
  - Enforces `retention:configure`, loads point types, and fails visibly on load errors.
- Modify: `src/app/portal/admin/nav.ts`
  - Adds the Point Types system page with its exact permission.
- Modify: `src/app/portal/admin/nav.test.ts`
  - Verifies route visibility and breadcrumb metadata.
- Create: `src/app/portal/calendar/[eventId]/award-editor-input.ts`
  - Builds active and retired editor rows, parses active inputs, and formats the public Worth line.
- Create: `src/app/portal/calendar/[eventId]/award-editor-input.test.ts`
  - Proves active empty rows, integer bounds, retired rows, and display formatting.
- Create: `src/app/portal/calendar/[eventId]/event-awards-editor.tsx`
  - Calls `setAwardsAction` for active rows and the explicit remove action for retired rows.
- Modify: `src/app/portal/calendar/[eventId]/actions.ts`
  - Adds `setAwardsAction` and `removeRetiredAwardAction`; later removes `setPointsAction`.
- Modify: `src/app/portal/calendar/[eventId]/event-manage-panel.tsx`
  - Replaces the single-number panel with the per-type editor and stops reading `event.points`.
- Modify: `src/app/portal/calendar/[eventId]/page.tsx`
  - Loads award metadata, renders the Worth summary, and passes editor rows to the management panel.
- Modify: `src/db/repositories/events.ts`
  - Adds the award-list projection and explicit retired-award removal, preserves retired awards during active replacement, then removes the B2 `setPoints` shim and Retention mirror write.
- Modify: `src/db/repositories/events.integration.test.ts`
  - Covers retired preservation/removal and proves `setAwards` no longer writes `crs_events.points`.
- Create: `src/app/portal/profile/point-breakdown.ts`
  - Reduces typed history into one row per active point type.
- Create: `src/app/portal/profile/point-breakdown.test.ts`
  - Covers zero rows, inactive exclusion, typed totals, and Retention identity.
- Modify: `src/app/portal/profile/page.tsx`
  - Renders the active point-type breakdown and keeps status styling only on Retention.
- Modify: `src/components/retention-history.tsx`
  - Shows each history record's point-type label.
- Create: `src/app/portal/events/point-type-selection.ts`
  - Resolves the requested leaderboard type with Retention as the default.
- Create: `src/app/portal/events/point-type-selection.test.ts`
  - Covers explicit, default, invalid, retired, and empty selections.
- Modify: `src/app/portal/events/page.tsx`
  - Adds the selector and passes the selected point type into the leaderboard query.
- Modify: `src/db/repositories/retention.ts`
  - Filters `publicLeaderboard` by one exact point-type ID without changing the retention-only admin leaderboard.
- Modify: `src/db/repositories/retention.integration.test.ts`
  - Proves rankings change when the selected point type changes.
- Modify: `src/db/contract/events.ts`
  - Removes only the B2 `setPoints` compatibility operation; keeps `setAwards`.
- Modify: `src/db/contract/events.test.ts`
  - Removes the B2 shim assertion while preserving bounded `setAwards` contract coverage.
- Do not modify: `src/db/schema.ts`, `drizzle/migrations/**`, `crs_events.points`, D1 seed data, or deployment configuration.

### Task 1: Add the Point-Type Policy Repository

**Files:**
- Create: `src/db/repositories/pointTypes.ts`
- Create: `src/db/repositories/pointTypes.integration.test.ts`
- Modify: `src/db/repositories/index.ts`

**Interfaces:**
- Consumes: B1 `pointTypes`, `retention:configure`, existing repository `Db`, `AuditRepository`, `Actor`, and `can()`.
- Produces:

```ts
export type PointTypeRow = {
	id: string;
	key: string;
	label: string;
	countsTowardRetention: boolean;
	active: boolean;
	position: number;
};

export type PointTypeUpsertInput = {
	id: string | null;
	key: string;
	label: string;
	countsTowardRetention: boolean;
	active: boolean;
	position: number;
};

export type PointTypesRepository = {
	list(): Promise<PointTypeRow[]>;
	upsertType(actor: Actor, input: PointTypeUpsertInput): Promise<PointTypeRow>;
};
```

- [ ] **Step 1: Write the failing repository tests**

Use the existing Workers D1 setup and audit stub pattern:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createPointTypesRepository } from "./pointTypes";

const retentionAdmin: Actor = { memberId: "mem_admin", roles: ["retention"] };
const plainMember: Actor = { memberId: "mem_plain", roles: [] };
const audit = { record: async () => undefined, list: async () => [] };

describe("point types repository", () => {
	const db = drizzle(env.DB, { schema });
	const repo = createPointTypesRepository(db, audit);

	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM event_point_awards").run();
		await env.DB.prepare("DELETE FROM point_types").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin", Date.now(), Date.now()).run();
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
			.bind("mem_plain", "plain@example.com", "Plain", Date.now(), Date.now()).run();
		await env.DB.prepare(
			"INSERT INTO point_types (id, key, label, counts_toward_retention, active, position) VALUES (?, ?, ?, ?, ?, ?)",
		).bind("pt_retention", "retention", "Retention", 1, 1, 1).run();
		await env.DB.prepare(
			"INSERT INTO point_types (id, key, label, counts_toward_retention, active, position) VALUES (?, ?, ?, ?, ?, ?)",
		).bind("pt_frontliner", "frontliner", "Frontliner", 0, 0, 2).run();
	});

	it("lists active and inactive rows in display order", async () => {
		expect((await repo.list()).map((row) => [row.id, row.active])).toEqual([
			["pt_retention", true],
			["pt_frontliner", false],
		]);
	});

	it("creates a type with a derived immutable id", async () => {
		await expect(repo.upsertType(retentionAdmin, {
			id: null,
			key: "project_lead",
			label: "Project Lead",
			countsTowardRetention: false,
			active: true,
			position: 3,
		})).resolves.toMatchObject({ id: "pt_project_lead", key: "project_lead" });
	});

	it("requires retention configuration permission and keeps keys immutable", async () => {
		await expect(repo.upsertType(plainMember, {
			id: "pt_frontliner",
			key: "frontliner",
			label: "Frontliner",
			countsTowardRetention: false,
			active: true,
			position: 2,
		})).rejects.toThrow("Not authorized");
		await expect(repo.upsertType(retentionAdmin, {
			id: "pt_frontliner",
			key: "renamed",
			label: "Frontliner",
			countsTowardRetention: false,
			active: true,
			position: 2,
		})).rejects.toThrow("Point type keys cannot be changed.");
	});

	it("validates write values inside the repository", async () => {
		await expect(repo.upsertType(retentionAdmin, {
			id: null,
			key: "Bad Key",
			label: " ",
			countsTowardRetention: false,
			active: true,
			position: 1.5,
		})).rejects.toThrow();
	});

	it("refuses clearing or deactivating the final active retention-bearing type", async () => {
		const base = {
			id: "pt_retention",
			key: "retention",
			label: "Retention",
			position: 1,
		};
		await expect(repo.upsertType(retentionAdmin, {
			...base,
			countsTowardRetention: false,
			active: true,
		})).rejects.toThrow("At least one active point type must count toward retention.");
		await expect(repo.upsertType(retentionAdmin, {
			...base,
			countsTowardRetention: true,
			active: false,
		})).rejects.toThrow("At least one active point type must count toward retention.");
	});
});
```

- [ ] **Step 2: Run the repository test to verify it fails**

Run:

```powershell
pnpm exec vitest run "src/db/repositories/pointTypes.integration.test.ts"
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement list, create, and guarded update**

Create `pointTypes.ts` with B1 schema row mapping and:

```ts
const LAST_RETENTION_TYPE_ERROR = "At least one active point type must count toward retention.";
const POINT_TYPE_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

// Match the existing eventTypeRules repository until the repository Db union is centralized.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function createPointTypesRepository(db: Db, audit: AuditRepository): PointTypesRepository {
	return {
		async list() {
			return db
				.select({
					id: pointTypes.id,
					key: pointTypes.key,
					label: pointTypes.label,
					countsTowardRetention: pointTypes.countsTowardRetention,
					active: pointTypes.active,
					position: pointTypes.position,
				})
				.from(pointTypes)
				.orderBy(asc(pointTypes.position), asc(pointTypes.label));
		},

		async upsertType(actor, input) {
			if (!can(actor, "retention:configure")) {
				throw new Error("Not authorized to configure point types.");
			}
			if (!POINT_TYPE_KEY_PATTERN.test(input.key)) throw new Error("Invalid point type key.");
			const label = input.label.trim();
			if (!label || label.length > 60) throw new Error("Point type label is required.");
			if (!Number.isInteger(input.position) || input.position < 0 || input.position > 999) {
				throw new Error("Point type position must be a whole number from 0 to 999.");
			}
			if (input.id === null) {
				const id = `pt_${input.key}`;
				const [created] = await db.insert(pointTypes).values({
					id,
					key: input.key,
					label,
					countsTowardRetention: input.countsTowardRetention,
					active: input.active,
					position: input.position,
					updatedBy: actor.memberId,
					updatedAt: new Date(),
				}).returning();
				await audit.record(actor, {
					action: "point_type:create",
					targetType: "point_type",
					targetId: id,
					category: "retention",
				});
				return created;
			}

			const [existing] = await db.select().from(pointTypes).where(eq(pointTypes.id, input.id)).limit(1);
			if (!existing) throw new Error("Point type not found.");
			if (existing.key !== input.key) throw new Error("Point type keys cannot be changed.");

			const guard = input.active && input.countsTowardRetention
				? eq(pointTypes.id, input.id)
				: and(
						eq(pointTypes.id, input.id),
						exists(
							db.select({ id: pointTypes.id }).from(pointTypes).where(
								and(
									ne(pointTypes.id, input.id),
									eq(pointTypes.active, true),
									eq(pointTypes.countsTowardRetention, true),
								),
							),
						),
					);
			const updated = await db.update(pointTypes).set({
				label,
				countsTowardRetention: input.countsTowardRetention,
				active: input.active,
				position: input.position,
				updatedBy: actor.memberId,
				updatedAt: new Date(),
			}).where(guard).returning();
			if (updated.length === 0) throw new Error(LAST_RETENTION_TYPE_ERROR);
			await audit.record(actor, {
				action: "point_type:update",
				targetType: "point_type",
				targetId: input.id,
				category: "retention",
			});
			return updated[0];
		},
	};
}
```

The TypeScript branch keeps the refusal driven by affected-row count and avoids a read-then-write race.

- [ ] **Step 4: Register local and fail-loud shared repositories**

In `src/db/repositories/index.ts`, create the local repository with the existing audit instance:

```ts
pointTypes: createPointTypesRepository(db, audit),
```

Add the shared-mode entry:

```ts
pointTypes: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createPointTypesRepository>,
```

Do not add an internal route or shared adapter operation in B3.

- [ ] **Step 5: Run the repository test**

Run:

```powershell
pnpm exec vitest run "src/db/repositories/pointTypes.integration.test.ts"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add "src/db/repositories/pointTypes.ts" "src/db/repositories/pointTypes.integration.test.ts" "src/db/repositories/index.ts"
git commit -m "feat: add point type policy repository"
```

### Task 2: Add Point-Type Administration

**Files:**
- Create: `src/app/portal/admin/system/point-types/input.ts`
- Create: `src/app/portal/admin/system/point-types/input.test.ts`
- Create: `src/app/portal/admin/system/point-types/actions.ts`
- Create: `src/app/portal/admin/system/point-types/point-types-manager.tsx`
- Create: `src/app/portal/admin/system/point-types/page.tsx`
- Modify: `src/app/portal/admin/nav.ts`
- Modify: `src/app/portal/admin/nav.test.ts`

**Interfaces:**
- Consumes: `PointTypeRow`, `PointTypeUpsertInput`, `repositories.pointTypes.list()`, `repositories.pointTypes.upsertType(actor, input)`, `requireActor()`, and `can(actor, "retention:configure")`.
- Produces: `/portal/admin/system/point-types` and `parsePointTypeUpsertInput(formData): PointTypeUpsertInput`.

- [ ] **Step 1: Write the failing parser tests**

```ts
import { describe, expect, it } from "vitest";
import { parsePointTypeUpsertInput } from "./input";

function formDataFor(fields: Record<string, string | undefined>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined) data.set(key, value);
	}
	return data;
}

describe("parsePointTypeUpsertInput", () => {
	const base = {
		id: "pt_frontliner",
		key: "frontliner",
		label: "Frontliner",
		position: "2",
		active: "on",
		countsTowardRetention: "on",
	};

	it("parses an existing point type", () => {
		expect(parsePointTypeUpsertInput(formDataFor(base))).toEqual({
			id: "pt_frontliner",
			key: "frontliner",
			label: "Frontliner",
			position: 2,
			active: true,
			countsTowardRetention: true,
		});
	});

	it("treats absent checkboxes as false", () => {
		expect(
			parsePointTypeUpsertInput(
				formDataFor({ ...base, active: undefined, countsTowardRetention: undefined }),
			),
		).toMatchObject({ active: false, countsTowardRetention: false });
	});

	it("accepts a new immutable key and rejects malformed keys", () => {
		expect(parsePointTypeUpsertInput(formDataFor({ ...base, id: "", key: "project_lead" })).id).toBeNull();
		expect(() => parsePointTypeUpsertInput(formDataFor({ ...base, id: "", key: "Project Lead" }))).toThrow();
	});

	it("rejects blank labels and non-integer positions", () => {
		expect(() => parsePointTypeUpsertInput(formDataFor({ ...base, label: " " }))).toThrow();
		expect(() => parsePointTypeUpsertInput(formDataFor({ ...base, position: "1.5" }))).toThrow();
	});
});
```

- [ ] **Step 2: Run the parser test to verify it fails**

Run:

```powershell
pnpm exec vitest run "src/app/portal/admin/system/point-types/input.test.ts"
```

Expected: FAIL because `input.ts` does not exist.

- [ ] **Step 3: Implement the pure `FormData` parser**

```ts
import { z } from "zod";
import type { PointTypeUpsertInput } from "@/db/repositories/pointTypes";

const optionalIdSchema = z.union([z.literal(""), z.string().regex(/^pt_[a-z0-9_]+$/)]);
const keySchema = z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/);
const labelSchema = z.string().trim().min(1).max(60);
const positionSchema = z.coerce.number().int().min(0).max(999);

export function parsePointTypeUpsertInput(formData: FormData): PointTypeUpsertInput {
	const id = optionalIdSchema.parse(formData.get("id") ?? "");
	return {
		id: id === "" ? null : id,
		key: keySchema.parse(formData.get("key")),
		label: labelSchema.parse(formData.get("label")),
		countsTowardRetention: formData.get("countsTowardRetention") === "on",
		active: formData.get("active") === "on",
		position: positionSchema.parse(formData.get("position") ?? 0),
	};
}
```

- [ ] **Step 4: Run the parser test to verify it passes**

Run:

```powershell
pnpm exec vitest run "src/app/portal/admin/system/point-types/input.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Write the failing admin navigation assertions**

Add to `src/app/portal/admin/nav.test.ts`:

```ts
const retentionActor: Actor = { memberId: "m3", roles: ["retention"] };

it("shows Point Types only to retention configuration holders", () => {
	const retentionPages = visibleGroups(retentionActor).flatMap((group) => group.pages.map((page) => page.href));
	const linkPages = visibleGroups(linkOnly).flatMap((group) => group.pages.map((page) => page.href));
	expect(retentionPages).toContain("/portal/admin/system/point-types");
	expect(linkPages).not.toContain("/portal/admin/system/point-types");
	expect(crumbFor("/portal/admin/system/point-types").at(-1)).toEqual({ label: "Point Types" });
});
```

- [ ] **Step 6: Run the navigation test to verify it fails**

Run:

```powershell
pnpm exec vitest run "src/app/portal/admin/nav.test.ts"
```

Expected: FAIL because the Point Types page is not registered.

- [ ] **Step 7: Register the page and implement the guarded action**

Add this System entry in `src/app/portal/admin/nav.ts`:

```ts
{
	segment: "point-types",
	label: "Point Types",
	description: "Manage point labels, retention counting, availability, and display order.",
	permission: "retention:configure",
},
```

Create `actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { parsePointTypeUpsertInput } from "./input";

export async function upsertPointTypeAction(formData: FormData) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.pointTypes.upsertType(actor, parsePointTypeUpsertInput(formData));
	revalidatePath("/portal", "layout");
}
```

- [ ] **Step 8: Implement the page and manager**

The page must redirect unauthorized actors and must not convert a load failure into an empty editable list:

```tsx
import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { PointTypesManager } from "./point-types-manager";

export const dynamic = "force-dynamic";

export default async function PointTypesAdminPage() {
	const actor = await requireActor();
	if (!can(actor, "retention:configure")) redirect("/portal/admin");
	const repositories = await getRepositories();
	const rows = await repositories.pointTypes.list();
	return <PointTypesManager rows={rows} />;
}
```

`point-types-manager.tsx` must:

- Use one shallow `Card` for the tool.
- Render existing keys as text plus hidden `id` and `key` fields.
- Render a creation row with a required `[a-z0-9_]+` key field.
- Render label and numeric position inputs.
- Use existing `Checkbox` controls for `countsTowardRetention` and `active`.
- Use a `Save` lucide icon in each Save button.
- Show repository guard errors through the existing server-action error boundary instead of duplicating the last-flag rule in the client.

Core row shape:

```tsx
<form action={upsertPointTypeAction} className="grid gap-3 border-t border-border pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_7rem_auto] lg:items-end">
	<input type="hidden" name="id" value={row?.id ?? ""} />
	<label className="grid gap-1.5 text-sm">
		<span className="font-medium">Key</span>
		{row ? (
			<>
				<input type="hidden" name="key" value={row.key} />
				<Badge variant="secondary" className="w-fit">{row.key}</Badge>
			</>
		) : (
			<Input name="key" required maxLength={40} pattern="[a-z0-9_]+" />
		)}
	</label>
	<label className="grid gap-1.5 text-sm">
		<span className="font-medium">Label</span>
		<Input name="label" required maxLength={60} defaultValue={row?.label} />
	</label>
	<label className="flex h-10 items-center gap-2 text-sm font-medium">
		<Checkbox name="countsTowardRetention" defaultChecked={row?.countsTowardRetention ?? false} />
		Counts toward retention
	</label>
	<label className="flex h-10 items-center gap-2 text-sm font-medium">
		<Checkbox name="active" defaultChecked={row?.active ?? true} />
		Active
	</label>
	<label className="grid gap-1.5 text-sm">
		<span className="font-medium">Position</span>
		<Input type="number" name="position" min={0} max={999} defaultValue={row?.position ?? 0} />
	</label>
	<Button type="submit" size="sm" variant="secondary">
		<Save />
		Save
	</Button>
</form>
```

- [ ] **Step 9: Run focused tests**

Run:

```powershell
pnpm exec vitest run "src/app/portal/admin/system/point-types/input.test.ts" "src/app/portal/admin/nav.test.ts"
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add "src/app/portal/admin/system/point-types" "src/app/portal/admin/nav.ts" "src/app/portal/admin/nav.test.ts"
git commit -m "feat: add point type administration"
```

### Task 3: Preserve and Explicitly Remove Retired Awards

**Files:**
- Modify: `src/db/repositories/events.ts`
- Modify: `src/db/repositories/events.integration.test.ts`

**Interfaces:**
- Consumes: B2 `eventPointAwards`, `pointTypes`, `retentionRecords`, `EventsRepository.setAwards`, `runAtomic`, and `event:points`.
- Produces:

```ts
export type EventPointAwardRow = EventAwardInput & {
	pointTypeLabel: string;
	pointTypeActive: boolean;
	pointTypePosition: number;
};

listAwards(actor: Actor, eventId: string): Promise<EventPointAwardRow[]>;
removeRetiredAward(actor: Actor, eventId: string, pointTypeId: string): Promise<{ removed: boolean }>;
```

- Guarantees: normal `setAwards` saves never remove inactive award rows.

- [ ] **Step 1: Write the failing retired-award repository tests**

Add a focused describe block using the existing D1 test helpers:

```ts
async function seedPointType(input: {
	id: string;
	key: string;
	label: string;
	active: boolean;
	position?: number;
}) {
	await env.DB.prepare(
		`INSERT INTO point_types (id, key, label, counts_toward_retention, active, position)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET label = excluded.label, active = excluded.active, position = excluded.position`,
	).bind(
		input.id,
		input.key,
		input.label,
		input.key === "retention" ? 1 : 0,
		input.active ? 1 : 0,
		input.position ?? 1,
	).run();
}

async function seedActiveAward(eventId: string, pointTypeId: string, points: number) {
	await env.DB.prepare(
		"INSERT INTO event_point_awards (event_id, point_type_id, points) VALUES (?, ?, ?)",
	).bind(eventId, pointTypeId, points).run();
}

async function seedAttendanceHistory(eventId: string, memberId: string, pointTypeId: string, points: number) {
	await env.DB.prepare(
		`INSERT INTO retention_records
		 (id, member_id, term_id, event_id, point_type_id, points, reason, source, recorded_by, recorded_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 'event_attendance', ?, ?)`,
	).bind(
		`ret_${eventId}_${memberId}_${pointTypeId}`,
		memberId,
		"term_1",
		eventId,
		pointTypeId,
		points,
		"Attendance",
		"mem_events",
		Date.now(),
	).run();
}

async function seedRetiredAwardWithHistory(
	eventId: string,
	pointTypeId: string,
	memberId: string,
	points: number,
) {
	await seedPointType({
		id: pointTypeId,
		key: "frontliner",
		label: "Frontliner",
		active: false,
		position: 2,
	});
	await seedActiveAward(eventId, pointTypeId, points);
	await seedAttendanceHistory(eventId, memberId, pointTypeId, points);
}

it("preserves an inactive award and its history when active awards are saved", async () => {
	await seedPointType({ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 1 });
	await seedPointType({ id: "pt_frontliner", key: "frontliner", label: "Frontliner", active: true, position: 2 });
	const event = await makeApprovedEvent();
	await repo.setAwards(eventsAdmin, event.id, [
		{ pointTypeId: "pt_retention", points: 2 },
		{ pointTypeId: "pt_frontliner", points: 3 },
	]);
	await seedAttendanceHistory(event.id, "mem_a", "pt_frontliner", 3);
	await env.DB.prepare("UPDATE point_types SET active = 0 WHERE id = ?").bind("pt_frontliner").run();

	await repo.setAwards(eventsAdmin, event.id, [{ pointTypeId: "pt_retention", points: 4 }]);

	const award = await env.DB.prepare(
		"SELECT points FROM event_point_awards WHERE event_id = ? AND point_type_id = ?",
	).bind(event.id, "pt_frontliner").first<{ points: number }>();
	const history = await env.DB.prepare(
		"SELECT points FROM retention_records WHERE event_id = ? AND member_id = ? AND point_type_id = ?",
	).bind(event.id, "mem_a", "pt_frontliner").first<{ points: number }>();
	expect(award?.points).toBe(3);
	expect(history?.points).toBe(3);
});

it("removes only the retired award through the explicit operation", async () => {
	const event = await makeApprovedEvent();
	await seedRetiredAwardWithHistory(event.id, "pt_frontliner", "mem_a", 3);

	await expect(repo.removeRetiredAward(eventsAdmin, event.id, "pt_frontliner")).resolves.toEqual({ removed: true });

	const award = await env.DB.prepare(
		"SELECT 1 FROM event_point_awards WHERE event_id = ? AND point_type_id = ?",
	).bind(event.id, "pt_frontliner").first();
	const history = await env.DB.prepare(
		"SELECT points FROM retention_records WHERE event_id = ? AND member_id = ? AND point_type_id = ?",
	).bind(event.id, "mem_a", "pt_frontliner").first<{ points: number }>();
	expect(award).toBeNull();
	expect(history?.points).toBe(3);
});

it("refuses explicit retired removal for an active type", async () => {
	const event = await makeApprovedEvent();
	await seedPointType({ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 1 });
	await seedActiveAward(event.id, "pt_retention", 2);
	await expect(repo.removeRetiredAward(eventsAdmin, event.id, "pt_retention")).rejects.toThrow(
		"Active awards must be removed by saving the award editor.",
	);
});

it("lists active and retired awards with point-type metadata", async () => {
	const event = await makeApprovedEvent();
	await seedPointType({ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 1 });
	await seedActiveAward(event.id, "pt_retention", 2);
	await seedRetiredAwardWithHistory(event.id, "pt_frontliner", "mem_a", 3);
	expect(await repo.listAwards(outsider, event.id)).toEqual([
		{
			pointTypeId: "pt_retention",
			points: 2,
			pointTypeLabel: "Retention",
			pointTypeActive: true,
			pointTypePosition: 1,
		},
		{
			pointTypeId: "pt_frontliner",
			points: 3,
			pointTypeLabel: "Frontliner",
			pointTypeActive: false,
			pointTypePosition: 2,
		},
	]);
});
```

- [ ] **Step 2: Run the focused repository tests to verify they fail**

Run:

```powershell
pnpm exec vitest run "src/db/repositories/events.integration.test.ts"
```

Expected: FAIL because inactive awards are removed by replacement or `removeRetiredAward` is absent.

- [ ] **Step 3: Restrict normal replacement to active award rows**

In the B2 `setAwards` atomic batch, scope deletion of existing award definitions to active types:

```ts
db.delete(eventPointAwards).where(
	and(
		eq(eventPointAwards.eventId, eventId),
		inArray(
			eventPointAwards.pointTypeId,
			db.select({ id: pointTypes.id }).from(pointTypes).where(eq(pointTypes.active, true)),
		),
	),
)
```

Keep B2 validation unchanged: submitted IDs must be active. Keep its retention-record reconciliation restriction to active point types unchanged.

- [ ] **Step 4: Implement the award-list projection**

Add to `EventsRepository`:

```ts
listAwards(actor: Actor, eventId: string): Promise<EventPointAwardRow[]>;
```

Implement the projection without filtering inactive types:

```ts
async listAwards(_actor, eventId) {
	const event = await loadEvent(db, eventId);
	if (!event) throw new Error("Event not found.");
	return db
		.select({
			pointTypeId: eventPointAwards.pointTypeId,
			points: eventPointAwards.points,
			pointTypeLabel: pointTypes.label,
			pointTypeActive: pointTypes.active,
			pointTypePosition: pointTypes.position,
		})
		.from(eventPointAwards)
		.innerJoin(pointTypes, eq(pointTypes.id, eventPointAwards.pointTypeId))
		.where(eq(eventPointAwards.eventId, eventId))
		.orderBy(asc(pointTypes.position), asc(pointTypes.label));
}
```

- [ ] **Step 5: Implement explicit retired-award removal**

Add to `EventsRepository`:

```ts
removeRetiredAward(actor: Actor, eventId: string, pointTypeId: string): Promise<{ removed: boolean }>;
```

Implement it with these checks:

```ts
async removeRetiredAward(actor, eventId, pointTypeId) {
	if (!can(actor, "event:points")) throw new Error("Not authorized to set event points.");
	const event = await loadEvent(db, eventId);
	if (!event) throw new Error("Event not found.");
	const [type] = await db
		.select({ active: pointTypes.active })
		.from(pointTypes)
		.where(eq(pointTypes.id, pointTypeId))
		.limit(1);
	if (!type) throw new Error("Point type not found.");
	if (type.active) throw new Error("Active awards must be removed by saving the award editor.");
	const removed = await db
		.delete(eventPointAwards)
		.where(and(eq(eventPointAwards.eventId, eventId), eq(eventPointAwards.pointTypeId, pointTypeId)))
		.returning({ pointTypeId: eventPointAwards.pointTypeId });
	await audit.record(actor, {
		action: "event:remove_retired_award",
		targetType: "event",
		targetId: eventId,
		category: "event",
	});
	return { removed: removed.length > 0 };
}
```

Do not delete from `retention_records`.

- [ ] **Step 6: Run the repository tests**

Run:

```powershell
pnpm exec vitest run "src/db/repositories/events.integration.test.ts"
```

Expected: PASS, including all B2 award and reconciliation tests.

- [ ] **Step 7: Commit**

```powershell
git add "src/db/repositories/events.ts" "src/db/repositories/events.integration.test.ts"
git commit -m "feat: preserve retired event awards"
```

### Task 4: Replace the Event Points Panel with the Per-Type Editor

**Files:**
- Create: `src/app/portal/calendar/[eventId]/award-editor-input.ts`
- Create: `src/app/portal/calendar/[eventId]/award-editor-input.test.ts`
- Create: `src/app/portal/calendar/[eventId]/event-awards-editor.tsx`
- Modify: `src/app/portal/calendar/[eventId]/actions.ts`
- Modify: `src/app/portal/calendar/[eventId]/event-manage-panel.tsx`
- Modify: `src/app/portal/calendar/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `PointTypeRow`, `EventPointAwardRow`, B2 `EventAwardInput`, `eventsContract.setAwards.input`, `repositories.events.listAwards()`, `repositories.events.setAwards()`, and `repositories.events.removeRetiredAward()`.
- Produces: `buildAwardEditorRows()`, `parseActiveAwardValues()`, `formatAwardSummary()`, `setAwardsAction()`, and `removeRetiredAwardAction()`.

- [ ] **Step 1: Write the failing pure helper tests**

```ts
import { describe, expect, it } from "vitest";
import {
	buildAwardEditorRows,
	formatAwardSummary,
	parseActiveAwardValues,
} from "./award-editor-input";

const types = [
	{ id: "pt_retention", key: "retention", label: "Retention", countsTowardRetention: true, active: true, position: 1 },
	{ id: "pt_frontliner", key: "frontliner", label: "Frontliner", countsTowardRetention: false, active: false, position: 2 },
	{ id: "pt_project_lead", key: "project_lead", label: "Project Lead", countsTowardRetention: false, active: true, position: 3 },
];

const awards = [
	{ pointTypeId: "pt_retention", points: 2, pointTypeLabel: "Retention", pointTypeActive: true, pointTypePosition: 1 },
	{ pointTypeId: "pt_frontliner", points: 3, pointTypeLabel: "Frontliner", pointTypeActive: false, pointTypePosition: 2 },
];

describe("event award editor helpers", () => {
	it("renders every active type and only awarded retired types", () => {
		expect(buildAwardEditorRows(types, awards)).toEqual([
			{ pointTypeId: "pt_retention", label: "Retention", value: "2", retired: false },
			{ pointTypeId: "pt_project_lead", label: "Project Lead", value: "", retired: false },
			{ pointTypeId: "pt_frontliner", label: "Frontliner", value: "3", retired: true },
		]);
	});

	it("parses only nonblank active rows", () => {
		const rows = buildAwardEditorRows(types, awards);
		expect(parseActiveAwardValues(rows, {
			pt_retention: "4",
			pt_project_lead: "",
			pt_frontliner: "99",
		})).toEqual([{ pointTypeId: "pt_retention", points: 4 }]);
	});

	it("rejects decimals and out-of-range values", () => {
		const rows = buildAwardEditorRows(types, awards);
		expect(() => parseActiveAwardValues(rows, { pt_retention: "1.5" })).toThrow("Retention");
		expect(() => parseActiveAwardValues(rows, { pt_retention: "101" })).toThrow("Retention");
	});

	it("formats only currently active awards", () => {
		expect(formatAwardSummary(awards)).toBe("Worth: 2 Retention");
		expect(formatAwardSummary([])).toBe("Worth: No points");
	});
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```powershell
pnpm exec vitest run "src/app/portal/calendar/[eventId]/award-editor-input.test.ts"
```

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the pure editor helpers**

```ts
import type { EventAwardInput } from "@/db/types";
import type { EventPointAwardRow } from "@/db/repositories/events";
import type { PointTypeRow } from "@/db/repositories/pointTypes";

export type AwardEditorRow = {
	pointTypeId: string;
	label: string;
	value: string;
	retired: boolean;
};

export function buildAwardEditorRows(
	types: PointTypeRow[],
	awards: EventPointAwardRow[],
): AwardEditorRow[] {
	const byType = new Map(awards.map((award) => [award.pointTypeId, award]));
	const active = types
		.filter((type) => type.active)
		.map((type) => ({
			pointTypeId: type.id,
			label: type.label,
			value: byType.get(type.id)?.points.toString() ?? "",
			retired: false,
		}));
	const retired = awards
		.filter((award) => !award.pointTypeActive)
		.sort((a, b) => a.pointTypePosition - b.pointTypePosition || a.pointTypeLabel.localeCompare(b.pointTypeLabel))
		.map((award) => ({
			pointTypeId: award.pointTypeId,
			label: award.pointTypeLabel,
			value: award.points.toString(),
			retired: true,
		}));
	return [...active, ...retired];
}

export function parseActiveAwardValues(
	rows: AwardEditorRow[],
	values: Record<string, string>,
): EventAwardInput[] {
	return rows.flatMap((row) => {
		if (row.retired) return [];
		const raw = values[row.pointTypeId]?.trim() ?? "";
		if (raw === "") return [];
		const points = Number(raw);
		if (!Number.isInteger(points) || points < -100 || points > 100) {
			throw new Error(`${row.label} must be a whole number from -100 to 100.`);
		}
		return [{ pointTypeId: row.pointTypeId, points }];
	});
}

export function formatAwardSummary(awards: EventPointAwardRow[]): string {
	const text = awards
		.filter((award) => award.pointTypeActive)
		.map((award) => `${award.points} ${award.pointTypeLabel}`)
		.join(" · ");
	return `Worth: ${text || "No points"}`;
}
```

- [ ] **Step 4: Run the helper test**

Run:

```powershell
pnpm exec vitest run "src/app/portal/calendar/[eventId]/award-editor-input.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Add the new server actions while retaining the old action temporarily**

Add to `actions.ts`:

```ts
import { eventsContract } from "@/db/contract/events";

export async function setAwardsAction(eventId: string, awards: unknown) {
	const actor = await requireActor();
	const input = eventsContract.setAwards.input.parse({ eventId, awards });
	const repositories = await getRepositories();
	const result = await repositories.events.setAwards(actor, input.eventId, input.awards);
	revalidate(input.eventId);
	return result;
}

export async function removeRetiredAwardAction(eventId: string, pointTypeId: string) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const result = await repositories.events.removeRetiredAward(actor, eventId, pointTypeId);
	revalidate(eventId);
	return result;
}
```

Keep `setPointsAction` in this step. Its deletion belongs to Task 7 after the new editor is active.

- [ ] **Step 6: Implement the client editor**

`event-awards-editor.tsx` must:

- Initialize a value map from non-retired rows.
- Render a number `Input` for every active row with `min={-100}`, `max={100}`, and `step={1}`.
- Render retired rows as read-only text: `{label} - retired, no longer grants points`.
- Render a `Trash2` icon button with visible `Remove` text for each retired row.
- Call `setAwardsAction(eventId, parseActiveAwardValues(rows, values))` from the Save button.
- Call `removeRetiredAwardAction(eventId, pointTypeId)` only from the retired row's Remove button.
- Disable all controls during their transition and refresh after success.
- Use no nested cards.

Core action calls:

```tsx
function save() {
	setError(null);
	startTransition(async () => {
		try {
			const result = await setAwardsAction(eventId, parseActiveAwardValues(rows, values));
			setResult(`Updated ${result.updated} attendee record(s).`);
			router.refresh();
		} catch (error) {
			setError(error instanceof Error ? error.message : "Could not update event awards.");
		}
	});
}

function removeRetired(pointTypeId: string) {
	setError(null);
	startTransition(async () => {
		try {
			await removeRetiredAwardAction(eventId, pointTypeId);
			router.refresh();
		} catch (error) {
			setError(error instanceof Error ? error.message : "Could not remove the retired award.");
		}
	});
}
```

- [ ] **Step 7: Load award data and replace the old panel**

In `page.tsx`:

- Load `repositories.pointTypes.list()` and `repositories.events.listAwards(actor, eventId)`.
- Keep a distinct unavailable state instead of converting a failed load into an empty editable award set.
- Render `formatAwardSummary(awards)` in the public event detail.
- Build rows with `buildAwardEditorRows(pointTypes, awards)` for `event:points` holders.
- Remove `points: managed.points` from the `ManageEvent` prop.

In `event-manage-panel.tsx`:

- Remove `points` from `ManageEvent`.
- Remove the `setPointsAction` import.
- Delete the old local `PointsSection`.
- Render `EventAwardsEditor` in the existing Points tab.
- Pass `event.id`, editor rows, and the unavailable state.

The editor call must now be the only event-detail points write:

```tsx
{section === "points" ? (
	<EventAwardsEditor eventId={event.id} rows={awardRows} unavailable={awardsUnavailable} />
) : null}
```

- [ ] **Step 8: Prove the old UI no longer reads or calls the compatibility path**

Run:

```powershell
rg -n "event\.points|managed\.points|setPointsAction|Points per attendee|Apply to all" "src/app/portal/calendar/[eventId]"
```

Expected: no matches.

Run:

```powershell
pnpm exec vitest run "src/app/portal/calendar/[eventId]/award-editor-input.test.ts" "src/db/repositories/events.integration.test.ts"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add "src/app/portal/calendar/[eventId]" "src/db/repositories/events.ts" "src/db/repositories/events.integration.test.ts"
git commit -m "feat: edit event awards by point type"
```

### Task 5: Add the Profile Point Breakdown

**Files:**
- Create: `src/app/portal/profile/point-breakdown.ts`
- Create: `src/app/portal/profile/point-breakdown.test.ts`
- Modify: `src/app/portal/profile/page.tsx`

**Interfaces:**
- Consumes: active `PointTypeRow[]`, B2 `TypedRetentionRecord[]`, and `MyHistorySummary["status"]`.
- Produces: `buildPointBreakdown(types, records): ProfilePointRow[]`.

- [ ] **Step 1: Write the failing breakdown tests**

```ts
import { describe, expect, it } from "vitest";
import { buildPointBreakdown } from "./point-breakdown";

const types = [
	{ id: "pt_retention", key: "retention", label: "Retention", countsTowardRetention: true, active: true, position: 1 },
	{ id: "pt_frontliner", key: "frontliner", label: "Frontliner", countsTowardRetention: false, active: true, position: 2 },
	{ id: "pt_project_lead", key: "project_lead", label: "Project Lead", countsTowardRetention: false, active: true, position: 3 },
	{ id: "pt_retired", key: "retired", label: "Retired", countsTowardRetention: false, active: false, position: 4 },
];

const records = [
	{ pointTypeId: "pt_retention", points: 8 },
	{ pointTypeId: "pt_retention", points: 2 },
	{ pointTypeId: "pt_frontliner", points: 3 },
	{ pointTypeId: "pt_retired", points: 50 },
];

describe("buildPointBreakdown", () => {
	it("returns one ordered row per active type including zero totals", () => {
		expect(buildPointBreakdown(types, records)).toEqual([
			{ pointTypeId: "pt_retention", label: "Retention", totalPoints: 10, retention: true },
			{ pointTypeId: "pt_frontliner", label: "Frontliner", totalPoints: 3, retention: false },
			{ pointTypeId: "pt_project_lead", label: "Project Lead", totalPoints: 0, retention: false },
		]);
	});

	it("ignores null points", () => {
		expect(buildPointBreakdown(types, [{ pointTypeId: "pt_retention", points: null }])[0]?.totalPoints).toBe(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
pnpm exec vitest run "src/app/portal/profile/point-breakdown.test.ts"
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the pure reducer**

```ts
import type { PointTypeRow } from "@/db/repositories/pointTypes";

type TypedPoints = { pointTypeId: string; points: number | null };

export type ProfilePointRow = {
	pointTypeId: string;
	label: string;
	totalPoints: number;
	retention: boolean;
};

export function buildPointBreakdown(types: PointTypeRow[], records: TypedPoints[]): ProfilePointRow[] {
	const totals = new Map<string, number>();
	for (const record of records) {
		totals.set(record.pointTypeId, (totals.get(record.pointTypeId) ?? 0) + (record.points ?? 0));
	}
	return types
		.filter((type) => type.active)
		.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label))
		.map((type) => ({
			pointTypeId: type.id,
			label: type.label,
			totalPoints: totals.get(type.id) ?? 0,
			retention: type.key === "retention",
		}));
}
```

- [ ] **Step 4: Run the helper test**

Run:

```powershell
pnpm exec vitest run "src/app/portal/profile/point-breakdown.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Render the breakdown on the profile**

In `profile/page.tsx`:

- Load `repositories.retention.myHistory(actor, {})` and `repositories.pointTypes.list()` beside the existing member and overview reads.
- Build rows with `buildPointBreakdown`.
- Remove the single Retention tile from the existing three-stat array.
- Add one shallow `Card` titled `Points this term`.
- Render one unframed list row per active point type.
- Render the Retention row with the existing status badge vocabulary and threshold text from `history.summary`.
- Render other point types as plain counts with no retained/probation styling.
- If point metadata or history fails to load, render `Points are unavailable right now.` instead of zero rows that look authoritative.

Status mapping:

```ts
const STATUS_LABEL = {
	retained: "Retained",
	on_track: "On track",
	probation: "Probation",
} as const;
```

Row shape:

```tsx
{pointRows.map((row) => (
	<div key={row.pointTypeId} className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
		<div>
			<p className="text-sm font-medium">{row.label}</p>
			{row.retention && history.summary ? (
				<p className="text-xs text-muted-foreground">
					Retained at {history.summary.retainedAt}
				</p>
			) : null}
		</div>
		<div className="flex items-center gap-3">
			<span className="font-heading text-xl tabular-nums">{row.totalPoints}</span>
			{row.retention && history.summary ? (
				<Badge variant={history.summary.status === "probation" ? "warn" : "secondary"}>
					{STATUS_LABEL[history.summary.status]}
				</Badge>
			) : null}
		</div>
	</div>
))}
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
pnpm exec vitest run "src/app/portal/profile/point-breakdown.test.ts" "src/db/repositories/retention.integration.test.ts"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add "src/app/portal/profile"
git commit -m "feat: show profile point breakdown"
```

### Task 6: Label History and Filter the Leaderboard by Type

**Files:**
- Modify: `src/components/retention-history.tsx`
- Create: `src/app/portal/events/point-type-selection.ts`
- Create: `src/app/portal/events/point-type-selection.test.ts`
- Modify: `src/app/portal/events/page.tsx`
- Modify: `src/db/repositories/retention.ts`
- Modify: `src/db/repositories/retention.integration.test.ts`

**Interfaces:**
- Consumes: B2 `TypedRetentionRecord.pointTypeLabel`, B3 `PointTypeRow[]`, and existing `publicLeaderboard`.
- Produces: `selectLeaderboardPointTypeId(requested, types): string | null` and `publicLeaderboard(actor, input)` with required `pointTypeId`.

- [ ] **Step 1: Add the member history label**

Change each record's trailing value from an unlabelled number to a typed value:

```tsx
<span className="text-sm tabular-nums">
	{record.points ?? "n/a"} {record.pointTypeLabel}
</span>
```

Do not add a render test for this one-line presentation change.

- [ ] **Step 2: Write the failing selection helper tests**

```ts
import { describe, expect, it } from "vitest";
import { selectLeaderboardPointTypeId } from "./point-type-selection";

const types = [
	{ id: "pt_frontliner", key: "frontliner", label: "Frontliner", active: true, position: 2 },
	{ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 1 },
	{ id: "pt_retired", key: "retired", label: "Retired", active: false, position: 3 },
];

describe("selectLeaderboardPointTypeId", () => {
	it("defaults to Retention", () => {
		expect(selectLeaderboardPointTypeId(undefined, types)).toBe("pt_retention");
	});

	it("honors any known selected type, including retired history", () => {
		expect(selectLeaderboardPointTypeId("pt_frontliner", types)).toBe("pt_frontliner");
		expect(selectLeaderboardPointTypeId("pt_retired", types)).toBe("pt_retired");
	});

	it("falls back from an unknown type and handles no types", () => {
		expect(selectLeaderboardPointTypeId("unknown", types)).toBe("pt_retention");
		expect(selectLeaderboardPointTypeId(undefined, [])).toBeNull();
	});
});
```

- [ ] **Step 3: Run the selection test to verify it fails**

Run:

```powershell
pnpm exec vitest run "src/app/portal/events/point-type-selection.test.ts"
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 4: Implement the selection helper**

```ts
type SelectablePointType = {
	id: string;
	key: string;
	active: boolean;
	position: number;
};

export function selectLeaderboardPointTypeId(
	requested: string | undefined,
	types: SelectablePointType[],
): string | null {
	if (requested && types.some((type) => type.id === requested)) return requested;
	return types.find((type) => type.key === "retention")?.id ?? types[0]?.id ?? null;
}
```

- [ ] **Step 5: Write the failing selected-type leaderboard integration test**

Add to `retention.integration.test.ts`:

```ts
it("ranks public leaderboard rows by the selected point type", async () => {
	await insertRecord({ id: "ret_a", memberId: "mem_a", pointTypeId: "pt_retention", points: 10 });
	await insertRecord({ id: "front_a", memberId: "mem_a", pointTypeId: "pt_frontliner", points: 1 });
	await insertRecord({ id: "ret_b", memberId: "mem_b", pointTypeId: "pt_retention", points: 5 });
	await insertRecord({ id: "front_b", memberId: "mem_b", pointTypeId: "pt_frontliner", points: 20 });

	const retentionBoard = await repo.publicLeaderboard(plainMember, {
		termId: "term_1",
		pointTypeId: "pt_retention",
	});
	const frontlinerBoard = await repo.publicLeaderboard(plainMember, {
		termId: "term_1",
		pointTypeId: "pt_frontliner",
	});

	expect(retentionBoard.map((row) => [row.memberId, row.totalPoints])).toEqual([
		["mem_a", 10],
		["mem_b", 5],
	]);
	expect(frontlinerBoard.map((row) => [row.memberId, row.totalPoints])).toEqual([
		["mem_b", 20],
		["mem_a", 1],
	]);
});
```

- [ ] **Step 6: Run the repository test to verify it fails**

Run:

```powershell
pnpm exec vitest run "src/db/repositories/retention.integration.test.ts"
```

Expected: FAIL because `publicLeaderboard` does not require or filter by `pointTypeId`.

- [ ] **Step 7: Filter only the member-facing leaderboard**

Split the input types so the B2 retention-only admin leaderboard remains unchanged:

```ts
export type LeaderboardInput = { termId: string; limit?: number; offset?: number };
export type PublicLeaderboardInput = LeaderboardInput & { pointTypeId: string };
```

Update the repository interface:

```ts
publicLeaderboard(actor: Actor, input: PublicLeaderboardInput): Promise<LeaderboardRow[]>;
```

In `publicLeaderboard`, replace the B2 retention-bearing subquery predicate with:

```ts
eq(retentionRecords.pointTypeId, input.pointTypeId)
```

Keep term, member, limit, offset, grouping, and descending total ordering unchanged. Do not change `leaderboard()` or `retentionContract.leaderboard`; those remain retention-only B2 totals.

Update every existing `publicLeaderboard` test call to pass `pointTypeId: "pt_retention"` so its previous Retention expectations remain explicit.

- [ ] **Step 8: Wire the selector into the page**

Update `searchParams`:

```ts
searchParams: Promise<{ termId?: string; view?: string; pointTypeId?: string }>;
```

Load point types, resolve the selection, and pass it into the query:

```ts
const pointTypeLoad = await repositories.pointTypes
	.list()
	.then((rows) => ({ ok: true as const, rows }))
	.catch(() => ({ ok: false as const, rows: [] }));
const selectedPointTypeId = selectLeaderboardPointTypeId(params.pointTypeId, pointTypeLoad.rows);
const leaderboard =
	view === "leaderboard" && pointTypeLoad.ok && selectedTermId && selectedPointTypeId
		? await repositories.retention.publicLeaderboard(actor, {
				termId: selectedTermId,
				pointTypeId: selectedPointTypeId,
				limit: 25,
			}).catch(() => [])
		: [];
```

Above the leaderboard, render a GET form using the existing `Select` and `Button` components:

```tsx
<form method="get" className="flex flex-wrap items-end gap-3">
	<input type="hidden" name="view" value="leaderboard" />
	<input type="hidden" name="termId" value={selectedTermId} />
	<label className="grid gap-1.5 text-sm">
		<span className="font-medium">Point type</span>
		<Select name="pointTypeId" defaultValue={selectedPointTypeId ?? ""}>
			{pointTypeLoad.rows.map((type) => (
				<option key={type.id} value={type.id}>
					{type.label}{type.active ? "" : " (retired)"}
				</option>
			))}
		</Select>
	</label>
	<Button type="submit" variant="secondary">
		<Filter />
		View
	</Button>
</form>
```

Keep Retention selected when `pointTypeId` is absent. When `pointTypeLoad.ok` is false, render `Point types are unavailable right now.` instead of the form or empty leaderboard.

- [ ] **Step 9: Run focused tests**

Run:

```powershell
pnpm exec vitest run "src/app/portal/events/point-type-selection.test.ts" "src/db/repositories/retention.integration.test.ts"
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add "src/components/retention-history.tsx" "src/app/portal/events" "src/db/repositories/retention.ts" "src/db/repositories/retention.integration.test.ts"
git commit -m "feat: filter point leaderboards by type"
```

### Task 7: Remove the B2 Shim and Legacy Mirror Write

**Files:**
- Modify: `src/app/portal/calendar/[eventId]/actions.ts`
- Modify: `src/db/repositories/events.ts`
- Modify: `src/db/repositories/events.integration.test.ts`
- Modify: `src/db/contract/events.ts`
- Modify: `src/db/contract/events.test.ts`

**Interfaces:**
- Consumes: the Task 4 event editor, which already calls `setAwardsAction`.
- Produces: no `setPointsAction`, no `EventsRepository.setPoints`, no `eventsContract.setPoints`, and no `setAwards` write to `crs_events.points`.

- [ ] **Step 1: Verify the replacement editor is live before cleanup**

Run:

```powershell
rg -n "setAwardsAction|EventAwardsEditor" "src/app/portal/calendar/[eventId]"
```

Expected: the Points tab renders `EventAwardsEditor`, and the editor calls `setAwardsAction`.

Run:

```powershell
rg -n "event\.points|managed\.points|setPointsAction" "src/app/portal/calendar/[eventId]"
```

Expected: no matches. Stop if either check fails.

- [ ] **Step 2: Write the failing no-mirror regression test**

In the B2 `setAwards` integration describe block:

```ts
it("does not mirror Retention awards into the deprecated event points column", async () => {
	const event = await makeApprovedEvent();
	await env.DB.prepare("UPDATE crs_events SET points = ? WHERE id = ?").bind(91, event.id).run();

	await repo.setAwards(eventsAdmin, event.id, [{ pointTypeId: "pt_retention", points: 4 }]);

	const row = await env.DB.prepare("SELECT points FROM crs_events WHERE id = ?")
		.bind(event.id)
		.first<{ points: number | null }>();
	expect(row?.points).toBe(91);
});
```

The sentinel proves B3 stopped writing the mirror without dropping or nulling the column.

- [ ] **Step 3: Run the test to verify it fails**

Run:

```powershell
pnpm exec vitest run "src/db/repositories/events.integration.test.ts"
```

Expected: FAIL because B2 `setAwards` still mirrors Retention into `crs_events.points`.

- [ ] **Step 4: Remove the mirror write**

Delete only the `crsEvents.points` update from the B2 `setAwards` atomic batch. Keep:

- Award replacement.
- Set-based attendee reconciliation.
- Active-type restriction.
- Audit write.
- Best-effort notifications.
- `updated` return shape.

Do not edit `src/db/schema.ts` or a migration.

- [ ] **Step 5: Remove the compatibility symbols**

Delete:

```ts
export async function setPointsAction(eventId: string, points: number | null)
```

Delete from `EventsRepository` and its implementation:

```ts
setPoints(actor: Actor, eventId: string, points: number | null): Promise<{ updated: number }>;
```

Delete from `eventsContract`:

```ts
setPoints: operation({
	input: z.object({ eventId: z.string().min(1), points: z.number().int().min(-100).max(100).nullable() }),
	output: z.object({ updated: z.number().int().min(0) }),
	auth: "admin",
	permission: "event:points",
	sharedDev: "deny",
}),
```

Delete B2 shim-only tests. Preserve and rerun all `setAwards`, scan, authorization, reconciliation, inactive-history, and no-mirror tests.

In `src/db/contract/events.test.ts`, delete only the `eventsContract.setPoints` assertion. Keep the bounded-array and `sharedDev: "deny"` assertions for `eventsContract.setAwards`.

- [ ] **Step 6: Prove only the deprecated column definition and non-UI projections remain**

Run:

```powershell
rg -n "setPointsAction|setPoints\(" src
```

Expected: no matches.

Run:

```powershell
rg -n "crsEvents\.points" "src/db/repositories/events.ts"
```

Expected: no write in `setAwards`. Reads or create-time `points: null` may remain because the column is deliberately retained.

Run:

```powershell
rg -n "event\.points|managed\.points" "src/app"
```

Expected: no matches.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
pnpm exec vitest run "src/db/repositories/events.integration.test.ts" "src/db/contract/events.test.ts" "src/app/portal/calendar/[eventId]/award-editor-input.test.ts"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add "src/app/portal/calendar/[eventId]/actions.ts" "src/db/repositories/events.ts" "src/db/repositories/events.integration.test.ts" "src/db/contract/events.ts" "src/db/contract/events.test.ts"
git commit -m "refactor: remove legacy event points shim"
```

### Task 8: Verify B3 End to End

**Files:**
- Verify only. Do not add a component test, dependency, migration, schema change, or deployment script.

**Interfaces:**
- Consumes: all B3 commits.
- Produces: test, build, responsive-layout, cleanup, and graph evidence.

- [ ] **Step 1: Run every new pure test**

Run:

```powershell
pnpm exec vitest run "src/app/portal/admin/system/point-types/input.test.ts" "src/app/portal/calendar/[eventId]/award-editor-input.test.ts" "src/app/portal/profile/point-breakdown.test.ts" "src/app/portal/events/point-type-selection.test.ts"
```

Expected: PASS.

- [ ] **Step 2: Run the affected repository and navigation tests**

Run:

```powershell
pnpm exec vitest run "src/db/repositories/pointTypes.integration.test.ts" "src/db/repositories/events.integration.test.ts" "src/db/repositories/retention.integration.test.ts" "src/app/portal/admin/nav.test.ts"
```

Expected: PASS.

- [ ] **Step 3: Run the complete Workers test suite**

Run:

```powershell
pnpm test
```

Expected: PASS with only `.ts` tests in the Workers pool and no `better-sqlite3` import from tests.

- [ ] **Step 4: Run static verification**

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 5: Check forbidden changes and legacy cleanup**

Run:

```powershell
git diff --name-only -- "drizzle/migrations" "src/db/schema.ts" "wrangler*.jsonc"
```

Expected: no output.

Run:

```powershell
rg -n "setPointsAction|setPoints\(|event\.points|managed\.points" src
```

Expected: no output.

Run:

```powershell
rg -n "points" "src/db/schema.ts" "drizzle/migrations"
```

Expected: `crs_events.points` still exists. No drop or rename statement exists.

- [ ] **Step 6: Check responsive layouts**

Start the app:

```powershell
pnpm dev
```

At 390x844 and 1440x900, inspect:

- `/portal/admin/system/point-types`
- `/portal/calendar/<an-event-id>` with an event-points actor
- `/portal/profile`
- `/portal/events?view=leaderboard`

Verify:

- No horizontal page overflow.
- Admin rows wrap without clipping labels or controls.
- Active award inputs and retired rows remain distinct.
- The retired Remove button is visible and labelled.
- The profile shows every active point type and no inactive type.
- Retention status styling does not appear on non-Retention rows.
- The leaderboard selector defaults to Retention and changes the displayed ranking.

Stop the dev server after the check.

- [ ] **Step 7: Update the knowledge graph**

Run:

```powershell
graphify update .
```

Expected: the graph includes the point-type admin, event awards editor, profile breakdown, leaderboard selection, and removed shim relationships. Preserve unrelated pre-existing graph changes.

- [ ] **Step 8: Review the final diff**

Run:

```powershell
git status --short
git diff --stat
git log --oneline -7
```

Expected:

- Only B3 source, tests, and expected graph outputs are part of the B3 commits.
- No migration, schema, seed, or deployment file changed.
- Commits appear in this order:
  - `feat: add point type policy repository`
  - `feat: add point type administration`
  - `feat: preserve retired event awards`
  - `feat: edit event awards by point type`
  - `feat: show profile point breakdown`
  - `feat: filter point leaderboards by type`
  - `refactor: remove legacy event points shim`

## Deployment Note

B3 deliberately includes no D1 or deployment command. Removing `eventsContract.setPoints` changes a shared contract source file, but that operation is already `sharedDev: "deny"` in B2. A separately approved shared Worker deployment can synchronize the deployed bundle after B3; it is outside this plan and must not be run during these tasks.

## Self-Review Checklist

- Point-type reads, writes, immutable keys, authorization, and last-flag guards are covered by Task 1.
- Point-types admin route, parser, actions, navigation, and load failure are covered by Task 2.
- Inactive awarded types remain visible, read-only, labelled retired, and removable only through an explicit operation in Tasks 3 and 4.
- The event editor has one row per active type and calls `setAwards` before any compatibility cleanup in Task 4.
- Profile active-type rows, zero totals, and Retention-only status styling are covered by Task 5.
- Member history labels and selected-type leaderboard filtering with Retention default are covered by Task 6.
- `setPointsAction`, repository shim, contract operation, and mirror write are removed only in Task 7.
- `crs_events.points` remains present and no migration or schema change is planned.
- Every non-trivial UI parser or row-shaping function is a pure `.ts` helper with a Workers Vitest test.
- No component render test or `better-sqlite3` test import is planned.
- Type names and method signatures are consistent from B2 Preconditions through all tasks.
- No D1 migration, seed, reset, remote SQL, or deployment command appears as an execution step.
