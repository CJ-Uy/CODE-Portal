import { describe, expect, it } from "vitest";
import {
	defaultClosesAt,
	effectiveStatus,
	estimateSeconds,
	reminderAtFor,
	scaleSummary,
	suggestInviteCount,
} from "./stats";

describe("suggestInviteCount", () => {
	it.each([
		[0, 0],
		[1, 1],
		[10, 10],
		[30, 30],
		[80, 47],
		[150, 56],
		[300, 63],
	])("eligible %i -> %i", (n, want) => {
		expect(suggestInviteCount(n)).toBe(want);
	});
});

describe("scaleSummary", () => {
	it("summarizes a 1-5 distribution", () => {
		expect(scaleSummary([5, 5, 4, 3, 1, 0, 6, 2.5])).toEqual({
			n: 5,
			counts: [1, 0, 1, 1, 2],
			mean: 3.6,
			topTwoPct: 60,
		});
		expect(scaleSummary([])).toEqual({
			n: 0,
			counts: [0, 0, 0, 0, 0],
			mean: null,
			topTwoPct: null,
		});
	});
});

describe("estimateSeconds", () => {
	it("estimates the standard template at about two minutes", () => {
		type Q = { type: "scale" | "text" | "choice" };
		const qs: Q[] = [
			...Array.from({ length: 5 }, (): Q => ({ type: "scale" })),
			{ type: "text" },
			{ type: "text" },
		];
		expect(estimateSeconds(qs)).toBe(125);
	});
});

describe("defaultClosesAt", () => {
	it("closes 72h after the end, falling back to the start", () => {
		const start = new Date("2026-10-10T09:00:00Z");
		expect(defaultClosesAt(start, new Date("2026-10-10T12:00:00Z")).toISOString()).toBe(
			"2026-10-13T12:00:00.000Z",
		);
		expect(defaultClosesAt(start, null).toISOString()).toBe("2026-10-13T09:00:00.000Z");
	});
});

describe("reminderAtFor", () => {
	it("skips the reminder when the window is too short", () => {
		const sent = new Date("2026-10-10T00:00:00Z");
		expect(reminderAtFor(new Date("2026-10-13T00:00:00Z"), sent)?.toISOString()).toBe(
			"2026-10-12T00:00:00.000Z",
		);
		expect(reminderAtFor(new Date("2026-10-11T00:30:00Z"), sent)).toBeNull();
	});
});

describe("effectiveStatus", () => {
	it("treats a running form past its close as closed", () => {
		const now = new Date("2026-10-13T00:00:00Z");
		expect(
			effectiveStatus({ status: "running", closesAt: new Date("2026-10-12T00:00:00Z") }, now),
		).toBe("closed");
		expect(
			effectiveStatus({ status: "running", closesAt: new Date("2026-10-14T00:00:00Z") }, now),
		).toBe("running");
	});
});
