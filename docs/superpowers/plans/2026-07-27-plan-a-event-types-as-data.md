# Plan A — Event Types as Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the hardcoded `casual | official | birthday` event-type enum in favour of admin-managed rows carrying label, colour, required permission, active flag, and ordering.

**Architecture:** `event_type_rules` gains columns **in place** — its physical table name never changes, because the deployed Worker queries it during the migrate-then-deploy gap. Type membership moves from a compile-time `z.enum` to a runtime lookup that **fails closed**. No table rebuilds anywhere.

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), Drizzle ORM over Cloudflare D1 (better-sqlite3 locally), zod contracts, Tailwind, vitest on `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-07-27-event-taxonomy-and-points-design.md` (§1, §9 Plan A). Four Codex adversarial review rounds; 21 findings applied.

## Global Constraints

- **No new npm dependency.**
- **Tests run in the Cloudflare Workers pool.** `vitest.config.mts` sets `include: ["src/**/*.test.ts", "scripts/**/*.test.ts"]` — **`.ts` only, never `.tsx`**. No jsdom, no React Testing Library. **Do not write component render tests.** Extract logic into pure `.ts` helpers and test those.
- **`better-sqlite3` cannot be imported by any test file.**
- **Never rename `event_type_rules`** and never drop a column. The deployed Worker runs against the new schema before the new Worker ships.
- **No table rebuilds.** `ALTER TABLE … ADD COLUMN` only, always with a non-null default when `NOT NULL`.
- **Do not touch `drizzle/migrations/meta/_journal.json`.** The migrations directory is the source of truth.
- Repository errors that must surface as HTTP 403 **must** start with `Not authorized`.
- **No points work.** `point_types`, `event_point_awards`, `retention_records.point_type_id`, and `setAwards` all belong to Plans B1–B3. Do not touch `crs_events.points`.
- Tabs for indentation.

---

### Task 1: Palette, schema columns, and migration 0011

**Files:**
- Create: `src/lib/event-type-colours.ts`
- Create: `src/lib/event-type-colours.test.ts`
- Create: `drizzle/migrations/0011_event_type_metadata.sql`
- Modify: `src/db/schema.ts` (the `eventTypeRules` table and the `EventType` type)

**Interfaces:**
- Consumes: nothing.
- Produces: `eventTypeColours: readonly string[]`, `colourClasses(token: string): { chip: string; dot: string }`, `EventType = string`, `seedEventTypes`, and four new columns on `event_type_rules`.

- [ ] **Step 1: Write the failing palette test**

Create `src/lib/event-type-colours.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { colourClasses, eventTypeColours } from "./event-type-colours";

describe("event type colours", () => {
	it("offers exactly the six supported tokens", () => {
		expect([...eventTypeColours]).toEqual(["primary", "accent", "emerald", "amber", "rose", "slate"]);
	});

	it("maps a known token to chip and dot classes", () => {
		const classes = colourClasses("emerald");
		expect(classes.chip).toContain("emerald");
		expect(classes.dot).toContain("emerald");
	});

	it("falls back to slate for an unknown token rather than rendering unstyled", () => {
		// A token written straight to the database, out-of-band of the admin form.
		expect(colourClasses("chartreuse")).toEqual(colourClasses("slate"));
		expect(colourClasses("")).toEqual(colourClasses("slate"));
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/event-type-colours.test.ts`
Expected: FAIL — `Failed to resolve import "./event-type-colours"`

- [ ] **Step 3: Write the palette module**

Create `src/lib/event-type-colours.ts`:

```ts
/**
 * Event type colours are stored as a token, not a hex value: Tailwind classes cannot be
 * generated at runtime, and a fixed palette guarantees legibility in light and dark mode.
 */
export const eventTypeColours = ["primary", "accent", "emerald", "amber", "rose", "slate"] as const;

export type EventTypeColour = (typeof eventTypeColours)[number];

const CLASSES: Record<EventTypeColour, { chip: string; dot: string }> = {
	primary: { chip: "bg-primary/10 text-foreground", dot: "bg-primary" },
	accent: { chip: "bg-accent/15 text-foreground", dot: "bg-accent" },
	emerald: { chip: "bg-emerald-500/15 text-foreground", dot: "bg-emerald-500" },
	amber: { chip: "bg-amber-500/15 text-foreground", dot: "bg-amber-500" },
	rose: { chip: "bg-rose-500/15 text-foreground", dot: "bg-rose-500" },
	slate: { chip: "bg-slate-500/15 text-foreground", dot: "bg-slate-500" },
};

/** Unknown tokens degrade to slate. Falling back visually is safe; falling open on a permission would not be. */
export function colourClasses(token: string): { chip: string; dot: string } {
	return CLASSES[token as EventTypeColour] ?? CLASSES.slate;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/event-type-colours.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Widen `EventType` and keep the seed list**

In `src/db/schema.ts`, replace the `eventTypes` const and `EventType` type (currently line 5-6) with:

```ts
/** The three types seeded by migration 0010; kept for seeding and tests only. Event types are data now — see event_type_rules. */
export const seedEventTypes = ["official", "casual", "birthday"] as const;
/** An event type is now an admin-managed key, validated at runtime against event_type_rules. */
export type EventType = string;
```

Then add the four columns to the existing `eventTypeRules` table definition:

```ts
export const eventTypeRules = sqliteTable("event_type_rules", {
	type: text("type").$type<EventType>().primaryKey(),
	// NULL means any member may create this event type.
	requiredPermission: text("required_permission"),
	label: text("label").notNull().default(""),
	colour: text("colour").notNull().default("slate"),
	active: integer("active").notNull().default(1),
	position: integer("position").notNull().default(0),
	updatedBy: text("updated_by").references(() => members.id, { onDelete: "set null" }),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});
