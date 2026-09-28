import { and, asc, count, desc, eq, gte, getTableColumns, inArray, isNull, like, lte, notInArray, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { createId } from "@/lib/ids";
import { generateEventCode, normalizeEventCode } from "@/lib/event-code";
import {
	auditLogs,
	crsAttendance,
	crsEvents,
	eventInvites,
	eventPointAwards,
	eventRsvps,
	eventStaff,
	members,
	pointTypes,
	retentionRecords,
	terms,
} from "@/db/schema";
import type { EventType, RsvpState } from "@/db/schema";
import type { EventAwardInput } from "@/db/types";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import { auditInsertValues } from "./audit";
import type { AuditRepository } from "./audit";
import { buildExistingAttendanceAwardUpsert, buildScanAwardUpsert } from "./event-awards";
import { canCreateType, createEventTypeRulesRepository } from "./eventTypeRules";
import { notify } from "./notifications";
import { validateEventSignupAnswers, type EventSignupAnswers, type EventSignupField } from "@/lib/event-signup-form";
import { quantizePoints } from "@/lib/points";

export const CHECKIN_LEAD_MS = 30 * 60 * 1000;

export type EventRole = "owner" | "admin" | "scanner";
export type EventRecord = InferSelectModel<typeof crsEvents> & {
	myRole: EventRole | null;
	canModerate: boolean;
	canSetPoints: boolean;
	scannedCount: number;
};

export type CreateEventInput = {
	title: string;
	type: EventType;
	place: string;
	description: string;
	startsAt: Date;
	endsAt: Date;
	points?: number | null;
	capacity: number | null;
	graceMinutes?: number | null;
	rsvpForm?: EventSignupField[];
	rsvpResponsesPublic?: boolean;
	allDay?: boolean;
	readOnly?: boolean;
};

export type UpdateEventInput = Partial<{
	title: string;
	type: EventType;
	place: string;
	description: string;
	startsAt: Date;
	endsAt: Date;
	capacity: number | null;
	graceMinutes: number | null;
	rsvpForm: EventSignupField[];
	rsvpResponsesPublic: boolean;
	allDay: boolean;
	readOnly: boolean;
}>;

export type ListEventsInput = { limit?: number; offset?: number };
export type SetRsvpInput = { eventId: string; state: RsvpState; answers?: EventSignupAnswers };
export type RecordScanInput = { eventId: string; memberId: string; termId: string };
export type UndoScanInput = { eventId: string; memberId: string };
export type RecordScanResult = {
	eventId: string;
	memberId: string;
	memberName: string | null;
	memberImage: string | null;
	scannedAt: Date;
	scannedByName: string | null;
	alreadyPresent: boolean;
};
export type MemberSearchInput = { eventId: string; query: string; limit?: number };
export type AttendableMember = {
	memberId: string;
	fullName: string | null;
	name: string | null;
	email: string;
	alreadyScanned: boolean;
};
export type AttendanceRow = {
	memberId: string;
	fullName: string | null;
	name: string | null;
	scannedAt: Date;
	scannedBy: string;
};
export type EventInviteRow = { memberId: string; fullName: string | null; name: string | null; invitedAt: Date };
export type EventSignupResponseRow = {
	memberId: string;
	fullName: string | null;
	name: string | null;
	answers: EventSignupAnswers;
	updatedAt: Date;
	scannedAt: Date | null;
};
export type EventPointAwardRow = EventAwardInput & {
	pointTypeLabel: string;
	pointTypeActive: boolean;
	pointTypePosition: number;
};

export type EventsRepository = {
	resolveCapability(actor: Actor, event: { createdBy: string; id: string }): Promise<EventRole | null>;
	/**
	 * Share-code lookup for /events/<CODE>. Takes no actor: it runs before sign-in and returns only
	 * an id, so it decides nothing about visibility — the page it redirects to does that.
	 */
	resolveShareCode(code: string): Promise<{ id: string } | null>;
	create(actor: Actor, input: CreateEventInput): Promise<EventRecord>;
	listPublished(actor: Actor, input?: ListEventsInput): Promise<EventRecord[]>;
	listPending(actor: Actor, input?: ListEventsInput): Promise<EventRecord[]>;
	getById(actor: Actor, id: string): Promise<EventRecord | null>;
	update(actor: Actor, eventId: string, patch: UpdateEventInput): Promise<EventRecord>;
	softDelete(actor: Actor, eventId: string): Promise<void>;
	setAwards(actor: Actor, eventId: string, awards: EventAwardInput[]): Promise<{ updated: number }>;
	listAwards(actor: Actor, eventId: string): Promise<EventPointAwardRow[]>;
	removeRetiredAward(actor: Actor, eventId: string, pointTypeId: string): Promise<{ removed: boolean }>;
	addStaff(actor: Actor, eventId: string, memberId: string, role: "admin" | "scanner"): Promise<void>;
	removeStaff(actor: Actor, eventId: string, memberId: string): Promise<void>;
	transferOwnership(actor: Actor, eventId: string, toMemberId: string): Promise<void>;
	invite(actor: Actor, eventId: string, memberIds: string[]): Promise<{ invited: number }>;
	listInvites(actor: Actor, eventId: string): Promise<EventInviteRow[]>;
	listSignupResponses(actor: Actor, eventId: string): Promise<EventSignupResponseRow[]>;
	listStaff(
		actor: Actor,
		eventId: string,
	): Promise<Array<{ memberId: string; fullName: string | null; name: string | null; role: "owner" | "admin" | "scanner" }>>;
	setRsvp(actor: Actor, input: SetRsvpInput): Promise<{ state: RsvpState }>;
	recordScan(actor: Actor, input: RecordScanInput): Promise<RecordScanResult>;
	undoScan(actor: Actor, input: UndoScanInput): Promise<{ removed: boolean }>;
	searchAttendableMembers(actor: Actor, input: MemberSearchInput): Promise<AttendableMember[]>;
	resolveAttendableEmails(actor: Actor, input: { eventId: string; emails: string[] }): Promise<AttendableMember[]>;
	listAttendance(actor: Actor, eventId: string): Promise<AttendanceRow[]>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type BaseEventRecord = InferSelectModel<typeof crsEvents>;

async function loadEvent(db: Db, eventId: string): Promise<BaseEventRecord | null> {
	const [event] = await db.select().from(crsEvents).where(eq(crsEvents.id, eventId)).limit(1);
	if (!event || event.deletedAt) return null;
	return event;
}

async function staffRole(db: Db, eventId: string, memberId: string): Promise<"admin" | "scanner" | null> {
	const [row] = await db
		.select({ role: eventStaff.role })
		.from(eventStaff)
		.where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.memberId, memberId)))
		.limit(1);
	return row?.role ?? null;
}

