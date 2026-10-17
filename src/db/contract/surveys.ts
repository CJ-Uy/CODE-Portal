import { z } from "zod";
import { createSurveyInputSchema, METRIC_KEYS, sendSurveyInputSchema } from "@/db/types";
import { operation } from "./common";

const surveyOutputSchema = z.object({
	id: z.string(),
	eventId: z.string().nullable(),
	title: z.string(),
	status: z.enum(["draft", "running", "closed"]),
	sampleSize: z.number().int().nullable(),
	createdBy: z.string(),
	createdAt: z.coerce.date(),
	templateId: z.string().nullable(),
	closesAt: z.coerce.date().nullable(),
	sentAt: z.coerce.date().nullable(),
	reminderAt: z.coerce.date().nullable(),
	reminderSentAt: z.coerce.date().nullable(),
	allowWalkIn: z.boolean(),
	shareWithOrganizers: z.boolean(),
	emailInvitees: z.boolean(),
	aiSummaryJson: z.string().nullable(),
	aiSummaryAt: z.coerce.date().nullable(),
	aiSummaryResponseCount: z.number().int().nullable(),
});

const surveyQuestionOutputSchema = z.object({
	id: z.string(),
	surveyId: z.string(),
	position: z.number().int(),
	type: z.enum(["scale", "text", "choice"]),
	prompt: z.string(),
	optionsJson: z.string().nullable(),
	required: z.boolean(),
	help: z.string().nullable(),
	metricKey: z.enum(METRIC_KEYS).nullable(),
});

const scaleSummarySchema = z.object({
	n: z.number().int(),
	counts: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
	mean: z.number().nullable(),
	topTwoPct: z.number().nullable(),
});

const resultsQuestionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("scale"),
		questionId: z.string(),
		prompt: z.string(),
		help: z.string().nullable(),
		metricKey: z.enum(METRIC_KEYS).nullable(),
		labels: z.tuple([z.string(), z.string()]),
		summary: scaleSummarySchema,
		baseline: z.object({ mean: z.number(), events: z.number().int() }).nullable(),
	}),
	z.object({
		kind: z.literal("choice"),
		questionId: z.string(),
		prompt: z.string(),
		options: z.array(z.string()),
		counts: z.record(z.string(), z.number().int()),
		n: z.number().int(),
	}),
	z.object({
		kind: z.literal("text"),
		questionId: z.string(),
		prompt: z.string(),
		answers: z.array(z.object({ id: z.string(), value: z.string(), hidden: z.boolean() })),
		terms: z.array(z.object({ term: z.string(), count: z.number().int() })),
	}),
]);

const surveyResultsSchema = z.object({
	surveyId: z.string(),
	title: z.string(),
	eventId: z.string().nullable(),
	eventType: z.string().nullable(),
	status: z.enum(["draft", "running", "closed"]),
	closesAt: z.coerce.date().nullable(),
	invitedCount: z.number().int(),
	invitedResponded: z.number().int(),
	walkInCount: z.number().int(),
	responseCount: z.number().int(),
	belowThreshold: z.boolean(),
	shareWithOrganizers: z.boolean(),
	questions: z.array(resultsQuestionSchema),
	summary: z
		.object({
			themes: z.array(
				z.object({
					label: z.string(),
					description: z.string(),
					share: z.enum(["most", "several", "a few"]),
					quotes: z.array(z.string()),
				}),
			),
			usedComments: z.number().int(),
			totalComments: z.number().int(),
			generatedAt: z.coerce.date(),
			responseCountAtGeneration: z.number().int(),
		})
		.nullable(),
});

export const surveysContract = {
	list: operation({
		input: z.object({ limit: z.number().int().min(1).max(50).default(25) }),
		output: z.object({ surveys: z.array(surveyOutputSchema) }),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "allow",
	}),
	get: operation({
		input: z.object({ id: z.string().min(1) }),
		output: z.object({
			survey: surveyOutputSchema.nullable(),
			questions: z.array(surveyQuestionOutputSchema),
		}),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "allow",
	}),
	create: operation({
		input: createSurveyInputSchema,
		output: z.object({ survey: surveyOutputSchema }),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "deny",
	}),
	send: operation({
		input: sendSurveyInputSchema,
		output: z.object({ invited: z.number().int(), eligible: z.number().int() }),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "deny",
	}),
	results: operation({
		input: z.object({ id: z.string().min(1) }),
		output: z.object({ results: surveyResultsSchema }),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "allow",
	}),
};
