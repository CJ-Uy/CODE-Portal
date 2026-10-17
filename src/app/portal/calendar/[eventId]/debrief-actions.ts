"use server";

import { revalidatePath } from "next/cache";
import { getRepositories } from "@/db";
import { DEBRIEF_FAILED, DEBRIEF_INVALID, knownDebriefError, parseDebriefForm } from "@/lib/feedback/debrief-input";
import { errorLabel } from "@/lib/feedback/safe-log";
import { requireActor } from "@/server/auth/actor";
import { assertFeatureEnabled } from "@/server/features";

export type SaveDebriefResult = { saved: true } | { error: string };

// Who may edit is decided by the repository (event owner, staff admin, or survey:configure), not here.
// Errors come back as text so the form keeps what was typed. Nothing logged here carries the debrief text:
// a failed query can quote the values it was writing.
export async function saveDebriefAction(formData: FormData): Promise<SaveDebriefResult> {
	assertFeatureEnabled("surveys");
	const actor = await requireActor();

	let input;
	try {
		input = parseDebriefForm(formData);
	} catch {
		return { error: DEBRIEF_INVALID };
	}

	const repositories = await getRepositories();
	try {
		await repositories.eventDebriefs.save(actor, input);
	} catch (error) {
		const known = knownDebriefError(error);
		if (known) return { error: known };
		console.error("Could not save the event debrief.", { eventId: input.eventId, error: errorLabel(error) });
		return { error: DEBRIEF_FAILED };
	}

	// Both pages show the same debrief: the member event page for organizers, the archive detail for CRS admins.
	revalidatePath(`/portal/calendar/${input.eventId}`);
	revalidatePath(`/portal/admin/data/events/${input.eventId}`);
	return { saved: true };
}
