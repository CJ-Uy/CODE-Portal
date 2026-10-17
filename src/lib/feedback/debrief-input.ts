import { type DebriefInput, debriefInputSchema, type EventDebrief } from "@/db/types";
import { formatUtc8DateTime } from "@/lib/date-slots";

// The After Action Review, in the order it is asked.
export const DEBRIEF_FIELDS = [
	{ name: "intended", label: "What did we set out to do?" },
	{ name: "happened", label: "What actually happened?" },
	{ name: "why", label: "Why was there a difference?" },
	{ name: "change", label: "What will we do differently next time?" },
] as const satisfies ReadonlyArray<{ name: keyof Omit<DebriefInput, "eventId">; label: string }>;

export type DebriefFieldView = { name: (typeof DEBRIEF_FIELDS)[number]["name"]; label: string; value: string };
export type DebriefView = { fields: DebriefFieldView[]; lastEdited: string | null };

export const DEBRIEF_INVALID = "Check the debrief and try again. Each answer can be up to 2000 characters.";
export const DEBRIEF_FAILED = "Couldn't save the debrief. Try again.";

/**
 * Reads the debrief form. A textarea posts its line breaks as CRLF, which would count twice against the 2000-character
 * limit the browser itself counted once, so they are folded to LF first. A field the form did not post is left out and
 * keeps its saved value; an empty one is posted as "" and clears it. Throws when the form does not fit.
 */
export function parseDebriefForm(formData: FormData): DebriefInput {
	const text = (name: string) => {
		const value = formData.get(name);
		return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : undefined;
	};
	return debriefInputSchema.parse({
		eventId: formData.get("eventId"),
		intended: text("intended"),
		happened: text("happened"),
		why: text("why"),
		change: text("change"),
	});
}

// Messages the debrief repository writes for the person editing. Any other error is replaced, never shown.
const KNOWN_ERRORS: readonly string[] = ["Not authorized to save this debrief.", "Event not found."];

export function knownDebriefError(error: unknown): string | null {
	return error instanceof Error && KNOWN_ERRORS.includes(error.message) ? error.message : null;
}

export function lastEditedLine(name: string | null, at: Date): string {
	return `Last edited ${name ? `by ${name} ` : ""}on ${formatUtc8DateTime(at)}`;
}

/** What the form renders: the four prompts with their saved text, and who last edited. Plain strings only, so no ids reach the client. */
export function debriefView(debrief: (EventDebrief & { updatedByName: string | null }) | null): DebriefView {
	return {
		fields: DEBRIEF_FIELDS.map(({ name, label }) => ({ name, label, value: debrief?.[name] ?? "" })),
		lastEdited: debrief ? lastEditedLine(debrief.updatedByName, debrief.updatedAt) : null,
	};
}
