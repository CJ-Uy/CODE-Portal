import { describe, expect, it } from "vitest";
import { parsePointTypeRows, parsePointTypeUpsertInput } from "./input";

function formDataFor(fields: Record<string, string | undefined>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined) data.set(key, value);
	}
	return data;
}

describe("parsePointTypeUpsertInput", () => {
	const base = {
		id: "pt_frontliner",
		key: "frontliner",
		label: "Frontliner",
		position: "2",
		active: "on",
		milestones: JSON.stringify([
			{ points: "20", title: "Eligible for S7 next year", description: "Next-year eligibility" },
			{ points: "10", title: "Qualified for automatic renewal", description: "Renew without review" },
		]),
	};

	it("parses an existing point type", () => {
		expect(parsePointTypeUpsertInput(formDataFor(base))).toEqual({
			id: "pt_frontliner",
			key: "frontliner",
			label: "Frontliner",
			position: 2,
			active: true,
			milestones: [
				{ points: 10, title: "Qualified for automatic renewal", description: "Renew without review" },
				{ points: 20, title: "Eligible for S7 next year", description: "Next-year eligibility" },
			],
		});
	});

	it("treats an absent active checkbox as false", () => {
		expect(parsePointTypeUpsertInput(formDataFor({ ...base, active: undefined }))).toMatchObject({ active: false });
	});

	it("accepts a new immutable key and rejects malformed keys", () => {
		expect(parsePointTypeUpsertInput(formDataFor({ ...base, id: "", key: "project_lead" })).id).toBeNull();
		expect(() => parsePointTypeUpsertInput(formDataFor({ ...base, id: "", key: "Project Lead" }))).toThrow();
	});

	it("rejects blank labels and non-integer positions", () => {
		expect(() => parsePointTypeUpsertInput(formDataFor({ ...base, label: " " }))).toThrow();
		expect(() => parsePointTypeUpsertInput(formDataFor({ ...base, position: "1.5" }))).toThrow();
	});

	it("uses row order as position when saving the list", () => {
		const data = new FormData();
		for (const value of ["pt_retention", "pt_frontliner"]) data.append("ids", value);
		for (const value of ["retention", "frontliner"]) data.append("keys", value);
		for (const value of ["Retention", "Frontliner"]) data.append("labels", value);
		for (const value of [
			JSON.stringify([{ points: "10", title: "Renewed", description: "" }]),
			JSON.stringify([{ points: "20", title: "S7", description: "Next year" }]),
		]) {
			data.append("milestones", value);
		}
		for (const value of ["pt_retention", "pt_frontliner"]) data.append("activeIds", value);

		expect(parsePointTypeRows(data)).toEqual([
			{
				id: "pt_retention",
				key: "retention",
				label: "Retention",
				active: true,
				position: 0,
				milestones: [{ points: 10, title: "Renewed", description: "" }],
			},
			{
				id: "pt_frontliner",
				key: "frontliner",
				label: "Frontliner",
				active: true,
				position: 1,
				milestones: [{ points: 20, title: "S7", description: "Next year" }],
			},
		]);
	});

	it("rejects malformed and duplicate milestones", () => {
		expect(() => parsePointTypeUpsertInput(formDataFor({ ...base, milestones: "not-json" }))).toThrow(
			"valid JSON",
		);
		expect(() =>
			parsePointTypeUpsertInput(
				formDataFor({
					...base,
					milestones: JSON.stringify([
						{ points: 10, title: "Renewal", description: "" },
						{ points: 10, title: "S7", description: "" },
					]),
				}),
			),
		).toThrow("unique");
	});
});
