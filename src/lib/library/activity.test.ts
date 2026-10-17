import { describe, expect, it } from "vitest";
import { ACTIVITY, creditSeconds, formatHours, showSaveCount, statsLine, utc8Day } from "./activity";

describe("statsLine", () => {
	const base = { saves: 12, opens: 340, uniqueReaders: 61, activeSeconds: 37 * 3600 + 120 };

	it("reads like the spec's example", () => {
		expect(statsLine(base)).toEqual(["Saved by 12", "Opened 340 times by 61 members", "37 hours read"]);
	});

	it("hides the save count below 3 but always shows opens and hours", () => {
		expect(statsLine({ ...base, saves: 2 })).toEqual(["Opened 340 times by 61 members", "37 hours read"]);
		expect(statsLine({ ...base, saves: 3 })[0]).toBe("Saved by 3");
		expect(statsLine({ saves: 0, opens: 0, uniqueReaders: 0, activeSeconds: 0 })).toEqual(["Opened 0 times by 0 members", "Less than an hour read"]);
	});

	it("uses the singular for one", () => {
		expect(statsLine({ ...base, opens: 1, uniqueReaders: 1, activeSeconds: 3600 })).toEqual(["Saved by 12", "Opened 1 time by 1 member", "1 hour read"]);
	});

	it("groups thousands", () => {
		expect(statsLine({ ...base, opens: 1204 })[1]).toBe("Opened 1,204 times by 61 members");
	});
});

describe("utc8Day", () => {
	it("uses the UTC+8 calendar day", () => {
		expect(utc8Day(new Date("2026-10-16T15:59:59Z"))).toBe("2026-10-16");
		expect(utc8Day(new Date("2026-10-16T16:00:00Z"))).toBe("2026-10-17");
	});
});

describe("creditSeconds", () => {
	it("credits at most 30s per ping and respects the 2h daily cap", () => {
		expect(creditSeconds(45, 0)).toBe(30);
		expect(creditSeconds(20, 7_190)).toBe(10);
		expect(creditSeconds(20, 7_200)).toBe(0);
		expect(creditSeconds(-5, 0)).toBe(0);
		expect(creditSeconds(Number.NaN, 0)).toBe(0);
	});

	it("rounds down to whole seconds", () => {
		expect(creditSeconds(14.9, 0)).toBe(14);
	});

	it("treats non-finite input and an over-cap total as nothing to credit", () => {
		expect(creditSeconds(Number.POSITIVE_INFINITY, 0)).toBe(0);
		expect(creditSeconds(20, Number.NaN)).toBe(0);
		expect(creditSeconds(20, 9_999)).toBe(0);
	});

	it("exposes the agreed constants", () => {
		expect(ACTIVITY).toEqual({ pingIntervalMs: 15_000, idleMs: 60_000, maxPingSeconds: 30, dailyCapSeconds: 7_200 });
	});
});

describe("formatHours", () => {
	it("formats hours", () => {
		expect(formatHours(1800)).toBe("Less than an hour");
		expect(formatHours(3600)).toBe("1 hour");
		expect(formatHours(1204 * 3600 + 59)).toBe("1,204 hours");
	});

	it("floors, and treats bad input as under an hour", () => {
		expect(formatHours(3599)).toBe("Less than an hour");
		expect(formatHours(2 * 3600 - 1)).toBe("1 hour");
		expect(formatHours(2 * 3600)).toBe("2 hours");
		expect(formatHours(Number.NaN)).toBe("Less than an hour");
		expect(formatHours(-10)).toBe("Less than an hour");
	});
});

describe("showSaveCount", () => {
	it("hides save counts below 3", () => {
		expect(showSaveCount(2)).toBe(false);
		expect(showSaveCount(3)).toBe(true);
	});
});
