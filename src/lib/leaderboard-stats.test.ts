import { describe, expect, it } from "vitest";
import { describePoints } from "./leaderboard-stats";

describe("describePoints", () => {
	it("returns nothing to describe for an empty board", () => {
		expect(describePoints([])).toBeNull();
	});

	it("computes spread and quartiles", () => {
		const stats = describePoints([1, 2, 3, 4, 5, 6, 7, 8])!;
		expect(stats.n).toBe(8);
		expect(stats.mean).toBe(4.5);
		expect(stats.median).toBe(4.5);
		expect(stats.sd).toBeCloseTo(2.449, 3); // sample standard deviation
		expect(stats.q1).toBe(2.75);
		expect(stats.q3).toBe(6.25);
		expect(stats.min).toBe(1);
		expect(stats.max).toBe(8);
	});

	it("bins every value exactly once, starting at zero", () => {
		const values = [0.25, 0.5, 0.75, 1, 1, 1.25, 2, 3.5, 5.25];
		const stats = describePoints(values)!;
		expect(stats.bins[0].from).toBe(0);
		expect(stats.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(values.length);
		expect(stats.bins.at(-1)!.to).toBeGreaterThan(5.25);
	});

	it("calls a long right tail right-skewed with one peak", () => {
		const stats = describePoints([0.5, 0.5, 0.75, 0.75, 1, 1, 1, 1.25, 1.5, 2, 6])!;
		expect(stats.skew).toBeGreaterThan(0.5);
		expect(stats.shape.peaks).toBe(1);
		expect(stats.shape.tail).toBe("right");
	});

	it("notices two separate clusters", () => {
		const stats = describePoints([1, 1, 1, 1, 1.25, 1.25, 1.5, 6, 6, 6, 6.25, 6.25, 6.5])!;
		expect(stats.shape.peaks).toBe(2);
	});
});
