import { describe, expect, it } from "vitest";
import { STOPWORDS, tokens, topTerms } from "./words";

describe("topTerms", () => {
	it("counts terms per answer and drops Taglish stopwords", () => {
		const terms = topTerms([
			"The venue was too hot, venue aircon broke",
			"Sobrang init sa venue pero ang ganda ng talks",
			"Talks were great!! 🔥",
		]);
		expect(terms.find((t) => t.term === "venue")?.count).toBe(2);
		expect(terms.find((t) => t.term === "talks")?.count).toBe(2);
		for (const stop of ["the", "was", "sa", "ang", "ng", "pero", "were"]) {
			expect(terms.some((t) => t.term === stop)).toBe(false);
		}
	});

	it("respects the limit and orders ties alphabetically", () => {
		expect(topTerms(["alpha beta", "beta gamma"], 2)).toEqual([
			{ term: "beta", count: 2 },
			{ term: "alpha", count: 1 },
		]);
	});
});

describe("tokens", () => {
	it("tokenizes for filtering", () => {
		expect(tokens("Venue, VENUE! 2026 ok")).toEqual(new Set(["venue"]));
	});
});

describe("STOPWORDS", () => {
	it("covers the required English and Filipino words", () => {
		const required = [
			"the", "and", "was", "were", "for", "with", "that", "this", "very", "too",
			"ang", "ng", "sa", "na", "mga", "yung", "po", "lang", "naman", "kasi", "talaga",
			"pero", "ako", "ko", "din", "rin", "nga", "siya", "kami", "tayo",
		];
		for (const w of required) expect(STOPWORDS.has(w)).toBe(true);
	});
});
