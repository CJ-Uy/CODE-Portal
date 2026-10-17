import { describe, expect, it } from "vitest";
import { createFrameFocus, createReadingTracker, PDF_FOCUS_MS } from "./activity-tracker";

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

describe("createFrameFocus", () => {
	it("counts focus in the preview for five minutes, then stops", () => {
		const frame = createFrameFocus();
		expect(frame.counts(true, 1_000)).toBe(true);
		expect(frame.counts(true, 1_000 + PDF_FOCUS_MS - 1)).toBe(true);
		expect(frame.counts(true, 1_000 + PDF_FOCUS_MS)).toBe(false);
		expect(frame.counts(true, 1_000 + PDF_FOCUS_MS + 60_000)).toBe(false);
	});

	it("never counts focus that is not in the preview, and starts a new entry on return", () => {
		const frame = createFrameFocus();
		expect(frame.counts(false, 0)).toBe(false);
		expect(frame.counts(true, 1_000)).toBe(true);
		expect(frame.counts(true, 1_000 + PDF_FOCUS_MS)).toBe(false);
		expect(frame.counts(false, 400_000)).toBe(false);
		// Focus came back (a click, or the window regained focus): a fresh five minutes.
		expect(frame.counts(true, 401_000)).toBe(true);
		expect(frame.counts(true, 401_000 + PDF_FOCUS_MS - 1_000)).toBe(true);
	});
});

describe("reading a PDF with focus resting in the preview", () => {
	// The same loop the page runs: a tick a second, focus in the preview counted as an interaction first.
	function read(seconds: number, inFrame: (second: number) => boolean) {
		const tracker = createReadingTracker();
		const frame = createFrameFocus();
		tracker.feed({ type: "visible", at: 0 });
		tracker.feed({ type: "interact", at: 0 });
		let sent = 0;
		for (let second = 1; second <= seconds; second++) {
			const at = second * 1_000;
			if (frame.counts(inFrame(second), at)) tracker.feed({ type: "interact", at });
			sent += tracker.feed({ type: "tick", at });
		}
		return sent + tracker.feed({ type: "hidden", at: seconds * 1_000 });
	}

	it("credits what was read: three minutes in the preview is about 180 s", () => {
		expect(read(180, () => true)).toBe(180);
	});

	it("stops after five minutes of focus plus the one-minute idle tail, however long the tab stays open", () => {
		expect(read(600, () => true)).toBe(360);
	});

	it("stops soon after the window or the preview loses focus", () => {
		// Focus leaves at 120 s: the idle tail is all that is left.
		expect(read(600, (second) => second <= 120)).toBe(180);
	});

	it("counts nothing when focus was never in the preview", () => {
		// Only the mount interaction at 0, so one idle minute.
		expect(read(600, () => false)).toBe(60);
	});
});
