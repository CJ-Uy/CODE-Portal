import { z } from "zod";
import { createSurveyInputSchema, sampleSurveyInputSchema, submitSurveyResponseInputSchema } from "@/db/types";
import { operation } from "./common";

const surveyOutputSchema = z.object({
	id: z.string(),
	eventId: z.string().nullable(),
	title: z.string(),
	status: z.enum(["draft", "running", "closed"]),
	sampleSize: z.number().int().nullable(),
	createdBy: z.string(),
	createdAt: z.coerce.date(),
});

const surveyQuestionOutputSchema = z.object({
	id: z.string(),
	surveyId: z.string(),
	position: z.number().int(),
	type: z.enum(["scale", "text", "choice"]),
	prompt: z.string(),
	optionsJson: z.string().nullable(),
});

const surveyResultsSchema = z.object({
	surveyId: z.string(),
	title: z.string(),
	status: z.enum(["draft", "running", "closed"]),
	assignedCount: z.number().int(),
	completedCount: z.number().int(),
	questions: z.array(
		z.object({
			questionId: z.string(),
			prompt: z.string(),
			type: z.enum(["scale", "text", "choice"]),
			answerCount: z.number().int(),
			valueCounts: z.record(z.string(), z.number().int()).optional(),
			textAnswers: z.array(z.string()).optional(),
		}),
	),
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
	sample: operation({
		input: sampleSurveyInputSchema,
		output: z.object({
			assigned: z.number().int(),
			tokens: z.array(z.object({ memberId: z.string(), token: z.string() })),
		}),
		auth: "admin",
		permission: "survey:configure",
		sharedDev: "deny",
	}),
	submit: operation({
		input: submitSurveyResponseInputSchema,
		output: z.object({ ok: z.literal(true) }),
		auth: "public",
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
