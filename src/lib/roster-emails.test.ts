import { describe, it, expect } from "vitest";
import { parseEmailColumn } from "./roster-emails";

describe("parseEmailColumn", () => {
	it("splits on newlines/commas/semicolons, lowercases, dedupes, and separates invalid", () => {
		const r = parseEmailColumn('A@x.com\nA@X.com, b@y.com; not-an-email\n"Jane" <j@z.com>');
		expect(r.valid.sort()).toEqual(["a@x.com", "b@y.com"]);
		expect(r.invalid).toEqual(["not-an-email", '"jane" <j@z.com>']);
		expect(r.dedupedInput).toBe(1);
	});

	it("handles CRLF, tabs, and trailing/empty delimiters", () => {
		const r = parseEmailColumn("a@x.com\r\n\tb@y.com;;\n");
		expect(r.valid.sort()).toEqual(["a@x.com", "b@y.com"]);
		expect(r.invalid).toEqual([]);
		expect(r.dedupedInput).toBe(0);
	});

	it("returns empty results for blank input", () => {
		expect(parseEmailColumn("   \n\n")).toEqual({ valid: [], invalid: [], dedupedInput: 0 });
	});
});
