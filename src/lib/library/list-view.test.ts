import { describe, expect, it } from "vitest";
import { moveItem, relativeAge } from "./list-view";

describe("moveItem", () => {
	const order = ["a", "b", "c", "d"];

	it("moves an entry up and down", () => {
		expect(moveItem(order, 2, 1)).toEqual(["a", "c", "b", "d"]);
		expect(moveItem(order, 1, 2)).toEqual(["a", "c", "b", "d"]);
		expect(moveItem(order, 0, 3)).toEqual(["b", "c", "d", "a"]);
		expect(moveItem(order, 3, 0)).toEqual(["d", "a", "b", "c"]);
	});

	it("does not change the input", () => {
		moveItem(order, 3, 0);
		expect(order).toEqual(["a", "b", "c", "d"]);
	});

	it("returns the input itself for a move that goes nowhere", () => {
		expect(moveItem(order, 1, 1)).toBe(order);
		expect(moveItem(order, 0, -1)).toBe(order);
		expect(moveItem(order, 3, 4)).toBe(order);
		expect(moveItem(order, -1, 2)).toBe(order);
		expect(moveItem(order, 9, 0)).toBe(order);
		expect(moveItem([], 0, 0)).toEqual([]);
	});
});

describe("relativeAge", () => {
	const now = new Date("2026-10-17T12:00:00Z");
	const ago = (ms: number) => relativeAge(new Date(now.getTime() - ms), now);
	const MIN = 60_000;
	const HOUR = 60 * MIN;
	const DAY = 24 * HOUR;

	it("steps through minutes, hours, days, months and years", () => {
		expect(ago(0)).toBe("just now");
		expect(ago(59_000)).toBe("just now");
		expect(ago(MIN)).toBe("1m ago");
		expect(ago(59 * MIN)).toBe("59m ago");
		expect(ago(HOUR)).toBe("1h ago");
		expect(ago(23 * HOUR)).toBe("23h ago");
		expect(ago(DAY)).toBe("1d ago");
		expect(ago(29 * DAY)).toBe("29d ago");
		expect(ago(30 * DAY)).toBe("1mo ago");
		expect(ago(364 * DAY)).toBe("12mo ago");
		expect(ago(365 * DAY)).toBe("1y ago");
		expect(ago(800 * DAY)).toBe("2y ago");
	});

	it("reads a date in the future as just now", () => {
		expect(ago(-5 * MIN)).toBe("just now");
	});
});
