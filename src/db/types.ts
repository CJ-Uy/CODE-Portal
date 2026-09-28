import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import { quantizePoints } from "@/lib/points";
import type {
	members,
	surveyAnswers,
	surveyAssignments,
	surveyQuestions,
	surveyResponses,
	surveys,
	SurveyQuestionType,
	SurveyStatus,
} from "./schema";

export type Member = InferSelectModel<typeof members>;
export type NewMember = InferInsertModel<typeof members>;

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
	createMember(input: CreateMemberInput): Promise<Member>;
	getMemberById(id: string): Promise<Member | null>;
	updateMemberProfile(id: string, input: UpdateMemberProfileInput): Promise<Member>;
}

export type Survey = InferSelectModel<typeof surveys>;
export type SurveyQuestion = InferSelectModel<typeof surveyQuestions>;
export type SurveyAssignment = InferSelectModel<typeof surveyAssignments>;
export type SurveyResponse = InferSelectModel<typeof surveyResponses>;
export type SurveyAnswer = InferSelectModel<typeof surveyAnswers>;

// A survey is created together with its ordered questions in one call so the
// admin form is a single submit. Choice/scale questions carry their options.
export const surveyQuestionInputSchema = z.object({
	type: z.enum(["scale", "text", "choice"]),
	prompt: z.string().trim().min(1).max(500),
	options: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

export type SurveyQuestionInput = z.infer<typeof surveyQuestionInputSchema>;

export const createSurveyInputSchema = z.object({
	title: z.string().trim().min(1).max(200),
	eventId: z.string().trim().min(1).nullable().optional(),
	questions: z.array(surveyQuestionInputSchema).min(1).max(30),
});

export type CreateSurveyInput = z.infer<typeof createSurveyInputSchema>;

// Drawing the sample also flips the survey to running. sampleSize is the number
// of members to draw; seed makes the draw deterministic and testable.
export const sampleSurveyInputSchema = z.object({
	surveyId: z.string().trim().min(1),
	sampleSize: z.number().int().min(1).max(1000),
	seed: z.string().trim().min(1).max(120).optional(),
});

export type SampleSurveyInput = z.infer<typeof sampleSurveyInputSchema>;

export const surveyAnswerInputSchema = z.object({
	questionId: z.string().trim().min(1),
	value: z.string().trim().min(1).max(2000),
});

// The raw token travels in the body; the server hashes it and never stores it.
export const submitSurveyResponseInputSchema = z.object({
	surveyId: z.string().trim().min(1),
	token: z.string().trim().min(1).max(200),
	answers: z.array(surveyAnswerInputSchema).min(1).max(30),
});

export type SubmitSurveyResponseInput = z.infer<typeof submitSurveyResponseInputSchema>;

// Aggregated, identity-free results. Per question we expose only counts.
export type SurveyResultsQuestion = {
	questionId: string;
	prompt: string;
	type: SurveyQuestionType;
	answerCount: number;
	// For scale/choice: value -> count. For text: omitted.
	valueCounts?: Record<string, number>;
	// For text: the raw answer strings, with no ordering tie to any member.
	textAnswers?: string[];
};

export type SurveyResults = {
	surveyId: string;
	title: string;
	status: SurveyStatus;
	assignedCount: number;
	completedCount: number;
	questions: SurveyResultsQuestion[];
};
