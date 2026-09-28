import { asc, eq } from "drizzle-orm";
import { pointTypes } from "@/db/schema";
import { pointMilestonesSchema, type PointMilestone } from "@/lib/point-milestones";
import { RETENTION_POINT_TYPE_ID } from "@/lib/point-types";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

const RETENTION_RETIRE_ERROR = "The Retention point type cannot be retired.";
const POINT_TYPE_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;

// Match the existing eventTypeRules repository until the repository Db union is centralized.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type PointTypeRow = {
	id: string;
	key: string;
	label: string;
	milestones?: PointMilestone[];
	active: boolean;
	position: number;
};

export type PointTypeUpsertInput = {
	id: string | null;
	key: string;
	label: string;
	milestones?: PointMilestone[];
	active: boolean;
	position: number;
};

export type PointTypesRepository = {
	list(): Promise<PointTypeRow[]>;
	upsertType(actor: Actor, input: PointTypeUpsertInput): Promise<PointTypeRow>;
};

export function createPointTypesRepository(db: Db, audit: AuditRepository): PointTypesRepository {
	return {
		async list() {
			const rows = await db
				.select({
					id: pointTypes.id,
					key: pointTypes.key,
					label: pointTypes.label,
					milestones: pointTypes.milestonesJson,
					active: pointTypes.active,
					position: pointTypes.position,
				})
				.from(pointTypes)
				.orderBy(asc(pointTypes.position), asc(pointTypes.label));
			return rows.map((row: PointTypeRow) => ({
				...row,
				milestones: pointMilestonesSchema.parse(row.milestones ?? []),
			}));
		},

		async upsertType(actor, input) {
			if (!can(actor, "retention:configure")) {
				throw new Error("Not authorized to configure point types.");
			}
			if (!POINT_TYPE_KEY_PATTERN.test(input.key)) throw new Error("Invalid point type key.");
			const label = input.label.trim();
			const milestones = input.milestones === undefined ? undefined : pointMilestonesSchema.parse(input.milestones);
			if (!label || label.length > 60) throw new Error("Point type label is required.");
			if (!Number.isInteger(input.position) || input.position < 0 || input.position > 999) {
				throw new Error("Point type position must be a whole number from 0 to 999.");
			}
			if (input.id === null) {
				const id = `pt_${input.key}`;
				const [created] = await db.insert(pointTypes).values({
					id,
					key: input.key,
					label,
					milestonesJson: milestones ?? [],
					active: input.active,
					position: input.position,
					updatedBy: actor.memberId,
					updatedAt: new Date(),
				}).returning();
				await audit.record(actor, {
					action: "point_type:create",
					targetType: "point_type",
					targetId: id,
					category: "retention",
				});
				return { ...created, milestones: pointMilestonesSchema.parse(created.milestonesJson) };
			}

			const [existing] = await db.select().from(pointTypes).where(eq(pointTypes.id, input.id)).limit(1);
			if (!existing) throw new Error("Point type not found.");
			if (existing.key !== input.key) throw new Error("Point type keys cannot be changed.");

			if (input.id === RETENTION_POINT_TYPE_ID && !input.active) {
				throw new Error(RETENTION_RETIRE_ERROR);
			}
			const updated = await db.update(pointTypes).set({
				label,
				...(milestones === undefined ? {} : { milestonesJson: milestones }),
				active: input.active,
				position: input.position,
				updatedBy: actor.memberId,
				updatedAt: new Date(),
			}).where(eq(pointTypes.id, input.id)).returning();
			if (updated.length === 0) throw new Error("Point type not found.");
			await audit.record(actor, {
				action: "point_type:update",
				targetType: "point_type",
				targetId: input.id,
				category: "retention",
			});
			return { ...updated[0], milestones: pointMilestonesSchema.parse(updated[0].milestonesJson) };
		},
	};
}