```

Every existing `eventTypes` import now breaks. Fix each by importing `seedEventTypes` **only** where a seed list is genuinely meant; every other site is handled by later tasks in this plan. Run `pnpm typecheck` and note the failures — you will resolve them in Tasks 2, 4 and 7.

- [ ] **Step 6: Write the migration**

Create `drizzle/migrations/0011_event_type_metadata.sql`:

```sql
ALTER TABLE `event_type_rules` ADD `label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `event_type_rules` ADD `colour` text DEFAULT 'slate' NOT NULL;--> statement-breakpoint
ALTER TABLE `event_type_rules` ADD `active` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `event_type_rules` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `event_type_rules` SET `label` = 'Official', `colour` = 'primary', `position` = 0 WHERE `type` = 'official';--> statement-breakpoint
UPDATE `event_type_rules` SET `label` = 'Casual',   `colour` = 'emerald', `position` = 1 WHERE `type` = 'casual';--> statement-breakpoint
UPDATE `event_type_rules` SET `label` = 'Birthday', `colour` = 'accent',  `position` = 2 WHERE `type` = 'birthday';
```

Every `ADD COLUMN` is `NOT NULL` **with** a non-null default, which SQLite permits and which keeps the deployed Worker's reads valid during the migrate-then-deploy gap. No `REFERENCES`, so no rebuild.

- [ ] **Step 7: Apply locally and verify**

Run: `pnpm db:migrate:local:sqlite`
Expected: `Applied 0011_event_type_metadata.sql`

Then verify via bash:
```bash
node -e "const D=require('better-sqlite3');const db=new D('./.local/dev.db',{readonly:true});console.log(db.prepare('select type,label,colour,active,position from event_type_rules order by position').all());"
```
Expected: three rows — official/Official/primary, casual/Casual/emerald, birthday/Birthday/accent, all `active: 1`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/event-type-colours.ts src/lib/event-type-colours.test.ts drizzle/migrations/0011_event_type_metadata.sql src/db/schema.ts
git commit -m "feat(events): add label, colour, active and position to event types"
```

---

### Task 2: Event type repository — types as data, failing closed

**Files:**
- Modify: `src/db/repositories/eventTypeRules.ts` (substantial rewrite of the exported surface)
- Modify: `src/db/repositories/eventTypeRules.integration.test.ts`

**Interfaces:**
- Consumes: `eventTypeRules` table and `seedEventTypes` from Task 1.
- Produces:
```ts
type EventTypeRow = {
	type: string; label: string; colour: string;
	requiredPermission: string | null; active: boolean; position: number;
};
canCreateType(actor: Actor, rows: EventTypeRow[], type: string): boolean
allowedEventTypes(actor: Actor, rows: EventTypeRow[]): EventTypeRow[]
labelFor(rows: EventTypeRow[], type: string): string
createEventTypeRulesRepository(db, audit): {
	list(): Promise<EventTypeRow[]>;
	upsertType(actor: Actor, input: EventTypeUpsertInput): Promise<void>;
	setRequiredPermission(actor: Actor, type: string, permission: PermissionAction | null): Promise<void>;
}
type EventTypeUpsertInput = { type: string; label: string; colour: string; requiredPermission: string | null; active: boolean; position: number };
```
  Tasks 3–7 all consume `EventTypeRow`, `canCreateType`, `allowedEventTypes`, and `labelFor`.

- [ ] **Step 1: Write the failing tests**

Replace the body of `src/db/repositories/eventTypeRules.integration.test.ts`'s `describe` with these tests (keep the existing imports, actors, and `makeRepo` helper, adding `EventTypeRow` to the import list):

```ts
	it("returns full type rows ordered by position", async () => {
		const rows = await makeRepo().list();
		expect(rows.map((r) => r.type)).toEqual(["official", "casual", "birthday"]);
		expect(rows[0]).toMatchObject({ type: "official", label: "Official", colour: "primary", active: true });
	});

	it("FAILS CLOSED when no row exists for the key", async () => {
		// Once the table IS the type list, a missing row means the type does not exist.
		// This reverses the previous behaviour, where a missing row meant "no rule configured".
		const rows = await makeRepo().list();
		expect(canCreateType(superAdmin, rows, "does_not_exist")).toBe(false);
		expect(canCreateType(plainMember, rows, "does_not_exist")).toBe(false);
	});

	it("rejects an inactive type for everyone, including super", async () => {
		const repo = makeRepo();
		await repo.upsertType(superAdmin, {
			type: "casual", label: "Casual", colour: "emerald",
			requiredPermission: null, active: false, position: 1,
		});
		const rows = await repo.list();
		expect(canCreateType(plainMember, rows, "casual")).toBe(false);
		expect(canCreateType(superAdmin, rows, "casual")).toBe(false);
		expect(allowedEventTypes(plainMember, rows).map((r) => r.type)).not.toContain("casual");
	});

	it("gates active types by permission", async () => {
		const rows = await makeRepo().list();
		expect(canCreateType(plainMember, rows, "casual")).toBe(true);
		expect(canCreateType(plainMember, rows, "official")).toBe(false);
		expect(canCreateType(eventsAdmin, rows, "official")).toBe(true);
		expect(canCreateType(superAdmin, rows, "official")).toBe(true);
	});

	it("still fails closed on an unrecognized permission string", async () => {
		await env.DB.prepare("UPDATE event_type_rules SET required_permission = ? WHERE type = ?")
			.bind("event:create_restrictedd", "casual")
			.run();
		const rows = await makeRepo().list();
		expect(canCreateType(plainMember, rows, "casual")).toBe(false);
		expect(canCreateType(eventsAdmin, rows, "casual")).toBe(false);
		expect(canCreateType(superAdmin, rows, "casual")).toBe(true);
	});

	it("creates a brand new admin-defined type", async () => {
		const repo = makeRepo();
		await repo.upsertType(superAdmin, {
			type: "workshop", label: "Workshop", colour: "amber",
			requiredPermission: null, active: true, position: 3,
		});
		const rows = await repo.list();
		expect(rows.find((r) => r.type === "workshop")).toMatchObject({ label: "Workshop", colour: "amber", active: true });
		expect(canCreateType(plainMember, rows, "workshop")).toBe(true);
	});

	it("rejects an unknown colour token and a malformed key", async () => {
		const repo = makeRepo();
		const base = { label: "X", colour: "amber", requiredPermission: null, active: true, position: 9 };
		await expect(repo.upsertType(superAdmin, { ...base, type: "workshop", colour: "chartreuse" })).rejects.toThrow(
			"Unknown colour",
		);
		await expect(repo.upsertType(superAdmin, { ...base, type: "Not A Key!" })).rejects.toThrow("Invalid event type key");
	});

	it("rejects writes from an actor without role:assign", async () => {
		const base = {
			type: "workshop", label: "Workshop", colour: "amber",
			requiredPermission: null, active: true, position: 3,
		};
		await expect(makeRepo().upsertType(plainMember, base)).rejects.toThrow("Not authorized");
		await expect(makeRepo().setRequiredPermission(plainMember, "casual", null)).rejects.toThrow("Not authorized");
	});

	it("resolves a label, falling back to the key when the row is gone", async () => {
		const rows = await makeRepo().list();
		expect(labelFor(rows, "official")).toBe("Official");
		expect(labelFor(rows, "vanished")).toBe("vanished");
	});
