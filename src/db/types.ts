import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import type { ScaleSummary } from "@/lib/feedback/stats";
import type { FeedbackSummary } from "@/lib/feedback/summary";
import { quantizePoints } from "@/lib/points";
import type {
	eventDebriefs,
	members,
	MetricKey,
	surveyAnswers,
	surveyAssignments,
	surveyQuestions,
	surveyResponses,
	surveys,
	surveyTemplates,
	SurveyStatus,
} from "./schema";

export type { MetricKey, SurveySource } from "./schema";

export type Member = InferSelectModel<typeof members>;
export type NewMember = InferInsertModel<typeof members>;
export type MemberPageInput = { q?: string; page?: number; pageSize?: number };
export type MemberPage = { members: Member[]; total: number; page: number; pageSize: number };

export const createMemberInputSchema = z.object({
	email: z.string().trim().toLowerCase().email(),
	name: z.string().trim().min(1).max(120).optional().nullable(),
});

export type CreateMemberInput = z.infer<typeof createMemberInputSchema>;

export const updateMemberProfileInputSchema = z.object({
	fullName: z.string().trim().min(1).max(120).nullable().optional(),
	nickname: z.string().trim().min(1).max(80).nullable().optional(),
	pronouns: z.string().trim().max(80).nullable().optional(),
	batch: z.string().trim().max(20).nullable().optional(),
	birthday: z.iso.date().nullable().optional(),
	birthdayPrivate: z.boolean().optional(),
});

export type UpdateMemberProfileInput = z.infer<typeof updateMemberProfileInputSchema>;

// Points are REAL now, so 0.75 is a legal award. Quantizing here - the single input
// boundary both the manual sheet and the award editor pass through - keeps every
// stored value at 2dp, so sums and exports never surface float dust.
const pointsValueSchema = z.number().finite().transform(quantizePoints);
// Bounds must be asserted before the transform: .transform() returns a pipe with no .min().
const awardPointsSchema = z.number().finite().min(-100).max(100).transform(quantizePoints);

export const createManualRetentionRecordInputSchema = z.object({
	memberIds: z
		.array(z.string().trim().min(1))
		.min(1, "Select at least one member.")
		.max(100, "Select at most 100 members per entry.")
		.transform((ids) => Array.from(new Set(ids))),
	termId: z.string().trim().min(1),
	pointTypeId: z.string().trim().min(1, "Select a point type."),
	eventId: z.string().trim().min(1).nullable().default(null),
	points: pointsValueSchema.nullable().default(null),
	reason: z.string().trim().min(1, "A reason is required.").max(500),
});

export type CreateManualRetentionRecordInput = z.infer<typeof createManualRetentionRecordInputSchema>;

export const eventAwardInputSchema = z.object({
	pointTypeId: z.string().trim().min(1),
	points: awardPointsSchema,
});

export const eventAwardsInputSchema = z
	.array(eventAwardInputSchema)
	.max(100, "Set at most 100 point awards per event.");

export type EventAwardInput = z.infer<typeof eventAwardInputSchema>;

export interface DatabaseAdapter {
	readonly adapterType: "d1-binding" | "local-sqlite" | "shared-api";
	listMembers(): Promise<Member[]>;
	listMembersPage?(input: MemberPageInput): Promise<MemberPage>;
	createMember(input: CreateMemberInput): Promise<Member>;
	getMemberById(id: string): Promise<Member | null>;
	updateMemberProfile(id: string, input: UpdateMemberProfileInput): Promise<Member>;
}

export type Survey = InferSelectModel<typeof surveys>;
export type SurveyQuestion = InferSelectModel<typeof surveyQuestions>;
export type SurveyAssignment = InferSelectModel<typeof surveyAssignments>;
export type SurveyResponse = InferSelectModel<typeof surveyResponses>;
export type SurveyAnswer = InferSelectModel<typeof surveyAnswers>;
export type SurveyTemplate = InferSelectModel<typeof surveyTemplates>;
export type EventDebrief = InferSelectModel<typeof eventDebriefs>;

export const METRIC_KEYS = ["overall", "flow", "content", "venue", "return_intent", "learning"] as const satisfies readonly MetricKey[];

// A survey is created together with its ordered questions in one call so the
// admin form is a single submit. A scale is always 1-5 and its options are the
// [low, high] end labels; a choice lists its choices; text has no options.
export const surveyQuestionInputSchema = z
	.object({
		type: z.enum(["scale", "text", "choice"]),
		prompt: z.string().trim().min(1).max(500),
		help: z.string().trim().min(1).max(500).optional(),
		required: z.boolean().default(false),
		metricKey: z.enum(METRIC_KEYS).optional(),
		options: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
	})
	.superRefine((question, ctx) => {
		const count = question.options?.length ?? 0;
		const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
		if (question.type === "scale" && count !== 2) issue("options", "A scale needs exactly two labels: low and high.");
		if (question.type === "choice" && count < 2) issue("options", "A choice question needs 2 to 20 options.");
		if (question.type === "text" && count > 0) issue("options", "A text question has no options.");
		if (question.metricKey && question.type !== "scale") issue("metricKey", "Only scale questions can be tracked.");
	});

