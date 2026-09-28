import { describe, expect, it } from "vitest";
import {
	buildAwardEditorRows,
	formatAwardSummary,
	parseActiveAwardValues,
} from "./award-editor-input";

const types = [
	{ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 1 },
	{ id: "pt_frontliner", key: "frontliner", label: "Frontliner", active: false, position: 2 },
	{ id: "pt_project_lead", key: "project_lead", label: "Project Lead", active: true, position: 3 },
];

const awards = [
	{ pointTypeId: "pt_retention", points: 2, pointTypeLabel: "Retention", pointTypeActive: true, pointTypePosition: 1 },
	{ pointTypeId: "pt_frontliner", points: 3, pointTypeLabel: "Frontliner", pointTypeActive: false, pointTypePosition: 2 },
];

describe("event award editor helpers", () => {
	it("renders every active type and only awarded retired types", () => {
		expect(buildAwardEditorRows(types, awards)).toEqual([
			{ pointTypeId: "pt_retention", label: "Retention", value: "2", retired: false },
			{ pointTypeId: "pt_project_lead", label: "Project Lead", value: "", retired: false },
			{ pointTypeId: "pt_frontliner", label: "Frontliner", value: "3", retired: true },
		]);
	});

	it("parses only nonblank active rows", () => {
		const rows = buildAwardEditorRows(types, awards);
		expect(parseActiveAwardValues(rows, {
			pt_retention: "4",
			pt_project_lead: "",
			pt_frontliner: "99",
		})).toEqual([{ pointTypeId: "pt_retention", points: 4 }]);
	});

	it("accepts a fractional award", () => {
		const rows = buildAwardEditorRows(types, awards);
		expect(parseActiveAwardValues(rows, { pt_retention: "0.75" })).toEqual([
			{ pointTypeId: "pt_retention", points: 0.75 },
		]);
	});

	it("quantizes a third decimal instead of rejecting it", () => {
		const rows = buildAwardEditorRows(types, awards);
		expect(parseActiveAwardValues(rows, { pt_retention: "0.756" })).toEqual([
			{ pointTypeId: "pt_retention", points: 0.76 },
		]);
	});

	it("still rejects out-of-range values", () => {
		const rows = buildAwardEditorRows(types, awards);
		expect(() => parseActiveAwardValues(rows, { pt_retention: "101" })).toThrow("Retention");
		expect(() => parseActiveAwardValues(rows, { pt_retention: "-101" })).toThrow("Retention");
		expect(() => parseActiveAwardValues(rows, { pt_retention: "abc" })).toThrow("Retention");
	});

	it("formats only currently active awards", () => {
		expect(formatAwardSummary(awards)).toBe("Worth: 2 Retention");
		expect(formatAwardSummary([])).toBe("Worth: No points");
	});
});
