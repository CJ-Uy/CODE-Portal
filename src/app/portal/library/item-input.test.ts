import { describe, expect, it } from "vitest";
import {
	confidentialityInputSchema,
	deleteInputSchema,
	keysUnderItem,
	moderateInputSchema,
	publicReadinessInputSchema,
	reportInputSchema,
	saveToNewListInputSchema,
	toggleSaveInputSchema,
} from "./item-input";

describe("keysUnderItem", () => {
	it("keeps only keys under the item's own prefix", () => {
		expect(
			keysUnderItem("lib_1", [
				"library/lib_1/mem_1/a.pdf",
				"library/lib_1/mem_2/b.png",
				"library/lib_2/mem_1/c.pdf",
				"avatars/mem_1/me.png",
				"library/lib_10/mem_1/d.pdf",
				"library/lib_1",
				"library/lib_1/",
			]),
		).toEqual(["library/lib_1/mem_1/a.pdf", "library/lib_1/mem_2/b.png"]);
	});

	it("drops traversal and duplicates", () => {
		expect(keysUnderItem("lib_1", ["library/lib_1/../lib_2/x.pdf", "library/lib_1/m/a.pdf", "library/lib_1/m/a.pdf"])).toEqual(["library/lib_1/m/a.pdf"]);
	});

	it("is empty when nothing belongs to the item", () => {
		expect(keysUnderItem("lib_1", [])).toEqual([]);
		expect(keysUnderItem("lib_1", ["library/other/x.pdf"])).toEqual([]);
	});
});

describe("toggleSaveInputSchema", () => {
	it("takes a list id or the literal saved, and a boolean", () => {
		expect(toggleSaveInputSchema.safeParse({ itemId: "lib_1", listId: "saved", saved: true }).success).toBe(true);
		expect(toggleSaveInputSchema.safeParse({ itemId: "lib_1", listId: "lst_9", saved: false }).success).toBe(true);
	});

	it("rejects a missing list, a non-boolean and an odd item id", () => {
		expect(toggleSaveInputSchema.safeParse({ itemId: "lib_1", listId: "", saved: true }).success).toBe(false);
		expect(toggleSaveInputSchema.safeParse({ itemId: "lib_1", listId: "saved", saved: "yes" }).success).toBe(false);
		expect(toggleSaveInputSchema.safeParse({ itemId: "../x", listId: "saved", saved: true }).success).toBe(false);
	});
});

describe("saveToNewListInputSchema", () => {
	it("trims the name and needs one", () => {
		expect(saveToNewListInputSchema.parse({ itemId: "lib_1", name: "  Reading  " }).name).toBe("Reading");
		expect(saveToNewListInputSchema.safeParse({ itemId: "lib_1", name: "   " }).success).toBe(false);
		expect(saveToNewListInputSchema.safeParse({ itemId: "lib_1", name: "x".repeat(101) }).success).toBe(false);
	});
});

describe("reportInputSchema", () => {
	it("needs exactly one target and a known reason", () => {
		expect(reportInputSchema.safeParse({ itemId: "lib_1", reason: "copyright" }).success).toBe(true);
		expect(reportInputSchema.safeParse({ listId: "lst_1", reason: "other", details: "why" }).success).toBe(true);
		expect(reportInputSchema.safeParse({ reason: "other" }).success).toBe(false);
		expect(reportInputSchema.safeParse({ itemId: "lib_1", listId: "lst_1", reason: "other" }).success).toBe(false);
		expect(reportInputSchema.safeParse({ itemId: "lib_1", reason: "spam" }).success).toBe(false);
	});

	it("caps the details at 1000 characters after trimming", () => {
		expect(reportInputSchema.safeParse({ itemId: "lib_1", reason: "other", details: ` ${"x".repeat(1000)} ` }).success).toBe(true);
		expect(reportInputSchema.safeParse({ itemId: "lib_1", reason: "other", details: "x".repeat(1001) }).success).toBe(false);
	});
});

describe("moderateInputSchema", () => {
	it("needs a reason to send back or take down, and trims it", () => {
		for (const action of ["send_back", "take_down"] as const) {
			expect(moderateInputSchema.safeParse({ itemId: "lib_1", action }).success).toBe(false);
			expect(moderateInputSchema.safeParse({ itemId: "lib_1", action, reason: "   " }).success).toBe(false);
			expect(moderateInputSchema.parse({ itemId: "lib_1", action, reason: "  Names a client. " }).reason).toBe("Names a client.");
		}
	});

	it("does not need one to approve or restore", () => {
		expect(moderateInputSchema.safeParse({ itemId: "lib_1", action: "approve" }).success).toBe(true);
		expect(moderateInputSchema.safeParse({ itemId: "lib_1", action: "restore" }).success).toBe(true);
	});

	it("rejects an unknown action", () => {
		expect(moderateInputSchema.safeParse({ itemId: "lib_1", action: "delete" }).success).toBe(false);
	});
});

describe("public readiness and confidentiality", () => {
	it("allows the three labels and null (unreviewed)", () => {
		for (const value of ["not_eligible", "needs_adapting", "public_ready", null]) {
			expect(publicReadinessInputSchema.safeParse({ itemId: "lib_1", value }).success).toBe(true);
		}
		expect(publicReadinessInputSchema.safeParse({ itemId: "lib_1", value: "public" }).success).toBe(false);
		expect(publicReadinessInputSchema.safeParse({ itemId: "lib_1" }).success).toBe(false);
	});

	it("never accepts public for confidentiality", () => {
		expect(confidentialityInputSchema.safeParse({ itemId: "lib_1", value: "confidential" }).success).toBe(true);
		expect(confidentialityInputSchema.safeParse({ itemId: "lib_1", value: "members" }).success).toBe(true);
		expect(confidentialityInputSchema.safeParse({ itemId: "lib_1", value: "public" }).success).toBe(false);
	});
});

describe("deleteInputSchema", () => {
	it("carries the typed title as given (the action compares it)", () => {
		expect(deleteInputSchema.parse({ itemId: "lib_1", confirmTitle: " Org Design " }).confirmTitle).toBe(" Org Design ");
		expect(deleteInputSchema.safeParse({ itemId: "lib_1" }).success).toBe(false);
	});
});
