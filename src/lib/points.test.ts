import { describe, expect, it } from "vitest";
import { formatPoints, quantizePoints } from "./points";

describe("quantizePoints", () => {
	it("leaves a whole number alone", () => {
		expect(quantizePoints(5)).toBe(5);
	});

	it("leaves two decimals alone", () => {
		expect(quantizePoints(0.75)).toBe(0.75);
	});

	it("rounds a third decimal away", () => {
		expect(quantizePoints(0.756)).toBe(0.76);
	});

	it("keeps negative deductions symmetric", () => {
		expect(quantizePoints(-0.755)).toBe(-0.76);
		expect(quantizePoints(10.075)).toBe(10.08);
		expect(quantizePoints(-10.075)).toBe(-10.08);
	});

	it("clears binary float dust from a sum", () => {
		expect(quantizePoints(0.1 + 0.2)).toBe(0.3);
	});
});

describe("formatPoints", () => {
	it("drops trailing zeros", () => {
		expect(formatPoints(1.5)).toBe("1.5");
		expect(formatPoints(2)).toBe("2");
	});

	it("never renders float dust", () => {
		expect(formatPoints(0.1 + 0.2)).toBe("0.3");
	});
});
