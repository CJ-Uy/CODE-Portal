import { describe, expect, it } from "vitest";
import { buildPointBreakdown } from "./point-breakdown";

const types = [
	{ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 1 },
	{ id: "pt_frontliner", key: "frontliner", label: "Frontliner", active: true, position: 2 },
	{ id: "pt_project_lead", key: "project_lead", label: "Project Lead", active: true, position: 3 },
	{ id: "pt_retired", key: "retired", label: "Retired", active: false, position: 4 },
];

const records = [
	{ pointTypeId: "pt_retention", points: 8 },
	{ pointTypeId: "pt_retention", points: 2 },
	{ pointTypeId: "pt_frontliner", points: 3 },
	{ pointTypeId: "pt_retired", points: 50 },
];

describe("buildPointBreakdown", () => {
	it("returns one ordered row per active type including zero totals", () => {
		expect(buildPointBreakdown(types, records)).toEqual([
			{ pointTypeId: "pt_retention", label: "Retention", totalPoints: 10, retention: true },
			{ pointTypeId: "pt_frontliner", label: "Frontliner", totalPoints: 3, retention: false },
			{ pointTypeId: "pt_project_lead", label: "Project Lead", totalPoints: 0, retention: false },
		]);
	});

	it("ignores null points", () => {
		expect(buildPointBreakdown(types, [{ pointTypeId: "pt_retention", points: null }])[0]?.totalPoints).toBe(0);
	});

	it("uses the permanent retention id to mark retention progress", () => {
		const rows = buildPointBreakdown([
			{ id: "pt_x", key: "retention", label: "Legacy label", active: true, position: 1 },
			{ id: "pt_retention", key: "anything", label: "Retention", active: true, position: 2 },
		], []);
		expect(rows.find((row) => row.pointTypeId === "pt_x")?.retention).toBe(false);
		expect(rows.find((row) => row.pointTypeId === "pt_retention")?.retention).toBe(true);
	});
});