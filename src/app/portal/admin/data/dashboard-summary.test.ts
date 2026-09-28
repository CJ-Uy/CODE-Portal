import { describe, expect, it } from "vitest";
import { summarizeDashboard, summarizeEvents } from "./dashboard-summary";

describe("events and points dashboard summaries", () => {
	it("keeps attendance separate from point and manual records", () => {
		const events = [{ id: "e1" }, { id: "e2" }];
		const attendance = [{ eventId: "e1" }, { eventId: "e1" }];
		const records = [
			{ eventId: "e1", points: 5, source: "event_attendance" as const },
			{ eventId: "e1", points: 2, source: "manual" as const },
			{ eventId: null, points: -1, source: "manual" as const },
		];

		expect(summarizeEvents(events, attendance, records)).toEqual([
			{ id: "e1", attendanceCount: 2, pointsIssued: 7, manualCount: 1 },
			{ id: "e2", attendanceCount: 0, pointsIssued: 0, manualCount: 0 },
		]);
		expect(summarizeDashboard(events, attendance, records)).toEqual({
			eventCount: 2,
			attendanceCount: 2,
			pointsIssued: 6,
			manualCount: 2,
		});
	});
});
