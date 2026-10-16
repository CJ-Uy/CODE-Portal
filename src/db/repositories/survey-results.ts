import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "@/db/schema";
import { crsEvents, eventDebriefs, surveyAnswers, surveyAssignments, surveyQuestions, surveyResponses, surveys } from "@/db/schema";
import type { EventFeedbackRow, MetricKey, ResultsQuestion, Survey, SurveyResults } from "@/db/types";
import { COMPARE_MIN_EVENTS, COMPARE_MIN_RESPONSES, effectiveStatus, RESULTS_MIN_RESPONSES, scaleSummary } from "@/lib/feedback/stats";
import type { FeedbackSummary } from "@/lib/feedback/summary";
import { topTerms } from "@/lib/feedback/words";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { chunk } from "./email-audience";
import { eventRole, isOrganizerRole } from "./survey-access";

type Db = DrizzleD1Database<typeof schema>;

// D1 binds at most 100 parameters per statement; this leaves room for the other filters.
const ID_CHUNK = 90;

export type ResultsFilter = "all" | "invited";

export type OrganizerResults = {
	state: "none" | "not_shared" | "too_few" | "ready";
	surveyId?: string;
	results?: SurveyResults;
};

export type SurveyResultsRepository = {
	getResults(actor: Actor, surveyId: string, opts: { filter: ResultsFilter }, now?: Date): Promise<SurveyResults>;
	getOrganizerResults(actor: Actor, eventId: string, now?: Date): Promise<OrganizerResults | null>;
	setAnswerHidden(actor: Actor, input: { answerId: string; hidden: boolean }): Promise<void>;
	feedbackForEvents(actor: Actor, eventIds: string[]): Promise<Map<string, EventFeedbackRow>>;
};

type ScaleQuestion = Extract<ResultsQuestion, { kind: "scale" }>;

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Invited head counts and response counts by source, per survey. */
async function surveyCounts(db: Db, surveyIds: string[]) {
	const invited = new Map<string, { invited: number; responded: number }>();
	const responses = new Map<string, { invited: number; walk_in: number }>();
	for (const part of chunk(surveyIds, ID_CHUNK)) {
		const [assignmentRows, responseRows] = await Promise.all([
			db
				.select({ surveyId: surveyAssignments.surveyId, invited: count(), responded: count(surveyAssignments.completedAt) })
				.from(surveyAssignments)
				.where(and(inArray(surveyAssignments.surveyId, part), eq(surveyAssignments.source, "invited")))
				.groupBy(surveyAssignments.surveyId),
			db
				.select({ surveyId: surveyResponses.surveyId, source: surveyResponses.source, n: count() })
				.from(surveyResponses)
				.where(inArray(surveyResponses.surveyId, part))
				.groupBy(surveyResponses.surveyId, surveyResponses.source),
		]);
		for (const row of assignmentRows) invited.set(row.surveyId, { invited: row.invited, responded: row.responded });
		for (const row of responseRows) {
			const bySource = responses.get(row.surveyId) ?? { invited: 0, walk_in: 0 };
			bySource[row.source] = row.n;
			responses.set(row.surveyId, bySource);
		}
	}
	return { invited, responses };
}

/**
 * Per metric: the mean of per-survey means over other effectively closed surveys whose event has the same
 * type, counting only surveys with enough answers on that metric. A metric without enough such surveys is absent.
 */
async function baselines(db: Db, surveyId: string, eventType: string, metricKeys: MetricKey[], now: Date) {
	const candidates = await db
		.select({ id: surveys.id, status: surveys.status, closesAt: surveys.closesAt })
		.from(surveys)
		.innerJoin(crsEvents, eq(crsEvents.id, surveys.eventId))
		.where(and(eq(crsEvents.type, eventType), ne(surveys.id, surveyId)));
	const closedIds = candidates.filter((survey) => effectiveStatus(survey, now) === "closed").map((survey) => survey.id);

	const means = new Map<MetricKey, number[]>();
	for (const part of chunk(closedIds, ID_CHUNK)) {
		const rows = await db
			.select({
				metricKey: surveyQuestions.metricKey,
				n: count(),
				mean: sql<number>`avg(cast(${surveyAnswers.value} as real))`,
			})
			.from(surveyAnswers)
			.innerJoin(surveyQuestions, eq(surveyQuestions.id, surveyAnswers.questionId))
			.where(and(inArray(surveyQuestions.surveyId, part), inArray(surveyQuestions.metricKey, metricKeys)))
			.groupBy(surveyQuestions.surveyId, surveyQuestions.metricKey);
		for (const row of rows) {
			if (!row.metricKey || row.n < RESULTS_MIN_RESPONSES) continue;
			means.set(row.metricKey, [...(means.get(row.metricKey) ?? []), row.mean]);
		}
	}

	const out = new Map<MetricKey, { mean: number; events: number }>();
	for (const [key, values] of means) {
		if (values.length < COMPARE_MIN_EVENTS) continue;
		out.set(key, { mean: round1(values.reduce((sum, value) => sum + value, 0) / values.length), events: values.length });
	}
	return out;
}

