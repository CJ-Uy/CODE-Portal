import { and, asc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "@/db/schema";
import { crsAttendance, crsEvents, eventStaff, members } from "@/db/schema";

type Db = DrizzleD1Database<typeof schema>;

export type SurveyEventRole = "owner" | "admin" | "scanner";

/** The owner is crs_events.created_by; everyone else is an event_staff row. */
export async function eventRole(db: Db, eventId: string, memberId: string): Promise<SurveyEventRole | null> {
	const [event] = await db.select({ createdBy: crsEvents.createdBy }).from(crsEvents).where(eq(crsEvents.id, eventId)).limit(1);
	if (event?.createdBy === memberId) return "owner";
	const [staff] = await db
		.select({ role: eventStaff.role })
		.from(eventStaff)
		.where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.memberId, memberId)))
		.limit(1);
	return staff?.role ?? null;
}

/** Organizers see an event's feedback results; scanners only helped at the door. */
export function isOrganizerRole(role: SurveyEventRole | null): boolean {
	return role === "owner" || role === "admin";
}

export async function staffIds(db: Db, eventId: string): Promise<Set<string>> {
	const [event] = await db.select({ createdBy: crsEvents.createdBy }).from(crsEvents).where(eq(crsEvents.id, eventId)).limit(1);
	const staff = await db.select({ memberId: eventStaff.memberId }).from(eventStaff).where(eq(eventStaff.eventId, eventId));
	return new Set([...(event ? [event.createdBy] : []), ...staff.map((row) => row.memberId)]);
}

/** Active members who may be asked for feedback, sorted so a seeded draw is reproducible. */
export async function eligibleMemberIds(db: Db, survey: { eventId: string | null }): Promise<string[]> {
	const active = eq(members.status, "active");
	if (!survey.eventId) {
		const rows = await db.select({ id: members.id }).from(members).where(active).orderBy(asc(members.id));
		return rows.map((row) => row.id);
	}

	const [attendees, staff] = await Promise.all([
		db
			.select({ id: members.id })
			.from(crsAttendance)
			.innerJoin(members, eq(members.id, crsAttendance.memberId))
			.where(and(eq(crsAttendance.eventId, survey.eventId), active))
			.orderBy(asc(members.id)),
		staffIds(db, survey.eventId),
	]);
	return attendees.map((row) => row.id).filter((id) => !staff.has(id));
}
