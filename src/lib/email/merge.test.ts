import { describe, expect, it } from "vitest";
import { findUnknownTags, mergeValuesFor, replaceTags } from "./merge";

describe("findUnknownTags", () => {
	it("returns tags outside the allowed list, once each", () => {
		expect(findUnknownTags("Hi {{first_name}}, {{ points }} and {{points}}")).toEqual(["points"]);
	});
	it("accepts spacing inside braces", () => {
		expect(findUnknownTags("{{ full_name }}")).toEqual([]);
	});
});

describe("replaceTags", () => {
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
