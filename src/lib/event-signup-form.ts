import { z } from "zod";

export const eventSignupFieldTypes = ["radio", "select", "short_text", "long_text"] as const;
export type EventSignupFieldType = (typeof eventSignupFieldTypes)[number];

export type EventSignupField = {
	id: string;
	type: EventSignupFieldType;
	label: string;
	required: boolean;
	options: string[];
};

export type EventSignupAnswers = Record<string, string>;

const optionSchema = z.string().trim().min(1).max(120);

export const eventSignupFieldSchema = z.object({
	id: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
	type: z.enum(eventSignupFieldTypes),
	label: z.string().trim().min(1).max(160),
	required: z.boolean().default(false),
	options: z.array(optionSchema).max(12).default([]),
});

export const eventSignupFormInputSchema = z
	.array(eventSignupFieldSchema)
	.max(20)
	.transform((fields) =>
		fields.map((field) => ({
			...field,
			options: field.type === "radio" || field.type === "select" ? [...new Set(field.options)] : [],
		})),
	)
	.refine((fields) => new Set(fields.map((field) => field.id)).size === fields.length, "Signup field IDs must be unique.")
	.refine(
		(fields) => fields.every((field) => (field.type === "radio" || field.type === "select" ? field.options.length >= 2 : true)),
		"Choice fields need at least two options.",
	);

export const eventSignupAnswersSchema = z.record(z.string(), z.string().trim().max(2000)).default({});

export function validateEventSignupAnswers(form: EventSignupField[], raw: unknown): EventSignupAnswers {
	const answers = eventSignupAnswersSchema.parse(raw);
	const clean: EventSignupAnswers = {};
	for (const field of form) {
		const value = (answers[field.id] ?? "").trim();
		if (field.required && !value) throw new Error(`Answer "${field.label}".`);
		if ((field.type === "radio" || field.type === "select") && value && !field.options.includes(value)) {
			throw new Error(`Choose a valid option for "${field.label}".`);
		}
		if (value) clean[field.id] = value;
	}
	return clean;
}

export function answerLabel(form: EventSignupField[], fieldId: string): string {
	return form.find((field) => field.id === fieldId)?.label ?? fieldId;
}
