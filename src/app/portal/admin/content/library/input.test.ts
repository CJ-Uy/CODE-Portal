import { describe, expect, it } from "vitest";
import {
	deleteTagInputSchema,
	itemInputSchema,
	itemReasonInputSchema,
	listInputSchema,
	mergeTagsInputSchema,
	noticeText,
	parseTab,
	regroupTagInputSchema,
	renameTagInputSchema,
	reportInputSchema,
	reportReasonInputSchema,
	TABS,
} from "./input";

describe("parseTab", () => {
	it("knows the five tabs", () => {
		expect(TABS.map((tab) => tab.key)).toEqual(["waiting", "reports", "taken-down", "tags", "search-index"]);
		for (const tab of TABS) expect(parseTab(tab.key)).toBe(tab.key);
	});

	it("falls back to the first tab for anything else", () => {
		for (const value of [undefined, "", "Tags", "nope", "__proto__", "constructor", ["tags", "reports"]]) expect(parseTab(value)).toBe("waiting");
	});
});

describe("noticeText", () => {
	it("words only the fixed codes", () => {
		expect(noticeText("list-restored")).toMatch(/restored/);
	});

	it("never reflects what the link says", () => {
		for (const value of [undefined, "", "<b>hi</b>", "You have won", "__proto__", "constructor", "toString", "hasOwnProperty", ["list-restored"]]) expect(noticeText(value)).toBeNull();
	});
});

describe("reasons", () => {
	it("are required and trimmed for send back and take down", () => {
		expect(itemReasonInputSchema.safeParse({ itemId: "lib_1", reason: "   " }).success).toBe(false);
		expect(itemReasonInputSchema.safeParse({ itemId: "lib_1" }).success).toBe(false);
		expect(reportReasonInputSchema.safeParse({ reportId: "lrp_1", reason: "" }).success).toBe(false);
		expect(itemReasonInputSchema.parse({ itemId: "lib_1", reason: "  Needs a source.  " })).toEqual({ itemId: "lib_1", reason: "Needs a source." });
	});

	it("top out at 500 characters", () => {
		expect(itemReasonInputSchema.safeParse({ itemId: "lib_1", reason: "x".repeat(500) }).success).toBe(true);
		const tooLong = reportReasonInputSchema.safeParse({ reportId: "lrp_1", reason: "x".repeat(501) });
		expect(tooLong.success).toBe(false);
		expect(tooLong.error?.issues[0]?.message).toBe("A reason can be at most 500 characters.");
	});
});

describe("ids", () => {
	it("must be present and sane", () => {
		expect(itemInputSchema.safeParse({ itemId: "" }).success).toBe(false);
		expect(itemInputSchema.safeParse({ itemId: "../etc" }).success).toBe(false);
		expect(itemInputSchema.safeParse({ itemId: "lib_1" }).success).toBe(true);
		expect(listInputSchema.safeParse({ listId: "" }).success).toBe(false);
		expect(reportInputSchema.safeParse({ reportId: "x".repeat(121) }).success).toBe(false);
		expect(deleteTagInputSchema.safeParse({ tagId: 7 }).success).toBe(false);
	});
});

describe("tag inputs", () => {
	it("need a name, at most 60 characters, and trim it", () => {
		expect(renameTagInputSchema.safeParse({ tagId: "ltg_1", name: "  " }).success).toBe(false);
		expect(renameTagInputSchema.safeParse({ tagId: "ltg_1", name: "x".repeat(61) }).success).toBe(false);
		expect(renameTagInputSchema.parse({ tagId: "ltg_1", name: "  Org Design " }).name).toBe("Org Design");
	});

	it("let a group be emptied (back to Ungrouped) but not overlong", () => {
		expect(regroupTagInputSchema.parse({ tagId: "ltg_1", groupName: "   " }).groupName).toBe("");
		expect(regroupTagInputSchema.safeParse({ tagId: "ltg_1", groupName: "g".repeat(61) }).success).toBe(false);
	});

	it("refuse to merge a tag into itself", () => {
		expect(mergeTagsInputSchema.safeParse({ fromId: "ltg_1", intoId: "ltg_1" }).success).toBe(false);
		expect(mergeTagsInputSchema.safeParse({ fromId: "ltg_1", intoId: "ltg_2" }).success).toBe(true);
	});
});
