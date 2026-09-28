import { describe, expect, it } from "vitest";
import { attendanceStatus, minutesLate } from "./attendance-status";

const START = new Date("2026-03-01T10:00:00.000Z");
const at = (minutes: number, ms = 0) => new Date(START.getTime() + minutes * 60_000 + ms);

describe("attendanceStatus", () => {
	it("treats a scan before the start as on time", () => {
		expect(attendanceStatus(at(-20), START, 15)).toBe("on_time");
	});

	it("treats a scan exactly at the end of the grace window as on time", () => {
		expect(attendanceStatus(at(15), START, 15)).toBe("on_time");
	});

	it("treats one millisecond past the grace window as late", () => {
		expect(attendanceStatus(at(15, 1), START, 15)).toBe("late");
	});

	it("falls back to the default grace when none is set", () => {
		expect(attendanceStatus(at(15), START, null)).toBe("on_time");
		expect(attendanceStatus(at(16), START, null)).toBe("late");
	});

	it("honours a zero grace window", () => {
		expect(attendanceStatus(at(0), START, 0)).toBe("on_time");
		expect(attendanceStatus(at(1), START, 0)).toBe("late");
	});
});

describe("minutesLate", () => {
	it("returns 0 when on time", () => {
		expect(minutesLate(at(15), START, 15)).toBe(0);
		expect(minutesLate(at(-30), START, 15)).toBe(0);
	});

	it("measures from the end of the grace window, not the start time", () => {
		expect(minutesLate(at(27), START, 15)).toBe(12);
	});

	it("floors partial minutes", () => {
		// 16 min 59 s past start, minus a 15 min grace, is 1 min 59 s over. Floors to 1.
		expect(minutesLate(at(16, 59_000), START, 15)).toBe(1);
	});
});
