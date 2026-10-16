import { describe, expect, it } from "vitest";
import { createReadingTracker } from "./activity-tracker";

function active() {
	const t = createReadingTracker();
	t.feed({ type: "visible", at: 0 });
	t.feed({ type: "interact", at: 0 });
	return t;
}

describe("createReadingTracker", () => {
	it("flushes 15s of active visible reading", () => {
		const t = active();
		expect(t.feed({ type: "tick", at: 14_000 })).toBe(0);
		expect(t.feed({ type: "tick", at: 15_000 })).toBe(15);
	});

	it("stops counting 60s after the last interaction", () => {
		const t = active();
		let sent = 0;
		for (let at = 1_000; at <= 300_000; at += 1_000) sent += t.feed({ type: "tick", at });
		expect(sent).toBe(60);
	});

	it("does not count hidden time and flushes on hide", () => {
		const t = active();
		expect(t.feed({ type: "hidden", at: 7_000 })).toBe(7);
		expect(t.feed({ type: "tick", at: 30_000 })).toBe(0);
	});

	it("counts only up to the idle point when it falls between two events", () => {
		const t = active();
		expect(t.feed({ type: "tick", at: 100_000 })).toBe(60);
		expect(t.feed({ type: "tick", at: 200_000 })).toBe(0);
	});

	it("resumes counting after a fresh interaction", () => {
		const t = active();
		t.feed({ type: "tick", at: 100_000 });
		t.feed({ type: "interact", at: 100_000 });
		expect(t.feed({ type: "tick", at: 115_000 })).toBe(15);
	});

	it("counts nothing before the first interaction", () => {
		const t = createReadingTracker();
		t.feed({ type: "visible", at: 0 });
		expect(t.feed({ type: "tick", at: 30_000 })).toBe(0);
		expect(t.feed({ type: "hidden", at: 31_000 })).toBe(0);
	});

	it("does not become visible from an interaction while hidden", () => {
		const t = createReadingTracker();
		t.feed({ type: "interact", at: 0 });
		expect(t.feed({ type: "tick", at: 20_000 })).toBe(0);
		t.feed({ type: "visible", at: 20_000 });
		expect(t.feed({ type: "tick", at: 35_000 })).toBe(15);
	});

	it("keeps the sub-second remainder across flushes", () => {
		const t = active();
		expect(t.feed({ type: "tick", at: 15_500 })).toBe(15);
		// 500 ms carried over + 1_300 ms more = 1_800 ms, so 1 s is flushed and 800 ms stays.
		expect(t.feed({ type: "hidden", at: 16_800 })).toBe(1);
		t.feed({ type: "visible", at: 20_000 });
		t.feed({ type: "interact", at: 20_000 });
		// 800 ms carried over + 400 ms more = 1_200 ms, so 1 s is flushed.
		expect(t.feed({ type: "hidden", at: 20_400 })).toBe(1);
	});

	it("flushes nothing on hide below one second", () => {
		const t = active();
		expect(t.feed({ type: "hidden", at: 900 })).toBe(0);
	});

	it("ignores events that arrive out of order", () => {
		const t = active();
		t.feed({ type: "tick", at: 10_000 });
		expect(t.feed({ type: "tick", at: 5_000 })).toBe(0);
		expect(t.feed({ type: "tick", at: 15_000 })).toBe(15);
	});
});