```

Update the `beforeEach` seeding so the three rows carry their new columns:

```ts
		await env.DB.prepare("DELETE FROM event_type_rules").run();
		for (const [type, permission, label, colour, position] of [
			["official", "event:create_restricted", "Official", "primary", 0],
			["casual", null, "Casual", "emerald", 1],
			["birthday", null, "Birthday", "accent", 2],
		] as const) {
			await env.DB.prepare(
				"INSERT INTO event_type_rules (type, required_permission, label, colour, active, position) VALUES (?, ?, ?, ?, 1, ?)",
			)
				.bind(type, permission, label, colour, position)
				.run();
		}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/db/repositories/eventTypeRules.integration.test.ts`
Expected: FAIL — `upsertType is not a function`, `labelFor` not exported

- [ ] **Step 3: Rewrite the repository**

Replace the whole of `src/db/repositories/eventTypeRules.ts`:

```ts
import { asc } from "drizzle-orm";
import { eventTypeRules } from "@/db/schema";
import { eventTypeColours } from "@/lib/event-type-colours";
import type { Actor, PermissionAction } from "@/server/auth/permissions";
import { can, permissionActions } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type EventTypeRow = {
	type: string;
	label: string;
	colour: string;
	requiredPermission: string | null;
	active: boolean;
	position: number;
};

export type EventTypeUpsertInput = {
	type: string;
	label: string;
	colour: string;
	requiredPermission: string | null;
	active: boolean;
	position: number;
};

export type EventTypeRulesRepository = {
	list(): Promise<EventTypeRow[]>;
	upsertType(actor: Actor, input: EventTypeUpsertInput): Promise<void>;
	setRequiredPermission(actor: Actor, type: string, permission: PermissionAction | null): Promise<void>;
};

/** Admin-defined keys are lowercase identifiers; the shape is validated because membership no longer can be. */
export const EVENT_TYPE_KEY_PATTERN = /^[a-z0-9_]{1,32}$/;

/**
 * FAILS CLOSED on a missing row. Once this table IS the list of event types, a missing row
 * means the type does not exist — the opposite of the old behaviour, where a missing row meant
 * "no permission rule configured for this otherwise-valid type". Falling open here would let
 * any string through the repository now that the zod enums are gone.
 *
 * An inactive type is rejected for everyone, including super: retiring a type means no new
 * events may use it. Editing an existing event of that type is handled separately, by only
 * consulting this helper when the type actually changes.
 *
 * An unrecognized permission string still fails closed to super-only: `can()` short-circuits
 * super to true for any action value, while every non-super role matches only fixed literal
 * arrays, so a typo can never be included in one.
 */
export function canCreateType(actor: Actor, rows: EventTypeRow[], type: string): boolean {
	const row = rows.find((entry) => entry.type === type);
	if (!row) return false;
	if (!row.active) return false;
	if (row.requiredPermission === null) return true;
	return can(actor, row.requiredPermission as PermissionAction);
}

export function allowedEventTypes(actor: Actor, rows: EventTypeRow[]): EventTypeRow[] {
	return rows.filter((row) => canCreateType(actor, rows, row.type));
}

/** Falls back to the raw key so an event whose type row vanished still renders something truthful. */
export function labelFor(rows: EventTypeRow[], type: string): string {
	return rows.find((row) => row.type === type)?.label || type;
}

