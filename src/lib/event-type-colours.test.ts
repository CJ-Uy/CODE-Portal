import { describe, expect, it } from "vitest";
import { colourClasses, eventTypeColours } from "./event-type-colours";

describe("event type colours", () => {
	it("offers exactly the six supported tokens", () => {
		expect([...eventTypeColours]).toEqual(["primary", "accent", "emerald", "amber", "rose", "slate"]);
	});

	it("maps a known token to chip and dot classes", () => {
		const classes = colourClasses("emerald");
		expect(classes.chip).toContain("emerald");
		expect(classes.dot).toContain("emerald");
	});

	it("falls back to slate for an unknown token rather than rendering unstyled", () => {
		// A token written straight to the database, out-of-band of the admin form.
		expect(colourClasses("chartreuse")).toEqual(colourClasses("slate"));
		expect(colourClasses("")).toEqual(colourClasses("slate"));
	});
});
