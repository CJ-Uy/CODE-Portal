import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
	crsAttendance,
	crsEvents,
	eventPointAwards,
	pointTypes,
	retentionRecords,
	terms,
} from "@/db/schema";

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

export function buildExistingAttendanceAwardUpsert(db: Db, eventId: string, pointTypeId?: string) {
	const source = db
		.select({
			id: sql<string>`'ret_' || lower(hex(randomblob(12)))`,
			memberId: crsAttendance.memberId,
			termId: terms.id,
			eventId: crsAttendance.eventId,
			pointTypeId: eventPointAwards.pointTypeId,
			points: eventPointAwards.points,
			reason: sql<string>`'Attended ' || ${crsEvents.title}`,
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
	const source = db
		.select({
			id: sql<string>`'ret_' || lower(hex(randomblob(12)))`,
			memberId: sql<string>`${input.memberId}`,
			termId: sql<string>`${input.termId}`,
			eventId: eventPointAwards.eventId,
			pointTypeId: eventPointAwards.pointTypeId,
			points: eventPointAwards.points,
			reason: sql<string>`'Attended ' || ${crsEvents.title}`,
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
