import { describe, expect, it } from "vitest";
import { assertTagMapComplete, proposeTagMap } from "./tag-map";

describe("proposeTagMap", () => {
	it("proposes tag mappings and flags unmapped topics", () => {
		const map = proposeTagMap(
			["Acountability", "Vision and Mission realignment through BHAG", "Underwater Basket Weaving"],
			["Accountability", "Vision & Mission (VMOS)"],
		);
		expect(map["Acountability"]).toEqual(["Accountability"]);
		expect(map["Vision and Mission realignment through BHAG"]).toEqual(["Vision & Mission (VMOS)"]);
		expect(() => assertTagMapComplete(map)).toThrow(/Underwater Basket Weaving/);
	});

	it("matches abbreviations, slash alternatives and the comma-free form of a tag", () => {
		const tags = ["Processes, Systems & Structures (PSS)", "Design Thinking / HCD", "Org Culture", "Alignment"];
		const map = proposeTagMap(["PSS", "hcd", "Organizational Culture", "Processes, Systems, and Structures", "Realignment of goals"], tags);
		expect(map["PSS"]).toEqual(["Processes, Systems & Structures (PSS)"]);
		expect(map["hcd"]).toEqual(["Design Thinking / HCD"]);
		expect(map["Organizational Culture"]).toEqual(["Org Culture"]);
		expect(map["Processes, Systems, and Structures"]).toEqual(["Processes, Systems & Structures (PSS)"]);
		// Whole words only: "realignment" is not "alignment".
		expect(map["Realignment of goals"]).toEqual([]);
	});
});

describe("assertTagMapComplete", () => {
	it("passes when every topic maps to a tag or is dropped", () => {
		expect(() => assertTagMapComplete({ a: ["Leadership"], b: "drop" }, ["Leadership"])).not.toThrow();
	});

	it("lists every unmapped topic, and rejects tags that do not exist", () => {
		expect(() => assertTagMapComplete({ one: [], two: [], three: ["Leadership"] })).toThrow(/one.*two/);
		expect(() => assertTagMapComplete({ one: ["Not A Tag"] }, ["Leadership"])).toThrow(/Not A Tag/);
		expect(() => assertTagMapComplete({ one: "Drop" as never })).toThrow(/one/);
	});
});
