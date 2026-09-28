import { and, desc, eq, gte, inArray, isNull, like, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { auditLogs, crsAttendance, crsEvents, eventRsvps, members, pointTypes, retentionRecords, terms } from "@/db/schema";
import type { EventStatus } from "@/db/schema";
import { DEFAULT_GRACE_MINUTES } from "@/lib/point-types";
import { quantizePoints } from "@/lib/points";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type TermEventSummaryRow = {
	eventId: string;
	title: string;
	type: string;
	status: EventStatus;
	place: string;
	startsAt: Date;
	endsAt: Date | null;
	graceMinutes: number | null;
	attendedCount: number;
	lateCount: number;
	absentCount: number;
	pointsIssued: number;
};

export type EventRosterReportRow = {
	memberId: string;
	memberEmail: string;
	memberName: string | null;
	startsAt: Date;
	graceMinutes: number | null;
	scannedAt: Date | null;
	scannedById: string | null;
	scannedByName: string | null;
	rsvpState: string | null;
};

export type TermMemberSummaryRow = {
	memberId: string;
	memberEmail: string;
	memberName: string | null;
	attendedCount: number;
	lateCount: number;
	pointsByType: Record<string, number>;
};

export type MemberAttendanceRow = {
	eventId: string;
	eventTitle: string;
	startsAt: Date;
	graceMinutes: number | null;
	scannedAt: Date | null;
	rsvpState: string | null;
	pointsEarned: number;
};

export type ScanLogRow = {
	id: string;
	action: "event:scan_attendance" | "event:undo_scan";
	eventId: string;
	eventTitle: string;
	memberId: string | null;
	memberName: string | null;
	scannerId: string | null;
	scannerName: string | null;
	eventStartsAt: Date;
	graceMinutes: number | null;
	createdAt: Date;
};

export type ListOptions = { q?: string; limit?: number; offset?: number };
export type ScanLogOptions = ListOptions & {
	eventId?: string;
	scannerId?: string;
	memberId?: string;
	from?: Date;
	to?: Date;
};

const scannerMember = alias(members, "scanner_member");
const actorMember = alias(members, "actor_member");
const targetMember = alias(members, "target_member");

const requireReporting = (actor: Actor) => {
	if (!can(actor, "retention:record")) throw new Error("Not authorized to read attendance reports.");
};

export const clampLimit = (limit: number) => Math.min(Math.max(1, Math.floor(limit)), 200);

const lateExpr = sql`${crsAttendance.scannedAt} > ${crsEvents.startsAt} + coalesce(${crsEvents.graceMinutes}, ${DEFAULT_GRACE_MINUTES}) * 60000`;

/**
 * D1 caps bound variables per statement at around 100, so a full page of member ids in a
 * single `inArray` fails with "too many SQL variables". Split into chunks and merge.
 * ponytail: fixed chunk size, no batching abstraction - two call sites, both in this file.
 */
const ID_CHUNK = 80;
const chunkIds = (ids: string[]): string[][] =>
	Array.from({ length: Math.ceil(ids.length / ID_CHUNK) }, (_, i) => ids.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK));

const lowerLike = (column: unknown, pattern: string) => like(sql`lower(${column})`, pattern);

