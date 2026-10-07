import type { MyHistoryRecord } from "@/db/repositories/retention";
import { toLocalDate } from "@/lib/date-slots";
import { quantizePoints } from "@/lib/points";

export type RetentionCategory = { key: string; label: string; colour: string; points: number; activities: number };
export type CategoryFrame = { date: string | null; categories: RetentionCategory[] };

export function recordCategory(record: MyHistoryRecord): Pick<RetentionCategory, "key" | "label" | "colour"> {
	if (record.eventType) return { key: record.eventType, label: record.eventTypeLabel || record.eventType, colour: record.eventColour || "slate" };
	return record.source === "manual"
		? { key: "source:manual", label: "Manual records", colour: "slate" }
		: { key: "source:other", label: "Other activities", colour: "primary" };
}

/** Snapshot after each Manila recording day; attendance counts each event once. */
export function buildCategoryTimeline(records: MyHistoryRecord[]): CategoryFrame[] {
	const sorted = [...records].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
	const groups = new Map<string, RetentionCategory>();
	const attended = new Set<string>();
	const frames: CategoryFrame[] = [{ date: null, categories: [] }];
	for (const [index, record] of sorted.entries()) {
		const category = recordCategory(record);
		const group = groups.get(category.key) ?? { ...category, points: 0, activities: 0 };
		group.points = quantizePoints(group.points + (record.points ?? 0));
		if (record.source === "event_attendance" && record.eventId && !attended.has(record.eventId)) {
			group.activities++;
			attended.add(record.eventId);
		}
		groups.set(category.key, group);
		const date = toLocalDate(record.recordedAt);
		if (!sorted[index + 1] || toLocalDate(sorted[index + 1].recordedAt) !== date) {
			frames.push({ date, categories: Array.from(groups.values(), (group) => ({ ...group })) });
		}
	}
	return frames;
}
