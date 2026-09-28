import { z } from "zod";

export const pointMilestoneSchema = z.preprocess(
	(value) => {
		if (!value || typeof value !== "object" || !("label" in value) || "title" in value) return value;
		return { ...value, title: value.label, description: "" };
	},
	z.object({
		points: z.number().int().min(1).max(1_000_000),
		title: z.string().trim().min(1).max(120),
		description: z.string().trim().max(240).default(""),
	}),
);

export const pointMilestonesSchema = z
	.array(pointMilestoneSchema)
	.max(20, "Add at most 20 milestones per point type.")
	.superRefine((milestones, context) => {
		const points = milestones.map((milestone) => milestone.points);
		if (new Set(points).size !== points.length) {
			context.addIssue({ code: "custom", message: "Milestone point values must be unique." });
		}
	})
	.transform((milestones) => [...milestones].sort((a, b) => a.points - b.points));

export type PointMilestone = z.output<typeof pointMilestoneSchema>;