/** `forOrganizers` drops hidden comments entirely and never carries the summary. */
async function buildResults(db: Db, survey: Survey, filter: ResultsFilter, now: Date, forOrganizers: boolean): Promise<SurveyResults> {
	const [event] = survey.eventId
		? await db.select({ type: crsEvents.type }).from(crsEvents).where(eq(crsEvents.id, survey.eventId)).limit(1)
		: [];
	const eventType = event?.type ?? null;
	const { invited, responses } = await surveyCounts(db, [survey.id]);
	const bySource = responses.get(survey.id) ?? { invited: 0, walk_in: 0 };
	const responseCount = filter === "invited" ? bySource.invited : bySource.invited + bySource.walk_in;
	const belowThreshold = responseCount < RESULTS_MIN_RESPONSES;

	const header = {
		surveyId: survey.id,
		title: survey.title,
		eventId: survey.eventId,
		eventType,
		status: effectiveStatus(survey, now),
		closesAt: survey.closesAt,
		invitedCount: invited.get(survey.id)?.invited ?? 0,
		invitedResponded: invited.get(survey.id)?.responded ?? 0,
		walkInCount: bySource.walk_in,
		responseCount,
		belowThreshold,
		shareWithOrganizers: survey.shareWithOrganizers,
	};
	// Below the threshold nothing but the counts goes out, to protect anonymity.
	if (belowThreshold) return { ...header, questions: [], summary: null };

	const [questions, answers] = await Promise.all([
		db.select().from(surveyQuestions).where(eq(surveyQuestions.surveyId, survey.id)).orderBy(asc(surveyQuestions.position)),
		db
			.select({
				id: surveyAnswers.id,
				questionId: surveyAnswers.questionId,
				value: surveyAnswers.value,
				hidden: surveyAnswers.hiddenFromOrganizers,
			})
			.from(surveyAnswers)
			.innerJoin(surveyResponses, eq(surveyResponses.id, surveyAnswers.responseId))
			.where(
				and(
					eq(surveyResponses.surveyId, survey.id),
					filter === "invited" ? eq(surveyResponses.source, "invited") : undefined,
					forOrganizers ? eq(surveyAnswers.hiddenFromOrganizers, false) : undefined,
				),
			),
	]);
	const answersFor = new Map<string, typeof answers>();
	for (const answer of answers) {
		const list = answersFor.get(answer.questionId);
		if (list) list.push(answer);
		else answersFor.set(answer.questionId, [answer]);
	}

	const resultQuestions = questions.map((question): ResultsQuestion => {
		const list = answersFor.get(question.id) ?? [];
		const options = JSON.parse(question.optionsJson ?? "[]") as string[];
		const base = { questionId: question.id, prompt: question.prompt };
		if (question.type === "scale") {
			return {
				...base,
				kind: "scale",
				help: question.help,
				metricKey: question.metricKey,
				labels: [options[0] ?? "", options[1] ?? ""],
				summary: scaleSummary(list.map((answer) => Number(answer.value))),
				baseline: null,
			};
		}
		if (question.type === "choice") {
			const counts: Record<string, number> = Object.fromEntries(options.map((option) => [option, 0]));
			for (const answer of list) counts[answer.value] = (counts[answer.value] ?? 0) + 1;
			return { ...base, kind: "choice", options, counts, n: list.length };
		}
		return {
			...base,
			kind: "text",
			answers: list.map((answer) => ({ id: answer.id, value: answer.value, hidden: answer.hidden })),
			terms: topTerms(list.map((answer) => answer.value)),
		};
	});

	const comparable = resultQuestions.filter(
		(question): question is ScaleQuestion & { metricKey: MetricKey } =>
			question.kind === "scale" && question.metricKey !== null && question.summary.n >= COMPARE_MIN_RESPONSES,
	);
	if (eventType && comparable.length > 0) {
		const found = await baselines(db, survey.id, eventType, [...new Set(comparable.map((question) => question.metricKey))], now);
		for (const question of comparable) question.baseline = found.get(question.metricKey) ?? null;
	}

	const summary =
		!forOrganizers && survey.aiSummaryJson && survey.aiSummaryAt
			? {
					...(JSON.parse(survey.aiSummaryJson) as FeedbackSummary),
					generatedAt: survey.aiSummaryAt,
					responseCountAtGeneration: survey.aiSummaryResponseCount ?? 0,
				}
			: null;
	return { ...header, questions: resultQuestions, summary };
}

