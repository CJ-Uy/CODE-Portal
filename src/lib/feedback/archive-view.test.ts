import { describe, expect, it } from "vitest";
import type { EventFeedbackRow } from "@/db/types";
import { archiveHref, archiveRows, archiveTypes, feedbackCells, planningLink } from "./archive-view";

const row = (eventId: string, type: string, startsAt: string, title = eventId) => ({
	eventId,
	title,
	type,
	status: "scheduled",
	place: "Leong Hall",
	startsAt: new Date(startsAt),
});

const rows = [
	row("a", "workshop", "2026-08-01T00:00:00Z", "Intro to Git"),
	row("c", "social", "2026-09-10T00:00:00Z", "Welcome mixer"),
	row("b", "workshop", "2026-09-01T00:00:00Z", "Study jam"),
];

describe("archiveHref", () => {
	it("returns the bare path with nothing set and keeps only the filters that are", () => {
		expect(archiveHref()).toBe("/portal/admin/data/events");
		expect(archiveHref({ termId: "", q: undefined })).toBe("/portal/admin/data/events");
		expect(archiveHref({ type: "workshop" })).toBe("/portal/admin/data/events?type=workshop");
		expect(archiveHref({ type: "social", termId: "term_1", q: "mixer" })).toBe("/portal/admin/data/events?termId=term_1&q=mixer&type=social");
	});

	it("encodes values", () => {
		expect(archiveHref({ type: "a&b c" })).toBe("/portal/admin/data/events?type=a%26b+c");
	});
});

describe("archiveTypes", () => {
	it("lists each type once, sorted", () => {
		expect(archiveTypes(rows)).toEqual(["social", "workshop"]);
	});

	it("keeps a selected type that this term has no events for", () => {
		expect(archiveTypes(rows, "talk")).toEqual(["social", "talk", "workshop"]);
		expect(archiveTypes(rows, "social")).toEqual(["social", "workshop"]);
	});
});

describe("archiveRows", () => {
	it("sorts newest first", () => {
		expect(archiveRows(rows, {}).map((r) => r.eventId)).toEqual(["c", "b", "a"]);
	});

	it("breaks a tie on start time by event id, descending", () => {
		const tied = [row("x", "social", "2026-09-01T00:00:00Z"), row("y", "social", "2026-09-01T00:00:00Z")];
		expect(archiveRows(tied, {}).map((r) => r.eventId)).toEqual(["y", "x"]);
	});

	it("filters by exact type", () => {
		expect(archiveRows(rows, { type: "workshop" }).map((r) => r.eventId)).toEqual(["b", "a"]);
		expect(archiveRows(rows, { type: "talk" })).toEqual([]);
	});

	it("searches title, type, status and place case-insensitively", () => {
		expect(archiveRows(rows, { q: "MIXER" }).map((r) => r.eventId)).toEqual(["c"]);
		expect(archiveRows(rows, { q: "leong" })).toHaveLength(3);
		expect(archiveRows(rows, { q: "scheduled" })).toHaveLength(3);
	});

	it("combines search and type, and does not reorder the input", () => {
		const input = [...rows];
		expect(archiveRows(input, { q: "study", type: "workshop" }).map((r) => r.eventId)).toEqual(["b"]);
		expect(archiveRows(input, { q: "study", type: "social" })).toEqual([]);
		expect(input.map((r) => r.eventId)).toEqual(["a", "c", "b"]);
	});
});

describe("feedbackCells", () => {
	const entry = (overrides: Partial<EventFeedbackRow>): EventFeedbackRow => ({
		surveyId: "srv_1",
		overall: { n: 6, counts: [0, 1, 1, 2, 2], mean: 3.8, topTwoPct: 67 },
		responses: 6,
		invitedRate: 0.5,
		hasDebrief: true,
		...overrides,
	});

	it("shows every value for an event with a form and a debrief", () => {
		expect(feedbackCells(entry({}))).toEqual({ topTwo: "67%", responses: "6", rate: "50%", debrief: true });
	});

	it("shows dashes for an event with neither a form nor a debrief", () => {
		expect(feedbackCells(undefined)).toEqual({ topTwo: "—", responses: "—", rate: "—", debrief: false });
	});

	it("shows a debrief-only event as a check with dashes for the rest", () => {
		const cells = feedbackCells(entry({ surveyId: null, overall: null, responses: 0, invitedRate: null }));
		expect(cells).toEqual({ topTwo: "—", responses: "—", rate: "—", debrief: true });
	});

	it("keeps the response count but dashes the score below the anonymity floor", () => {
		const cells = feedbackCells(entry({ overall: null, responses: 2, invitedRate: 0.25, hasDebrief: false }));
		expect(cells).toEqual({ topTwo: "—", responses: "2", rate: "25%", debrief: false });
	});

	it("keeps a real 0% score and rounds the response rate", () => {
		const cells = feedbackCells(entry({ overall: { n: 3, counts: [3, 0, 0, 0, 0], mean: 1, topTwoPct: 0 }, invitedRate: 2 / 3 }));
		expect(cells.topTwo).toBe("0%");
		expect(cells.rate).toBe("67%");
	});

	it("dashes a score the summary could not compute", () => {
		expect(feedbackCells(entry({ overall: { n: 0, counts: [0, 0, 0, 0, 0], mean: null, topTwoPct: null } })).topTwo).toBe("—");
	});
});

describe("planningLink", () => {
	it("points at the archive filtered by the type key and names the type by its label", () => {
		expect(planningLink("workshop", "Workshop")).toEqual({
			href: "/portal/admin/data/events?type=workshop",
			text: "See feedback from past Workshop events",
		});
	});
});
