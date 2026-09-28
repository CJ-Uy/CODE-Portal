import { z } from "zod";
import type { PointTypeUpsertInput } from "@/db/repositories/pointTypes";
import { pointMilestonesSchema, type PointMilestone } from "@/lib/point-milestones";

const optionalIdSchema = z.union([z.literal(""), z.string().regex(/^pt_[a-z0-9_]+$/)]);
const keySchema = z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/);
const labelSchema = z.string().trim().min(1).max(60);
const positionSchema = z.coerce.number().int().min(0).max(999);

const milestoneDraftsSchema = z
	.array(
		z.object({
			points: z.coerce.number().int().min(1).max(1_000_000),
			title: z.string().trim().min(1).max(120),
			description: z.string().trim().max(240).default(""),
		}),
	)
	.max(20, "Add at most 20 milestones per point type.");

export function parseMilestones(value: FormDataEntryValue | null): PointMilestone[] {
	if (typeof value !== "string") throw new Error("Milestones must be valid JSON.");
	try {
		return pointMilestonesSchema.parse(milestoneDraftsSchema.parse(JSON.parse(value)));
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error("Milestones must be valid JSON.");
		throw error;
	}
}

export function parsePointTypeUpsertInput(formData: FormData): PointTypeUpsertInput {
	const id = optionalIdSchema.parse(formData.get("id") ?? "");
	return {
		id: id === "" ? null : id,
		key: keySchema.parse(formData.get("key")),
		label: labelSchema.parse(formData.get("label")),
		milestones: parseMilestones(formData.get("milestones") ?? "[]"),
		active: formData.get("active") === "on",
		position: positionSchema.parse(formData.get("position") ?? 0),
	};
}

export function parsePointTypeRows(formData: FormData): PointTypeUpsertInput[] {
	const ids = z.array(z.string().regex(/^pt_[a-z0-9_]+$/)).parse(formData.getAll("ids"));
	const keys = z.array(keySchema).parse(formData.getAll("keys"));
	const labels = z.array(z.string()).parse(formData.getAll("labels"));
	const milestones = z.array(z.string()).parse(formData.getAll("milestones"));
	const activeIds = new Set(z.array(z.string()).parse(formData.getAll("activeIds")));
	const knownIds = new Set(ids);

	if (
		knownIds.size !== ids.length ||
		new Set(keys).size !== keys.length ||
		ids.length !== keys.length ||
		ids.length !== labels.length ||
		ids.length !== milestones.length ||
		[...activeIds].some((id) => !knownIds.has(id))
	) {
		throw new Error("Point type form is incomplete.");
	}

	return ids.map((id, position) => {
		const row = new FormData();
		row.set("id", id);
		row.set("key", keys[position]);
		row.set("label", labels[position]);
		row.set("milestones", milestones[position]);
		row.set("position", String(position));
		if (activeIds.has(id)) row.set("active", "on");
		return parsePointTypeUpsertInput(row);
	});
}
