import { and, asc, desc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import {
	crsEvents,
	linkDailyStats,
	shortLinks,
	surveyAssignments,
	surveys,
	terms,
} from "@/db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { RetentionProgress } from "@/lib/retention-parts";
import { loadProgress } from "./retention";
import type { Actor } from "@/server/auth/permissions";
import type * as schema from "@/db/schema";

// The repository registry passes the getDb() handle, whose static type is the
// union of the sync better-sqlite3 and async D1 Drizzle databases. That union
// does not unify the query-builder overloads, so we narrow to the async D1
// shape (what production and the tests run on); the local better-sqlite3 handle
// is structurally compatible at runtime, matching the existing members repo.
type Db = DrizzleD1Database<typeof schema>;

export type OverviewSummary = {
	/** Null when no school year is running now. */
	retention: { termName: string; progress: RetentionProgress } | null;
	pendingSurveys: number;
	/** The member's oldest open invited form, so the home page can link straight to it. */
	oldestPendingSurveyId: string | null;
	upcomingEvents: number;
	linkClicks: number;
};

export type OverviewRepository = {
	getSummary(actor: Actor, now?: Date): Promise<OverviewSummary>;
};

async function getCurrentTerm(db: Db, now: Date): Promise<{ id: string; name: string } | null> {
	const [term] = await db
		.select({ id: terms.id, name: terms.name })
		.from(terms)
		.where(and(lte(terms.startsAt, now), gte(terms.endsAt, now)))
		.orderBy(desc(terms.startsAt))
		.limit(1);
	return term ?? null;
}

export function createOverviewRepository(db: Db): OverviewRepository {
	return {
		async getSummary(actor, now = new Date()) {
			// Independent reads run together: each awaited query is a full D1 round trip.
			const termProgress = getCurrentTerm(db, now).then(async (term) => ({
				term,
				progress: term ? (await loadProgress(db, [actor.memberId], term.id, now)).get(actor.memberId) : undefined,
			}));

			// A member has only a handful of open forms, so one list gives both the count and the oldest.
			const pendingRows = db
				.select({ surveyId: surveyAssignments.surveyId })
				.from(surveyAssignments)
				.innerJoin(surveys, eq(surveys.id, surveyAssignments.surveyId))
				.where(
					and(
						eq(surveyAssignments.memberId, actor.memberId),
						eq(surveyAssignments.source, "invited"),
						isNull(surveyAssignments.completedAt),
						eq(surveys.status, "running"),
						or(isNull(surveys.closesAt), gt(surveys.closesAt, now)),
					),
				)
				.orderBy(asc(surveyAssignments.assignedAt), asc(surveyAssignments.surveyId));

			const eventRows = db
				.select({ count: sql<number>`count(*)` })
				.from(crsEvents)
				.where(and(isNull(crsEvents.deletedAt), gt(crsEvents.startsAt, now)));

			const linkRows = db
				.select({ total: sql<number>`coalesce(sum(${linkDailyStats.count}), 0)` })
				.from(linkDailyStats)
				.innerJoin(shortLinks, eq(shortLinks.id, linkDailyStats.linkId))
				.where(eq(shortLinks.ownerMemberId, actor.memberId));

			const [{ term, progress }, pending, [eventRow], [linkRow]] = await Promise.all([termProgress, pendingRows, eventRows, linkRows]);

			return {
				retention: term && progress ? { termName: term.name, progress } : null,
				pendingSurveys: pending.length,
				oldestPendingSurveyId: pending[0]?.surveyId ?? null,
				upcomingEvents: Number(eventRow?.count ?? 0),
				linkClicks: Number(linkRow?.total ?? 0),
			};
		},
	};
}
