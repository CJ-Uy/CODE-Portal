import { describe, expect, it } from "vitest";
import { findUnknownTags, knownVariables, mergeValuesFor, missingMergeTags, replaceTags, replaceTagsOneLine, usedMergeTags, type MergeSheet } from "./merge";
import { mergeOverridesSchema, mergeSheetSchema } from "./blocks";

describe("findUnknownTags", () => {
	it("accepts profile fields and well-formed sheet variables, once each", () => {
		expect(findUnknownTags("Hi {{first_name}}, {{ points }} and {{points}} {{batch2}}")).toEqual([]);
	});
	it("accepts spacing inside braces", () => {
		expect(findUnknownTags("{{ full_name }}")).toEqual([]);
	});
	it("reports malformed names", () => {
		expect(findUnknownTags("{{First_Name}} {{FIRST_NAME}} {{first-name}} {{2nd}} {{}}")).toEqual(["First_Name", "FIRST_NAME", "first-name", "2nd", ""]);
	});
});

describe("replaceTags", () => {
	it("accepts aliases and separates absent data from rendering fallbacks", () => {
		const member = { email: "guest@x.com", name: null, fullName: null, nickname: null, batch: null };
		const tags = usedMergeTags("Hi {{firstname}} {{first_name}} {{fullname}} {{batch}}");
		expect(tags).toEqual(["first_name", "full_name", "batch"]);
		expect(findUnknownTags("{{firstname}} {{fullname}}")).toEqual([]);
		expect(missingMergeTags(member, tags)).toEqual(tags);
		const overrides = mergeOverridesSchema.parse({ "GUEST@x.com": { first_name: "Ana\r\nBcc: x" } });
		const values = mergeValuesFor(member, overrides);
		expect(replaceTagsOneLine("Hi {{firstname}}", values)).toBe("Hi Ana Bcc: x");
		expect(missingMergeTags(member, tags, overrides)).toEqual(["full_name", "batch"]);
		expect(mergeOverridesSchema.safeParse({ "guest@x.com": { email: "other@x.com" } }).success).toBe(false);
		expect(mergeOverridesSchema.safeParse({ "guest@x.com": { "Bad Name": "x" } }).success).toBe(false);
		expect(mergeValuesFor({ ...member, fullName: "DELA CRUZ, Juan Miguel" }).first_name).toBe("Juan");
	});
	it("replaces well-formed tags and leaves malformed text alone", () => {
		expect(replaceTags("Hi {{ first_name }} {{nope}} {{No-pe}}", (tag) => tag.toUpperCase())).toBe("Hi FIRST_NAME NOPE {{No-pe}}");
	});
});

describe("mergeValuesFor", () => {
	it("takes the first name from full name, then name, then nickname", () => {
		const base = { email: "a@x.com", name: null, fullName: null, nickname: null, batch: null };
		expect(mergeValuesFor({ ...base, fullName: "Juan Dela Cruz" }).first_name).toBe("Juan");
		expect(mergeValuesFor({ ...base, name: "Maria Clara" }).first_name).toBe("Maria");
		expect(mergeValuesFor({ ...base, nickname: "Jo" }).first_name).toBe("Jo");
		expect(mergeValuesFor(base).first_name).toBe("there");
	});
	it("fills every tag with a string", () => {
		const values = mergeValuesFor({ email: "a@x.com", name: "A B", fullName: null, nickname: null, batch: "2027" });
		expect(values).toEqual({ first_name: "A", full_name: "A B", nickname: "A", batch: "2027", email: "a@x.com" });
	});
});

describe("mergeValuesFor with a sheet", () => {
	const sheet: MergeSheet = {
		name: "batch.xlsx",
		importedAt: "2026-10-23T00:00:00.000Z",
		keyColumn: "Email",
		columns: [{ header: "Batch", variable: "batch" }, { header: "Message", variable: "message" }],
		rows: { "ana@x.com": { batch: "2028", message: "Line one\r\nLine two" }, "ben@x.com": { batch: "", message: "" } },
	};
	const ana = { email: "Ana@x.com", name: "Ana", fullName: null, nickname: null, batch: "2027" };
	const ben = { email: "ben@x.com", name: "Ben", fullName: null, nickname: null, batch: "2026" };
	const cy = { email: "cy@x.com", name: "Cy", fullName: null, nickname: null, batch: null };
	it("layers profile, non-blank sheet cells, then corrections", () => {
		expect(mergeValuesFor(ana, {}, sheet)).toMatchObject({ batch: "2028", message: "Line one\nLine two" });
		expect(mergeValuesFor(ben, {}, sheet)).toMatchObject({ batch: "2026", message: "" });
		expect(mergeValuesFor(cy, {}, sheet).message).toBe("");
		expect(mergeValuesFor(ana, { "ana@x.com": { message: "Fixed" } }, sheet).message).toBe("Fixed");
	});
	it("reports a variable missing when no row or cell fills it", () => {
		expect(missingMergeTags(ana, ["message", "batch"], {}, sheet)).toEqual([]);
		expect(missingMergeTags(ben, ["message", "batch"], {}, sheet)).toEqual(["message"]);
		expect(missingMergeTags(cy, ["message", "batch", "points"], {}, sheet)).toEqual(["message", "batch", "points"]);
		expect(missingMergeTags(cy, ["message"], { "cy@x.com": { message: "Hi" } }, sheet)).toEqual([]);
	});
	it("knows which variables a campaign can fill", () => {
		expect([...knownVariables(sheet, { "a@x.com": { note: "x" } })]).toEqual(["first_name", "full_name", "nickname", "batch", "email", "message", "note"]);
	});
	it("validates a saved sheet", () => {
		expect(mergeSheetSchema.parse(sheet)?.rows["ana@x.com"].batch).toBe("2028");
		expect(mergeSheetSchema.safeParse({ ...sheet, columns: [{ header: "Email", variable: "email" }] }).success).toBe(false);
		expect(mergeSheetSchema.safeParse({ ...sheet, rows: { "not-an-email": { batch: "1" } } }).success).toBe(false);
		expect(mergeSheetSchema.parse(null)).toBeNull();
	});
});

describe("line breaks", () => {
	it("keep LF for message bodies but never reach a subject", () => {
		const values = mergeValuesFor({ email: "a@x.com", name: null, fullName: "A\r\nBcc: x", nickname: "N\nM", batch: "1\r2" });
		for (const value of Object.values(values)) expect(value).not.toMatch(/\r/);
		expect(values.full_name).toBe("A\nBcc: x");
		expect(replaceTagsOneLine("{{full_name}} {{nickname}} {{batch}}", values)).toBe("A Bcc: x N M 1 2");
	});
});
