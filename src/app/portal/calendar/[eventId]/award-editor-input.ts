import type { EventAwardInput } from "@/db/types";
import type { EventPointAwardRow } from "@/db/repositories/events";
import type { PointTypeRow } from "@/db/repositories/pointTypes";
import { formatPoints, quantizePoints } from "@/lib/points";

export type AwardEditorRow = {
	pointTypeId: string;
	label: string;
	value: string;
	retired: boolean;
};

export function buildAwardEditorRows(
	types: PointTypeRow[],
	awards: EventPointAwardRow[],
): AwardEditorRow[] {
	const byType = new Map(awards.map((award) => [award.pointTypeId, award]));
	const active = types
		.filter((type) => type.active)
		.map((type) => ({
			pointTypeId: type.id,
			label: type.label,
			value: byType.get(type.id)?.points.toString() ?? "",
			retired: false,
		}));
	const retired = awards
		.filter((award) => !award.pointTypeActive)
		.sort((a, b) => a.pointTypePosition - b.pointTypePosition || a.pointTypeLabel.localeCompare(b.pointTypeLabel))
		.map((award) => ({
			pointTypeId: award.pointTypeId,
			label: award.pointTypeLabel,
			value: award.points.toString(),
			retired: true,
		}));
	return [...active, ...retired];
}

export function parseActiveAwardValues(
	rows: AwardEditorRow[],
	values: Record<string, string>,
): EventAwardInput[] {
	return rows.flatMap((row) => {
		if (row.retired) return [];
		const raw = values[row.pointTypeId]?.trim() ?? "";
		if (raw === "") return [];
		const points = quantizePoints(Number(raw));
		if (!Number.isFinite(points) || points < -100 || points > 100) {
			throw new Error(`${row.label} must be a number from -100 to 100, with at most 2 decimals.`);
		}
		return [{ pointTypeId: row.pointTypeId, points }];
	});
}

export function formatAwardSummary(awards: EventPointAwardRow[]): string {
	const text = awards
		.filter((award) => award.pointTypeActive)
		.map((award) => `${formatPoints(award.points)} ${award.pointTypeLabel}`)
		.join(" · ");
	return `Worth: ${text || "No points"}`;
}
