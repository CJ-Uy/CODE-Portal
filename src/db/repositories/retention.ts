import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { crsAttendance, crsEvents, eventRsvps, members, pointTypes, retentionRecords, terms } from "@/db/schema";
import type { RetentionRecordSource } from "@/db/schema";
import { fromLocalInput } from "@/lib/date-slots";
import { quantizePoints } from "@/lib/points";
import { RETENTION_POINT_TYPE_ID } from "@/lib/point-types";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { CreateManualRetentionRecordInput } from "../types";
import type { AuditRepository } from "./audit";

export type RetentionRecord = InferSelectModel<typeof retentionRecords>;
export type TypedRetentionRecord = RetentionRecord & { pointTypeId: string; pointTypeLabel: string };

export type TermMasterRow = {
	recordId: string;
	memberId: string;
	memberEmail: string;
	memberName: string | null;
	eventId: string | null;
	eventTitle: string | null;
	pointTypeId: string;
	pointTypeLabel: string;
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

export type ListForMemberInput = { memberId: string; termId: string; limit?: number; offset?: number };
export type MemberTermSummaryInput = { memberId: string; termId: string };
export type RetentionStatus = "retained" | "on_track" | "probation";
export type RetentionSummary = {
	totalPoints: number;
	recordCount: number;
	retainedAt: number;
	probationBelow: number;
	status: RetentionStatus;
};
export type LeaderboardInput = { termId: string; limit?: number; offset?: number };
export type PublicLeaderboardInput = LeaderboardInput & { pointTypeId: string };
export type LedgerListOptions = { q?: string; limit?: number; offset?: number };
export type LeaderboardRow = { memberId: string; fullName: string | null; name: string | null; totalPoints: number };

export type MyHistorySummary = {
	termId: string;
	termName: string;
	totalPoints: number;
	retainedAt: number;
	probationBelow: number;
	status: RetentionStatus;
	recordCount: number;
};

/** One calendar day of the viewer's own points, keyed the way the month grid labels cells. */
export type PointsDay = { date: string; points: number; records: number };

export type TermOption = { id: string; name: string; isCurrent: boolean };

export type TermAdminRow = {
	id: string;
	name: string;
	retainedAt: number;
	probationBelow: number;
	startsAt: Date;
	endsAt: Date;
	isCurrent: boolean;
};

export type TermUpsertInput = {
	id: string | null;
	name: string;
	retainedAt: number;
	probationBelow: number;
	startsAt: Date;
	endsAt: Date;
};

export type RetentionRepository = {
	listForMember(actor: Actor, input: ListForMemberInput): Promise<TypedRetentionRecord[]>;
	getMemberTermSummary(actor: Actor, input: MemberTermSummaryInput): Promise<RetentionSummary>;
	leaderboard(actor: Actor, input: LeaderboardInput): Promise<LeaderboardRow[]>;
	publicLeaderboard(actor: Actor, input: PublicLeaderboardInput): Promise<LeaderboardRow[]>;
	createManual(actor: Actor, input: CreateManualRetentionRecordInput): Promise<{ recordIds: string[] }>;
	listForTerm(actor: Actor, termId: string, opts?: LedgerListOptions): Promise<TermMasterRow[]>;
	listMemberTermHistory(actor: Actor, memberId: string, termId: string, opts?: LedgerListOptions): Promise<MemberHistoryRow[]>;
	listForEvent(actor: Actor, eventId: string): Promise<EventRosterRow[]>;
	myHistory(
		actor: Actor,
		input: { termId?: string },
		now?: Date,
	): Promise<{ summary: MyHistorySummary | null; records: TypedRetentionRecord[] }>;
	myPointsByDay(actor: Actor, input: { year: number; month: number }): Promise<PointsDay[]>;
	listTerms(actor: Actor, now?: Date): Promise<TermOption[]>;
	listTermsAdmin(actor: Actor, now?: Date): Promise<TermAdminRow[]>;
	upsertTerm(actor: Actor, input: TermUpsertInput, now?: Date): Promise<TermAdminRow>;
};

const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function statusFor(totalPoints: number, retainedAt: number, probationBelow: number): RetentionStatus {
	if (totalPoints >= retainedAt) return "retained";
	if (totalPoints < probationBelow) return "probation";
	return "on_track";
}

async function getCurrentTermId(db: Db, now: Date): Promise<string | null> {
	const [term] = await db
		.select({ id: terms.id })
		.from(terms)
		.where(and(lte(terms.startsAt, now), gte(terms.endsAt, now)))
		.orderBy(desc(terms.startsAt))
		.limit(1);
	return term?.id ?? null;
}

const reportBaseColumns = {
	recordId: retentionRecords.id,
	memberId: retentionRecords.memberId,
	memberEmail: members.email,
	memberName: members.fullName,
	eventId: retentionRecords.eventId,
	eventTitle: crsEvents.title,
	pointTypeId: retentionRecords.pointTypeId,
	pointTypeLabel: pointTypes.label,
	points: retentionRecords.points,
	reason: retentionRecords.reason,
	source: retentionRecords.source,
	recordedAt: retentionRecords.recordedAt,
};

const clampReportLimit = (limit: number) => Math.min(Math.max(1, Math.floor(limit)), 200);

const lowerLike = (column: unknown, pattern: string) => like(sql`lower(${column})`, pattern);

const ledgerSearch = (q: string) => {
	const pattern = `%${q.trim().toLowerCase()}%`;
	return or(
		lowerLike(members.fullName, pattern),
		lowerLike(members.name, pattern),
		lowerLike(members.email, pattern),
		lowerLike(crsEvents.title, pattern),
		lowerLike(retentionRecords.reason, pattern),
	);
};

const typedRecordColumns = {
	id: retentionRecords.id,
	memberId: retentionRecords.memberId,
	termId: retentionRecords.termId,
	eventId: retentionRecords.eventId,
	pointTypeId: retentionRecords.pointTypeId,
	pointTypeLabel: pointTypes.label,
	points: retentionRecords.points,
	reason: retentionRecords.reason,
	source: retentionRecords.source,
	recordedBy: retentionRecords.recordedBy,
	recordedAt: retentionRecords.recordedAt,
};

export function createRetentionRepository(db: Db, audit: AuditRepository): RetentionRepository {
	return {
		async listForMember(actor, input) {
			if (actor.memberId !== input.memberId && !can(actor, "retention:record")) {
				throw new Error("Not authorized to read these retention records.");
			}
			return db
				.select(typedRecordColumns)
				.from(retentionRecords)
				.innerJoin(pointTypes, eq(pointTypes.id, retentionRecords.pointTypeId))
				.where(and(eq(retentionRecords.memberId, input.memberId), eq(retentionRecords.termId, input.termId)))
				.orderBy(desc(retentionRecords.recordedAt))
				.limit(Math.min(input.limit ?? 50, 100))
				.offset(input.offset ?? 0);
		},

		async getMemberTermSummary(actor, input) {
			if (actor.memberId !== input.memberId && !can(actor, "retention:record")) {
				throw new Error("Not authorized to read this retention summary.");
			}
			const [agg] = await db
				.select({
					totalPoints: sql<number>`coalesce(sum(${retentionRecords.points}), 0)`,
					recordCount: sql<number>`count(*)`,
				})
				.from(retentionRecords)
				.innerJoin(pointTypes, eq(pointTypes.id, retentionRecords.pointTypeId))
				.where(
					and(
						eq(retentionRecords.memberId, input.memberId),
						eq(retentionRecords.termId, input.termId),
						eq(retentionRecords.pointTypeId, RETENTION_POINT_TYPE_ID),
					),
				);
			const [term] = await db
				.select({ retainedAt: terms.retainedAt, probationBelow: terms.probationBelow })
				.from(terms)
				.where(eq(terms.id, input.termId))
				.limit(1);
			const retainedAt = term?.retainedAt ?? 0;
			const probationBelow = term?.probationBelow ?? 0;
			const totalPoints = quantizePoints(Number(agg?.totalPoints ?? 0));
			const recordCount = Number(agg?.recordCount ?? 0);
			return {
				totalPoints,
				recordCount,
				retainedAt,
				probationBelow,
				status: statusFor(totalPoints, retainedAt, probationBelow),
			};
		},

		async leaderboard(actor, input) {
			if (!can(actor, "retention:record")) {
				throw new Error("Not authorized to read the retention leaderboard.");
			}
			const rows: LeaderboardRow[] = await db
				.select({
					memberId: retentionRecords.memberId,
					fullName: members.fullName,
					name: members.name,
					totalPoints: sql<number>`coalesce(sum(${retentionRecords.points}), 0)`,
				})
				.from(retentionRecords)
				.innerJoin(members, eq(members.id, retentionRecords.memberId))
				.innerJoin(pointTypes, eq(pointTypes.id, retentionRecords.pointTypeId))
				.where(and(eq(retentionRecords.termId, input.termId), eq(retentionRecords.pointTypeId, RETENTION_POINT_TYPE_ID)))
				.groupBy(retentionRecords.memberId, members.fullName, members.name)
				.orderBy(desc(sql`coalesce(sum(${retentionRecords.points}), 0)`))
				.limit(Math.min(input.limit ?? 50, 100))
				.offset(input.offset ?? 0);
			return rows.map((row) => ({ ...row, totalPoints: quantizePoints(Number(row.totalPoints)) }));
		},

		async publicLeaderboard(_actor, input) {
			const rows: LeaderboardRow[] = await db
				.select({
					memberId: retentionRecords.memberId,
					fullName: members.fullName,
					name: members.name,
					totalPoints: sql<number>`coalesce(sum(${retentionRecords.points}), 0)`,
				})
				.from(retentionRecords)
				.innerJoin(members, eq(members.id, retentionRecords.memberId))
				.where(and(eq(retentionRecords.termId, input.termId), eq(retentionRecords.pointTypeId, input.pointTypeId)))
				.groupBy(retentionRecords.memberId, members.fullName, members.name)
				.orderBy(desc(sql`coalesce(sum(${retentionRecords.points}), 0)`))
				.limit(Math.min(input.limit ?? 25, 100))
				.offset(input.offset ?? 0);
			return rows.map((row) => ({ ...row, totalPoints: quantizePoints(Number(row.totalPoints)) }));
		},

		async createManual(actor, input) {
			if (!can(actor, "retention:record")) {
				throw new Error("Not authorized to record retention records.");
			}

			const [term] = await db.select().from(terms).where(eq(terms.id, input.termId)).limit(1);
			if (!term) {
				throw new Error("Term not found.");
			}
			const [pointType] = await db
				.select({ id: pointTypes.id })
				.from(pointTypes)
				.where(and(eq(pointTypes.id, input.pointTypeId), eq(pointTypes.active, true)))
				.limit(1);
			if (!pointType) {
				throw new Error("Point type is not active.");
			}
			if (input.points !== null && (!Number.isFinite(input.points) || input.points < -100 || input.points > 100)) {
				throw new Error("Points must be a number from -100 to 100.");
			}
			const points = input.points === null ? null : quantizePoints(input.points);

			const recordedAt = new Date();
			const rows = input.memberIds.map((memberId) => ({
				id: createId("ret"),
				memberId,
				termId: input.termId,
				eventId: input.eventId,
				pointTypeId: input.pointTypeId,
				points,
				reason: input.reason,
				source: "manual" as const,
				recordedBy: actor.memberId,
				recordedAt,
			}));

			// ponytail: sequential inserts keep local better-sqlite and D1 paths compatible; batch if bulk volume matters.
			for (const row of rows) {
				await db.insert(retentionRecords).values(row);
			}

			const pointsLabel = points === null ? "no points" : `${points} points`;
			for (const row of rows) {
				await audit.record(actor, {
					action: "retention:record_manual",
					targetType: "member",
					targetId: row.memberId,
					category: "retention",
					detail: `${pointsLabel}: ${input.reason}`,
				});
			}

			return { recordIds: rows.map((row) => row.id) };
		},

		async listForTerm(actor, termId, opts) {
			if (!can(actor, "retention:record")) {
				throw new Error("Not authorized to read retention reports.");
			}
			const conditions = [eq(retentionRecords.termId, termId)];
			if (opts?.q?.trim()) {
				const search = ledgerSearch(opts.q);
				if (search) conditions.push(search);
			}
			let query = db
				.select(reportBaseColumns)
				.from(retentionRecords)
				.innerJoin(members, eq(members.id, retentionRecords.memberId))
				.innerJoin(pointTypes, eq(pointTypes.id, retentionRecords.pointTypeId))
				.leftJoin(crsEvents, eq(crsEvents.id, retentionRecords.eventId))
				.where(and(...conditions))
				.orderBy(desc(retentionRecords.recordedAt), desc(retentionRecords.id));
			if (opts?.limit !== undefined) query = query.limit(clampReportLimit(opts.limit));
			if (opts?.offset !== undefined) query = query.offset(opts.offset);
			return query as Promise<TermMasterRow[]>;
		},

		async listMemberTermHistory(actor, memberId, termId, opts) {
			if (!can(actor, "retention:record")) {
				throw new Error("Not authorized to read retention reports.");
			}
			const conditions = [eq(retentionRecords.memberId, memberId), eq(retentionRecords.termId, termId)];
			if (opts?.q?.trim()) {
				const search = ledgerSearch(opts.q);
				if (search) conditions.push(search);
			}
			let query = db
				.select(reportBaseColumns)
				.from(retentionRecords)
				.innerJoin(members, eq(members.id, retentionRecords.memberId))
				.innerJoin(pointTypes, eq(pointTypes.id, retentionRecords.pointTypeId))
				.leftJoin(crsEvents, eq(crsEvents.id, retentionRecords.eventId))
				.where(and(...conditions))
				.orderBy(desc(retentionRecords.recordedAt), desc(retentionRecords.id));
			if (opts?.limit !== undefined) query = query.limit(clampReportLimit(opts.limit));
			if (opts?.offset !== undefined) query = query.offset(opts.offset);
			return query as Promise<MemberHistoryRow[]>;
		},

		async listForEvent(actor, eventId) {
			if (!can(actor, "retention:record")) {
				throw new Error("Not authorized to read retention reports.");
			}
			const rsvps = await db
				.select({
					memberId: members.id,
					memberEmail: members.email,
					memberName: members.fullName,
				})
				.from(eventRsvps)
				.innerJoin(members, eq(members.id, eventRsvps.memberId))
				.where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.state, "going")));
			const attendance = await db
				.select({
					memberId: members.id,
					memberEmail: members.email,
					memberName: members.fullName,
					scannedAt: crsAttendance.scannedAt,
				})
				.from(crsAttendance)
				.innerJoin(members, eq(members.id, crsAttendance.memberId))
				.where(eq(crsAttendance.eventId, eventId));

			const rows = new Map<string, EventRosterRow>();
			for (const row of rsvps) {
				rows.set(row.memberId, { ...row, rsvped: true, attended: false, scannedAt: null });
			}
			for (const row of attendance) {
				rows.set(row.memberId, {
					memberId: row.memberId,
					memberEmail: row.memberEmail,
					memberName: row.memberName,
					rsvped: rows.get(row.memberId)?.rsvped ?? false,
					attended: true,
					scannedAt: row.scannedAt,
				});
			}
			return Array.from(rows.values()).sort((a, b) => a.memberEmail.localeCompare(b.memberEmail));
		},

		async myHistory(actor, input, now = new Date()) {
			const termId = input.termId ?? (await getCurrentTermId(db, now));
			if (!termId) return { summary: null, records: [] };

			const [term] = await db
				.select({ id: terms.id, name: terms.name, retainedAt: terms.retainedAt, probationBelow: terms.probationBelow })
				.from(terms)
				.where(eq(terms.id, termId))
				.limit(1);
			if (!term) return { summary: null, records: [] };

			const rows: TypedRetentionRecord[] = await db
				.select(typedRecordColumns)
				.from(retentionRecords)
				.innerJoin(pointTypes, eq(pointTypes.id, retentionRecords.pointTypeId))
				.where(and(eq(retentionRecords.memberId, actor.memberId), eq(retentionRecords.termId, termId)))
				.orderBy(desc(retentionRecords.recordedAt));

			const totalPoints = quantizePoints(
				rows.reduce(
					(sum: number, row) => sum + (row.pointTypeId === RETENTION_POINT_TYPE_ID ? (row.points ?? 0) : 0),
					0,
				),
			);
			const summary: MyHistorySummary = {
				termId: term.id,
				termName: term.name,
				totalPoints,
				retainedAt: term.retainedAt,
				probationBelow: term.probationBelow,
				status: statusFor(totalPoints, term.retainedAt, term.probationBelow),
				recordCount: rows.length,
			};
			const records: TypedRetentionRecord[] = rows.map((row) => ({
				id: row.id,
				memberId: row.memberId,
				termId: row.termId,
				eventId: row.eventId,
				pointTypeId: row.pointTypeId,
				pointTypeLabel: row.pointTypeLabel,
				points: row.points,
				reason: row.reason,
				source: row.source,
				recordedBy: row.recordedBy,
				recordedAt: row.recordedAt,
			}));
			return { summary, records };
		},

		/**
		 * The viewer's own points per day for one month. Grouped on recorded_at shifted into
		 * UTC+8 so a scan at 9pm Manila lands on the day the member actually attended, not the
		 * next UTC day - the month grid labels its cells the same way via toLocalDate().
		 *
		 * Scoped to actor.memberId with no permission check: this is the viewer reading their
		 * own ledger, the same data myHistory already returns to them.
		 */
		async myPointsByDay(actor, input) {
			const start = fromLocalInput(`${input.year}-${String(input.month).padStart(2, "0")}-01T00:00`);
			const nextMonth = input.month === 12 ? { y: input.year + 1, m: 1 } : { y: input.year, m: input.month + 1 };
			const end = fromLocalInput(`${nextMonth.y}-${String(nextMonth.m).padStart(2, "0")}-01T00:00`);

			const dayKey = sql`strftime('%Y-%m-%d', (${retentionRecords.recordedAt} + ${UTC8_OFFSET_MS}) / 1000, 'unixepoch')`;
			const rows = await db
				.select({
					date: dayKey,
					// COALESCE: points is nullable - an attendance note with no points still counts as a record.
					points: sql<number>`coalesce(sum(coalesce(${retentionRecords.points}, 0)), 0)`,
					records: sql<number>`count(*)`,
				})
				.from(retentionRecords)
				.where(
					and(
						eq(retentionRecords.memberId, actor.memberId),
						gte(retentionRecords.recordedAt, start),
						lte(retentionRecords.recordedAt, new Date(end.getTime() - 1)),
					),
				)
				.groupBy(dayKey);
			return rows.map((row: { date: string; points: number; records: number }) => ({
				date: row.date,
				// Sum of REAL columns, so quantize before it reaches a badge.
				points: quantizePoints(Number(row.points)),
				records: Number(row.records),
			}));
		},

		async listTerms(actor, now = new Date()) {
			const currentTermId = await getCurrentTermId(db, now);
			const rows = await db.select({ id: terms.id, name: terms.name }).from(terms).orderBy(desc(terms.startsAt));
			return rows.map((row: { id: string; name: string }) => ({
				id: row.id,
				name: row.name,
				isCurrent: row.id === currentTermId,
			}));
		},

		async listTermsAdmin(actor, now = new Date()) {
			if (!can(actor, "retention:configure")) throw new Error("Not authorized to manage school years.");
			const currentTermId = await getCurrentTermId(db, now);
			const rows = await db.select().from(terms).orderBy(desc(terms.startsAt));
			return rows.map((row: Omit<TermAdminRow, "isCurrent">) => ({ ...row, isCurrent: row.id === currentTermId }));
		},

		async upsertTerm(actor, input, now = new Date()) {
			if (!can(actor, "retention:configure")) throw new Error("Not authorized to manage school years.");
			const name = input.name.trim();
			if (!name || name.length > 80) throw new Error("School year name is required.");
			if (input.endsAt <= input.startsAt) throw new Error("The end date must be after the start date.");
			if (input.probationBelow > input.retainedAt) {
				throw new Error("Probation threshold cannot be higher than the retained threshold.");
			}

			// Scans resolve their term by date range and take the latest match, so overlapping
			// school years would silently file attendance under the wrong one.
			const overlapping = await db
				.select({ id: terms.id, name: terms.name })
				.from(terms)
				.where(and(lte(terms.startsAt, input.endsAt), gte(terms.endsAt, input.startsAt)));
			const clash = overlapping.find((row: { id: string }) => row.id !== input.id);
			if (clash) throw new Error(`These dates overlap "${clash.name}". School years cannot overlap.`);

			const values = {
				name,
				retainedAt: input.retainedAt,
				probationBelow: input.probationBelow,
				startsAt: input.startsAt,
				endsAt: input.endsAt,
			};
			const isCurrent = input.startsAt <= now && now <= input.endsAt;

			if (input.id === null) {
				const id = createId("term");
				await db.insert(terms).values({ id, ...values });
				await audit.record(actor, { action: "term:create", targetType: "term", targetId: id, category: "retention" });
				return { id, ...values, isCurrent };
			}

			const updated = await db.update(terms).set(values).where(eq(terms.id, input.id)).returning();
			if (updated.length === 0) throw new Error("School year not found.");
			await audit.record(actor, {
				action: "term:update",
				targetType: "term",
				targetId: input.id,
				category: "retention",
			});
			return { id: input.id, ...values, isCurrent };
		},
	};
}
