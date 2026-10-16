import { and, asc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import {
	crsAttendance,
	crsEvents,
	surveyAnswers,
	surveyAssignments,
	surveyQuestions,
	surveyResponses,
	surveys,
	surveyTemplates,
} from "@/db/schema";
import type {
	CreateFromTemplateInput,
	CreateSurveyInput,
	SaveTemplateInput,
	SendSurveyInput,
	SubmitSurveyResponseInput,
	Survey,
	SurveyQuestion,
	SurveyQuestionInput,
	SurveyResults,
	SurveyResultsQuestion,
	SurveySource,
	SurveyTemplate,
	UpdateDraftInput,
	UpdateRunningInput,
} from "@/db/types";
import { startOfUtc8Day } from "@/lib/date-slots";
import { effectiveStatus, reminderAtFor, suggestInviteCount } from "@/lib/feedback/stats";
import { createId } from "@/lib/ids";
import { seededSample } from "@/lib/sample";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { chunk } from "./email-audience";
import { notify } from "./notifications";
import { eligibleMemberIds, eventRole } from "./survey-access";
import { pageLimit } from "./types";

type SurveyDb = DrizzleD1Database<typeof schema>;

// D1 binds at most 100 parameters per statement, and drizzle can bind one per column per row.
const D1_MAX_PARAMS = 100;
const rowsPerInsert = (table: typeof surveyQuestions | typeof surveyAnswers | typeof surveyAssignments) =>
	Math.floor(D1_MAX_PARAMS / Object.keys(getTableColumns(table)).length);
const QUESTION_ROWS_PER_INSERT = rowsPerInsert(surveyQuestions);
const ANSWER_ROWS_PER_INSERT = rowsPerInsert(surveyAnswers);
const ASSIGNMENT_ROWS_PER_INSERT = rowsPerInsert(surveyAssignments);

// One insert per chunk; callers put them in a db.batch so a form's questions land together or not at all.
function questionInserts(db: SurveyDb, surveyId: string, questions: SurveyQuestionInput[]) {
	const rows = questions.map((question, index) => ({
		id: createId("srvq"),
		surveyId,
		position: index + 1,
		type: question.type,
		prompt: question.prompt,
		optionsJson: question.options ? JSON.stringify(question.options) : null,
		required: question.required,
		help: question.help ?? null,
		metricKey: question.metricKey ?? null,
	}));
	return chunk(rows, QUESTION_ROWS_PER_INSERT).map((part) => db.insert(surveyQuestions).values(part));
}

export type SendResult = { invited: number; eligible: number };

export type RespondentState = "open" | "answered" | "closed" | "ineligible" | "staff";
export type RespondentView = { survey: Survey; questions: SurveyQuestion[]; eventTitle: string | null; state: RespondentState };

// What a member is told, on the form page and from submitResponse, when the form is not open to them.
export const RESPONDENT_STATE_MESSAGES: Record<Exclude<RespondentState, "open">, string> = {
	closed: "This form has closed.",
	staff: "Organizers give feedback through the debrief.",
	answered: "You've already answered this form.",
	ineligible: "This form is not open to you.",
};

const orderedQuestions = (db: SurveyDb, surveyId: string) =>
	db.select().from(surveyQuestions).where(eq(surveyQuestions.surveyId, surveyId)).orderBy(asc(surveyQuestions.position));

/**
 * Decides, from the session and the clock alone, what this member can do with a running form.
 * `invited` is true when an uncompleted assignment exists to claim; an open state without it is a walk-in.
 */
async function respondentState(
	db: SurveyDb,
	actor: Actor,
	survey: Survey,
	now: Date,
): Promise<{ state: RespondentState; eventTitle: string | null; invited: boolean }> {
	let event: { title: string; deletedAt: Date | null } | undefined;
	if (survey.eventId) {
		[event] = await db
			.select({ title: crsEvents.title, deletedAt: crsEvents.deletedAt })
			.from(crsEvents)
			.where(eq(crsEvents.id, survey.eventId))
			.limit(1);
	}
	const eventTitle = event?.title ?? null;
	const result = (state: RespondentState, invited = false) => ({ state, eventTitle, invited });

	if (survey.status === "draft") return result("ineligible");
	if (effectiveStatus(survey, now) === "closed" || event?.deletedAt) return result("closed");
	if (survey.eventId && (await eventRole(db, survey.eventId, actor.memberId))) return result("staff");

	const [assignment] = await db
		.select({ completedAt: surveyAssignments.completedAt })
		.from(surveyAssignments)
		.where(and(eq(surveyAssignments.surveyId, survey.id), eq(surveyAssignments.memberId, actor.memberId)))
		.limit(1);
	if (assignment) return assignment.completedAt ? result("answered") : result("open", true);

	if (event && survey.allowWalkIn) {
		const [attended] = await db
			.select({ memberId: crsAttendance.memberId })
			.from(crsAttendance)
			.where(and(eq(crsAttendance.eventId, survey.eventId!), eq(crsAttendance.memberId, actor.memberId)))
			.limit(1);
		if (attended) return result("open");
	}
	return result("ineligible");
}

function validateAnswers(questions: SurveyQuestion[], answers: SubmitSurveyResponseInput["answers"]) {
	const byId = new Map(questions.map((question) => [question.id, question]));
	const answered = new Set<string>();
	for (const { questionId, value } of answers) {
		const question = byId.get(questionId);
		if (!question) throw new Error("Answer references an unknown question.");
		if (answered.has(questionId)) throw new Error("Answer each question once.");
		answered.add(questionId);
		if (question.type === "scale" && !/^[1-5]$/.test(value)) throw new Error("Pick a value from 1 to 5.");
		if (question.type === "choice" && !(JSON.parse(question.optionsJson ?? "[]") as string[]).includes(value)) {
			throw new Error("Pick one of the listed choices.");
		}
	}
	if (questions.some((question) => question.required && !answered.has(question.id))) {
		throw new Error("Answer every required question.");
	}
}

// The only writer of survey_responses. submittedAt is always the Manila day, so a response cannot be matched
// to its assignment's exact completedAt. Callers put these in a db.batch with the assignment write.
function responseInserts(
	db: SurveyDb,
	surveyId: string,
	source: SurveySource,
	answers: SubmitSurveyResponseInput["answers"],
	now: Date,
) {
	const responseId = createId("srvr");
	const answerRows = answers.map((answer) => ({
		id: createId("srva"),
		responseId,
		questionId: answer.questionId,
		value: answer.value,
	}));
	return [
		db.insert(surveyResponses).values({ id: responseId, surveyId, source, submittedAt: startOfUtc8Day(now) }),
		...chunk(answerRows, ANSWER_ROWS_PER_INSERT).map((part) => db.insert(surveyAnswers).values(part)),
	] as const;
}

const isPrimaryKeyConflict = (error: unknown) =>
	/UNIQUE constraint failed: survey_assignments/.test(`${(error as Error)?.message} ${(error as { cause?: Error })?.cause?.message}`);

export type SurveysRepository = {
	create(actor: Actor, input: CreateSurveyInput): Promise<Survey>;
	listTemplates(actor: Actor): Promise<SurveyTemplate[]>;
	getTemplate(actor: Actor, id: string): Promise<SurveyTemplate | null>;
	saveTemplate(actor: Actor, input: SaveTemplateInput): Promise<SurveyTemplate>;
	archiveTemplate(actor: Actor, id: string): Promise<void>;
	createFromTemplate(actor: Actor, input: CreateFromTemplateInput): Promise<Survey>;
	updateDraft(actor: Actor, input: UpdateDraftInput): Promise<void>;
	getForEvent(actor: Actor, eventId: string): Promise<Survey | null>;
	eligibleCount(actor: Actor, surveyId: string): Promise<number>;
	send(actor: Actor, input: SendSurveyInput, now?: Date): Promise<SendResult>;
	updateRunning(actor: Actor, input: UpdateRunningInput, now?: Date): Promise<void>;
	list(actor: Actor, input?: { limit?: number }): Promise<Survey[]>;
	getById(actor: Actor, id: string): Promise<{ survey: Survey; questions: SurveyQuestion[] } | null>;
	getForRespondent(actor: Actor, surveyId: string, now?: Date): Promise<RespondentView | null>;
	submitResponse(actor: Actor, input: SubmitSurveyResponseInput, now?: Date): Promise<{ ok: true }>;
	openFeedbackForEvent(actor: Actor, eventId: string, now?: Date): Promise<{ surveyId: string; state: RespondentState } | null>;
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

			const [firstQuestions, ...moreQuestions] = questionInserts(db, surveyId, input.questions);
			await db.batch([firstQuestions, ...moreQuestions]);

			await audit.record(actor, {
				action: "survey:create",
				targetType: "survey",
				targetId: surveyId,
				category: "survey",
			});
			return survey;
		},

		async listTemplates(actor) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to manage survey templates.");
			return db
				.select()
				.from(surveyTemplates)
				.where(isNull(surveyTemplates.archivedAt))
				.orderBy(asc(surveyTemplates.position), asc(surveyTemplates.name));
		},

		// Archived templates still read back, so a survey's provenance can be shown.
		async getTemplate(actor, id) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to manage survey templates.");
			const [template] = await db.select().from(surveyTemplates).where(eq(surveyTemplates.id, id)).limit(1);
			return template ?? null;
		},

		async saveTemplate(actor, input) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to manage survey templates.");

			const fields = { name: input.name, description: input.description, questionsJson: input.questions };
			let template: SurveyTemplate | undefined;
			if (input.id) {
				[template] = await db
					.update(surveyTemplates)
					.set({ ...fields, updatedAt: new Date() })
					.where(and(eq(surveyTemplates.id, input.id), isNull(surveyTemplates.archivedAt)))
					.returning();
			} else {
				// A new template goes last, so the seeded default stays first.
				[template] = await db
					.insert(surveyTemplates)
					.values({
						...fields,
						id: createId("stpl"),
						position: sql`(SELECT COALESCE(MAX(position), -1) + 1 FROM survey_templates)`,
						createdBy: actor.memberId,
					})
					.returning();
			}
			if (!template) throw new Error("Template not found.");

			await audit.record(actor, {
				action: "survey:template_save",
				targetType: "survey_template",
				targetId: template.id,
				category: "survey",
				detail: template.name,
			});
			return template;
		},

		async archiveTemplate(actor, id) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to manage survey templates.");

			const now = new Date();
			const [archived] = await db
				.update(surveyTemplates)
				.set({ archivedAt: now, updatedAt: now })
				.where(and(eq(surveyTemplates.id, id), isNull(surveyTemplates.archivedAt)))
				.returning({ name: surveyTemplates.name });
			if (!archived) throw new Error("Template not found.");

			await audit.record(actor, {
				action: "survey:template_archive",
				targetType: "survey_template",
				targetId: id,
				category: "survey",
				detail: archived.name,
			});
		},

		async createFromTemplate(actor, input) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to create surveys.");

			const [template] = await db
				.select()
				.from(surveyTemplates)
				.where(and(eq(surveyTemplates.id, input.templateId), isNull(surveyTemplates.archivedAt)))
				.limit(1);
			if (!template) throw new Error("Template not found.");

			let eventTitle: string | null = null;
			if (input.eventId) {
				const [event] = await db
					.select({ title: crsEvents.title })
					.from(crsEvents)
					.where(and(eq(crsEvents.id, input.eventId), isNull(crsEvents.deletedAt)))
					.limit(1);
				if (!event) throw new Error("Event not found.");
				// If two admins race past this check, the unique index on surveys.event_id fails the loser's whole batch (raw D1 error, no orphan).
				const [existing] = await db.select({ id: surveys.id }).from(surveys).where(eq(surveys.eventId, input.eventId)).limit(1);
				if (existing) throw new Error("This event already has a feedback form.");
				eventTitle = event.title;
			}

			const surveyId = createId("srv");
			// One batch, so a failed question insert cannot leave an empty draft behind.
			const [[survey]] = await db.batch([
				db
					.insert(surveys)
					.values({
						id: surveyId,
						title: input.title ?? (eventTitle ? `Feedback: ${eventTitle}` : template.name),
						eventId: input.eventId,
						templateId: template.id,
						status: "draft",
						createdBy: actor.memberId,
					})
					.returning(),
				...questionInserts(db, surveyId, template.questionsJson),
			]);

			await audit.record(actor, {
				action: "survey:create",
				targetType: "survey",
				targetId: surveyId,
				category: "survey",
				detail: `From template ${template.name}.`,
			});
			return survey;
		},

		async updateDraft(actor, input) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to edit surveys.");

			const [survey] = await db.select({ status: surveys.status }).from(surveys).where(eq(surveys.id, input.surveyId)).limit(1);
			if (!survey) throw new Error("Survey not found.");
			if (survey.status !== "draft") throw new Error("Questions can't change after sending.");

			// ponytail: a send landing between the check above and this batch would still be overwritten; guard in SQL if sends become concurrent.
			await db.batch([
				db.update(surveys).set({ title: input.title }).where(eq(surveys.id, input.surveyId)),
				db.delete(surveyQuestions).where(eq(surveyQuestions.surveyId, input.surveyId)),
				...questionInserts(db, input.surveyId, input.questions),
			]);
		},

		async getForEvent(actor, eventId) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to read this survey.");
			const [survey] = await db.select().from(surveys).where(eq(surveys.eventId, eventId)).limit(1);
			return survey ?? null;
		},

		async eligibleCount(actor, surveyId) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to read this survey.");
			const [survey] = await db.select({ eventId: surveys.eventId }).from(surveys).where(eq(surveys.id, surveyId)).limit(1);
			if (!survey) throw new Error("Survey not found.");
			return (await eligibleMemberIds(db, survey)).length;
		},

		async send(actor, input, now = new Date()) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to send surveys.");

			const [survey] = await db.select().from(surveys).where(eq(surveys.id, input.surveyId)).limit(1);
			if (!survey) throw new Error("Survey not found.");
			if (survey.status !== "draft") throw new Error("This form has already been sent.");
			if (input.closesAt <= now) throw new Error("Pick a closing time in the future.");

			const eligibleIds = await eligibleMemberIds(db, survey);
			if (eligibleIds.length === 0) throw new Error("No one is eligible for this form yet.");

			const wanted =
				input.invite.mode === "all"
					? eligibleIds.length
					: input.invite.mode === "count"
						? input.invite.count
						: suggestInviteCount(eligibleIds.length);
			const drawn = seededSample(eligibleIds, wanted, input.seed ?? input.surveyId);

			let eventTitle: string | null = null;
			if (survey.eventId) {
				const [event] = await db.select({ title: crsEvents.title }).from(crsEvents).where(eq(crsEvents.id, survey.eventId)).limit(1);
				eventTitle = event?.title ?? null;
			}

			const assignmentRows = drawn.map((memberId) => ({ surveyId: input.surveyId, memberId, source: "invited" as const }));
			// One batch is atomic, so the form never runs without its invitees or the reverse.
			// ponytail: a concurrent send that passed the draft check above can still add a second sample; guard in SQL if sends become concurrent.
			await db.batch([
				db
					.update(surveys)
					.set({
						status: "running",
						sentAt: now,
						closesAt: input.closesAt,
						reminderAt: input.remind ? reminderAtFor(input.closesAt, now) : null,
						// Only an event has a door to walk in through.
						allowWalkIn: survey.eventId ? input.allowWalkIn : false,
						shareWithOrganizers: input.shareWithOrganizers,
						emailInvitees: input.emailInvitees,
						sampleSize: drawn.length,
					})
					.where(and(eq(surveys.id, input.surveyId), eq(surveys.status, "draft"))),
				...chunk(assignmentRows, ASSIGNMENT_ROWS_PER_INSERT).map((part) => db.insert(surveyAssignments).values(part)),
			]);

			await audit.record(actor, {
				action: "survey:send",
				targetType: "survey",
				targetId: input.surveyId,
				category: "survey",
				detail: `Invited ${drawn.length} of ${eligibleIds.length} eligible.`,
			});
			// ponytail: one notify() call per invitee; batch them if "all" on a very large event nears the subrequest cap.
			for (const memberId of drawn) {
				await notify(db, {
					memberId,
					kind: "survey_assigned",
					title: eventTitle ? `How was ${eventTitle}?` : survey.title,
					body: "Share quick feedback. Your name isn't attached to your answers.",
					href: `/portal/surveys/${input.surveyId}`,
				});
			}
			return { invited: drawn.length, eligible: eligibleIds.length };
		},

		async updateRunning(actor, input, now = new Date()) {
			if (!can(actor, "survey:configure")) throw new Error("Not authorized to edit surveys.");

			const [survey] = await db.select().from(surveys).where(eq(surveys.id, input.surveyId)).limit(1);
			if (!survey) throw new Error("Survey not found.");
			if (survey.status !== "running") throw new Error("Only a running form can be edited.");
			if (input.closesAt && input.closesAt <= now) throw new Error("Pick a closing time in the future.");
			// Closing wins over a reminder asked for in the same call.
			const remindNow = input.remindNow && !input.close;
			if (remindNow) {
				if (survey.reminderSentAt) throw new Error("The reminder was already sent.");
				if (effectiveStatus(survey, now) !== "running") throw new Error("This form has already closed.");
			}

			const patch: Partial<typeof surveys.$inferInsert> = {};
			const changes: string[] = [];
			if (input.close) {
				patch.status = "closed";
				changes.push("closed");
			}
			if (input.closesAt) {
				patch.closesAt = input.closesAt;
				// A reminder that was turned off or already sent stays that way; a pending one follows the new close.
				if (survey.reminderAt && !survey.reminderSentAt) patch.reminderAt = reminderAtFor(input.closesAt, now);
				changes.push(`closes ${input.closesAt.toISOString()}`);
			}
			if (input.shareWithOrganizers !== undefined) {
				patch.shareWithOrganizers = input.shareWithOrganizers;
				changes.push(`organizer sharing ${input.shareWithOrganizers ? "on" : "off"}`);
			}
			if (remindNow) {
				patch.reminderAt = now;
				changes.push("reminder sent early");
			}
			if (changes.length === 0) return;

			// The status guard keeps a double submit or a racing close from editing a form that just closed.
			const [updated] = await db
				.update(surveys)
				.set(patch)
				.where(and(eq(surveys.id, input.surveyId), eq(surveys.status, "running")))
				.returning({ id: surveys.id });
			if (!updated) throw new Error("Only a running form can be edited.");

			await audit.record(actor, {
				action: "survey:update",
				targetType: "survey",
				targetId: input.surveyId,
				category: "survey",
				detail: changes.join(", "),
			});
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

		async getForRespondent(actor, surveyId, now = new Date()) {
			const [survey] = await db.select().from(surveys).where(eq(surveys.id, surveyId)).limit(1);
			if (!survey || survey.status === "draft") return null;
			const { state, eventTitle } = await respondentState(db, actor, survey, now);
			// Only someone who can answer gets the questions.
			const questions = state === "open" ? await orderedQuestions(db, surveyId) : [];
			return { survey, questions, eventTitle, state };
		},

		async submitResponse(actor, input, now = new Date()) {
			const [survey] = await db.select().from(surveys).where(eq(surveys.id, input.surveyId)).limit(1);
			if (!survey) throw new Error(RESPONDENT_STATE_MESSAGES.ineligible);
			const { state, invited } = await respondentState(db, actor, survey, now);
			if (state !== "open") throw new Error(RESPONDENT_STATE_MESSAGES[state]);

			validateAnswers(await orderedQuestions(db, survey.id), input.answers);

			if (!invited) {
				// A walk-in's assignment, response and answers land in one atomic batch. A second submit hits the
				// (survey, member) primary key, which rolls the whole batch back.
				try {
					await db.batch([
						db.insert(surveyAssignments).values({ surveyId: survey.id, memberId: actor.memberId, source: "walk_in", completedAt: now }),
						...responseInserts(db, survey.id, "walk_in", input.answers, now),
					]);
				} catch (error) {
					if (isPrimaryKeyConflict(error)) throw new Error(RESPONDENT_STATE_MESSAGES.answered);
					throw error;
				}
				return { ok: true };
			}

			const [claimed] = await db
				.update(surveyAssignments)
				.set({ completedAt: now })
				.where(
					and(
						eq(surveyAssignments.surveyId, survey.id),
						eq(surveyAssignments.memberId, actor.memberId),
						isNull(surveyAssignments.completedAt),
					),
				)
				.returning({ source: surveyAssignments.source });
			if (!claimed) throw new Error(RESPONDENT_STATE_MESSAGES.answered);

			// ponytail: rare crash after the claim can lose one response slot; use a transactional DB if that matters.
			// One batch is atomic, so the response and every answer chunk land together or not at all.
			await db.batch([...responseInserts(db, survey.id, claimed.source, input.answers, now)]);
			return { ok: true };
		},

		async openFeedbackForEvent(actor, eventId, now = new Date()) {
			const [survey] = await db.select().from(surveys).where(eq(surveys.eventId, eventId)).limit(1);
			if (!survey || effectiveStatus(survey, now) !== "running") return null;
			const { state } = await respondentState(db, actor, survey, now);
			// Only a member who can answer, or already did, is shown the card.
			return state === "open" || state === "answered" ? { surveyId: survey.id, state } : null;
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
		listTemplates: unavailable,
		getTemplate: unavailable,
		saveTemplate: unavailable,
		archiveTemplate: unavailable,
		createFromTemplate: unavailable,
		updateDraft: unavailable,
		getForEvent: unavailable,
		eligibleCount: unavailable,
		send: unavailable,
		updateRunning: unavailable,
		list: unavailable,
		getById: unavailable,
		getForRespondent: unavailable,
		submitResponse: unavailable,
		openFeedbackForEvent: unavailable,
		getResults: unavailable,
	} as unknown as SurveysRepository;
}
