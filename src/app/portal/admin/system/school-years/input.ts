import { z } from "zod";
import type { TermUpsertInput } from "@/db/repositories/retention";
import { endOfUtc8Day, fromLocalInput } from "@/lib/date-slots";

const optionalIdSchema = z.union([z.literal(""), z.string().min(1)]);
const nameSchema = z.string().trim().min(1).max(80);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date.");

/** A school year runs from the first moment of its start day to the last of its end day, Manila time. */
export function parseTermUpsertInput(formData: FormData): TermUpsertInput {
	const id = optionalIdSchema.parse(formData.get("id") ?? "");
	const startsOn = dateSchema.parse(formData.get("startsOn"));
	const endsOn = dateSchema.parse(formData.get("endsOn"));
	return {
		id: id === "" ? null : id,
		name: nameSchema.parse(formData.get("name")),
		startsAt: fromLocalInput(`${startsOn}T00:00`),
		endsAt: endOfUtc8Day(fromLocalInput(`${endsOn}T00:00`)),
		// The 2nd semester starts at the first moment of its day, Manila time.
		secondSemesterStartsAt: fromLocalInput(`${dateSchema.parse(formData.get("secondSemesterStartsOn"))}T00:00`),
	};
}
