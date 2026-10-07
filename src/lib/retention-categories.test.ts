import { describe, expect, it } from "vitest";
import type { MyHistoryRecord } from "@/db/repositories/retention";
import { buildCategoryTimeline, recordCategory } from "./retention-categories";

function record(id: string, overrides: Partial<MyHistoryRecord> = {}): MyHistoryRecord {
	return { id, memberId: "member", termId: "term", pointTypeId: "pt_retention", pointTypeLabel: "Retention", eventId: "event", eventType: "project", eventTypeLabel: "Project Team", eventColour: "rose", eventTitle: "Project night", points: 0.1, reason: "Attended", source: "event_attendance", recordedBy: "admin", recordedAt: new Date("2026-08-12T16:30:00Z"), ...overrides };
}

describe("category progress", () => {
	it("groups Manila recording days, deduplicates attendance, and preserves fractional, null and negative points", () => {
		const rows = [
			record("correction", { eventId: null, eventType: null, points: -2, source: "manual", recordedAt: new Date("2026-08-14T01:00:00Z") }),
			record("first"),
			record("second", { points: 0.2 }),
			record("null", { eventId: "other", points: null }),
		];
		const frames = buildCategoryTimeline(rows);
		expect(frames.map((frame) => frame.date)).toEqual([null, "2026-08-13", "2026-08-14"]);
		expect(frames[1].categories).toEqual([{ key: "project", label: "Project Team", colour: "rose", points: 0.3, activities: 2 }]);
		expect(frames[2].categories).toContainEqual({ key: "source:manual", label: "Manual records", colour: "slate", points: -2, activities: 0 });
		expect(frames[1].categories).toHaveLength(1);
		expect(rows[0].id).toBe("correction");
	});

	it("keeps manual event-linked awards in the event category without counting attendance", () => {
		expect(buildCategoryTimeline([record("award", { source: "manual", points: 5 })]).at(-1)?.categories[0]).toMatchObject({ key: "project", points: 5, activities: 0 });
		expect(recordCategory(record("missing", { eventType: null, eventId: null }))).toMatchObject({ key: "source:other", label: "Other activities" });
		expect(buildCategoryTimeline([])).toEqual([{ date: null, categories: [] }]);
	});
});
