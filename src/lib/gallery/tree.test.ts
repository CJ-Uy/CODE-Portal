import { describe, expect, it } from "vitest";
import { createFolderTree, daysLeft, purgeCutoff, type FolderNode } from "./tree";

const DAY = 24 * 60 * 60 * 1000;
const folder = (id: string, parentId: string | null, extra: Partial<FolderNode> = {}): FolderNode => ({
	id,
	parentId,
	name: id,
	eventId: null,
	isPublic: false,
	deletedAt: null,
	...extra,
});

// top ─ trip ─ day1 ─ morning
//            └ day2 (deleted)
const tree = createFolderTree([
	folder("trip", null, { isPublic: true, eventId: "evt" }),
	folder("day1", "trip"),
	folder("morning", "day1"),
	folder("day2", "trip", { deletedAt: new Date(0) }),
	folder("night", "day2"),
	folder("other", null),
]);

describe("gallery folder tree", () => {
	it("hides a folder when it or any parent is deleted", () => {
		expect(tree.isLive(null)).toBe(true);
		expect(tree.isLive("morning")).toBe(true);
		expect(tree.isLive("day2")).toBe(false);
		expect(tree.isLive("night")).toBe(false);
		expect(tree.isLive("missing")).toBe(false);
		expect(tree.children("trip").map((f) => f.id)).toEqual(["day1"]);
	});

	it("inherits public and event tags from parents", () => {
		expect(tree.isPublic("morning")).toBe(true);
		expect(tree.isPublic("other")).toBe(false);
		expect(tree.eventId("morning")).toBe("evt");
		expect(tree.eventId(null)).toBeNull();
	});

	it("restores into the deepest live folder above", () => {
		expect(tree.nearestLive("night")).toBe("trip");
		expect(tree.nearestLive("morning")).toBe("morning");
		expect(tree.nearestLive("missing")).toBeNull();
	});

	it("refuses to move a folder into itself or below itself", () => {
		expect(tree.wouldCycle("trip", "morning")).toBe(true);
		expect(tree.wouldCycle("trip", "trip")).toBe(true);
		expect(tree.wouldCycle("morning", "other")).toBe(false);
		expect(tree.wouldCycle("morning", null)).toBe(false);
	});

	it("lists descendants and breadcrumbs", () => {
		expect(tree.descendants("trip").map((f) => f.id).sort()).toEqual(["day1", "day2", "morning", "night"]);
		expect(tree.path("morning").map((f) => f.id)).toEqual(["trip", "day1", "morning"]);
		expect(createFolderTree([folder("a", null), folder("b", "a", { isPublic: true }), folder("c", "b")]).publicPath("c").map((f) => f.id)).toEqual(["b", "c"]);
		expect(tree.publicPath("other")).toEqual([]);
	});

	it("counts down 30 days and purges after", () => {
		const deletedAt = new Date(1_000_000);
		expect(daysLeft(deletedAt, deletedAt)).toBe(30);
		expect(daysLeft(deletedAt, new Date(deletedAt.getTime() + 29.5 * DAY))).toBe(1);
		expect(daysLeft(deletedAt, new Date(deletedAt.getTime() + 31 * DAY))).toBe(0);
		expect(purgeCutoff(new Date(40 * DAY)).getTime()).toBe(10 * DAY);
	});
});
