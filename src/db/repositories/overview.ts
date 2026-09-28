import { and, desc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import {
	crsEvents,
	linkDailyStats,
	retentionRecords,
	shortLinks,
	surveyAssignments,
	surveys,
	terms,
} from "@/db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { RETENTION_POINT_TYPE_ID } from "@/lib/point-types";
import { quantizePoints } from "@/lib/points";
import type { Actor } from "@/server/auth/permissions";
import type * as schema from "@/db/schema";

// The repository registry passes the getDb() handle, whose static type is the
// union of the sync better-sqlite3 and async D1 Drizzle databases. That union
// does not unify the query-builder overloads, so we narrow to the async D1
// shape (what production and the tests run on); the local better-sqlite3 handle
// is structurally compatible at runtime, matching the existing members repo.
type Db = DrizzleD1Database<typeof schema>;

export type OverviewSummary = {
	retention: { points: number; retainedAt: number | null; termName: string | null };
	pendingSurveys: number;
	upcomingEvents: number;
	linkClicks: number;
};

export type OverviewRepository = {
	getSummary(actor: Actor, now?: Date): Promise<OverviewSummary>;
};

async function getCurrentTerm(db: Db, now: Date): Promise<{ id: string; name: string; retainedAt: number } | null> {
	const [term] = await db
		.select({ id: terms.id, name: terms.name, retainedAt: terms.retainedAt })
		.from(terms)
		.where(and(lte(terms.startsAt, now), gte(terms.endsAt, now)))
		.orderBy(desc(terms.startsAt))
		.limit(1);
	return term ?? null;
}

export function createOverviewRepository(db: Db): OverviewRepository {
	return {
		async getSummary(actor, now = new Date()) {
			const term = await getCurrentTerm(db, now);

			let points = 0;
			if (term) {
				const [row] = await db
					.select({ total: sql<number>`coalesce(sum(${retentionRecords.points}), 0)` })
					.from(retentionRecords)
					.where(
						and(
							eq(retentionRecords.memberId, actor.memberId),
							eq(retentionRecords.termId, term.id),
							eq(retentionRecords.pointTypeId, RETENTION_POINT_TYPE_ID),
						),
					);
				points = quantizePoints(Number(row?.total ?? 0));
			}

			const [surveyRow] = await db
				.select({ count: sql<number>`count(*)` })
				.from(surveyAssignments)
				.innerJoin(surveys, eq(surveys.id, surveyAssignments.surveyId))
				.where(
					and(
						eq(surveyAssignments.memberId, actor.memberId),
						isNull(surveyAssignments.completedAt),
						eq(surveys.status, "running"),
					),
				);

			const [eventRow] = await db
				.select({ count: sql<number>`count(*)` })
				.from(crsEvents)
				.where(and(isNull(crsEvents.deletedAt), gt(crsEvents.startsAt, now)));

			const [linkRow] = await db
				.select({ total: sql<number>`coalesce(sum(${linkDailyStats.count}), 0)` })
				.from(linkDailyStats)
				.innerJoin(shortLinks, eq(shortLinks.id, linkDailyStats.linkId))
				.where(eq(shortLinks.ownerMemberId, actor.memberId));

			return {
				retention: {
					points,
					retainedAt: term?.retainedAt ?? null,
					termName: term?.name ?? null,
				},
				pendingSurveys: Number(surveyRow?.count ?? 0),
				upcomingEvents: Number(eventRow?.count ?? 0),
				linkClicks: Number(linkRow?.total ?? 0),
			};
		},
	};
}
