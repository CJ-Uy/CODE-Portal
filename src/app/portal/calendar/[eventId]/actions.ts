"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRepositories } from "@/db";
import { eventsContract } from "@/db/contract/events";
import { eventTypeKeySchema } from "@/lib/event-type-key";
import { eventSignupAnswersSchema, eventSignupFormInputSchema } from "@/lib/event-signup-form";
import { parseEmailColumn } from "@/lib/roster-emails";
import { requireActor } from "@/server/auth/actor";
import { endOfUtc8Day, startOfUtc8Day } from "@/lib/date-slots";

// Server actions get Next's built-in same-origin/POST protection (same as the
// other mutation actions in this app, e.g. members/list/actions.ts).

function revalidate(eventId: string) {
	revalidatePath(`/portal/calendar/${eventId}`);
	revalidatePath("/portal/calendar");
	revalidatePath("/portal/events");
}

const updateSchema = z
	.object({
		eventId: z.string().min(1),
		title: z.string().trim().min(1).max(160),
		type: eventTypeKeySchema,
		place: z.string().trim().min(1).max(160),
		description: z.string().trim().min(1).max(4000),
		startsAt: z.coerce.date(),
		endsAt: z.coerce.date(),
		capacity: z.number().int().min(1).max(100000).nullable().default(null),
		graceMinutes: z.number().int().min(0).max(240).nullable().default(null),
		rsvpForm: eventSignupFormInputSchema.default([]),
		rsvpResponsesPublic: z.boolean().default(false),
		allDay: z.boolean().default(false),
		readOnly: z.boolean().default(false),
	})
	// Normalized before the ordering check so a same-day all-day event stays valid.
	.transform((v) =>
		v.allDay ? { ...v, startsAt: startOfUtc8Day(v.startsAt), endsAt: endOfUtc8Day(v.endsAt) } : v,
	)
	.refine((v) => v.endsAt > v.startsAt, { path: ["endsAt"], message: "End must be after the start." });

/**
 * Toggling an existing event to informational and back. Separate from updateEventAction so a
 * mis-set event can be repaired without resubmitting the whole form.
 *
 * Authorization is NOT decided here: events.update checks the readOnly field against event:moderate
 * independently of ownership, which is also what protects the HTTP routes.
 */
export async function setEventReadOnlyAction(input: { eventId: string; readOnly: boolean }) {
	const actor = await requireActor();
	const parsed = z.object({ eventId: z.string().min(1), readOnly: z.boolean() }).parse(input);
	const repositories = await getRepositories();
	await repositories.events.update(actor, parsed.eventId, { readOnly: parsed.readOnly });
	revalidate(parsed.eventId);
}

export async function updateEventAction(input: z.input<typeof updateSchema>) {
	const actor = await requireActor();
	const { eventId, ...patch } = updateSchema.parse(input);
	const repositories = await getRepositories();
	await repositories.events.update(actor, eventId, patch);
	revalidate(eventId);
}

export async function deleteEventAction(eventId: string) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.events.softDelete(actor, eventId);
	revalidatePath("/portal/calendar");
}

export async function searchMembersAction(eventId: string, query: string) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	return repositories.events.searchAttendableMembers(actor, { eventId, query });
}

export async function markPresentAction(eventId: string, memberId: string) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	// Points attach to a term; resolve the active one server-side so the client can't set it.
	const terms = await repositories.retention.listTerms(actor).catch(() => []);
	const currentTerm = terms.find((t) => t.isCurrent);
	if (!currentTerm) throw new Error("No active school year to record attendance against.");
	const result = await repositories.events.recordScan(actor, { eventId, memberId, termId: currentTerm.id });
	revalidate(eventId);
	return result;
}

export type BulkCheckinResult = {
	/** Newly checked in by this submission. */
	checkedIn: string[];
	/** Matched a member who was already present, so nothing changed. */
	alreadyPresent: string[];
	/** Valid emails with no matching member. */
	notFound: string[];
	/** Tokens that were not valid emails at all. */
	invalid: string[];
	/** Matched a member but the check-in itself failed. */
	failed: { email: string; reason: string }[];
	dedupedInput: number;
};