function withCapabilities(actor: Actor, event: BaseEventRecord, role: EventRole | null, scannedCount = 0): EventRecord {
	return {
		...event,
		myRole: role,
		canModerate: can(actor, "event:moderate"),
		canSetPoints: can(actor, "event:points"),
		scannedCount,
	};
}

function canManage(role: EventRole | null, actor: Actor): boolean {
	return role === "owner" || role === "admin" || can(actor, "event:moderate");
}

function canOperate(role: EventRole | null, actor: Actor): boolean {
	return role !== null || can(actor, "event:moderate");
}

/**
 * A read-only event is informational: it takes no signups, check-ins, points, uploads or posts.
 *
 * Called at the top of every member-facing mutation rather than from a shared wrapper, so a method
 * added later without this guard shows up as a missing line in review instead of silently
 * inheriting protection it never got.
 */
function assertNotReadOnly(event: BaseEventRecord, message: string): void {
	if (event.readOnly) throw new Error(message);
}

/**
 * Setting or clearing read_only is an event:moderate action, NOT an ownership one.
 *
 * canManage() returns true for the event owner, so gating this on canManage alone would let any
 * member who created an event mark it informational and strip its own signup and check-in surface.
 * The capability is therefore checked against the specific field, independently of canManage.
 */
function assertMaySetReadOnly(actor: Actor, current: boolean, next: boolean | undefined): void {
	if (next === undefined || next === current) return;
	if (!can(actor, "event:moderate")) {
		throw new Error("Not authorized to change whether this event is read-only.");
	}
}

/** Interaction fields are meaningless on an informational event; coerce rather than reject. */
const READ_ONLY_FIELDS = {
	capacity: null,
	graceMinutes: null,
	points: null,
	rsvpFormJson: [] as EventSignupField[],
	rsvpResponsesPublic: false,
} as const;

function inCheckinWindow(event: BaseEventRecord, now: Date): boolean {
	if (!event.endsAt) return false;
	return now.getTime() >= event.startsAt.getTime() - CHECKIN_LEAD_MS && now.getTime() <= event.endsAt.getTime();
}

