import { describe, expect, it } from "vitest";
import { googleCalendarUrl, icsFor, type CalendarExportEvent } from "./calendar-export";

const shareUrl = "https://code.example/events/club-night";
const baseEvent: CalendarExportEvent = {
	title: "Club night",
	place: "CODE Clubhouse",
	description: "Member gathering",
	startsAt: new Date("2026-08-12T01:00:00Z"),
	endsAt: new Date("2026-08-12T03:00:00Z"),
	allDay: true,
	endDate: "2026-08-14",
	startDate: "2026-08-12",
	uid: "club-night-2026",
};

function makeEvent(overrides: Partial<CalendarExportEvent> = {}): CalendarExportEvent {
	return { ...baseEvent, ...overrides };
}

function googleDates(event: CalendarExportEvent): string | null {
	return new URL(googleCalendarUrl(event, shareUrl)).searchParams.get("dates");
}

describe("calendar export", () => {
	it("uses an exclusive end date for a multi-day all-day event", () => {
		const event = makeEvent();
		expect(googleDates(event)).toBe("20260812/20260815");
		expect(icsFor(event, shareUrl)).toContain("DTSTART;VALUE=DATE:20260812\r\nDTEND;VALUE=DATE:20260815");
	});

	it("uses the next day as the exclusive end for a single all-day event", () => {
		const event = makeEvent({ endDate: "2026-08-12" });
		expect(googleDates(event)).toBe("20260812/20260813");
		expect(icsFor(event, shareUrl)).toContain("DTEND;VALUE=DATE:20260813");
	});

	it("rolls an all-day end across a month boundary", () => {
		const event = makeEvent({ startDate: "2026-08-30", endDate: "2026-08-31" });
		expect(googleDates(event)).toBe("20260830/20260901");
		expect(icsFor(event, shareUrl)).toContain("DTEND;VALUE=DATE:20260901");
	});

	it("rolls an all-day end across a year boundary", () => {
		const event = makeEvent({ startDate: "2026-12-30", endDate: "2026-12-31" });
		expect(googleDates(event)).toBe("20261230/20270101");
		expect(icsFor(event, shareUrl)).toContain("DTEND;VALUE=DATE:20270101");
	});

	it("formats timed events as UTC timestamps", () => {
		const event = makeEvent({ allDay: false });
		expect(googleDates(event)).toBe("20260812T010000Z/20260812T030000Z");
		expect(icsFor(event, shareUrl)).toContain("DTSTART:20260812T010000Z\r\nDTEND:20260812T030000Z");
		expect(icsFor(event, shareUrl)).not.toContain("DTSTART;VALUE=DATE:");
	});

	it("defaults a point-in-time event to one hour", () => {
		const event = makeEvent({ allDay: false, endsAt: null });
		expect(googleDates(event)).toBe("20260812T010000Z/20260812T020000Z");
		expect(icsFor(event, shareUrl)).toContain("DTEND:20260812T020000Z");
	});

	it("escapes ICS text values", () => {
		const event = makeEvent({
			title: "Club, night; social",
			description: "First line\nPath C:\\events",
		});
		const ics = icsFor(event, "https://x.test");
		expect(ics).toContain("SUMMARY:Club\\, night\\; social");
		expect(ics).toContain("DESCRIPTION:First line\\nPath C:\\\\events\\n\\nhttps://x.test");
	});

	it("folds ICS lines at 75 UTF-8 octets", () => {
		const ics = icsFor(makeEvent({ description: "é".repeat(50) }), shareUrl);
		expect(ics).toContain("\r\n ");
		for (const line of ics.split("\r\n")) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		}
	});

	it("does not add attendees or expose an at sign in the Google URL", () => {
		const url = googleCalendarUrl(makeEvent(), shareUrl);
		expect(url).not.toContain("add=");
		expect(url).not.toContain("@");
	});
});
