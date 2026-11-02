import { describe, expect, it } from "vitest";
import { parsePinId, parsePinInput } from "./input";

const form = (values: Record<string, string>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) data.set(key, value);
	return data;
};
const valid = { label: " Shortcut ", url: " https://example.com ", icon: "Globe", position: "2" };

describe("pinned nav link input", () => {
	it("trims fields and parses the order", () => {
		expect(parsePinInput(form(valid))).toEqual({ label: "Shortcut", url: "https://example.com", icon: "Globe", position: 2 });
		expect(parsePinId(form({ id: " nav_x " }))).toBe("nav_x");
	});
	it("rejects unsafe links, unknown icons, blank labels and invalid order", () => {
		for (const invalid of [{ url: "javascript:alert(1)" }, { url: "ftp://example.com" }, { icon: "constructor" }, { label: " " }, { position: "-1" }, { position: "1.5" }, { position: "1000" }]) {
			expect(() => parsePinInput(form({ ...valid, ...invalid }))).toThrow();
		}
		expect(() => parsePinId(form({ id: "" }))).toThrow();
	});
});