export function createAttendanceReports(db: Db) {
	return {
		async termEventSummaries(actor: Actor, termId: string): Promise<TermEventSummaryRow[]> {
			requireReporting(actor);
			const [term] = await db.select().from(terms).where(eq(terms.id, termId)).limit(1);
			if (!term) return [];

			const summaries: TermEventSummaryRow[] = await db
				.select({
					eventId: crsEvents.id,
					title: crsEvents.title,
					type: crsEvents.type,
					status: crsEvents.status,
					place: crsEvents.place,
					startsAt: crsEvents.startsAt,
					endsAt: crsEvents.endsAt,
					graceMinutes: crsEvents.graceMinutes,
					attendedCount: sql<number>`count(${crsAttendance.memberId})`,
					lateCount: sql<number>`sum(case when ${lateExpr} then 1 else 0 end)`,
				})
				.from(crsEvents)
				.leftJoin(crsAttendance, eq(crsAttendance.eventId, crsEvents.id))
				.where(and(gte(crsEvents.startsAt, term.startsAt), lte(crsEvents.startsAt, term.endsAt), isNull(crsEvents.deletedAt)))
				.groupBy(crsEvents.id, crsEvents.title, crsEvents.type, crsEvents.status, crsEvents.place, crsEvents.startsAt, crsEvents.endsAt, crsEvents.graceMinutes)
				.orderBy(desc(crsEvents.startsAt), desc(crsEvents.id));

			const absents: { eventId: string; count: number }[] = await db
				.select({ eventId: eventRsvps.eventId, count: sql<number>`count(${eventRsvps.memberId})` })
				.from(eventRsvps)
				.innerJoin(crsEvents, eq(crsEvents.id, eventRsvps.eventId))
				.leftJoin(crsAttendance, and(eq(crsAttendance.eventId, eventRsvps.eventId), eq(crsAttendance.memberId, eventRsvps.memberId)))
				.where(
					and(
						eq(eventRsvps.state, "going"),
						isNull(crsAttendance.memberId),
						gte(crsEvents.startsAt, term.startsAt),
						lte(crsEvents.startsAt, term.endsAt),
						isNull(crsEvents.deletedAt),
					),
				)
				.groupBy(eventRsvps.eventId);

			const points: { eventId: string | null; points: number }[] = await db
				.select({
					eventId: retentionRecords.eventId,
					points: sql<number>`coalesce(sum(coalesce(${retentionRecords.points}, 0)), 0)`,
				})
				.from(retentionRecords)
				.where(and(eq(retentionRecords.termId, termId), sql`${retentionRecords.eventId} is not null`))
				.groupBy(retentionRecords.eventId);

			const absentByEvent = new Map(absents.map((row) => [row.eventId, Number(row.count)]));
			const pointsByEvent = new Map(points.map((row) => [row.eventId, quantizePoints(Number(row.points))]));

			return summaries.map((row) => ({
				eventId: row.eventId,
				title: row.title,
				type: row.type,
				status: row.status,
				place: row.place,
				startsAt: row.startsAt,
				endsAt: row.endsAt,
				graceMinutes: row.graceMinutes,
				attendedCount: Number(row.attendedCount),
				lateCount: Number(row.lateCount ?? 0),
				absentCount: absentByEvent.get(row.eventId) ?? 0,
				pointsIssued: pointsByEvent.get(row.eventId) ?? 0,
			}));
		},

		async eventRoster(actor: Actor, eventId: string): Promise<EventRosterReportRow[]> {
			requireReporting(actor);
			const [event] = await db
				.select({ startsAt: crsEvents.startsAt, graceMinutes: crsEvents.graceMinutes })
				.from(crsEvents)
				.where(eq(crsEvents.id, eventId))
				.limit(1);
			if (!event) return [];

			const rsvps: { memberId: string; memberEmail: string; memberName: string | null; rsvpState: string }[] = await db
				.select({ memberId: members.id, memberEmail: members.email, memberName: members.fullName, rsvpState: eventRsvps.state })
				.from(eventRsvps)
				.innerJoin(members, eq(members.id, eventRsvps.memberId))
				.where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.state, "going")));

			const attendance: { memberId: string; memberEmail: string; memberName: string | null; scannedAt: Date; scannedById: string; scannedByName: string | null; scannedByFallbackName: string | null; scannedByEmail: string | null }[] = await db
				.select({
					memberId: members.id,
					memberEmail: members.email,
					memberName: members.fullName,
					scannedAt: crsAttendance.scannedAt,
					scannedById: crsAttendance.scannedBy,
					scannedByName: scannerMember.fullName,
					scannedByFallbackName: scannerMember.name,
					scannedByEmail: scannerMember.email,
				})
				.from(crsAttendance)
				.innerJoin(members, eq(members.id, crsAttendance.memberId))
				.leftJoin(scannerMember, eq(scannerMember.id, crsAttendance.scannedBy))
				.where(eq(crsAttendance.eventId, eventId));

			const rows = new Map<string, EventRosterReportRow>();
			for (const row of rsvps) {
				rows.set(row.memberId, {
					memberId: row.memberId,
					memberEmail: row.memberEmail,
					memberName: row.memberName,
					startsAt: event.startsAt,
					graceMinutes: event.graceMinutes,
					scannedAt: null,
					scannedById: null,
					scannedByName: null,
					rsvpState: row.rsvpState,
				});
			}
			for (const row of attendance) {
				rows.set(row.memberId, {
					memberId: row.memberId,
					memberEmail: row.memberEmail,
					memberName: row.memberName,
					startsAt: event.startsAt,
					graceMinutes: event.graceMinutes,
					scannedAt: row.scannedAt,
					scannedById: row.scannedById,
					scannedByName: row.scannedByName ?? row.scannedByFallbackName ?? row.scannedByEmail,
					rsvpState: rows.get(row.memberId)?.rsvpState ?? null,
				});
			}
			return Array.from(rows.values()).sort((a, b) => a.memberEmail.localeCompare(b.memberEmail));
		},

		async termMemberSummaries(actor: Actor, termId: string, opts: ListOptions = {}): Promise<TermMemberSummaryRow[]> {
			requireReporting(actor);
			const [term] = await db.select().from(terms).where(eq(terms.id, termId)).limit(1);
			if (!term) return [];

			const pattern = opts.q?.trim() ? `%${opts.q.trim().toLowerCase()}%` : null;
			// Raw sql`` fragments carry no column type, so Drizzle cannot map a Date to the
			// timestamp_ms representation the way gte()/lte() on a typed column do. D1 rejects a
			// bound Date outright, so pass milliseconds explicitly here.
			const termFrom = term.startsAt.getTime();
			const termTo = term.endsAt.getTime();
			const activityInTerm = sql`(
				exists (select 1 from crs_attendance ca inner join crs_events ce on ce.id = ca.event_id where ca.member_id = ${members.id} and ce.starts_at >= ${termFrom} and ce.starts_at <= ${termTo} and ce.deleted_at is null)
				or exists (select 1 from event_rsvps er inner join crs_events ce on ce.id = er.event_id where er.member_id = ${members.id} and er.state = 'going' and ce.starts_at >= ${termFrom} and ce.starts_at <= ${termTo} and ce.deleted_at is null)
				or exists (select 1 from retention_records rr where rr.member_id = ${members.id} and rr.term_id = ${termId})
			)`;
			const where = pattern
				? and(activityInTerm, or(lowerLike(members.fullName, pattern), lowerLike(members.name, pattern), lowerLike(members.email, pattern)))
				: activityInTerm;
			const memberRows: { memberId: string; memberEmail: string; memberName: string | null }[] = await db
				.select({ memberId: members.id, memberEmail: members.email, memberName: members.fullName })
				.from(members)
				.where(where)
				.orderBy(members.fullName, members.email, members.id)
				.limit(clampLimit(opts.limit ?? 50))
				.offset(opts.offset ?? 0);

			const memberIds = memberRows.map((row) => row.memberId);
			if (memberIds.length === 0) return [];

			const attendance: { memberId: string; attendedCount: number; lateCount: number }[] = [];
			for (const ids of chunkIds(memberIds)) {
				const rows = await db
					.select({
						memberId: crsAttendance.memberId,
						attendedCount: sql<number>`count(${crsAttendance.eventId})`,
						lateCount: sql<number>`sum(case when ${lateExpr} then 1 else 0 end)`,
					})
					.from(crsAttendance)
					.innerJoin(crsEvents, eq(crsEvents.id, crsAttendance.eventId))
					.where(
						and(inArray(crsAttendance.memberId, ids), gte(crsEvents.startsAt, term.startsAt), lte(crsEvents.startsAt, term.endsAt), isNull(crsEvents.deletedAt)),
					)
					.groupBy(crsAttendance.memberId);
				attendance.push(...rows);
			}

			const points: { memberId: string; pointTypeId: string; points: number }[] = [];
			for (const ids of chunkIds(memberIds)) {
				const rows = await db
					.select({
						memberId: retentionRecords.memberId,
						pointTypeId: retentionRecords.pointTypeId,
						points: sql<number>`coalesce(sum(coalesce(${retentionRecords.points}, 0)), 0)`,
					})
					.from(retentionRecords)
					.innerJoin(pointTypes, eq(pointTypes.id, retentionRecords.pointTypeId))
					.where(and(inArray(retentionRecords.memberId, ids), eq(retentionRecords.termId, termId)))
					.groupBy(retentionRecords.memberId, retentionRecords.pointTypeId);
				points.push(...rows);
			}

			const attendanceByMember = new Map(attendance.map((row) => [row.memberId, row]));
			const pointsByMember = new Map<string, Record<string, number>>();
			for (const row of points) {
				const memberPoints = pointsByMember.get(row.memberId) ?? {};
				memberPoints[row.pointTypeId] = quantizePoints(Number(row.points));
				pointsByMember.set(row.memberId, memberPoints);
			}

			return memberRows.map((row) => {
				const counts = attendanceByMember.get(row.memberId);
				return {
					memberId: row.memberId,
					memberEmail: row.memberEmail,
					memberName: row.memberName,
					attendedCount: Number(counts?.attendedCount ?? 0),
					lateCount: Number(counts?.lateCount ?? 0),
					pointsByType: pointsByMember.get(row.memberId) ?? {},
				};
			});
		},

		async memberAttendance(actor: Actor, memberId: string, termId: string): Promise<MemberAttendanceRow[]> {
			requireReporting(actor);
			const [term] = await db.select().from(terms).where(eq(terms.id, termId)).limit(1);
			if (!term) return [];

			const attendance: { eventId: string; eventTitle: string; startsAt: Date; graceMinutes: number | null; scannedAt: Date }[] = await db
				.select({ eventId: crsEvents.id, eventTitle: crsEvents.title, startsAt: crsEvents.startsAt, graceMinutes: crsEvents.graceMinutes, scannedAt: crsAttendance.scannedAt })
				.from(crsAttendance)
				.innerJoin(crsEvents, eq(crsEvents.id, crsAttendance.eventId))
				.where(and(eq(crsAttendance.memberId, memberId), gte(crsEvents.startsAt, term.startsAt), lte(crsEvents.startsAt, term.endsAt), isNull(crsEvents.deletedAt)));
			const rsvps: { eventId: string; eventTitle: string; startsAt: Date; graceMinutes: number | null; rsvpState: string }[] = await db
				.select({ eventId: crsEvents.id, eventTitle: crsEvents.title, startsAt: crsEvents.startsAt, graceMinutes: crsEvents.graceMinutes, rsvpState: eventRsvps.state })
				.from(eventRsvps)
				.innerJoin(crsEvents, eq(crsEvents.id, eventRsvps.eventId))
				.where(and(eq(eventRsvps.memberId, memberId), eq(eventRsvps.state, "going"), gte(crsEvents.startsAt, term.startsAt), lte(crsEvents.startsAt, term.endsAt), isNull(crsEvents.deletedAt)));
			const points: { eventId: string | null; points: number }[] = await db
				.select({ eventId: retentionRecords.eventId, points: sql<number>`coalesce(sum(coalesce(${retentionRecords.points}, 0)), 0)` })
				.from(retentionRecords)
				.where(and(eq(retentionRecords.memberId, memberId), eq(retentionRecords.termId, termId), sql`${retentionRecords.eventId} is not null`))
				.groupBy(retentionRecords.eventId);

			const pointsByEvent = new Map(points.map((row) => [row.eventId, quantizePoints(Number(row.points))]));
			const rows = new Map<string, MemberAttendanceRow>();
			for (const row of rsvps) {
				rows.set(row.eventId, { eventId: row.eventId, eventTitle: row.eventTitle, startsAt: row.startsAt, graceMinutes: row.graceMinutes, scannedAt: null, rsvpState: row.rsvpState, pointsEarned: pointsByEvent.get(row.eventId) ?? 0 });
			}
			for (const row of attendance) {
				rows.set(row.eventId, { eventId: row.eventId, eventTitle: row.eventTitle, startsAt: row.startsAt, graceMinutes: row.graceMinutes, scannedAt: row.scannedAt, rsvpState: rows.get(row.eventId)?.rsvpState ?? null, pointsEarned: pointsByEvent.get(row.eventId) ?? 0 });
			}
			return Array.from(rows.values()).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || b.eventId.localeCompare(a.eventId));
		},

		async scanLog(actor: Actor, termId: string, opts: ScanLogOptions = {}): Promise<ScanLogRow[]> {
			requireReporting(actor);
			const [term] = await db.select().from(terms).where(eq(terms.id, termId)).limit(1);
			if (!term) return [];

			const conditions = [
				eq(auditLogs.category, "event"),
				inArray(auditLogs.action, ["event:scan_attendance", "event:undo_scan"]),
				gte(crsEvents.startsAt, term.startsAt),
				lte(crsEvents.startsAt, term.endsAt),
				isNull(crsEvents.deletedAt),
			];
			if (opts.eventId) conditions.push(eq(auditLogs.targetId, opts.eventId));
			if (opts.scannerId) conditions.push(eq(auditLogs.actorMemberId, opts.scannerId));
			if (opts.memberId) conditions.push(eq(auditLogs.targetMemberId, opts.memberId));
			if (opts.from) conditions.push(gte(auditLogs.createdAt, opts.from));
			if (opts.to) conditions.push(sql`${auditLogs.createdAt} < ${opts.to}`);

			const rows: {
				id: string;
				action: string;
				eventId: string;
				eventTitle: string;
				eventStartsAt: Date;
				graceMinutes: number | null;
				memberId: string | null;
				memberName: string | null;
				memberFallbackName: string | null;
				memberEmail: string | null;
				scannerId: string | null;
				scannerName: string | null;
				scannerFallbackName: string | null;
				scannerEmail: string | null;
				createdAt: Date;
			}[] = await db
				.select({
					id: auditLogs.id,
					action: auditLogs.action,
					eventId: crsEvents.id,
					eventTitle: crsEvents.title,
					eventStartsAt: crsEvents.startsAt,
					graceMinutes: crsEvents.graceMinutes,
					memberId: auditLogs.targetMemberId,
					memberName: targetMember.fullName,
					memberFallbackName: targetMember.name,
					memberEmail: targetMember.email,
					scannerId: auditLogs.actorMemberId,
					scannerName: actorMember.fullName,
					scannerFallbackName: actorMember.name,
					scannerEmail: actorMember.email,
					createdAt: auditLogs.createdAt,
				})
				.from(auditLogs)
				.innerJoin(crsEvents, eq(crsEvents.id, auditLogs.targetId))
				.leftJoin(targetMember, eq(targetMember.id, auditLogs.targetMemberId))
				.leftJoin(actorMember, eq(actorMember.id, auditLogs.actorMemberId))
				.where(and(...conditions))
				.orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
				.limit(clampLimit(opts.limit ?? 50))
				.offset(opts.offset ?? 0);

			return rows.map((row) => ({
				id: row.id,
				action: row.action as ScanLogRow["action"],
				eventId: row.eventId,
				eventTitle: row.eventTitle,
				eventStartsAt: row.eventStartsAt,
				graceMinutes: row.graceMinutes,
				memberId: row.memberId,
				memberName: row.memberName ?? row.memberFallbackName ?? row.memberEmail,
				scannerId: row.scannerId,
				scannerName: row.scannerName ?? row.scannerFallbackName ?? row.scannerEmail,
				createdAt: row.createdAt,
			}));
		},
	};
}


