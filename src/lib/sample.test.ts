import { describe, expect, it } from "vitest";
import { seededSample } from "./sample";

const ITEMS = Array.from({ length: 20 }, (_, i) => `m${i}`);

describe("seededSample", () => {
	it("is deterministic for the same items, size, and seed", () => {
		const a = seededSample(ITEMS, 5, "survey-123");
		const b = seededSample(ITEMS, 5, "survey-123");
		expect(a).toEqual(b);
	});

	it("returns a different draw for a different seed", () => {
		const a = seededSample(ITEMS, 5, "seed-a");
		const b = seededSample(ITEMS, 5, "seed-b");
		expect(a).not.toEqual(b);
	});

	it("returns exactly size items when the pool is larger", () => {
		expect(seededSample(ITEMS, 7, "x")).toHaveLength(7);
	});

	it("returns the whole pool when size exceeds it", () => {
		const result = seededSample(ITEMS, 50, "x");
		expect(result).toHaveLength(ITEMS.length);
		expect([...result].sort()).toEqual([...ITEMS].sort());
	});

	it("returns no duplicates", () => {
		const result = seededSample(ITEMS, 10, "x");
		expect(new Set(result).size).toBe(result.length);
	});

	it("returns an empty array for size 0 or empty pool", () => {
		expect(seededSample(ITEMS, 0, "x")).toEqual([]);
		expect(seededSample([], 5, "x")).toEqual([]);
	});
});