export function createSurveyResultsRepository(db: Db, audit: AuditRepository): SurveyResultsRepository {
	return {
		async getResults(actor, surveyId, opts, now = new Date()) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to read survey results.");
			const [survey] = await db.select().from(surveys).where(eq(surveys.id, surveyId)).limit(1);
			if (!survey) throw new Error("Survey not found.");
			return buildResults(db, survey, opts.filter, now, false);
		},

		async getOrganizerResults(actor, eventId, now = new Date()) {
			if (!can(actor, "survey:configure") && !isOrganizerRole(await eventRole(db, eventId, actor.memberId))) return null;

			const [survey] = await db.select().from(surveys).where(eq(surveys.eventId, eventId)).limit(1);
			if (!survey || survey.status === "draft") return { state: "none" };
			if (!survey.shareWithOrganizers) return { state: "not_shared", surveyId: survey.id };
			const results = await buildResults(db, survey, "all", now, true);
			if (results.belowThreshold) return { state: "too_few", surveyId: survey.id };
			return { state: "ready", surveyId: survey.id, results };
		},

		async setAnswerHidden(actor, input) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to hide comments.");

			const [answer] = await db
				.select({ type: surveyQuestions.type, surveyId: surveyQuestions.surveyId })
				.from(surveyAnswers)
				.innerJoin(surveyQuestions, eq(surveyQuestions.id, surveyAnswers.questionId))
				.where(eq(surveyAnswers.id, input.answerId))
				.limit(1);
			if (!answer) throw new Error("Answer not found.");
			if (answer.type !== "text") throw new Error("Only comments can be hidden.");

			await db.update(surveyAnswers).set({ hiddenFromOrganizers: input.hidden }).where(eq(surveyAnswers.id, input.answerId));
			await audit.record(actor, {
				action: input.hidden ? "survey:answer_hide" : "survey:answer_unhide",
				targetType: "survey",
				targetId: answer.surveyId,
				category: "survey",
			});
		},

		async feedbackForEvents(actor, eventIds) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to read survey results.");

			const rows = new Map<string, EventFeedbackRow>();
			for (const part of chunk([...new Set(eventIds)], ID_CHUNK)) {
				const [forms, debriefs] = await Promise.all([
					db.select({ id: surveys.id, eventId: surveys.eventId }).from(surveys).where(inArray(surveys.eventId, part)),
					db.select({ eventId: eventDebriefs.eventId }).from(eventDebriefs).where(inArray(eventDebriefs.eventId, part)),
				]);
				if (forms.length === 0) continue;

				const surveyIds = forms.map((form) => form.id);
				const [{ invited, responses }, overallRows] = await Promise.all([
					surveyCounts(db, surveyIds),
					db
						.select({ surveyId: surveyQuestions.surveyId, value: surveyAnswers.value })
						.from(surveyQuestions)
						.leftJoin(surveyAnswers, eq(surveyAnswers.questionId, surveyQuestions.id))
						.where(and(inArray(surveyQuestions.surveyId, surveyIds), eq(surveyQuestions.metricKey, "overall"))),
				]);
				// A survey with an overall question gets an entry even with no answers yet.
				const overallValues = new Map<string, number[]>();
				for (const row of overallRows) {
					const values = overallValues.get(row.surveyId) ?? [];
					if (row.value !== null) values.push(Number(row.value));
					overallValues.set(row.surveyId, values);
				}
				const debriefed = new Set(debriefs.map((debrief) => debrief.eventId));

				for (const form of forms) {
					const bySource = responses.get(form.id) ?? { invited: 0, walk_in: 0 };
					const total = bySource.invited + bySource.walk_in;
					const sample = invited.get(form.id);
					const values = overallValues.get(form.id);
					rows.set(form.eventId!, {
						surveyId: form.id,
						// The same anonymity threshold as the results page.
						overall: values && total >= RESULTS_MIN_RESPONSES ? scaleSummary(values) : null,
						responses: total,
						invitedRate: sample ? sample.responded / sample.invited : null,
						hasDebrief: debriefed.has(form.eventId!),
					});
				}
			}
			return rows;
		},
	};
}

export function createUnavailableSurveyResultsRepository(): SurveyResultsRepository {
	const unavailable = () => Promise.reject(new Error("Survey results are not available through this repository adapter."));
	return { getResults: unavailable, getOrganizerResults: unavailable, setAnswerHidden: unavailable, feedbackForEvents: unavailable };
}