/**
 * Bulk counterpart to markPresentAction: paste a column of emails, check them all in.
 * Each row still goes through recordScan, so the window rules, point award, dedupe and
 * audit log are identical to a scan - only the member lookup is different.
 */
export async function markPresentBulkAction(eventId: string, raw: string): Promise<BulkCheckinResult> {
	const actor = await requireActor();
	const text = z.string().max(64 * 1024, "Too much text pasted - split into smaller batches.").parse(raw);
	const { valid, invalid, dedupedInput } = parseEmailColumn(text);
	if (valid.length > 500) {
		throw new Error("Too many emails (max 500 per submission). Split into smaller batches.");
	}

	const repositories = await getRepositories();
	const terms = await repositories.retention.listTerms(actor).catch(() => []);
	const currentTerm = terms.find((t) => t.isCurrent);
	if (!currentTerm) throw new Error("No active school year to record attendance against.");

	const matched = await repositories.events.resolveAttendableEmails(actor, { eventId, emails: valid });
	const byEmail = new Map(matched.map((member) => [member.email.toLowerCase(), member]));

	const result: BulkCheckinResult = {
		checkedIn: [],
		alreadyPresent: [],
		notFound: [],
		invalid,
		failed: [],
		dedupedInput,
	};

	// ponytail: sequential, not Promise.all. 500 concurrent writes against one D1 binding
	// buys nothing and the awards upsert would contend. Raise it only if a real roster drags.
	for (const email of valid) {
		const member = byEmail.get(email);
		if (!member) {
			result.notFound.push(email);
			continue;
		}
		try {
			const scan = await repositories.events.recordScan(actor, {
				eventId,
				memberId: member.memberId,
				termId: currentTerm.id,
			});
			if (scan.alreadyPresent) result.alreadyPresent.push(email);
			else result.checkedIn.push(email);
		} catch (error) {
			result.failed.push({ email, reason: error instanceof Error ? error.message : "Could not check in." });
		}
	}

	revalidate(eventId);
	return result;
}

/**
 * Remove a check-in recorded by mistake. undoScan also deletes the matching
 * event_attendance retention record, so the points awarded by the scan come back off -
 * a removal that left the points behind would be worse than no removal at all.
 */
export async function undoPresentAction(eventId: string, memberId: string) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const result = await repositories.events.undoScan(actor, { eventId, memberId });
	revalidate(eventId);
	return result;
}

export async function rsvpAction(eventId: string, state: "going" | "none", answers: unknown) {
	const actor = await requireActor();
	const input = eventsContract.rsvp.input.parse({
		eventId,
		state,
		answers: eventSignupAnswersSchema.parse(answers),
	});
	const repositories = await getRepositories();
	const result = await repositories.events.setRsvp(actor, input);
	revalidate(input.eventId);
	return result;
}

const staffRole = z.enum(["admin", "scanner"]);

export async function addStaffAction(eventId: string, memberId: string, role: z.infer<typeof staffRole>) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.events.addStaff(actor, eventId, memberId, staffRole.parse(role));
	revalidate(eventId);
}

export async function removeStaffAction(eventId: string, memberId: string) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.events.removeStaff(actor, eventId, memberId);
	revalidate(eventId);
}

export async function transferOwnershipAction(eventId: string, toMemberId: string) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	await repositories.events.transferOwnership(actor, eventId, toMemberId);
	revalidate(eventId);
}

export async function inviteAction(eventId: string, memberIds: string[]) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const result = await repositories.events.invite(actor, eventId, memberIds);
	revalidate(eventId);
	return result;
}

export async function setAwardsAction(eventId: string, awards: unknown) {
	const actor = await requireActor();
	const input = eventsContract.setAwards.input.parse({ eventId, awards });
	const repositories = await getRepositories();
	const result = await repositories.events.setAwards(actor, input.eventId, input.awards);
	revalidate(input.eventId);
	return result;
}

export async function removeRetiredAwardAction(eventId: string, pointTypeId: string) {
	const actor = await requireActor();
	const repositories = await getRepositories();
	const result = await repositories.events.removeRetiredAward(actor, eventId, pointTypeId);
	revalidate(eventId);
	return result;
}
