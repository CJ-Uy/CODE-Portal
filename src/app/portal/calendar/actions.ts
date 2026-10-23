"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { eventTypeKeySchema } from "@/lib/event-type-key";
import { eventSignupFormInputSchema } from "@/lib/event-signup-form";
import { requireActor } from "@/server/auth/actor";
import { endOfUtc8Day, startOfUtc8Day } from "@/lib/date-slots";

// Server actions get Next's built-in same-origin/POST protection (same as every
// other mutation action in this app, e.g. members/list/actions.ts).

const createSchema = z
	.object({
		title: z.string().trim().min(1, "Add a title.").max(160),
		type: eventTypeKeySchema,
		place: z.string().trim().min(1, "Add a place.").max(160),
		description: z.string().trim().min(1, "Add a description.").max(4000),
		startsAt: z.coerce.date(),
		endsAt: z.coerce.date(),
		capacity: z.number().int().min(1).max(100000).nullable().default(null),
		graceMinutes: z.number().int().min(0).max(240).nullable().default(null),
		rsvpForm: eventSignupFormInputSchema.default([]),
		rsvpResponsesPublic: z.boolean().default(false),
		allDay: z.boolean().default(false),
		readOnly: z.boolean().default(false),
		feedbackTemplateId: z.string().trim().min(1).max(60).nullable().default(null),
	})
	// Normalized BEFORE the ordering check: an all-day event spans whole UTC+8 days regardless of the
	// times the client happened to send, and a same-day all-day event must stay valid.
	.transform((v) =>
		v.allDay ? { ...v, startsAt: startOfUtc8Day(v.startsAt), endsAt: endOfUtc8Day(v.endsAt) } : v,
	)
	.refine((v) => v.endsAt > v.startsAt, { path: ["endsAt"], message: "End must be after the start." });

export async function createEventAction(input: z.input<typeof createSchema>) {
	const actor = await requireActor();
	const parsed = createSchema.safeParse(input);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return { ok: false as const, error: issue ? `${issue.path.join(".") || "Event"}: ${issue.message}` : "Check the event details." };
	}
	const repositories = await getRepositories();
	const { feedbackTemplateId, ...eventInput } = parsed.data;
	// points stays null on create — only Events-role CRS admins set the value (spec §4).
	// readOnly is passed through and re-checked against event:moderate in the repository, which is
	// the gate that also covers the HTTP routes.
	const event = await repositories.events.create(actor, { ...eventInput, points: null });
	// The event is made either way. A form that can't be attached (no survey:configure, archived template) is not worth
	// failing the event over: the admin event page still offers to start one.
	if (feedbackTemplateId && !eventInput.readOnly) {
		await repositories.surveys.createFromTemplate(actor, { templateId: feedbackTemplateId, eventId: event.id }).catch((error: unknown) => {
			console.error("Could not attach a feedback form to the new event.", { eventId: event.id, error: error instanceof Error ? error.name : "unknown" });
		});
	}
	revalidatePath("/portal/calendar");
	return { ok: true as const, id: event.id };
}
