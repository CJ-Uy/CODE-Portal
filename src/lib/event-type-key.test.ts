import { describe, expect, it } from "vitest";
import { eventTypeKeySchema } from "./event-type-key";

describe("eventTypeKeySchema", () => {
	it("accepts admin-defined lowercase keys", () => {
		expect(eventTypeKeySchema.parse("casual")).toBe("casual");
		expect(eventTypeKeySchema.parse("gen_assembly")).toBe("gen_assembly");
		expect(eventTypeKeySchema.parse("workshop2")).toBe("workshop2");
	});

	it("rejects shapes that could never be a key", () => {
		// Membership is checked at the repository; this only stops obvious junk at the boundary.
		for (const bad of ["", "Casual", "has space", "punctuation!", "a".repeat(33)]) {
			expect(() => eventTypeKeySchema.parse(bad)).toThrow();
		}
	});
});
