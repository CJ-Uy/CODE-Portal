import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("./actions", () => ({
	addStaffAction: vi.fn(),
	deleteEventAction: vi.fn(),
	inviteAction: vi.fn(),
	markPresentAction: vi.fn(),
	markPresentBulkAction: vi.fn(),
	removeStaffAction: vi.fn(),
	searchMembersAction: vi.fn(),
	setEventReadOnlyAction: vi.fn(),
	transferOwnershipAction: vi.fn(),
	undoPresentAction: vi.fn(),
	updateEventAction: vi.fn(),
}));

import { EventManagePanel, isOptimisticallyRemoved, type ManageEvent } from "./event-manage-panel";

function renderPanel(event: ManageEvent): string {
	return renderToStaticMarkup(
		createElement(EventManagePanel, {
			event,
			staff: [],
			attendance: [],
			invites: [],
			signups: [],
			termId: "term-current",
			allowedEventTypes: [],
			typeRows: [],
			typesUnavailable: false,
			awardRows: [],
			awardsUnavailable: false,
		}),
	);
}

describe("EventManagePanel check-in access", () => {
	it("keeps ordinary check-in available to scanners without showing the admin-only bulk form", () => {
		const now = Date.now();
		const markup = renderPanel({
			id: "event-1",
			title: "Workshop",
			type: "workshop",
			place: "Room 1",
			description: "",
			startsAt: new Date(now - 60_000),
			endsAt: new Date(now + 60_000),
			capacity: null,
			graceMinutes: null,
			rsvpForm: [],
			rsvpResponsesPublic: false,
			allDay: false,
			readOnly: false,
			myRole: "scanner",
			canModerate: false,
			canSetPoints: false,
			attendingCount: 0,
		});

		expect(markup).toContain("Scan attendance");
		expect(markup).not.toContain("bulk-checkin-emails");
	});

	it("stops hiding a removed member when a refreshed row represents a later check-in", () => {
		const removedAt = new Date("2026-08-25T10:00:00.000Z");
		const removedScans = new Map([["member-1", removedAt.getTime()]]);
		const removedRow = {
			memberId: "member-1",
			fullName: "Member One",
			name: "Member",
			scannedAt: removedAt,
		};
		const laterCheckin = { ...removedRow, scannedAt: new Date("2026-08-25T10:05:00.000Z") };

		expect(isOptimisticallyRemoved(removedScans, removedRow)).toBe(true);
		expect(isOptimisticallyRemoved(removedScans, laterCheckin)).toBe(false);
	});
});