async function runAtomic(db: Db, queries: unknown[]): Promise<void> {
	if (db.batch) {
		await db.batch(queries);
		return;
	}
	// Local dev (better-sqlite3): db.batch is unavailable, and these `queries` are
	// already-built Drizzle query builders, not thunks, so they can't be re-run
	// inside a fresh callback. db.transaction() is synchronous for this driver and
	// will reject an async callback ("Transaction function cannot return a
	// promise"), so we must not `await` inside it. Instead we call the
	// synchronous `.run()` each builder exposes (verified empirically: since
	// better-sqlite3 has a single shared connection, statements run via `.run()`
	// inside this callback are captured by the surrounding BEGIN/COMMIT/ROLLBACK
	// even though the builders were constructed against `db`, not the `tx`
	// handed to the callback).
	db.transaction(() => {
		for (const query of queries) {
			(query as { run: () => unknown }).run();
		}
	});
}

const scannerMember = alias(members, "scanner_member");

type ScanRow = {
	scannedAt: Date;
	scannedBy: string;
	memberFullName: string | null;
	memberName: string | null;
	memberEmail: string;
	memberImage: string | null;
	scannedByFullName: string | null;
	scannedByName: string | null;
};

/** The attendance row joined to both the attendee and whoever scanned them. */
async function loadScanRow(db: Db, eventId: string, memberId: string): Promise<ScanRow | null> {
	const [row] = await db
		.select({
			scannedAt: crsAttendance.scannedAt,
			scannedBy: crsAttendance.scannedBy,
			memberFullName: members.fullName,
			memberName: members.name,
			memberEmail: members.email,
			memberImage: members.image,
			scannedByFullName: scannerMember.fullName,
			scannedByName: scannerMember.name,
		})
		.from(crsAttendance)
		.innerJoin(members, eq(members.id, crsAttendance.memberId))
		.leftJoin(scannerMember, eq(scannerMember.id, crsAttendance.scannedBy))
		.where(and(eq(crsAttendance.eventId, eventId), eq(crsAttendance.memberId, memberId)))
		.limit(1);
	return row ?? null;
}

function toScanResult(eventId: string, memberId: string, row: ScanRow, alreadyPresent: boolean): RecordScanResult {
	return {
		eventId,
		memberId,
		memberName: row.memberFullName ?? row.memberName ?? "Member",
		memberImage: row.memberImage,
		scannedAt: row.scannedAt,
		scannedByName: row.scannedByFullName ?? row.scannedByName,
		alreadyPresent,
	};
}

