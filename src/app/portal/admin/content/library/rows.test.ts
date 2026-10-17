import { describe, expect, it } from "vitest";
import type { LibraryItem, LibraryList, LibraryReport } from "@/db/repositories/library";
import { deleteTagText, groupTags, mergeTagText, toItemRow, toListRow, toReportRow, usedByText } from "./rows";

const item = {
	id: "lib_1",
	title: "Org design basics",
	kind: "guide",
	source: "member",
	status: "pending_review",
	authorsJson: [{ name: "Ana", memberId: "mem_secret" }, { name: "Ben" }],
	containsClientData: true,
	moderationReason: null,
	createdBy: "mem_secret",
	publishedAt: new Date("2026-10-03T04:00:00Z"),
	updatedAt: new Date("2026-10-09T04:00:00Z"),
} as unknown as LibraryItem;

describe("toItemRow", () => {
	it("keeps display fields only, with member ids left behind", () => {
		const row = toItemRow(item);
		expect(row).toEqual({
			id: "lib_1",
			title: "Org design basics",
			meta: "Guide · From members · Ana, Ben",
			when: "Oct 3, 2026",
			clientData: true,
			reason: null,
		});
		expect(JSON.stringify(row)).not.toContain("mem_secret");
	});

	it("shows a taken-down item's last change and the reason the owner reads", () => {
		const row = toItemRow({ ...item, status: "taken_down", containsClientData: null, moderationReason: "Names a client" } as LibraryItem);
		expect(row).toMatchObject({ when: "Oct 9, 2026", clientData: false, reason: "Names a client" });
	});

	it("drops an empty byline", () => {
		expect(toItemRow({ ...item, authorsJson: [] } as LibraryItem).meta).toBe("Guide · From members");
	});
});

describe("toListRow", () => {
	it("carries the name, the date and the reason, and not the owner", () => {
		const row = toListRow({ id: "lst_1", name: "Reading pack", memberId: "mem_secret", takenDownAt: new Date("2026-10-04T04:00:00Z"), moderationReason: "Spam" } as LibraryList);
		expect(row).toEqual({ id: "lst_1", name: "Reading pack", when: "Oct 4, 2026", reason: "Spam" });
	});
});

describe("toReportRow", () => {
	const base = { id: "lrp_1", memberId: "mem_secret", reason: "client_data", details: "Names Acme", createdAt: new Date("2026-10-05T04:00:00Z"), targetTitle: "Some title" };

	it("links an item report to the item page", () => {
		const row = toReportRow({ ...base, itemId: "lib_1", listId: null } as LibraryReport & { targetTitle: string });
		expect(row).toEqual({
			id: "lrp_1",
			href: "/portal/library/lib_1",
			targetTitle: "Some title",
			targetKind: "Item",
			reason: "Includes client names or client data",
			details: "Names Acme",
			when: "Oct 5, 2026",
		});
		expect(JSON.stringify(row)).not.toContain("mem_secret");
	});

	it("links a list report to the list page", () => {
		const row = toReportRow({ ...base, itemId: null, listId: "lst_1", reason: "other" } as LibraryReport & { targetTitle: string });
		expect(row).toMatchObject({ href: "/portal/library/lists/lst_1", targetKind: "List", reason: "Something else" });
	});
});

describe("groupTags", () => {
	it("folds neighbours into their group and keeps the order it was given", () => {
		const groups = groupTags([
			{ id: "a", name: "Alpha", groupName: "Methods", itemCount: 2 },
			{ id: "b", name: "Beta", groupName: "Methods", itemCount: 0 },
			{ id: "c", name: "Gamma", groupName: "Ungrouped", itemCount: 1 },
		]);
		expect(groups.map((group) => [group.groupName, group.tags.map((tag) => tag.name)])).toEqual([
			["Methods", ["Alpha", "Beta"]],
			["Ungrouped", ["Gamma"]],
		]);
		expect(groupTags([])).toEqual([]);
	});
});

describe("tag wording", () => {
	it("counts items", () => {
		expect(usedByText(0)).toBe("Not used yet");
		expect(usedByText(1)).toBe("1 item");
		expect(usedByText(1234)).toBe("1,234 items");
	});

	it("says how many items lose the tag before it is deleted", () => {
		expect(deleteTagText("Vision", 3)).toContain("3 items will lose the tag \"Vision\"");
		expect(deleteTagText("Vision", 1)).toContain("1 item will lose");
		expect(deleteTagText("Vision", 0)).toBe("No item carries \"Vision\". It will be deleted.");
	});

	it("says what a merge does to the items", () => {
		expect(mergeTagText("Old", "New", 2)).toContain("2 items carrying \"Old\" will carry \"New\" instead");
		expect(mergeTagText("Old", "New", 0)).toContain("No item carries \"Old\"");
	});
});
