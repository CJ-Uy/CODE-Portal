import { describe, expect, it } from "vitest";
import type { LibraryCardFields } from "./card-fields";
import { LIST_MEMORY_MAX_CARDS, LIST_MEMORY_TTL_MS, listHref, readListMemory, writeListMemory } from "./list-memory";
import type { ListMemory } from "./list-memory";

const card: LibraryCardFields = {
	id: "lib_1",
	kind: "guide",
	source: "code",
	title: "Run a diagnosis",
	dek: "",
	year: 2024,
	publicReadiness: null,
	confidentiality: "members",
	tagNames: [],
	saves: 0,
	authorsJson: [{ name: "Ana" }],
};
const now = 1_800_000_000_000;
const memory: ListMemory = { key: "type=guide", to: "/portal/library/lib_1", cards: [card], nextCursor: '["title","run","lib_1"]', scrollY: 1_240, savedAt: now - 60_000 };

describe("library list memory", () => {
	it("reads back what it wrote", () => {
		expect(readListMemory(writeListMemory(memory), now)).toEqual(memory);
		expect(readListMemory(writeListMemory({ ...memory, nextCursor: null }), now)?.nextCursor).toBeNull();
	});

	it("is nothing once stale, or for a save from the future", () => {
		const raw = writeListMemory(memory);
		expect(readListMemory(raw, memory.savedAt + LIST_MEMORY_TTL_MS + 1)).toBeNull();
		expect(readListMemory(raw, memory.savedAt - 1)).toBeNull();
	});

	it("does not keep a list too long to be worth restoring", () => {
		expect(writeListMemory({ ...memory, cards: Array.from({ length: LIST_MEMORY_MAX_CARDS + 1 }, () => card) })).toBeNull();
	});

	it.each([
		["nothing", null],
		["not json", "{"],
		["not an object", "[]"],
		["cards that are not cards", JSON.stringify({ ...memory, cards: [{ id: 1 }] })],
		["a negative scroll", JSON.stringify({ ...memory, scrollY: -5 })],
		["a cursor that is not text", JSON.stringify({ ...memory, nextCursor: 4 })],
		["no save time", JSON.stringify({ ...memory, savedAt: "now" })],
		["no search key", JSON.stringify({ ...memory, key: undefined })],
		["a destination off this site", JSON.stringify({ ...memory, to: "https://example.com/" })],
	])("ignores %s", (_, raw) => {
		expect(readListMemory(raw, now)).toBeNull();
	});

	it("links back to the list with its search", () => {
		expect(listHref("")).toBe("/portal/library");
		expect(listHref("type=guide&sort=newest")).toBe("/portal/library?type=guide&sort=newest");
	});
});