export function createEventsRepository(db: Db, audit: AuditRepository): EventsRepository {
	async function resolveCapability(actor: Actor, event: { createdBy: string; id: string }): Promise<EventRole | null> {
		if (event.createdBy === actor.memberId) return "owner";
		return staffRole(db, event.id, actor.memberId);
	}

	async function decorate(actor: Actor, event: BaseEventRecord): Promise<EventRecord> {
		return withCapabilities(actor, event, await resolveCapability(actor, event));
	}

	async function requireEvent(actor: Actor, eventId: string) {
		const event = await loadEvent(db, eventId);
		if (!event) throw new Error("Event not found.");
		return { event, role: await resolveCapability(actor, event) };
	}

	return {
		resolveCapability,

		async resolveShareCode(code) {
			const normalized = normalizeEventCode(code);
			if (!normalized) return null;
			// Selects the id ALONE. This is the only event lookup an unauthenticated request can
			// reach, and checkin_secret must never travel through it.
			const [row] = await db
				.select({ id: crsEvents.id })
				.from(crsEvents)
				.where(and(eq(crsEvents.publicCode, normalized), isNull(crsEvents.deletedAt)))
				.limit(1);
			return row ?? null;
		},

		async create(actor, input) {
			const rules = await createEventTypeRulesRepository(db, audit).list();
			if (!canCreateType(actor, rules, input.type)) {
				throw new Error(`Not authorized to create ${input.type} events.`);
			}
			const readOnly = input.readOnly ?? false;
			assertMaySetReadOnly(actor, false, input.readOnly);

			const values = {
				id: createId("evt"),
				title: input.title,
				type: input.type,
				status: "approved" as const,
				points: null,
				place: input.place,
				capacity: readOnly ? READ_ONLY_FIELDS.capacity : input.capacity,
				graceMinutes: readOnly ? READ_ONLY_FIELDS.graceMinutes : (input.graceMinutes ?? null),
				rsvpFormJson: readOnly ? [...READ_ONLY_FIELDS.rsvpFormJson] : (input.rsvpForm ?? []),
				rsvpResponsesPublic: readOnly ? READ_ONLY_FIELDS.rsvpResponsesPublic : (input.rsvpResponsesPublic ?? false),
				allDay: input.allDay ?? false,
				readOnly,
				startsAt: input.startsAt,
				endsAt: input.endsAt,
				description: input.description,
				createdBy: actor.memberId,
				approvedBy: actor.memberId,
				approvedAt: new Date(),
				checkinSecret: "",
			};

			// public_code is unique. 30^6 is a large space, but the birthday bound over the lifetime of
			// the club is not negligible, so retry a fresh code rather than failing the create.
			let event: BaseEventRecord | undefined;
			for (let attempt = 0; attempt < 5; attempt += 1) {
				try {
					[event] = await db
						.insert(crsEvents)
						.values({ ...values, publicCode: generateEventCode() })
						.returning();
					break;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (attempt === 4 || !/unique/i.test(message)) throw error;
				}
			}
			if (!event) throw new Error("Could not allocate a share code for this event.");

			await audit.record(actor, { action: "event:create", targetType: "event", targetId: event.id, category: "event" });
			return decorate(actor, event);
		},

		async listPublished(actor, input) {
			if (!actor) throw new Error("Authentication required.");
			const rows: Array<{ event: BaseEventRecord; scannedCount: number }> = await db
				.select({
					event: getTableColumns(crsEvents),
					scannedCount: count(crsAttendance.memberId),
				})
				.from(crsEvents)
				.leftJoin(crsAttendance, eq(crsAttendance.eventId, crsEvents.id))
				.where(isNull(crsEvents.deletedAt))
				.groupBy(crsEvents.id)
				.orderBy(asc(crsEvents.startsAt))
				.limit(Math.min(input?.limit ?? 50, 100))
				.offset(input?.offset ?? 0);
			return Promise.all(rows.map(async (row) => withCapabilities(actor, row.event, await resolveCapability(actor, row.event), row.scannedCount)));
		},

		async listPending(actor, input) {
			if (!can(actor, "event:moderate")) {
				throw new Error("Not authorized to view pending events.");
			}
			const rows: BaseEventRecord[] = await db
				.select()
				.from(crsEvents)
				.where(and(eq(crsEvents.status, "pending"), isNull(crsEvents.deletedAt)))
				.orderBy(asc(crsEvents.startsAt))
				.limit(Math.min(input?.limit ?? 50, 100))
				.offset(input?.offset ?? 0);
			return Promise.all(rows.map((event) => decorate(actor, event)));
		},

		async getById(actor, id) {
			const event = await loadEvent(db, id);
			return event ? decorate(actor, event) : null;
		},

		async update(actor, eventId, patch) {
			const { event, role } = await requireEvent(actor, eventId);
			if (!canManage(role, actor)) throw new Error("Not authorized to update this event.");
			// Only gate on the type rules when the patch actually changes the type — an owner
			// or manager must always be able to edit an existing event's other fields, even one
			// whose type they could no longer create themselves.
			if (patch.type !== undefined && patch.type !== event.type) {
				const rules = await createEventTypeRulesRepository(db, audit).list();
				if (!canCreateType(actor, rules, patch.type)) {
					throw new Error(`Not authorized to change this event to ${patch.type}.`);
				}
			}
			// Field-level, deliberately not folded into canManage above: canManage is true for the
			// event owner, so an ordinary member who created an event could otherwise mark it
			// read-only and strip its own signup and check-in surface.
			assertMaySetReadOnly(actor, event.readOnly, patch.readOnly);
			const readOnly = patch.readOnly ?? event.readOnly;

			const [updated] = await db
				.update(crsEvents)
				.set({
					title: patch.title ?? event.title,
					type: patch.type ?? event.type,
					place: patch.place ?? event.place,
					description: patch.description ?? event.description,
					startsAt: patch.startsAt ?? event.startsAt,
					endsAt: patch.endsAt ?? event.endsAt,
					allDay: patch.allDay ?? event.allDay,
					readOnly,
					// Collected rows (RSVPs, attendance, awards) are deliberately left in place when an
					// event is flipped read-only; only the configuration that invites new interaction
					// is cleared, so a mistaken flip stays reversible without data loss.
					capacity: readOnly ? READ_ONLY_FIELDS.capacity : patch.capacity === undefined ? event.capacity : patch.capacity,
					graceMinutes: readOnly
						? READ_ONLY_FIELDS.graceMinutes
						: patch.graceMinutes === undefined
							? event.graceMinutes
							: patch.graceMinutes,
					rsvpFormJson: readOnly
						? [...READ_ONLY_FIELDS.rsvpFormJson]
						: patch.rsvpForm === undefined
							? event.rsvpFormJson
							: patch.rsvpForm,
					rsvpResponsesPublic: readOnly
						? READ_ONLY_FIELDS.rsvpResponsesPublic
						: patch.rsvpResponsesPublic === undefined
							? event.rsvpResponsesPublic
							: patch.rsvpResponsesPublic,
				})
				.where(eq(crsEvents.id, eventId))
				.returning();
			await audit.record(actor, { action: "event:update", targetType: "event", targetId: eventId, category: "event" });
			return decorate(actor, updated);
		},

		async softDelete(actor, eventId) {
			const { event, role } = await requireEvent(actor, eventId);
			if (role !== "owner" && !can(actor, "event:moderate")) throw new Error("Not authorized to delete this event.");
			await db.update(crsEvents).set({ deletedAt: new Date() }).where(eq(crsEvents.id, event.id));
			await audit.record(actor, { action: "event:delete", targetType: "event", targetId: eventId, category: "event" });
		},

		async setAwards(actor, eventId, awards) {
			if (!can(actor, "event:points")) throw new Error("Not authorized to set event point awards.");
			if (awards.length > 100) throw new Error("Set at most 100 point awards per event.");
			const awardEvent = await loadEvent(db, eventId);
			if (!awardEvent) throw new Error("Event not found.");
			assertNotReadOnly(awardEvent, "This event does not award points.");

			const ids = awards.map((award) => award.pointTypeId);
			if (new Set(ids).size !== ids.length) throw new Error("Point type IDs must be unique.");
			for (const award of awards) {
				if (!Number.isFinite(award.points) || award.points < -100 || award.points > 100) {
					throw new Error("Award points must be a number from -100 to 100.");
				}
			}
			const quantizedAwards = awards.map((award) => ({
				...award,
				points: quantizePoints(award.points),
			}));

			if (ids.length > 0) {
				const types = await db
					.select({ id: pointTypes.id, active: pointTypes.active })
					.from(pointTypes)
					.where(inArray(pointTypes.id, ids));
				if (types.length !== ids.length || types.some((type: { active: boolean }) => !type.active)) {
					throw new Error("Point types must exist and be active.");
				}
			}

			const event = await loadEvent(db, eventId);
			if (!event) throw new Error("Event not found.");

			const activePointTypeIds = db
				.select({ id: pointTypes.id })
				.from(pointTypes)
				.where(eq(pointTypes.active, true));
			const configuredPointTypeIds = db
				.select({ pointTypeId: eventPointAwards.pointTypeId })
				.from(eventPointAwards)
				.where(eq(eventPointAwards.eventId, eventId));
			const queries = [
				db.delete(eventPointAwards).where(
					and(
						eq(eventPointAwards.eventId, eventId),
						inArray(
							eventPointAwards.pointTypeId,
							db.select({ id: pointTypes.id }).from(pointTypes).where(eq(pointTypes.active, true)),
						),
					),
				),
			];
			if (quantizedAwards.length > 0) {
				queries.push(
					db.insert(eventPointAwards).values(
						quantizedAwards.map((award) => ({
							eventId,
							pointTypeId: award.pointTypeId,
							points: award.points,
						})),
					),
				);
			}
			queries.push(
				buildExistingAttendanceAwardUpsert(db, eventId),
				db
					.delete(retentionRecords)
					.where(
						and(
							eq(retentionRecords.source, "event_attendance"),
							eq(retentionRecords.eventId, eventId),
							inArray(retentionRecords.pointTypeId, activePointTypeIds),
							notInArray(retentionRecords.pointTypeId, configuredPointTypeIds),
						),
					),
				db.insert(auditLogs).values(
					auditInsertValues(actor, {
						action: "event:set_awards",
						targetType: "event",
						targetId: eventId,
						category: "event",
					}),
				),
			);
			await runAtomic(db, queries);

			const attendees = await db
				.selectDistinct({ memberId: crsAttendance.memberId })
				.from(crsAttendance)
				.where(eq(crsAttendance.eventId, eventId));
			for (const attendee of attendees) {
				try {
					await notify(db, {
						memberId: attendee.memberId,
						kind: "points_awarded",
						title: "Points updated",
						body: `${event.title} point awards were updated.`,
						href: `/portal/calendar/${eventId}`,
					});
				} catch (error) {
					console.error("Failed to notify attendee about event point awards.", {
						eventId,
						memberId: attendee.memberId,
						error,
					});
				}
			}
			return { updated: attendees.length };
		},

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
		},

		async removeRetiredAward(actor, eventId, pointTypeId) {
			if (!can(actor, "event:points")) throw new Error("Not authorized to set event points.");
			const event = await loadEvent(db, eventId);
			if (!event) throw new Error("Event not found.");
			// Blocked for consistency with setAwards rather than for escalation risk: this can only
			// remove awards. Leaving its sibling open would read as an oversight later. The escape
			// hatch is the same one undoScan documents — flip read-only off, clean up, flip back.
			assertNotReadOnly(event, "This event does not award points.");
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
		},
		async addStaff(actor, eventId, memberId, role) {
			const { event, role: actorRole } = await requireEvent(actor, eventId);
			if (actorRole !== "owner" && actorRole !== "admin") throw new Error("Not authorized to manage event staff.");
			if (memberId === event.createdBy) throw new Error("Owner cannot be event staff.");
			await db
				.insert(eventStaff)
				.values({ eventId, memberId, role, addedBy: actor.memberId })
				.onConflictDoUpdate({ target: [eventStaff.eventId, eventStaff.memberId], set: { role, addedBy: actor.memberId, addedAt: new Date() } });
			await audit.record(actor, { action: "event:add_staff", targetType: "event", targetId: eventId, category: "event", detail: memberId });
		},

		async removeStaff(actor, eventId, memberId) {
			const { event, role } = await requireEvent(actor, eventId);
			if (role !== "owner" && role !== "admin") throw new Error("Not authorized to manage event staff.");
			if (memberId === event.createdBy) throw new Error("Owner cannot be removed as staff.");
			await db.delete(eventStaff).where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.memberId, memberId)));
			await audit.record(actor, { action: "event:remove_staff", targetType: "event", targetId: eventId, category: "event", detail: memberId });
		},

		async transferOwnership(actor, eventId, toMemberId) {
			const { event, role } = await requireEvent(actor, eventId);
			if (role !== "owner") throw new Error("Not authorized to transfer this event.");
			if (toMemberId === actor.memberId) return;
			await runAtomic(db, [
				db.update(crsEvents).set({ createdBy: toMemberId }).where(eq(crsEvents.id, eventId)),
				db.delete(eventStaff).where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.memberId, toMemberId))),
				db
					.insert(eventStaff)
					.values({ eventId, memberId: event.createdBy, role: "admin", addedBy: actor.memberId })
					.onConflictDoUpdate({
						target: [eventStaff.eventId, eventStaff.memberId],
						set: { role: "admin", addedBy: actor.memberId, addedAt: new Date() },
					}),
			]);
			await audit.record(actor, { action: "event:transfer", targetType: "event", targetId: eventId, category: "event", detail: toMemberId });
		},

		async invite(actor, eventId, memberIds) {
			const { event, role } = await requireEvent(actor, eventId);
			if (role !== "owner" && role !== "admin") throw new Error("Not authorized to invite members.");
			assertNotReadOnly(event, "This event does not take signups.");
			let invited = 0;
			for (const memberId of [...new Set(memberIds)]) {
				const rows = await db
					.insert(eventInvites)
					.values({ eventId, memberId, invitedBy: actor.memberId })
					.onConflictDoNothing()
					.returning({ memberId: eventInvites.memberId });
				if (rows.length === 0) continue;
				invited += 1;
				await notify(db, {
					memberId,
					kind: "event_invite",
					title: "Event invitation",
					body: `You were invited to ${event.title}.`,
					href: `/portal/calendar/${eventId}`,
				});
			}
			await audit.record(actor, { action: "event:invite", targetType: "event", targetId: eventId, category: "event", detail: String(invited) });
			return { invited };
		},

		async listInvites(actor, eventId) {
			const { role } = await requireEvent(actor, eventId);
			if (role !== "owner" && role !== "admin") throw new Error("Not authorized to list event invites.");
			return db
				.select({ memberId: eventInvites.memberId, fullName: members.fullName, name: members.name, invitedAt: eventInvites.invitedAt })
				.from(eventInvites)
				.innerJoin(members, eq(members.id, eventInvites.memberId))
				.where(eq(eventInvites.eventId, eventId))
				.orderBy(asc(members.fullName));
		},

		async listSignupResponses(actor, eventId) {
			const { event, role } = await requireEvent(actor, eventId);
			if (!event.rsvpResponsesPublic && role !== "owner" && role !== "admin" && !can(actor, "event:moderate")) {
				throw new Error("Not authorized to list signup responses.");
			}
			return db
				.select({
					memberId: eventRsvps.memberId,
					fullName: members.fullName,
					name: members.name,
					answers: eventRsvps.answersJson,
					updatedAt: eventRsvps.updatedAt,
					scannedAt: crsAttendance.scannedAt,
				})
				.from(eventRsvps)
				.innerJoin(members, eq(members.id, eventRsvps.memberId))
				.leftJoin(crsAttendance, and(eq(crsAttendance.eventId, eventRsvps.eventId), eq(crsAttendance.memberId, eventRsvps.memberId)))
				.where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.state, "going")))
				.orderBy(asc(members.fullName), asc(members.name));
		},

		async listStaff(actor, eventId) {
			const { event } = await requireEvent(actor, eventId);
			const [owner] = await db
				.select({ memberId: members.id, fullName: members.fullName, name: members.name })
				.from(members)
				.where(eq(members.id, event.createdBy))
				.limit(1);
			const staff = await db
				.select({ memberId: eventStaff.memberId, fullName: members.fullName, name: members.name, role: eventStaff.role })
				.from(eventStaff)
				.innerJoin(members, eq(members.id, eventStaff.memberId))
				.where(eq(eventStaff.eventId, eventId))
				.orderBy(asc(eventStaff.addedAt), asc(members.fullName));
			return owner ? [{ ...owner, role: "owner" as const }, ...staff] : staff;
		},

		async setRsvp(actor, input) {
			const event = await loadEvent(db, input.eventId);
			if (!event) throw new Error("Event not found.");
			assertNotReadOnly(event, "This event does not take signups.");
			const answers = input.state === "going" ? validateEventSignupAnswers(event.rsvpFormJson ?? [], input.answers ?? {}) : {};
			await db
				.insert(eventRsvps)
				.values({ eventId: input.eventId, memberId: actor.memberId, state: input.state, answersJson: answers, updatedAt: new Date() })
				.onConflictDoUpdate({
					target: [eventRsvps.eventId, eventRsvps.memberId],
					set: { state: input.state, answersJson: answers, updatedAt: new Date() },
				});
			return { state: input.state };
		},

		async recordScan(actor, input) {
			const { event, role } = await requireEvent(actor, input.eventId);
			if (!canOperate(role, actor)) throw new Error("Not authorized to scan attendance.");
			assertNotReadOnly(event, "This event does not take check-ins.");
			const scannedAt = new Date();
			if (role === "scanner" && !inCheckinWindow(event, scannedAt)) throw new Error("Check-in is closed.");

			const existing = await loadScanRow(db, input.eventId, input.memberId);
			if (existing) return toScanResult(input.eventId, input.memberId, existing, true);

			const [currentTerm] = await db
				.select({ id: terms.id })
				.from(terms)
				.where(and(lte(terms.startsAt, scannedAt), gte(terms.endsAt, scannedAt)))
				.orderBy(desc(terms.startsAt))
				.limit(1);
			if (currentTerm?.id !== input.termId) {
				throw new Error("No active school year to record attendance against.");
			}

			try {
				await runAtomic(db, [
					db
						.insert(crsAttendance)
						.values({ eventId: input.eventId, memberId: input.memberId, scannedAt, scannedBy: actor.memberId }),
					buildScanAwardUpsert(db, {
						eventId: input.eventId,
						memberId: input.memberId,
						termId: input.termId,
						scannedBy: actor.memberId,
						scannedAt,
					}),
					db.insert(auditLogs).values(
						auditInsertValues(actor, {
							action: "event:scan_attendance",
							targetType: "event",
							targetId: input.eventId,
							category: "event",
							detail: `member=${input.memberId}`,
							targetMemberId: input.memberId,
						}),
					),
				]);
			} catch (error) {
				// Two scanners hit the same badge at once: the loser reports the winner's row.
				const raced = await loadScanRow(db, input.eventId, input.memberId);
				if (raced) return toScanResult(input.eventId, input.memberId, raced, true);
				throw error;
			}
			const inserted = await loadScanRow(db, input.eventId, input.memberId);
			if (!inserted) throw new Error("Scan was recorded but could not be read back.");
			return toScanResult(input.eventId, input.memberId, inserted, false);
		},

		async undoScan(actor, input) {
			const { event, role } = await requireEvent(actor, input.eventId);
			if (!canManage(role, actor) && role !== "scanner") throw new Error("Not authorized to undo attendance.");
			assertNotReadOnly(event, "This event does not take check-ins.");

			const existing = await loadScanRow(db, input.eventId, input.memberId);
			if (!existing) return { removed: false };
			if (!canManage(role, actor) && existing.scannedBy !== actor.memberId) {
				throw new Error("Not authorized to undo attendance.");
			}

			await runAtomic(db, [
				db
					.delete(crsAttendance)
					.where(and(eq(crsAttendance.eventId, input.eventId), eq(crsAttendance.memberId, input.memberId))),
				db
					.delete(retentionRecords)
					.where(
						and(
							eq(retentionRecords.eventId, input.eventId),
							eq(retentionRecords.memberId, input.memberId),
							eq(retentionRecords.source, "event_attendance"),
						),
					),
				db.insert(auditLogs).values(
					auditInsertValues(actor, {
						action: "event:undo_scan",
						targetType: "event",
						targetId: input.eventId,
						category: "event",
						detail: `member=${input.memberId}`,
						targetMemberId: input.memberId,
					}),
				),
			]);
			return { removed: true };
		},

		// Exact-email lookup for the bulk paste box. Deliberately narrower than
		// searchAttendableMembers: only owners, event admins and moderators, because a pasted
		// roster is an admin action while a scanner works one member at a time.
		async resolveAttendableEmails(actor, input) {
			const { event, role } = await requireEvent(actor, input.eventId);
			if (!canOperate(role, actor)) throw new Error("Not authorized to record attendance for this event.");
			const broad = role === "owner" || role === "admin" || can(actor, "event:moderate");
			if (!broad) throw new Error("Only event admins can check members in from a pasted list.");
			// Unlike the search path this throws instead of returning empty: the caller asked for a
			// specific, deliberate write, so silence would look like "none of these emails exist".
			assertNotReadOnly(event, "This event does not take check-ins.");
			const emails = input.emails.map((email) => email.trim().toLowerCase()).filter(Boolean);
			if (emails.length === 0) return [];
			const rows = await db
				.select({
					memberId: members.id,
					fullName: members.fullName,
					name: members.name,
					email: members.email,
					scannedMemberId: crsAttendance.memberId,
				})
				.from(members)
				.leftJoin(
					crsAttendance,
					and(eq(crsAttendance.memberId, members.id), eq(crsAttendance.eventId, input.eventId)),
				)
				.where(inArray(sql`lower(${members.email})`, emails));
			return rows.map(
				(row: {
					memberId: string;
					fullName: string | null;
					name: string | null;
					email: string;
					scannedMemberId: string | null;
				}) => ({
					memberId: row.memberId,
					fullName: row.fullName,
					name: row.name,
					email: row.email,
					alreadyScanned: row.scannedMemberId !== null,
				}),
			);
		},

		async searchAttendableMembers(actor, input) {
			const { event, role } = await requireEvent(actor, input.eventId);
			if (!canOperate(role, actor)) throw new Error("Not authorized to search members for attendance.");
			// A read path that exists only to feed a blocked write; empty rather than throwing so the
			// scanner UI degrades quietly instead of erroring on every keystroke.
			if (event.readOnly) return [];
			const query = input.query.trim();
			const broad = role === "owner" || role === "admin" || can(actor, "event:moderate");
			const term = `%${query.toLowerCase()}%`;
			const rows = await db
				.select({
					memberId: members.id,
					fullName: members.fullName,
					name: members.name,
					email: members.email,
					scannedMemberId: crsAttendance.memberId,
				})
				.from(members)
				.leftJoin(
					crsAttendance,
					and(eq(crsAttendance.memberId, members.id), eq(crsAttendance.eventId, input.eventId)),
				)
				.where(
					broad
						? or(
								like(sql`lower(${members.id})`, term),
								like(sql`lower(${members.email})`, term),
								like(sql`lower(${members.fullName})`, term),
								like(sql`lower(${members.name})`, term),
							)
						: eq(members.id, query),
				)
				.orderBy(asc(members.fullName))
				.limit(Math.min(input.limit ?? 20, 50));
			return rows.map(
				(row: {
					memberId: string;
					fullName: string | null;
					name: string | null;
					email: string;
					scannedMemberId: string | null;
				}) => ({
					memberId: row.memberId,
					fullName: row.fullName,
					name: row.name,
					email: row.email,
					alreadyScanned: row.scannedMemberId !== null,
				}),
			);
		},

		async listAttendance(actor, eventId) {
			const { role } = await requireEvent(actor, eventId);
			if (!canOperate(role, actor)) throw new Error("Not authorized to view attendance.");
			return db
				.select({
					memberId: crsAttendance.memberId,
					fullName: members.fullName,
					name: members.name,
					scannedAt: crsAttendance.scannedAt,
					scannedBy: crsAttendance.scannedBy,
				})
				.from(crsAttendance)
				.innerJoin(members, eq(members.id, crsAttendance.memberId))
				.where(eq(crsAttendance.eventId, eventId))
				.orderBy(desc(crsAttendance.scannedAt));
		},
	};
}