export type SurveyQuestionInput = z.infer<typeof surveyQuestionInputSchema>;

export const createSurveyInputSchema = z.object({
	title: z.string().trim().min(1).max(200),
	eventId: z.string().trim().min(1).nullable().optional(),
	questions: z.array(surveyQuestionInputSchema).min(1).max(30),
});

export type CreateSurveyInput = z.infer<typeof createSurveyInputSchema>;

// A template is a reusable question list; a survey copies it at creation and never follows later edits.
export const saveTemplateInputSchema = z.object({
	id: z.string().trim().min(1).optional(),
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(300).default(""),
	questions: z.array(surveyQuestionInputSchema).min(1).max(30),
});

export type SaveTemplateInput = z.infer<typeof saveTemplateInputSchema>;

export const createFromTemplateInputSchema = z.object({
	templateId: z.string().trim().min(1),
	eventId: z.string().trim().min(1).nullable(),
	title: z.string().trim().min(1).max(200).optional(),
});

export type CreateFromTemplateInput = z.infer<typeof createFromTemplateInputSchema>;

export const updateDraftInputSchema = z.object({
	surveyId: z.string().trim().min(1),
	title: z.string().trim().min(1).max(200),
	questions: z.array(surveyQuestionInputSchema).min(1).max(30),
});

export type UpdateDraftInput = z.infer<typeof updateDraftInputSchema>;

// Sending flips a draft to running and invites a seeded sample of the eligible members. `suggested`
// uses the statistical head count, `all` invites everyone, `count` caps at the eligible total.
export const sendSurveyInputSchema = z.object({
	surveyId: z.string().trim().min(1),
	invite: z.discriminatedUnion("mode", [
		z.object({ mode: z.literal("suggested") }),
		z.object({ mode: z.literal("all") }),
		z.object({ mode: z.literal("count"), count: z.number().int().min(1).max(1000) }),
	]),
	allowWalkIn: z.boolean(),
	shareWithOrganizers: z.boolean(),
	emailInvitees: z.boolean(),
	remind: z.boolean(),
	closesAt: z.coerce.date(),
	seed: z.string().trim().min(1).max(120).optional(),
});

export type SendSurveyInput = z.infer<typeof sendSurveyInputSchema>;

// What can change on a running form. Questions and invitees are fixed once sent.
export const updateRunningInputSchema = z.object({
	surveyId: z.string().trim().min(1),
	closesAt: z.coerce.date().optional(),
	shareWithOrganizers: z.boolean().optional(),
	close: z.literal(true).optional(),
	remindNow: z.literal(true).optional(),
});

export type UpdateRunningInput = z.infer<typeof updateRunningInputSchema>;

export const surveyAnswerInputSchema = z.object({
	questionId: z.string().trim().min(1),
	value: z.string().trim().min(1).max(2000),
});

// The respondent is the signed-in member; eligibility comes from the session.
export const submitSurveyResponseInputSchema = z.object({
	surveyId: z.string().trim().min(1),
	answers: z.array(surveyAnswerInputSchema).min(1).max(30),
});

export type SubmitSurveyResponseInput = z.infer<typeof submitSurveyResponseInputSchema>;

// Interpreted, identity-free results for the admin and organizer views.
export type ResultsQuestion =
	| {
			kind: "scale";
			questionId: string;
			prompt: string;
			help: string | null;
			metricKey: MetricKey | null;
			labels: [string, string];
			summary: ScaleSummary;
			baseline: { mean: number; events: number } | null;
	  }
	| { kind: "choice"; questionId: string; prompt: string; options: string[]; counts: Record<string, number>; n: number }
	| {
			kind: "text";
			questionId: string;
			prompt: string;
			answers: Array<{ id: string; value: string; hidden: boolean }>;
			terms: Array<{ term: string; count: number }>;
	  };

export type SurveyResults = {
	surveyId: string;
	title: string;
	eventId: string | null;
	eventType: string | null;
	status: SurveyStatus;
	closesAt: Date | null;
	invitedCount: number;
	invitedResponded: number;
	walkInCount: number;
	responseCount: number;
	belowThreshold: boolean;
	shareWithOrganizers: boolean;
	questions: ResultsQuestion[];
	summary: (FeedbackSummary & { generatedAt: Date; responseCountAtGeneration: number }) | null;
};

// One row of the admin event archive. surveyId is null for an event with a debrief but no feedback form.
export type EventFeedbackRow = {
	surveyId: string | null;
	overall: ScaleSummary | null;
	responses: number;
	invitedRate: number | null;
	hasDebrief: boolean;
};
