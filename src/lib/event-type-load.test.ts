import { describe, expect, it } from "vitest";
import { loadEventTypes } from "./event-type-load";

const ROW = {
	type: "casual", label: "Casual", colour: "emerald",
	requiredPermission: null, active: true, position: 1,
};

describe("loadEventTypes", () => {
	it("reports success with rows", async () => {
		expect(await loadEventTypes(async () => [ROW])).toEqual({ ok: true, rows: [ROW] });
	});

	it("reports success with an genuinely empty table", async () => {
		// "Loaded and empty" must stay distinguishable from "failed to load".
		expect(await loadEventTypes(async () => [])).toEqual({ ok: true, rows: [] });
	});

	it("reports failure instead of an empty list when the read throws", async () => {
		// A read error must not become "no type may be created" or overwrite policy with an empty list.
		expect(
			await loadEventTypes(async () => {
				throw new Error("unavailable");
			}),
		).toEqual({ ok: false });
	});
});