function toRow(raw: {
	type: string;
	label: string | null;
	colour: string | null;
	requiredPermission: string | null;
	active: number;
	position: number;
}): EventTypeRow {
	return {
		type: raw.type,
		// Migration 0011 defaults label to ''; show the key until an admin names it.
		label: raw.label || raw.type,
		colour: raw.colour || "slate",
		requiredPermission: raw.requiredPermission,
		active: raw.active === 1,
		position: raw.position,
	};
}

export function createEventTypeRulesRepository(db: Db, audit: AuditRepository): EventTypeRulesRepository {
	async function write(actor: Actor, input: EventTypeUpsertInput, action: string, detail: string) {
		await db
			.insert(eventTypeRules)
			.values({
				type: input.type,
				label: input.label,
				colour: input.colour,
				requiredPermission: input.requiredPermission,
				active: input.active ? 1 : 0,
				position: input.position,
				updatedBy: actor.memberId,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: eventTypeRules.type,
				set: {
					label: input.label,
					colour: input.colour,
					requiredPermission: input.requiredPermission,
					active: input.active ? 1 : 0,
					position: input.position,
					updatedBy: actor.memberId,
					updatedAt: new Date(),
				},
			});
		await audit.record(actor, {
			action,
			targetType: "event_type",
			targetId: input.type,
			category: "event",
			detail,
		});
	}

	return {
		async list() {
			const rows = await db
				.select({
					type: eventTypeRules.type,
					label: eventTypeRules.label,
					colour: eventTypeRules.colour,
					requiredPermission: eventTypeRules.requiredPermission,
					active: eventTypeRules.active,
					position: eventTypeRules.position,
				})
				.from(eventTypeRules)
				.orderBy(asc(eventTypeRules.position), asc(eventTypeRules.type));
			return rows.map(toRow);
		},

		async upsertType(actor, input) {
			if (!can(actor, "role:assign")) throw new Error("Not authorized to change event types.");
			if (!EVENT_TYPE_KEY_PATTERN.test(input.type)) throw new Error("Invalid event type key.");
			if (!input.label.trim()) throw new Error("Event type label is required.");
			if (!(eventTypeColours as readonly string[]).includes(input.colour)) throw new Error("Unknown colour.");
			if (
				input.requiredPermission !== null &&
				!(permissionActions as readonly string[]).includes(input.requiredPermission)
			) {
				throw new Error("Unknown permission.");
			}
			await write(actor, input, "event:upsert_type", `active=${input.active} colour=${input.colour}`);
		},

		async setRequiredPermission(actor, type, permission) {
			if (!can(actor, "role:assign")) throw new Error("Not authorized to change event type rules.");
			if (permission !== null && !(permissionActions as readonly string[]).includes(permission)) {
				throw new Error("Unknown permission.");
			}
			const existing = (await this.list()).find((row) => row.type === type);
			if (!existing) throw new Error("Unknown event type.");
			await write(
				actor,
				{ ...existing, requiredPermission: permission },
				"event:set_type_rule",
				`required=${permission ?? "none"}`,
			);
		},
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/db/repositories/eventTypeRules.integration.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/eventTypeRules.ts src/db/repositories/eventTypeRules.integration.test.ts
git commit -m "feat(events): event types become data, failing closed on unknown keys"
```

---

### Task 3: Enforce the runtime type in create and update

**Files:**
- Modify: `src/db/repositories/events.ts` (`create` ~line 224, `update` ~line 283)
- Modify: `src/db/repositories/events.integration.test.ts`

**Interfaces:**
- Consumes: `canCreateType(actor, rows, type)` and `EventTypeRow` from Task 2.
- Produces: no new exports; `create` and `update` now reject unknown and inactive types.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("events repository on D1")` block in `src/db/repositories/events.integration.test.ts`:

```ts
	it("rejects an event type that has no row at all", async () => {
		const { repo } = makeRepos();
		await expect(
			repo.create(eventsAdmin, {
				title: "Ghost", type: "does_not_exist", place: "SOM 111",
				description: "Ghost", startsAt: START, endsAt: END, capacity: null,
			}),
		).rejects.toThrow("Not authorized");
	});

	it("rejects an inactive type for new events but still allows editing an existing one", async () => {
		const { repo } = makeRepos();
		const event = await repo.create(owner, {
			title: "Retro", type: "casual", place: "SOM 111",
			description: "Retro", startsAt: START, endsAt: END, capacity: null,
		});

		await env.DB.prepare("UPDATE event_type_rules SET active = 0 WHERE type = ?").bind("casual").run();

		// No new casual events...
		await expect(
			repo.create(owner, {
				title: "Another", type: "casual", place: "SOM 111",
				description: "Another", startsAt: START, endsAt: END, capacity: null,
			}),
		).rejects.toThrow("Not authorized");

		// ...but the existing one is still editable, because the type is unchanged.
		await expect(repo.update(owner, event.id, { title: "Retro renamed" })).resolves.toMatchObject({
			title: "Retro renamed",
		});
		await expect(repo.update(owner, event.id, { type: "casual", title: "Again" })).resolves.toMatchObject({
			title: "Again",
		});
	});
```

Also update this file's `beforeEach` seeding of `event_type_rules` to include the new columns, exactly as in Task 2 Step 1.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/db/repositories/events.integration.test.ts -t "no row at all"`
Expected: FAIL — creating `does_not_exist` resolves instead of rejecting

- [ ] **Step 3: Adjust the call sites**

In `src/db/repositories/events.ts`, the two existing gates already call `canCreateType`. Task 2 changed its semantics, so the only change needed is the error message in `create`, which currently reads `Not authorized to create ${input.type} events.` — keep it, it is still accurate for a missing or inactive type and still starts with `Not authorized`.

Confirm both gates read exactly:

```ts
			// create
			const rules = await createEventTypeRulesRepository(db, audit).list();
			if (!canCreateType(actor, rules, input.type)) {
				throw new Error(`Not authorized to create ${input.type} events.`);
			}
```
```ts
			// update — only when the type actually changes
			if (patch.type !== undefined && patch.type !== event.type) {
				const rules = await createEventTypeRulesRepository(db, audit).list();
				if (!canCreateType(actor, rules, patch.type)) {
					throw new Error(`Not authorized to change this event to ${patch.type}.`);
				}
			}
```

The `patch.type !== event.type` clause is **load-bearing** — it is what lets an owner edit an event whose type was since deactivated. Do not remove it.

- [ ] **Step 4: Run the full suite**

Run: `pnpm vitest run src/db/repositories/events.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/events.ts src/db/repositories/events.integration.test.ts
git commit -m "feat(events): reject unknown and inactive event types on create and update"
```

---

### Task 4: Contracts and server actions — enum to validated key

**Files:**
- Create: `src/lib/event-type-key.ts`
- Create: `src/lib/event-type-key.test.ts`
- Modify: `src/db/contract/events.ts:7`, `:67`
- Modify: `src/db/contract/calendar.ts:23`
- Modify: `src/app/portal/calendar/actions.ts:14`
- Modify: `src/app/portal/calendar/[eventId]/actions.ts:20`
- Modify: `src/app/portal/admin/system/event-types/input.ts`

**Interfaces:**
- Consumes: `EVENT_TYPE_KEY_PATTERN` semantics from Task 2.
- Produces: `eventTypeKeySchema: z.ZodString` — used by every boundary that previously used `z.enum`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/event-type-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eventTypeKeySchema } from "./event-type-key";

describe("eventTypeKeySchema", () => {
	it("accepts admin-defined lowercase keys", () => {
		expect(eventTypeKeySchema.parse("casual")).toBe("casual");
		expect(eventTypeKeySchema.parse("gen_assembly")).toBe("gen_assembly");
		expect(eventTypeKeySchema.parse("workshop2")).toBe("workshop2");
	});

	it("rejects shapes that could never be a key", () => {
		// Membership is checked at the repository; this only stops obvious junk at the boundary.
		for (const bad of ["", "Casual", "has space", "punctuation!", "a".repeat(33)]) {
			expect(() => eventTypeKeySchema.parse(bad)).toThrow();
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/event-type-key.test.ts`
Expected: FAIL — cannot resolve `./event-type-key`

- [ ] **Step 3: Write the schema**

Create `src/lib/event-type-key.ts`:

```ts
import { z } from "zod";

/**
 * Event types are admin-managed rows, so a boundary schema can no longer validate MEMBERSHIP.
 * It validates SHAPE only; existence, active state, and permission are enforced in
 * `events.create` / `events.update` via `canCreateType`, which fails closed.
 */
export const eventTypeKeySchema = z
	.string()
	.trim()
	.min(1)
	.max(32)
	.regex(/^[a-z0-9_]+$/, "Event type keys are lowercase letters, digits and underscores.");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/event-type-key.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Replace every `z.enum` type site**

Five replacements. In each, swap the enum for `eventTypeKeySchema` and add the import
`import { eventTypeKeySchema } from "@/lib/event-type-key";`:

| File | Current | Replace with |
| --- | --- | --- |
| `src/db/contract/events.ts:7` | `type: z.enum(["official", "casual", "birthday"]),` | `type: eventTypeKeySchema,` |
| `src/db/contract/events.ts:67` | `type: z.enum(["official", "casual", "birthday"]),` | `type: eventTypeKeySchema,` |
| `src/db/contract/calendar.ts:23` | `type: z.enum(["official", "casual", "birthday"]),` | `type: eventTypeKeySchema,` |
| `src/app/portal/calendar/actions.ts:14` | `type: z.enum(["official", "casual", "birthday"]),` | `type: eventTypeKeySchema,` |
| `src/app/portal/calendar/[eventId]/actions.ts:20` | `type: z.enum(["official", "casual", "birthday"]),` | `type: eventTypeKeySchema,` |

Leave `src/db/contract/calendar.ts:6`'s `source: z.enum(["event", "birthday", "term_deadline"])` **untouched** — that is calendar provenance and its `birthday` means *member birthdays*, an unrelated concept.

- [ ] **Step 6: Update the admin form parser**

In `src/app/portal/admin/system/event-types/input.ts`, replace `const typeSchema = z.enum(eventTypes);` with:

```ts
import { eventTypeKeySchema } from "@/lib/event-type-key";
const typeSchema = eventTypeKeySchema;
```

and drop the now-unused `eventTypes` / `EventType` imports, changing `EventTypeRuleInput["type"]` to `string`.

- [ ] **Step 7: Typecheck, lint, test**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: all clean

- [ ] **Step 8: Commit**

```bash
git add src/lib/event-type-key.ts src/lib/event-type-key.test.ts src/db/contract/ src/app/portal/calendar/actions.ts "src/app/portal/calendar/[eventId]/actions.ts" src/app/portal/admin/system/event-types/input.ts
git commit -m "feat(events): validate event type key shape instead of enum membership"
```

---

### Task 5: Three-state rules load across all three callers

**Files:**
- Create: `src/lib/event-type-load.ts`
- Create: `src/lib/event-type-load.test.ts`
- Modify: `src/app/portal/calendar/page.tsx:31-33`
- Modify: `src/app/portal/calendar/[eventId]/page.tsx:24-33`
- Modify: `src/app/portal/admin/system/event-types/page.tsx:12-15`
- Modify: `src/app/portal/calendar/create-event-sheet.tsx`
- Modify: `src/app/portal/admin/system/event-types/event-type-rules-manager.tsx`

**Interfaces:**
- Consumes: `EventTypeRow` and the repository `list()` from Task 2.
- Produces: `type EventTypeLoad = { ok: true; rows: EventTypeRow[] } | { ok: false }` and `loadEventTypes(list: () => Promise<EventTypeRow[]>): Promise<EventTypeLoad>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/event-type-load.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadEventTypes } from "./event-type-load";

const ROW = {
	type: "casual", label: "Casual", colour: "emerald",
	requiredPermission: null, active: true, position: 1,
};

describe("loadEventTypes", () => {
	it("reports success with rows", async () => {
		expect(await loadEventTypes(async () => [ROW])).toEqual({ ok: true, rows: [ROW] });
	});

	it("reports success with an genuinely empty table", async () => {
		// "Loaded and empty" must stay distinguishable from "failed to load".
		expect(await loadEventTypes(async () => [])).toEqual({ ok: true, rows: [] });
	});

	it("reports failure instead of an empty list when the read throws", async () => {
		// Shared-dev's throwing Proxy, or any transient DB error. Returning [] here would let a
		// fail-closed membership check turn a read error into "no type may be created", and would
		// let the admin screen show every type as "Any member" and save that over real policy.
		expect(
			await loadEventTypes(async () => {
				throw new Error("unavailable");
			}),
		).toEqual({ ok: false });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/event-type-load.test.ts`
Expected: FAIL — cannot resolve `./event-type-load`

- [ ] **Step 3: Write the loader**

Create `src/lib/event-type-load.ts`:

```ts
import type { EventTypeRow } from "@/db/repositories/eventTypeRules";

export type EventTypeLoad = { ok: true; rows: EventTypeRow[] } | { ok: false };

/**
 * Never collapse a failed read into an empty list. `canCreateType` fails closed, so `[]` from a
 * `.catch()` would mean "no type may be created" — turning a transient error into an outage —
 * and on the admin policy screen it would render every type as "Any member", which an admin
 * could then save straight over real policy.
 */
export async function loadEventTypes(list: () => Promise<EventTypeRow[]>): Promise<EventTypeLoad> {
	try {
		return { ok: true, rows: await list() };
	} catch {
		return { ok: false };
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/event-type-load.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the calendar list page**

In `src/app/portal/calendar/page.tsx`, replace the `.catch(() => [])` load:

```tsx
	const typeLoad = await loadEventTypes(() => repositories.eventTypeRules.list());
	const allowedTypes = typeLoad.ok ? allowedEventTypes(actor, typeLoad.rows) : [];
```

and pass `typesUnavailable={!typeLoad.ok}` alongside the existing `allowedTypes` prop into `<CreateEventSheet />`. Import `loadEventTypes` from `@/lib/event-type-load`.

- [ ] **Step 6: Wire the event detail page**

In `src/app/portal/calendar/[eventId]/page.tsx`, replace the `.catch(() => [])` load the same way, keeping the existing "current type must always be an option" logic but operating on `EventTypeRow[]`:

```tsx
	const typeLoad = await loadEventTypes(() => repositories.eventTypeRules.list());
	const rows = typeLoad.ok ? typeLoad.rows : [];
	const allowedForActor = typeLoad.ok ? allowedEventTypes(actor, rows) : [];
	const allowedTypesForEdit =
		managed && !allowedForActor.some((r) => r.type === managed.type)
			? [...allowedForActor, ...rows.filter((r) => r.type === managed.type)]
			: allowedForActor;
```

Pass `allowedTypesForEdit`, the full `rows` (for labels and colours), and `typesUnavailable={!typeLoad.ok}` down to `EventManagePanel`.

- [ ] **Step 7: Wire the admin policy screen — the dangerous one**

In `src/app/portal/admin/system/event-types/page.tsx`:

```tsx
	const typeLoad = await loadEventTypes(() => repositories.eventTypeRules.list());
	if (!typeLoad.ok) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Event Type Rules</CardTitle>
					<CardDescription>
						Event types could not be loaded, so they are not shown. Saving is disabled — editing from here
						would risk overwriting the real configuration with a blank one.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}
	return <EventTypeRulesManager rows={typeLoad.rows} />;
```

This is the finding that matters most: previously a failed read rendered every type as "Any member", and the admin could **save that over real policy**. The screen must refuse to submit, not present an empty list as truth.

- [ ] **Step 8: Render the unavailable state in the create sheet**

In `src/app/portal/calendar/create-event-sheet.tsx`, accept `typesUnavailable: boolean`, and where the "you cannot create any event type" message currently renders for an empty `allowedTypes`, distinguish the two:

```tsx
					{typesUnavailable ? (
						<p className="text-sm text-destructive">
							Event types are unavailable right now. Try again shortly.
						</p>
					) : noAllowedTypes ? (
						<p className="text-sm text-destructive">You do not have permission to create any event type.</p>
					) : (
						/* the existing <select> */
					)}
```

Fold `typesUnavailable` into `canSubmit` so submission is blocked in that state.

- [ ] **Step 9: Typecheck, lint, test**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: all clean

- [ ] **Step 10: Commit**

```bash
git add src/lib/event-type-load.ts src/lib/event-type-load.test.ts src/app/portal/calendar/ src/app/portal/admin/system/event-types/
git commit -m "feat(events): distinguish a failed type load from an empty type list"
```

---

### Task 6: Admin screen — full event type management

**Files:**
- Modify: `src/app/portal/admin/system/event-types/event-type-rules-manager.tsx` (rewrite)
- Modify: `src/app/portal/admin/system/event-types/actions.ts`
- Modify: `src/app/portal/admin/system/event-types/input.ts`
- Modify: `src/app/portal/admin/system/event-types/input.test.ts`

**Interfaces:**
- Consumes: `EventTypeRow`, `upsertType`, `EventTypeUpsertInput` from Task 2; `eventTypeColours` from Task 1; `eventTypeKeySchema` from Task 4.
- Produces: `parseEventTypeUpsertInput(formData: FormData): EventTypeUpsertInput`.

- [ ] **Step 1: Write the failing parser test**

Replace `src/app/portal/admin/system/event-types/input.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { parseEventTypeUpsertInput } from "./input";

function formDataFor(fields: Record<string, string | undefined>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
	return data;
}

describe("parseEventTypeUpsertInput", () => {
	const base = { type: "workshop", label: "Workshop", colour: "amber", position: "3", active: "on" };

	it("parses a full row", () => {
		expect(parseEventTypeUpsertInput(formDataFor({ ...base, requiredPermission: "" }))).toEqual({
			type: "workshop", label: "Workshop", colour: "amber",
			requiredPermission: null, active: true, position: 3,
		});
	});

	it("treats an absent active checkbox as inactive", () => {
		const parsed = parseEventTypeUpsertInput(formDataFor({ ...base, active: undefined, requiredPermission: "" }));
		expect(parsed.active).toBe(false);
	});

	it("throws when requiredPermission is absent entirely", () => {
		// A selected-but-disabled <option> is dropped from FormData, so presence cannot be assumed.
		// Coercing an absent field to null would silently open the type to every member.
		expect(() => parseEventTypeUpsertInput(formDataFor(base))).toThrow("Missing requiredPermission");
	});

	it("passes an unrecognized permission through for the repository to reject", () => {
		const parsed = parseEventTypeUpsertInput(formDataFor({ ...base, requiredPermission: "weird:unknown" }));
		expect(parsed.requiredPermission).toBe("weird:unknown");
	});

	it("rejects a malformed key and a blank label", () => {
		expect(() => parseEventTypeUpsertInput(formDataFor({ ...base, type: "Not A Key!", requiredPermission: "" }))).toThrow();
		expect(() => parseEventTypeUpsertInput(formDataFor({ ...base, label: "  ", requiredPermission: "" }))).toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/portal/admin/system/event-types/input.test.ts`
Expected: FAIL — `parseEventTypeUpsertInput` is not exported

- [ ] **Step 3: Write the parser**

Replace `src/app/portal/admin/system/event-types/input.ts`:

```ts
import { z } from "zod";
import type { EventTypeUpsertInput } from "@/db/repositories/eventTypeRules";
import { eventTypeColours } from "@/lib/event-type-colours";
import { eventTypeKeySchema } from "@/lib/event-type-key";

const labelSchema = z.string().trim().min(1).max(60);
const colourSchema = z.enum(eventTypeColours);
const positionSchema = z.coerce.number().int().min(0).max(999);

/**
 * `requiredPermission` has three distinct cases, not two:
 * - absent from the FormData entirely -> throw. Never coerce to "any member". A selected-but-
 *   disabled <option> is dropped from the form-data set, so presence cannot be assumed.
 * - present and exactly "" -> null ("Any member"). The only way to open a type up.
 * - present with any other string -> passed through; `upsertType` validates it and throws
 *   "Unknown permission." for anything unrecognized.
 */
export function parseEventTypeUpsertInput(formData: FormData): EventTypeUpsertInput {
	const raw = formData.get("requiredPermission");
	if (raw === null) throw new Error("Missing requiredPermission field.");
	if (typeof raw !== "string") throw new Error("Invalid requiredPermission field.");

	return {
		type: eventTypeKeySchema.parse(formData.get("type")),
		label: labelSchema.parse(formData.get("label")),
		colour: colourSchema.parse(formData.get("colour")),
		requiredPermission: raw === "" ? null : raw,
		active: formData.get("active") === "on",
		position: positionSchema.parse(formData.get("position") ?? 0),
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/portal/admin/system/event-types/input.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Update the server action**

Replace the action in `src/app/portal/admin/system/event-types/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { parseEventTypeUpsertInput } from "./input";

export async function upsertEventTypeAction(formData: FormData) {
	const actor = await requireActor();
	const input = parseEventTypeUpsertInput(formData);
	const repositories = await getRepositories();
	await repositories.eventTypeRules.upsertType(actor, input);
	revalidatePath("/portal/admin/system/event-types");
	revalidatePath("/portal/calendar");
}
```

- [ ] **Step 6: Rewrite the manager component**

Replace `src/app/portal/admin/system/event-types/event-type-rules-manager.tsx` with a form per existing row plus one "add a type" form. Each row form posts `type` (hidden for existing rows, a text input for the new one), `label`, `colour` select from `eventTypeColours`, `requiredPermission` select ("Any member" = `""`, plus every `permissionActions` entry, plus a rendered option for an unrecognized current value), `active` checkbox, and `position` number input. Use `Card` / `Button` / `Badge` exactly as the current file does, and keep the `"use client"` directive and the `EventTypeRulesManager` export name. Signature becomes `{ rows }: { rows: EventTypeRow[] }`.

Preserve the existing unrecognized-permission affordance: when a row's `requiredPermission` is not in `permissionActions`, render it as an extra **enabled** option labelled `{value} (unrecognized — locked to Super)`. It must remain enabled — a disabled option's value is excluded from the submitted FormData, which is exactly how a locked-down rule was previously cleared by accident.

- [ ] **Step 7: Typecheck, lint, test**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: all clean

- [ ] **Step 8: Commit**

```bash
git add src/app/portal/admin/system/event-types/
git commit -m "feat(admin): manage event type label, colour, ordering and active state"
```

---

### Task 7: Type badges and the remaining hardcoded unions

**Files:**
- Modify: `src/app/portal/calendar/events-list.tsx:10` and its `Row` component
- Modify: `src/app/portal/calendar/[eventId]/event-manage-panel.tsx:57`
- Modify: `src/app/portal/calendar/page.tsx` (pass type rows into the list)

**Interfaces:**
- Consumes: `EventTypeRow`, `labelFor` from Task 2; `colourClasses` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Widen the list item type and render a coloured badge**

In `src/app/portal/calendar/events-list.tsx`, change line 10 from
`type: "official" | "casual" | "birthday";` to `type: string;`, add
`types: EventTypeRow[]` to the component's props, and thread it into `Row`.

In `Row`, render the type badge using the row's colour and label:

```tsx
	const chip = colourClasses(types.find((t) => t.type === event.type)?.colour ?? "slate").chip;
	// …
	<Badge className={cn("shrink-0", chip)}>{labelFor(types, event.type)}</Badge>
```

Import `colourClasses` from `@/lib/event-type-colours`, `labelFor` / `EventTypeRow` from `@/db/repositories/eventTypeRules`, and `cn` from `@/lib/utils`.

- [ ] **Step 2: Pass the rows from the calendar page**

In `src/app/portal/calendar/page.tsx`, pass `types={typeLoad.ok ? typeLoad.rows : []}` into the events list. An empty array is safe here: `labelFor` falls back to the raw key and `colourClasses` falls back to slate, so a failed load degrades to plain badges rather than breaking the page.

- [ ] **Step 3: Widen the manage panel's union**

In `src/app/portal/calendar/[eventId]/event-manage-panel.tsx`, change line 57 from
`type: "official" | "casual" | "birthday";` to `type: string;`.

Its type `<select>` already renders from the `allowedTypes` prop, which Task 5 changed to `EventTypeRow[]` — render `{option.label}` as the option text and `{option.type}` as the value.

- [ ] **Step 4: Confirm no hardcoded triples remain**

Run:
```bash
grep -rn '"official"' src --include=*.ts --include=*.tsx | grep -v seedEventTypes | grep -v '\.test\.'
```
Expected: no matches outside test fixtures and `seedEventTypes`. Any hit is a site this plan missed — fix it the same way.

- [ ] **Step 5: Typecheck, lint, test**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: all clean

- [ ] **Step 6: Manual verification**

Run `pnpm dev`, then:
1. `/portal/admin/system/event-types` — add a type "Workshop", colour amber, Any member, active, position 3. Save.
2. `/portal/calendar` — Create event now offers Workshop; create one; the list shows an amber "Workshop" badge.
3. Back on the admin screen, set Workshop inactive. The create form no longer offers it; the existing Workshop event still shows its badge and its title can still be edited.

- [ ] **Step 7: Commit**

```bash
git add src/app/portal/calendar/
git commit -m "feat(calendar): render admin-defined event type labels and colours"
```

---

## Deployment

Per `CLAUDE.md`, and per the spec's expand-contract rule, run **migrate → verify → deploy**. Both commands need product-owner approval and wrangler cannot authenticate non-interactively:

```
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote   # read-only
pnpm db:migrate:dev
pnpm deploy:dev
```

**Blocking prerequisites:**

1. **Migration `0010` must already be applied to dev D1.** `0011` alters the table `0010` creates.
2. **Run the distinct-type audit against dev D1 before `0011`:**
   ```sql
   SELECT type, COUNT(*) FROM crs_events GROUP BY type;
   ```
   `crs_events.type` has no CHECK and no foreign key, so "production holds only the three seeded values" is an assumption. Local holds only `official`, which proves nothing about dev. Any value outside `official` / `casual` / `birthday` must get a reviewed, explicitly inactive `event_type_rules` row **before** `0011` ships, or those events will render with a raw key and become uneditable-by-type.

`0011` is additive with defaults, so the deployed Worker keeps working in the migrate-then-deploy gap.

## Self-Review Notes

- **Spec coverage:** §1 columns → Task 1; palette → Task 1; fail-closed → Task 2; pre-migration audit → Deployment; the ten `z.enum`/union sites → Tasks 4 and 7; active-flag handling → Tasks 2, 3 and 6; admin screen → Task 6; three-state load across all three callers → Task 5; type badges → Task 7. §9 Plan A is fully covered. No points work appears anywhere.
- **Type consistency:** `EventTypeRow` (Task 2) is the single shape consumed by Tasks 3, 5, 6 and 7. `EventTypeUpsertInput` is produced by Task 2 and parsed into by Task 6. `eventTypeKeySchema` (Task 4) is used at all five boundaries. `colourClasses` (Task 1) is consumed by Task 7.
- **Known ripple:** Task 1 Step 5 deliberately breaks every `eventTypes` import at once; Tasks 2, 4 and 7 repair them. Typecheck is expected to fail between Task 1 and Task 4 — that is why Task 1's gate is the migration verification, not `pnpm typecheck`.
- **Task 6 Step 6 describes the component rather than quoting it**, because the current file is being replaced wholesale and its structure (Card + per-row form) is already established in the file being edited. Every field name, option value and the enabled-option requirement are specified exactly.
