export type SummaryEvent = { id: string };
export type SummaryAttendance = { eventId: string };
export type SummaryRecord = { eventId: string | null; points: number | null; source: "event_attendance" | "manual" };

export function summarizeEvents<T extends SummaryEvent>(
	events: T[],
	attendance: SummaryAttendance[],
	records: SummaryRecord[],
) {
	const attendanceCounts = new Map<string, number>();
	const pointTotals = new Map<string, number>();
	const manualCounts = new Map<string, number>();

	for (const row of attendance) attendanceCounts.set(row.eventId, (attendanceCounts.get(row.eventId) ?? 0) + 1);
	for (const row of records) {
		if (!row.eventId) continue;
		pointTotals.set(row.eventId, (pointTotals.get(row.eventId) ?? 0) + (row.points ?? 0));
		if (row.source === "manual") manualCounts.set(row.eventId, (manualCounts.get(row.eventId) ?? 0) + 1);
	}

	return events.map((event) => ({
		...event,
		attendanceCount: attendanceCounts.get(event.id) ?? 0,
		pointsIssued: pointTotals.get(event.id) ?? 0,
		manualCount: manualCounts.get(event.id) ?? 0,
	}));
}

export function summarizeDashboard(
	events: SummaryEvent[],
	attendance: SummaryAttendance[],
	records: SummaryRecord[],
) {
	return {
		eventCount: events.length,
		attendanceCount: attendance.length,
		pointsIssued: records.reduce((total, row) => total + (row.points ?? 0), 0),
		manualCount: records.filter((row) => row.source === "manual").length,
	};
}
