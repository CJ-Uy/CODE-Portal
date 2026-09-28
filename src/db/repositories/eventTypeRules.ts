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
 * Seeded by migration 0010. Member birthdays are synthesized onto the calendar from
 * `members.birthday` rather than stored as events, but they read this row for their colour so the
 * admin console governs them like any other type.
 */
export const BIRTHDAY_EVENT_TYPE = "birthday";

/**
 * FAILS CLOSED on a missing row. Once this table IS the list of event types, a missing row
 * means the type does not exist. Falling open here would let any string through the repository
 * now that the zod enums are gone.
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
		// Migration 0012 defaults label to ''; show the key until an admin names it.
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
