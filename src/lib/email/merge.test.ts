import { describe, expect, it } from "vitest";
import { findUnknownTags, mergeValuesFor, missingMergeTags, replaceTags, usedMergeTags } from "./merge";
import { mergeOverridesSchema } from "./blocks";

describe("findUnknownTags", () => {
	it("returns tags outside the allowed list, once each", () => {
		expect(findUnknownTags("Hi {{first_name}}, {{ points }} and {{points}}")).toEqual(["points"]);
	});
	it("accepts spacing inside braces", () => {
		expect(findUnknownTags("{{ full_name }}")).toEqual([]);
	});
	it("reports near-miss tags", () => {
		expect(findUnknownTags("{{First_Name}} {{FIRST_NAME}} {{first-name}} {{batch2}}")).toEqual(["First_Name", "FIRST_NAME", "first-name", "batch2"]);
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
		expect(replaceTags("Hi {{firstname}}", (tag) => values[tag])).toBe("Hi Ana Bcc: x");
		expect(missingMergeTags(member, tags, overrides)).toEqual(["full_name", "batch"]);
		expect(mergeOverridesSchema.safeParse({ "guest@x.com": { email: "other@x.com" } }).success).toBe(false);
		expect(mergeValuesFor({ ...member, fullName: "DELA CRUZ, Juan Miguel" }).first_name).toBe("Juan");
	});
	it("replaces known tags and leaves unknown text alone", () => {
		expect(replaceTags("Hi {{ first_name }} {{nope}}", (tag) => tag.toUpperCase())).toBe("Hi FIRST_NAME {{nope}}");
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

describe("mergeValuesFor line breaks", () => {
	it("collapses CR/LF in every value", () => {
		const values = mergeValuesFor({ email: "a@x.com", name: null, fullName: "A\r\nBcc: x", nickname: "N\nM", batch: "1\r2" });
		for (const value of Object.values(values)) expect(value).not.toMatch(/[\r\n]/);
		expect(values.full_name).toBe("A Bcc: x");
	});
});
