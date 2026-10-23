import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

describe("library cursor", () => {
	it("reads back what it wrote, text and numbers alike", () => {
		const cursor = { order: "title", keys: ["módulo 3: “burnout”", "lib_abc"] };
		expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
		expect(decodeCursor(encodeCursor({ order: "most_saved", keys: [4, 1_792_272_350_000, "lib_x"] }))).toEqual({ order: "most_saved", keys: [4, 1_792_272_350_000, "lib_x"] });
	});

	it.each([
		["not json", "{"],
		["an object", '{"order":"newest"}'],
		["no keys", '["newest"]'],
		["too many keys", '["newest",1,2,3,4,5]'],
		["an empty order", '["",1]'],
		["a non-string order", "[1,2]"],
		["a nested key", '["newest",[1]]'],
		["a null key", '["newest",null]'],
		["a boolean key", '["newest",true]'],
		["an over-long key", JSON.stringify(["title", "x".repeat(301)])],
		["an over-long cursor", `["title","${"x".repeat(2_000)}"]`],
	])("rejects %s", (_, raw) => {
		expect(decodeCursor(raw)).toBeNull();
	});
});
