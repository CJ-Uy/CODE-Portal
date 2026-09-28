import { z } from "zod";
import { eventTypeKeySchema } from "@/lib/event-type-key";
import { eventSignupAnswersSchema, eventSignupFormInputSchema } from "@/lib/event-signup-form";
import { operation } from "./common";

export const calendarItemSchema = z.object({
	id: z.string(),
	source: z.enum(["event", "birthday", "term_deadline"]),
	title: z.string(),
	date: z.string(),
	// z.object STRIPS unknown keys rather than rejecting them, so every field added to CalendarItem
	// must be added here too — otherwise it silently vanishes across the shared-Worker boundary and
	// the calendar renders colourless and single-day in APP_ENV=shared only.
	endDate: z.string(),
	startsAt: z.string().nullable(),
	endsAt: z.string().nullable(),
	eventId: z.string().nullable(),
	href: z.string().nullable(),
	colour: z.string(),
	readOnly: z.boolean(),
});

export const getMonthInputSchema = z.object({
	year: z.number().int().min(2000).max(2100),
	month: z.number().int().min(1).max(12),
});

export const eventDetailSchema = z.object({
	id: z.string(),
	title: z.string(),
	type: eventTypeKeySchema,
	status: z.enum(["pending", "approved", "rejected"]),
	points: z.number().nullable(),
	place: z.string(),
	capacity: z.number().nullable(),
	startsAt: z.coerce.date(),
	endsAt: z.coerce.date().nullable(),
	description: z.string(),
	rsvpForm: eventSignupFormInputSchema,
	rsvpResponsesPublic: z.boolean(),
	myRsvpAnswers: eventSignupAnswersSchema,
	myRsvp: z.enum(["going", "none"]),
	attendingCount: z.number(),
	iAttended: z.boolean(),
	media: z.array(z.object({ id: z.string(), r2Key: z.string(), caption: z.string().nullable() })),
});

export const calendarContract = {
	getMonth: operation({
		input: getMonthInputSchema,
		output: z.object({ items: z.array(calendarItemSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	getEvent: operation({
		input: z.object({ eventId: z.string().min(1) }),
		output: z.object({ event: eventDetailSchema.nullable() }),
		auth: "member",
		sharedDev: "allow",
	}),
};
