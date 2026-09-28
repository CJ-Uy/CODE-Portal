import { describe, expect, it } from "vitest";
import { parseEventTypeRows, parseEventTypeUpsertInput } from "./input";

function formDataFor(fields: Record<string, string | undefined>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
	return data;
}

describe("parseEventTypeUpsertInput", () => {
	const base = { type: "workshop", label: "Workshop", colour: "amber", position: "3", active: "on" };

	it("parses a full row", () => {
		expect(parseEventTypeUpsertInput(formDataFor({ ...base, requiredPermission: "" }))).toEqual({
			type: "workshop", label: "Workshop", colour: "amber",
			requiredPermission: null, active: true, position: 3,
		});
	});

	it("treats an absent active checkbox as inactive", () => {
		const parsed = parseEventTypeUpsertInput(formDataFor({ ...base, active: undefined, requiredPermission: "" }));
		expect(parsed.active).toBe(false);
	});

	it("throws when requiredPermission is absent entirely", () => {
		// A selected-but-disabled <option> is dropped from FormData, so presence cannot be assumed.
		// Coercing an absent field to null would silently open the type to every member.
		expect(() => parseEventTypeUpsertInput(formDataFor(base))).toThrow("Missing requiredPermission");
	});

	it("passes an unrecognized permission through for the repository to reject", () => {
		const parsed = parseEventTypeUpsertInput(formDataFor({ ...base, requiredPermission: "weird:unknown" }));
		expect(parsed.requiredPermission).toBe("weird:unknown");
	});

	it("rejects a malformed key and a blank label", () => {
		expect(() => parseEventTypeUpsertInput(formDataFor({ ...base, type: "Not A Key!", requiredPermission: "" }))).toThrow();
		expect(() => parseEventTypeUpsertInput(formDataFor({ ...base, label: "  ", requiredPermission: "" }))).toThrow();
	});

	it("uses row order as position when saving the list", () => {
		const data = new FormData();
		for (const value of ["workshop", "lecture"]) data.append("types", value);
		for (const value of ["Workshop", "Lecture"]) data.append("labels", value);
		for (const value of ["amber", "primary"]) data.append("colours", value);
		for (const value of ["", "event:create"]) data.append("requiredPermissions", value);
		data.append("activeTypes", "lecture");

		expect(parseEventTypeRows(data)).toEqual([
			{
				type: "workshop",
				label: "Workshop",
				colour: "amber",
				requiredPermission: null,
				active: false,
				position: 0,
			},
			{
				type: "lecture",
				label: "Lecture",
				colour: "primary",
				requiredPermission: "event:create",
				active: true,
				position: 1,
			},
		]);
	});

	it("rejects incomplete list rows", () => {
		const data = new FormData();
		data.append("types", "workshop");
		data.append("labels", "Workshop");
		data.append("colours", "amber");
		expect(() => parseEventTypeRows(data)).toThrow("incomplete");
	});
});
