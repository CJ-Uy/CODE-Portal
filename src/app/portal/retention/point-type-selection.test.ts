import { describe, expect, it } from "vitest";
import { selectLeaderboardPointTypeId } from "./point-type-selection";

const types = [
	{ id: "pt_frontliner", key: "frontliner", label: "Frontliner", active: true, position: 0, retentionPeriod: null },
	{ id: "pt_hre", key: "hre", label: "HRE", active: true, position: 4, retentionPeriod: "semester" },
	{ id: "pt_gma", key: "gma", label: "GMA", active: true, position: 3, retentionPeriod: "semester" },
	{ id: "pt_retired", key: "retired", label: "Retired", active: false, position: 5, retentionPeriod: null },
];

describe("selectLeaderboardPointTypeId", () => {
	it("defaults to the first retention part", () => {
		expect(selectLeaderboardPointTypeId(undefined, types)).toBe("pt_gma");
		expect(selectLeaderboardPointTypeId(undefined, [types[0]])).toBe("pt_frontliner");
	});

	it("honors any known selected type, including retired history", () => {
		expect(selectLeaderboardPointTypeId("pt_frontliner", types)).toBe("pt_frontliner");
		expect(selectLeaderboardPointTypeId("pt_retired", types)).toBe("pt_retired");
	});

	it("falls back from an unknown type and handles no types", () => {
		expect(selectLeaderboardPointTypeId("unknown", types)).toBe("pt_gma");
		expect(selectLeaderboardPointTypeId(undefined, [])).toBeNull();
	});
});
