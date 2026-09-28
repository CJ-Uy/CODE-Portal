import { and, asc, eq, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { members, surveyAnswers, surveyAssignments, surveyQuestions, surveyResponses, surveys } from "@/db/schema";
import type {
	CreateSurveyInput,
	SampleSurveyInput,
	SubmitSurveyResponseInput,
	Survey,
	SurveyQuestion,
	SurveyResults,
	SurveyResultsQuestion,
} from "@/db/types";
import { createId } from "@/lib/ids";
import { seededSample } from "@/lib/sample";
import { generateResponseToken, hashResponseToken } from "@/lib/survey-token";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { notify } from "./notifications";
import { pageLimit } from "./types";

type SurveyDb = DrizzleD1Database<typeof schema>;

export type SampleResult = {
	assigned: number;
	tokens: Array<{ memberId: string; token: string }>;
};

export type SurveysRepository = {
	create(actor: Actor, input: CreateSurveyInput): Promise<Survey>;
	sample(actor: Actor, input: SampleSurveyInput): Promise<SampleResult>;
	list(actor: Actor, input?: { limit?: number }): Promise<Survey[]>;
	getById(actor: Actor, id: string): Promise<{ survey: Survey; questions: SurveyQuestion[] } | null>;
	getForRespondent(surveyId: string): Promise<{ survey: Survey; questions: SurveyQuestion[] } | null>;
	submitResponse(input: SubmitSurveyResponseInput): Promise<{ ok: true }>;
	getResults(actor: Actor, surveyId: string): Promise<SurveyResults>;
};

export function createSurveysRepository(db: SurveyDb, audit: AuditRepository): SurveysRepository {
	return {
		async create(actor, input) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to create surveys.");

			const surveyId = createId("srv");
			const [survey] = await db
				.insert(surveys)
				.values({
					id: surveyId,
					title: input.title,
					eventId: input.eventId ?? null,
					status: "draft",
					createdBy: actor.memberId,
				})
				.returning();

			await db.insert(surveyQuestions).values(
				input.questions.map((question, index) => ({
					id: createId("srvq"),
					surveyId,
					position: index + 1,
					type: question.type,
					prompt: question.prompt,
					optionsJson: question.options ? JSON.stringify(question.options) : null,
				})),
			);

			await audit.record(actor, {
				action: "survey:create",
				targetType: "survey",
				targetId: surveyId,
				category: "survey",
			});
			return survey;
		},

		async sample(actor, input) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to sample surveys.");

			const [survey] = await db.select().from(surveys).where(eq(surveys.id, input.surveyId)).limit(1);
			if (!survey) throw new Error("Survey not found.");
			if (survey.status !== "draft") throw new Error("Survey has already been sampled.");

			const eligible = await db
				.select({ id: members.id })
				.from(members)
				.where(eq(members.status, "active"))
				.orderBy(asc(members.id));
			const drawn = seededSample(
				eligible.map((row) => row.id),
				input.sampleSize,
				input.seed ?? input.surveyId,
			);

			const tokens: Array<{ memberId: string; token: string }> = [];
			const assignmentRows: Array<{ surveyId: string; memberId: string; responseTokenHash: string }> = [];
			for (const memberId of drawn) {
				const token = generateResponseToken();
				tokens.push({ memberId, token });
				assignmentRows.push({
					surveyId: input.surveyId,
					memberId,
					responseTokenHash: await hashResponseToken(token),
				});
			}

			for (let i = 0; i < assignmentRows.length; i += 33) {
				await db.insert(surveyAssignments).values(assignmentRows.slice(i, i + 33));
			}
			await db
				.update(surveys)
				.set({ status: "running", sampleSize: assignmentRows.length })
				.where(eq(surveys.id, input.surveyId));

			await audit.record(actor, {
				action: "survey:sample",
				targetType: "survey",
				targetId: input.surveyId,
				category: "survey",
				detail: `Assigned ${assignmentRows.length} members.`,
			});
			for (const memberId of drawn) {
				await notify(db, {
					memberId,
					kind: "survey_assigned",
					title: "Survey assigned",
					body: "You were selected for a survey.",
					href: `/portal/surveys/${input.surveyId}`,
				});
			}
			return { assigned: assignmentRows.length, tokens };
		},

		async list(actor, input) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to list surveys.");
			return db.select().from(surveys).orderBy(asc(surveys.createdAt)).limit(pageLimit(input?.limit));
		},

		async getById(actor, id) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to read this survey.");
			const [survey] = await db.select().from(surveys).where(eq(surveys.id, id)).limit(1);
			if (!survey) return null;
			const questions = await db
				.select()
				.from(surveyQuestions)
				.where(eq(surveyQuestions.surveyId, id))
				.orderBy(asc(surveyQuestions.position));
			return { survey, questions };
		},

		async getForRespondent(surveyId) {
			const [survey] = await db.select().from(surveys).where(eq(surveys.id, surveyId)).limit(1);
			if (!survey) return null;
			const questions = await db
				.select()
				.from(surveyQuestions)
				.where(eq(surveyQuestions.surveyId, surveyId))
				.orderBy(asc(surveyQuestions.position));
			return { survey, questions };
		},

		async submitResponse(input) {
			const tokenHash = await hashResponseToken(input.token);
			const claimed = await db
				.update(surveyAssignments)
				.set({ completedAt: new Date() })
				.where(
					and(
						eq(surveyAssignments.surveyId, input.surveyId),
						eq(surveyAssignments.responseTokenHash, tokenHash),
						isNull(surveyAssignments.completedAt),
					),
				)
				.returning({ memberId: surveyAssignments.memberId });
			if (claimed.length !== 1) {
				throw new Error("This survey link is invalid or has already been used.");
			}

			const questions = await db
				.select({ id: surveyQuestions.id })
				.from(surveyQuestions)
				.where(eq(surveyQuestions.surveyId, input.surveyId));
			const questionIds = new Set(questions.map((question) => question.id));
			for (const answer of input.answers) {
				if (!questionIds.has(answer.questionId)) throw new Error("Answer references an unknown question.");
			}

			// ponytail: rare crash after token claim can lose one response slot; use a transactional DB if that matters.
			const responseId = createId("srvr");
			await db.batch([
				db.insert(surveyResponses).values({ id: responseId, surveyId: input.surveyId }),
				db.insert(surveyAnswers).values(
					input.answers.map((answer) => ({
						id: createId("srva"),
						responseId,
						questionId: answer.questionId,
						value: answer.value,
					})),
				),
			]);
			return { ok: true };
		},

		async getResults(actor, surveyId) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to read survey results.");

			const [survey] = await db.select().from(surveys).where(eq(surveys.id, surveyId)).limit(1);
			if (!survey) throw new Error("Survey not found.");
			const questions = await db
				.select()
				.from(surveyQuestions)
				.where(eq(surveyQuestions.surveyId, surveyId))
				.orderBy(asc(surveyQuestions.position));
			const assignments = await db
				.select({ completedAt: surveyAssignments.completedAt })
				.from(surveyAssignments)
				.where(eq(surveyAssignments.surveyId, surveyId));
			const answers = await db
				.select({ questionId: surveyAnswers.questionId, value: surveyAnswers.value })
				.from(surveyAnswers)
				.innerJoin(surveyResponses, eq(surveyResponses.id, surveyAnswers.responseId))
				.where(eq(surveyResponses.surveyId, surveyId));

			const resultQuestions: SurveyResultsQuestion[] = questions.map((question) => {
				const forQuestion = answers.filter((answer) => answer.questionId === question.id);
				if (question.type === "text") {
					return {
						questionId: question.id,
						prompt: question.prompt,
						type: question.type,
						answerCount: forQuestion.length,
						textAnswers: forQuestion.map((answer) => answer.value),
					};
				}
				const valueCounts: Record<string, number> = {};
				for (const answer of forQuestion) valueCounts[answer.value] = (valueCounts[answer.value] ?? 0) + 1;
				return {
					questionId: question.id,
					prompt: question.prompt,
					type: question.type,
					answerCount: forQuestion.length,
					valueCounts,
				};
			});

			return {
				surveyId,
				title: survey.title,
				status: survey.status,
				assignedCount: assignments.length,
				completedCount: assignments.filter((assignment) => assignment.completedAt !== null).length,
				questions: resultQuestions,
			};
		},
	};
}

export function createUnavailableSurveysRepository(): SurveysRepository {
	const unavailable = () => Promise.reject(new Error("Surveys are not available through this repository adapter."));
	return {
		create: unavailable,
		sample: unavailable,
		list: unavailable,
		getById: unavailable,
		getForRespondent: unavailable,
		submitResponse: unavailable,
		getResults: unavailable,
	} as unknown as SurveysRepository;
}
