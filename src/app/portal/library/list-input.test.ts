import { describe, expect, it } from "vitest";
import {
	addListCommentInputSchema,
	createListInputSchema,
	editorInputSchema,
	listItemInputSchema,
	reorderInputSchema,
	setCommentHiddenInputSchema,
	setNoteInputSchema,
	setPinnedInputSchema,
	setSharedInputSchema,
	takeDownInputSchema,
	updateListInputSchema,
} from "./list-input";

describe("createListInputSchema", () => {
	it("trims the name and needs one of at most 100 characters", () => {
		expect(createListInputSchema.parse({ name: "  Onboarding  " })).toEqual({ name: "Onboarding" });
		expect(createListInputSchema.safeParse({ name: "   " }).success).toBe(false);
		expect(createListInputSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
		expect(createListInputSchema.safeParse({ name: "x".repeat(100) }).success).toBe(true);
	});

	it("limits the description to 1000 characters", () => {
		expect(createListInputSchema.safeParse({ name: "ok", description: "x".repeat(1000) }).success).toBe(true);
		expect(createListInputSchema.safeParse({ name: "ok", description: "x".repeat(1001) }).success).toBe(false);
	});
});

describe("updateListInputSchema", () => {
	it("needs something to change", () => {
		expect(updateListInputSchema.safeParse({ listId: "lst_1" }).success).toBe(false);
		expect(updateListInputSchema.safeParse({ listId: "lst_1", name: "New" }).success).toBe(true);
		expect(updateListInputSchema.safeParse({ listId: "lst_1", description: "" }).success).toBe(true);
	});

	it("takes only a plain hex color, because it ends up in a style attribute", () => {
		expect(updateListInputSchema.safeParse({ listId: "lst_1", color: "#0C315c" }).success).toBe(true);
		for (const bad of ["red", "#fff", "#0c315c; background:url(x)", "0c315c", "#0c315cd"]) {
			expect(updateListInputSchema.safeParse({ listId: "lst_1", color: bad }).success, bad).toBe(false);
		}
	});

	it("will not take an empty name", () => {
		expect(updateListInputSchema.safeParse({ listId: "lst_1", name: " " }).success).toBe(false);
	});
});

describe("ids", () => {
	it("a list needs an id", () => {
		expect(setSharedInputSchema.safeParse({ listId: "", shared: true }).success).toBe(false);
		expect(setSharedInputSchema.safeParse({ listId: "lst_1", shared: "yes" }).success).toBe(false);
		expect(setSharedInputSchema.safeParse({ listId: "lst_1", shared: false }).success).toBe(true);
		expect(editorInputSchema.safeParse({ listId: "lst_1", memberId: "" }).success).toBe(false);
	});

	it("an item id must be a plain library id", () => {
		expect(listItemInputSchema.safeParse({ listId: "lst_1", itemId: "lib_1" }).success).toBe(true);
		expect(listItemInputSchema.safeParse({ listId: "lst_1", itemId: "../x" }).success).toBe(false);
		expect(listItemInputSchema.safeParse({ listId: "lst_1", itemId: "" }).success).toBe(false);
	});
});

describe("setNoteInputSchema", () => {
	it("allows an empty note and at most 2000 characters after trimming", () => {
		expect(setNoteInputSchema.parse({ listId: "l", itemId: "lib_1", note: "  read first  " }).note).toBe("read first");
		expect(setNoteInputSchema.safeParse({ listId: "l", itemId: "lib_1", note: "" }).success).toBe(true);
		expect(setNoteInputSchema.safeParse({ listId: "l", itemId: "lib_1", note: "x".repeat(2000) }).success).toBe(true);
		expect(setNoteInputSchema.safeParse({ listId: "l", itemId: "lib_1", note: "x".repeat(2001) }).success).toBe(false);
		expect(setNoteInputSchema.safeParse({ listId: "l", itemId: "lib_1", note: `${"x".repeat(2000)}   ` }).success).toBe(true);
	});

	it("needs a string note", () => {
		expect(setNoteInputSchema.safeParse({ listId: "l", itemId: "lib_1" }).success).toBe(false);
		expect(setNoteInputSchema.safeParse({ listId: "l", itemId: "lib_1", note: 5 }).success).toBe(false);
	});
});

describe("reorderInputSchema", () => {
	it("takes the whole order, which may be empty", () => {
		expect(reorderInputSchema.parse({ listId: "l", itemIds: ["lib_2", "lib_1"] }).itemIds).toEqual(["lib_2", "lib_1"]);
		expect(reorderInputSchema.safeParse({ listId: "l", itemIds: [] }).success).toBe(true);
	});

	it("refuses a bad id and an oversized batch", () => {
		expect(reorderInputSchema.safeParse({ listId: "l", itemIds: ["lib_1", "../x"] }).success).toBe(false);
		expect(reorderInputSchema.safeParse({ listId: "l", itemIds: "lib_1" }).success).toBe(false);
		expect(reorderInputSchema.safeParse({ listId: "l", itemIds: Array.from({ length: 501 }, (_, i) => `lib_${i}`) }).success).toBe(false);
		expect(reorderInputSchema.safeParse({ listId: "l", itemIds: Array.from({ length: 500 }, (_, i) => `lib_${i}`) }).success).toBe(true);
	});
});

describe("addListCommentInputSchema", () => {
	it("trims the body and needs the anonymous flag", () => {
		expect(addListCommentInputSchema.parse({ listId: "l", anonymous: false, body: "  hi  " }).body).toBe("hi");
		expect(addListCommentInputSchema.safeParse({ listId: "l", body: "hi" }).success).toBe(false);
	});

	it("rejects an empty comment and one over 4000 characters", () => {
		expect(addListCommentInputSchema.safeParse({ listId: "l", anonymous: true, body: "   " }).success).toBe(false);
		expect(addListCommentInputSchema.safeParse({ listId: "l", anonymous: true, body: "x".repeat(4001) }).success).toBe(false);
		expect(addListCommentInputSchema.safeParse({ listId: "l", anonymous: true, body: "x".repeat(4000) }).success).toBe(true);
	});

	it("a reply may carry a parent id, a top-level comment may send none or null", () => {
		expect(addListCommentInputSchema.safeParse({ listId: "l", anonymous: false, body: "a", parentId: "llc_1" }).success).toBe(true);
		expect(addListCommentInputSchema.safeParse({ listId: "l", anonymous: false, body: "a", parentId: null }).success).toBe(true);
		expect(addListCommentInputSchema.safeParse({ listId: "l", anonymous: false, body: "a", parentId: "" }).success).toBe(false);
	});
});

describe("setCommentHiddenInputSchema", () => {
	it("needs the list, the comment and a boolean", () => {
		expect(setCommentHiddenInputSchema.safeParse({ listId: "l", commentId: "llc_1", hidden: true }).success).toBe(true);
		expect(setCommentHiddenInputSchema.safeParse({ listId: "l", commentId: "", hidden: true }).success).toBe(false);
		expect(setCommentHiddenInputSchema.safeParse({ listId: "l", commentId: "llc_1", hidden: "true" }).success).toBe(false);
	});
});

describe("setPinnedInputSchema", () => {
	it("pin order is optional and a whole number", () => {
		expect(setPinnedInputSchema.safeParse({ listId: "l", pinned: true }).success).toBe(true);
		expect(setPinnedInputSchema.safeParse({ listId: "l", pinned: true, pinOrder: 3 }).success).toBe(true);
		expect(setPinnedInputSchema.safeParse({ listId: "l", pinned: true, pinOrder: 0 }).success).toBe(true);
		expect(setPinnedInputSchema.safeParse({ listId: "l", pinned: true, pinOrder: 1.5 }).success).toBe(false);
		expect(setPinnedInputSchema.safeParse({ listId: "l", pinned: true, pinOrder: Number.NaN }).success).toBe(false);
		expect(setPinnedInputSchema.safeParse({ listId: "l", pinned: true, pinOrder: "3" }).success).toBe(false);
		expect(setPinnedInputSchema.safeParse({ listId: "l", pinned: true, pinOrder: 1e9 }).success).toBe(false);
	});
});

describe("takeDownInputSchema", () => {
	it("needs a reason of at most 500 characters", () => {
		expect(takeDownInputSchema.parse({ listId: "l", reason: "  Off topic " }).reason).toBe("Off topic");
		expect(takeDownInputSchema.safeParse({ listId: "l", reason: "  " }).success).toBe(false);
		expect(takeDownInputSchema.safeParse({ listId: "l", reason: "x".repeat(501) }).success).toBe(false);
	});
});
