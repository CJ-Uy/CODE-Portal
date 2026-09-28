import type { PointTypeRow } from "@/db/repositories/pointTypes";
import { RETENTION_POINT_TYPE_ID } from "@/lib/point-types";

type TypedPoints = { pointTypeId: string; points: number | null };

export type ProfilePointRow = {
	pointTypeId: string;
	label: string;
	totalPoints: number;
	retention: boolean;
};

export function buildPointBreakdown(types: PointTypeRow[], records: TypedPoints[]): ProfilePointRow[] {
	const totals = new Map<string, number>();
	for (const record of records) {
		totals.set(record.pointTypeId, (totals.get(record.pointTypeId) ?? 0) + (record.points ?? 0));
	}
	return types
		.filter((type) => type.active)
		.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label))
		.map((type) => ({
			pointTypeId: type.id,
			label: type.label,
			totalPoints: totals.get(type.id) ?? 0,
			retention: type.id === RETENTION_POINT_TYPE_ID,
		}));
}
