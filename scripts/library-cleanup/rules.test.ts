import { describe, expect, it } from "vitest";
import { cleanAuthor, cleanTitle, cleanTopics, fallbackTitle, isPlaceholderTitle, titleFor, undoLineJoin } from "./rules";

describe("cleanTitle", () => {
	it("joins a title wrapped over lines, and keeps a real semicolon", () => {
		expect(cleanTitle("Notes on a\nsample\n  title")).toBe("Notes on a sample title");
		expect(cleanTitle("Leadership; a primer")).toBe("Leadership; a primer");
	});

	it("undoes the old '; ' line join only when asked", () => {
		expect(undoLineJoin("The workshop design; sprint:; warm-up (day 1)")).toBe("The workshop design sprint: warm-up (day 1)");
		expect(undoLineJoin("Icebreakers,; and Exercises")).toBe("Icebreakers, and Exercises");
	});

	it("fixes known misspellings as whole words only", () => {
		expect(cleanTitle("Vision and Advocay Alignment")).toBe("Vision and Advocacy Alignment");
		expect(cleanTitle("Advocays")).toBe("Advocays");
		expect(cleanTitle("Advocay's Porass' model")).toBe("Advocacy's Porras' model");
	});

	it("writes every redaction marker the same way", () => {
		expect(cleanTitle("Plans for {Redacted}")).toBe("Plans for [Redacted]");
		expect(cleanTitle("The [REDACTED] of it")).toBe("The [Redacted] of it");
	});
});

describe("cleanTopics", () => {
	it("drops a dangling comma and fixes misspellings", () => {
		expect(cleanTopics("Empathy, Collabroation, Teamwork,")).toBe("Empathy, Collaboration, Teamwork");
		expect(cleanTopics("Goal Setting,  ,Planning")).toBe("Goal Setting, Planning");
	});

	it("turns line breaks into commas", () => {
		expect(cleanTopics("Motivation\nEmpathy")).toBe("Motivation, Empathy");
	});
});

describe("cleanAuthor", () => {
	it("returns null for a placeholder, so nothing shows instead of 'unknown'", () => {
		expect(cleanAuthor("unknown")).toBeNull();
		expect(cleanAuthor("  Unknown ")).toBeNull();
	});

	it("tidies spacing and a stray trailing period", () => {
		expect(cleanAuthor("Sample,Author")).toBe("Sample, Author");
		expect(cleanAuthor("Sam Example.")).toBe("Sam Example");
	});
});

describe("titles the sheet left as placeholders", () => {
	it("knows the placeholders", () => {
		expect(["*", "unknown", " Unknown ", ""].every(isPlaceholderTitle)).toBe(true);
		expect(isPlaceholderTitle("Unknown Pleasures")).toBe(false);
	});

	it("falls back to the code and first topic, then the topic, then the code", () => {
		expect(fallbackTitle("IDF-099", ["Motivation", "Empathy"])).toBe("IDF-099: Motivation");
		expect(fallbackTitle(null, ["Project Management"])).toBe("Project Management");
		expect(fallbackTitle("IDF-099", [])).toBe("IDF-099");
		expect(fallbackTitle(null, [])).toBeNull();
	});

	it("keeps a real title and replaces only a placeholder", () => {
		expect(titleFor("Sample\nTitle", null, ["Topic"])).toBe("Sample Title");
		expect(titleFor("*", null, ["Goal Setting"])).toBe("Goal Setting");
	});
});
