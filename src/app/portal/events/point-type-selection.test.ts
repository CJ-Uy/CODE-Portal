import { describe, expect, it } from "vitest";
import { selectLeaderboardPointTypeId } from "./point-type-selection";

const types = [
	{ id: "pt_frontliner", key: "frontliner", label: "Frontliner", active: true, position: 2 },
	{ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 1 },
	{ id: "pt_retired", key: "retired", label: "Retired", active: false, position: 3 },
];

describe("selectLeaderboardPointTypeId", () => {
	it("defaults to Retention", () => {
		expect(selectLeaderboardPointTypeId(undefined, types)).toBe("pt_retention");
	});

	it("honors any known selected type, including retired history", () => {
		expect(selectLeaderboardPointTypeId("pt_frontliner", types)).toBe("pt_frontliner");
		expect(selectLeaderboardPointTypeId("pt_retired", types)).toBe("pt_retired");
	});

	it("falls back from an unknown type and handles no types", () => {
		expect(selectLeaderboardPointTypeId("unknown", types)).toBe("pt_retention");
		expect(selectLeaderboardPointTypeId(undefined, [])).toBeNull();
	});
});
