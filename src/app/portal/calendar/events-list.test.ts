import { describe, expect, it, vi } from "vitest";
import { filterEvents, groupEventsByTime, type EventListItem, type EventShow } from "./events-list";
import { loadEventList } from "./load-events";

function event(id: string, start: string, end: string | null = null): EventListItem {
	return {
		id, title: id, type: "crs", place: "CODE Room", startsAt: new Date(start),
		endsAt: end ? new Date(end) : null, allDay: false, readOnly: false,
		myRole: null, canModerate: false, going: false, attended: false,
	};
}

describe("calendar event list", () => {
	it("groups by UTC+8 day and orders past events by their last activity", () => {
		const events = [
			event("upcoming", "2026-09-28T16:00:00Z"),
			event("past-older", "2026-09-25T04:00:00Z"),
			event("today", "2026-09-28T04:00:00Z"),
			event("past-midnight", "2026-09-27T04:00:00Z", "2026-09-27T16:00:00Z"),
			event("spanning-today", "2026-09-26T04:00:00Z", "2026-09-29T04:00:00Z"),
		];
		const groups = groupEventsByTime(events, new Date("2026-09-28T00:00:00Z"));
		expect(groups.current.map((row) => row.id)).toEqual(["spanning-today", "today"]);
		expect(groups.upcoming.map((row) => row.id)).toEqual(["upcoming"]);
		expect(groups.past.map((row) => row.id)).toEqual(["past-midnight", "past-older"]);
	});

	it("continues past the first 100 old events to include future events", async () => {
		const older = Array.from({ length: 100 }, (_, index) => event(`old-${index}`, "2025-09-28T04:00:00Z"));
		const future = event("future", "2027-09-28T04:00:00Z");
		const listPublished = vi.fn(async (_actor: unknown, input: { limit: number; offset: number }) =>
			input.offset === 0 ? older : [future]);
		const repositories = { events: { listPublished }, calendar: { myEventMarks: async () => ({ going: ["future"], attended: [] }) } } as unknown as Parameters<typeof loadEventList>[0];
		const actor = {} as Parameters<typeof loadEventList>[1];
		const rows = await loadEventList(repositories, actor);
		expect(rows).toHaveLength(101);
		expect(rows.at(-1)?.id).toBe("future");
		expect(rows.at(-1)?.going).toBe(true);
		expect(listPublished.mock.calls.map(([, input]) => input.offset)).toEqual([0, 100]);
	});

	it("filters by every query word across title, place and type label, plus type and mine", () => {
		const types = [{ type: "crs", label: "CRS Workshop", colour: "slate", requiredPermission: null, active: true, position: 0 }];
		const rows = [
			{ ...event("a", "2026-09-28T04:00:00Z"), title: "Debrief", place: "Bellarmine 201" },
			{ ...event("b", "2026-09-28T04:00:00Z"), title: "Hackathon", type: "official", myRole: "owner" as const, going: true },
			{ ...event("c", "2026-09-28T04:00:00Z"), title: "Intro to Git", myRole: "admin" as const, attended: true },
		];
		const ids = (q: string, type = "", show: EventShow = "") => filterEvents(rows, { q, type, show }, types).map((row) => row.id);
		expect(ids("")).toEqual(["a", "b", "c"]);
		expect(ids("bel  DEBRIEF")).toEqual(["a"]);
		expect(ids("workshop")).toEqual(["a", "c"]);
		expect(ids("debrief hackathon")).toEqual([]);
		expect(ids("", "official")).toEqual(["b"]);
		expect(ids("", "", "hosting")).toEqual(["b"]);
		expect(ids("", "", "going")).toEqual(["b"]);
		expect(ids("", "", "attended")).toEqual(["c"]);
	});
});
