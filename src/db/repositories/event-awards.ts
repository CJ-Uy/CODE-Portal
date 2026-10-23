import { and, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { alias, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
	crsAttendance,
	crsEvents,
	eventPointAwards,
	pointTypes,
	retentionRecords,
	surveyAssignments,
	surveys,
	terms,
} from "@/db/schema";
import { ATTENDANCE_SHARE } from "@/lib/points";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

type ScanAwardInput = {
	eventId: string;
	memberId: string;
	termId: string;
	scannedBy: string;
	scannedAt: Date;
};

const attendanceConflict = {
	target: [
		retentionRecords.eventId,
		retentionRecords.memberId,
		retentionRecords.pointTypeId,
	],
	targetWhere: sql`source = 'event_attendance'`,
	set: {
		points: sql`excluded.points`,
		reason: sql`excluded.reason`,
	},
};

/**
 * The event has a feedback form and the member can answer it, so check-in pays only ATTENDANCE_SHARE and the
 * form pays the rest (buildFeedbackShareUpsert). Organizers cannot answer their own event's form, so they get it all.
 */
function feedbackSplit(memberId: AnySQLiteColumn | SQL) {
	return sql`(exists (select 1 from ${surveys} where ${surveys.eventId} = ${crsEvents.id})
		and ${memberId} <> ${crsEvents.createdBy}
		and not exists (select 1 from event_staff where event_staff.event_id = ${crsEvents.id} and event_staff.member_id = ${memberId}))`;
}

const attendancePoints = (memberId: AnySQLiteColumn | SQL) =>
	sql<number>`case when ${feedbackSplit(memberId)} then round(${eventPointAwards.points} * ${ATTENDANCE_SHARE}, 2) else ${eventPointAwards.points} end`;

const attendanceReason = (memberId: AnySQLiteColumn | SQL) =>
	sql<string>`'Attended ' || ${crsEvents.title} || case when ${feedbackSplit(memberId)} then ' (75% now, 25% for the feedback form)' else '' end`;

export function buildExistingAttendanceAwardUpsert(db: Db, eventId: string, pointTypeId?: string) {
	const source = db
		.select({
			id: sql<string>`'ret_' || lower(hex(randomblob(12)))`,
			memberId: crsAttendance.memberId,
			termId: terms.id,
			eventId: crsAttendance.eventId,
			pointTypeId: eventPointAwards.pointTypeId,
			points: attendancePoints(crsAttendance.memberId),
			reason: attendanceReason(crsAttendance.memberId),
			source: sql<"event_attendance">`'event_attendance'`,
			recordedBy: crsAttendance.scannedBy,
			recordedAt: crsAttendance.scannedAt,
		})
		.from(crsAttendance)
		.innerJoin(eventPointAwards, eq(eventPointAwards.eventId, crsAttendance.eventId))
		.innerJoin(
			pointTypes,
			and(eq(pointTypes.id, eventPointAwards.pointTypeId), eq(pointTypes.active, true)),
		)
		.innerJoin(crsEvents, eq(crsEvents.id, crsAttendance.eventId))
		.innerJoin(
			terms,
			and(lte(terms.startsAt, crsAttendance.scannedAt), gte(terms.endsAt, crsAttendance.scannedAt)),
		)
		.where(
			and(
				eq(crsAttendance.eventId, eventId),
				pointTypeId ? eq(eventPointAwards.pointTypeId, pointTypeId) : undefined,
			),
		);

	return db
		.insert(retentionRecords)
		.select(source)
		.onConflictDoUpdate(attendanceConflict);
}

export function buildScanAwardUpsert(db: Db, input: ScanAwardInput) {
	const memberId = sql`${input.memberId}`;
	const source = db
		.select({
			id: sql<string>`'ret_' || lower(hex(randomblob(12)))`,
			memberId: sql<string>`${input.memberId}`,
			termId: sql<string>`${input.termId}`,
			eventId: eventPointAwards.eventId,
			pointTypeId: eventPointAwards.pointTypeId,
			points: attendancePoints(memberId),
			reason: attendanceReason(memberId),
			source: sql<"event_attendance">`'event_attendance'`,
			recordedBy: sql<string>`${input.scannedBy}`,
			recordedAt: sql<Date>`${input.scannedAt.getTime()}`,
		})
		.from(eventPointAwards)
		.innerJoin(
			pointTypes,
			and(eq(pointTypes.id, eventPointAwards.pointTypeId), eq(pointTypes.active, true)),
		)
		.innerJoin(crsEvents, eq(crsEvents.id, eventPointAwards.eventId))
		.where(eq(eventPointAwards.eventId, input.eventId));

	return db
		.insert(retentionRecords)
		.select(source)
		.onConflictDoUpdate(attendanceConflict);
}

/**
 * The rest of each award, for members who answered the event's form: the full award minus what their check-in paid,
 * so the two always sum to the award and a member paid in full before the form existed gets no row. Dated when they
 * answered and filed in their check-in's term. Pass memberId on submit; omit it to re-sync every answer after an award
 * edit. Callers put it after the assignment's completed_at write in the same atomic batch.
 */
export function buildFeedbackShareUpsert(db: Db, eventId: string, memberId?: string) {
	const attendance = alias(retentionRecords, "attendance");
	const remainder = sql<number>`round(${eventPointAwards.points} - ${attendance.points}, 2)`;
	const source = db
		.select({
			id: sql<string>`'ret_' || lower(hex(randomblob(12)))`,
			memberId: attendance.memberId,
			termId: attendance.termId,
			eventId: attendance.eventId,
			pointTypeId: attendance.pointTypeId,
			points: remainder,
			reason: sql<string>`'Answered the feedback form for ' || ${crsEvents.title}`,
			source: sql<"feedback_share">`'feedback_share'`,
			recordedBy: surveys.createdBy,
			recordedAt: surveyAssignments.completedAt,
		})
		.from(attendance)
		.innerJoin(eventPointAwards, and(eq(eventPointAwards.eventId, attendance.eventId), eq(eventPointAwards.pointTypeId, attendance.pointTypeId)))
		.innerJoin(pointTypes, and(eq(pointTypes.id, eventPointAwards.pointTypeId), eq(pointTypes.active, true)))
		.innerJoin(crsEvents, eq(crsEvents.id, attendance.eventId))
		.innerJoin(surveys, eq(surveys.eventId, attendance.eventId))
		.innerJoin(
			surveyAssignments,
			and(eq(surveyAssignments.surveyId, surveys.id), eq(surveyAssignments.memberId, attendance.memberId), isNotNull(surveyAssignments.completedAt)),
		)
		.where(
			and(
				eq(attendance.eventId, eventId),
				eq(attendance.source, "event_attendance"),
				memberId ? eq(attendance.memberId, memberId) : undefined,
				sql`${remainder} > 0`,
			),
		);

	return db
		.insert(retentionRecords)
		.select(source)
		.onConflictDoUpdate({
			target: [retentionRecords.eventId, retentionRecords.memberId, retentionRecords.pointTypeId],
			targetWhere: sql`source = 'feedback_share'`,
			set: { points: sql`excluded.points` },
		});
}
