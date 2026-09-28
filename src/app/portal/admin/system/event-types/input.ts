import { z } from "zod";
import type { EventTypeUpsertInput } from "@/db/repositories/eventTypeRules";
import { eventTypeColours } from "@/lib/event-type-colours";
import { eventTypeKeySchema } from "@/lib/event-type-key";

const labelSchema = z.string().trim().min(1).max(60);
const colourSchema = z.enum(eventTypeColours);
const positionSchema = z.coerce.number().int().min(0).max(999);

export function parseEventTypeUpsertInput(formData: FormData): EventTypeUpsertInput {
	const raw = formData.get("requiredPermission");
	if (raw === null) throw new Error("Missing requiredPermission field.");
	if (typeof raw !== "string") throw new Error("Invalid requiredPermission field.");

	return {
		type: eventTypeKeySchema.parse(formData.get("type")),
		label: labelSchema.parse(formData.get("label")),
		colour: colourSchema.parse(formData.get("colour")),
		requiredPermission: raw === "" ? null : raw,
		active: formData.get("active") === "on",
		position: positionSchema.parse(formData.get("position") ?? 0),
	};
}

export function parseEventTypeRows(formData: FormData): EventTypeUpsertInput[] {
	const types = z.array(eventTypeKeySchema).parse(formData.getAll("types"));
	const labels = z.array(z.string()).parse(formData.getAll("labels"));
	const colours = z.array(z.string()).parse(formData.getAll("colours"));
	const requiredPermissions = z.array(z.string()).parse(formData.getAll("requiredPermissions"));
	const activeTypes = new Set(z.array(eventTypeKeySchema).parse(formData.getAll("activeTypes")));

	if (
		new Set(types).size !== types.length ||
		types.length !== labels.length ||
		types.length !== colours.length ||
		types.length !== requiredPermissions.length ||
		[...activeTypes].some((type) => !types.includes(type))
	) {
		throw new Error("Event type form is incomplete.");
	}

	return types.map((type, position) => {
		const row = new FormData();
		row.set("type", type);
		row.set("label", labels[position]);
		row.set("colour", colours[position]);
		row.set("requiredPermission", requiredPermissions[position]);
		row.set("position", String(position));
		if (activeTypes.has(type)) row.set("active", "on");
		return parseEventTypeUpsertInput(row);
	});
}
