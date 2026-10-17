import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "@/db/schema";
import { crsEvents, eventDebriefs, members } from "@/db/schema";
import type { DebriefInput, EventDebrief } from "@/db/types";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { memberDisplayName } from "./email-audience";
import { eventRole, isOrganizerRole } from "./survey-access";

type Db = DrizzleD1Database<typeof schema>;

export type EventDebriefsRepository = {
	canEdit(actor: Actor, eventId: string): Promise<boolean>;
	get(actor: Actor, eventId: string): Promise<(EventDebrief & { updatedByName: string | null }) | null>;
	save(actor: Actor, input: DebriefInput): Promise<EventDebrief>;
};

export function createEventDebriefsRepository(db: Db, audit: AuditRepository): EventDebriefsRepository {
	const canEdit: EventDebriefsRepository["canEdit"] = async (actor, eventId) =>
		can(actor, "survey:configure") || isOrganizerRole(await eventRole(db, eventId, actor.memberId));

	return {
		canEdit,

		async get(actor, eventId) {
			if (!(await canEdit(actor, eventId))) throw new Error("Not authorized to read this debrief.");

			const [row] = await db
				.select({
					debrief: eventDebriefs,
					email: members.email,
					name: members.name,
					fullName: members.fullName,
					nickname: members.nickname,
				})
				.from(eventDebriefs)
				.leftJoin(members, eq(members.id, eventDebriefs.updatedBy))
				.where(eq(eventDebriefs.eventId, eventId))
				.limit(1);
			if (!row) return null;
			return { ...row.debrief, updatedByName: row.email ? memberDisplayName({ ...row, email: row.email }) : null };
		},

		async save(actor, input) {
			if (!(await canEdit(actor, input.eventId))) throw new Error("Not authorized to save this debrief.");

			const [event] = await db
				.select({ id: crsEvents.id })
				.from(crsEvents)
				.where(and(eq(crsEvents.id, input.eventId), isNull(crsEvents.deletedAt)))
				.limit(1);
			if (!event) throw new Error("Event not found.");

			// A field the caller leaves out is undefined, which drizzle skips on update and inserts as null.
			const { eventId, ...text } = input;
			const stamp = { updatedBy: actor.memberId, updatedAt: new Date() };
			const [saved] = await db
				.insert(eventDebriefs)
				.values({ eventId, ...text, ...stamp })
				.onConflictDoUpdate({ target: eventDebriefs.eventId, set: { ...text, ...stamp } })
				.returning();
			await audit.record(actor, { action: "event:debrief_save", targetType: "event", targetId: eventId, category: "survey" });
			return saved;
		},
	};
}

export function createUnavailableEventDebriefsRepository(): EventDebriefsRepository {
	const unavailable = () => Promise.reject(new Error("Event debriefs are not available through this repository adapter."));
	return { canEdit: unavailable, get: unavailable, save: unavailable };
}
