import { describe, expect, it } from "vitest";
import { hitZones, stepIndex } from "./chart-geometry";

describe("hitZones", () => {
	it("tiles the plot with no gap and no overlap", () => {
		const zones = hitZones([0, 10, 20, 30], 0, 30);
		expect(zones.map((zone) => zone.left)).toEqual([0, 5, 15, 25]);
		// Each zone ends exactly where the next begins.
		for (let index = 0; index < zones.length - 1; index += 1) {
			expect(zones[index].left + zones[index].width).toBeCloseTo(zones[index + 1].left);
		}
		const last = zones[zones.length - 1];
		expect(last.left + last.width).toBeCloseTo(30);
	});

	it("reaches the plot edges rather than stopping at the outer markers", () => {
		const zones = hitZones([20, 60], 10, 100);
		expect(zones[0].left).toBe(10);
		expect(zones[1].left + zones[1].width).toBe(100);
	});

	it("gives a single marker the whole plot", () => {
		const zones = hitZones([50], 0, 100);
		expect(zones).toEqual([{ left: 0, width: 100 }]);
	});

	it("never produces a zero-width zone for coincident markers", () => {
		for (const zone of hitZones([40, 40, 40], 40, 40)) expect(zone.width).toBeGreaterThan(0);
	});

	it("handles no markers", () => {
		expect(hitZones([], 0, 100)).toEqual([]);
	});
});

describe("stepIndex", () => {
	it("enters from the correct end when nothing is selected", () => {
		expect(stepIndex(null, 1, 5)).toBe(0);
		expect(stepIndex(null, -1, 5)).toBe(4);
	});

	it("clamps instead of wrapping", () => {
		expect(stepIndex(4, 1, 5)).toBe(4);
		expect(stepIndex(0, -1, 5)).toBe(0);
	});

	it("moves one step at a time", () => {
		expect(stepIndex(2, 1, 5)).toBe(3);
		expect(stepIndex(2, -1, 5)).toBe(1);
	});

	it("stays in range for an empty series", () => {
		expect(stepIndex(null, 1, 0)).toBe(0);
	});
});
