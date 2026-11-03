import { describe, expect, it } from "vitest";
import { parseTermUpsertInput } from "./input";

function form(values: Record<string, string>) {
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) data.set(key, value);
	return data;
}

describe("parseTermUpsertInput", () => {
	it("reads the 2nd semester start as the first moment of its Manila day", () => {
		const input = parseTermUpsertInput(form({ id: "", name: "SY 2026-2027", startsOn: "2026-06-08", endsOn: "2027-05-15", secondSemesterStartsOn: "2027-01-11" }));
		expect(input.secondSemesterStartsAt).toEqual(new Date("2027-01-10T16:00:00.000Z"));
		expect(input).not.toHaveProperty("retainedAt");
	});

	it("requires the 2nd semester date", () => {
		expect(() => parseTermUpsertInput(form({ id: "", name: "SY", startsOn: "2026-06-08", endsOn: "2027-05-15" }))).toThrow();
	});
});
