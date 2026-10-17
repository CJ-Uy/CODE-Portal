import { describe, expect, it } from "vitest";
import {
	actionErrorMessage,
	attachFileInputSchema,
	createDraftInputSchema,
	isOwnFileKey,
	MAX_BLOCKS_BYTES,
	MAX_TAGS,
	publishInputSchema,
	publishProblems,
	saveItemInputSchema,
} from "./editor-input";

const textBlocks = (count: number, size: number) =>
	Array.from({ length: count }, (_, i) => ({ id: `blk_${i}`, type: "text" as const, props: { text: "x".repeat(size) } }));

describe("saveItemInputSchema", () => {
	it("rejects non-https links and unknown kinds in saved input", () => {
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", url: "http://x.org" }).success).toBe(false);
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", kind: "podcast" }).success).toBe(false);
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", title: "x".repeat(201) }).success).toBe(false);
	});

	it("accepts https links, clears an empty one, and refuses other schemes", () => {
		expect(saveItemInputSchema.parse({ itemId: "lib_1", url: " https://x.org/a " }).url).toBe("https://x.org/a");
		expect(saveItemInputSchema.parse({ itemId: "lib_1", url: "" }).url).toBeNull();
		expect(saveItemInputSchema.parse({ itemId: "lib_1", url: null }).url).toBeNull();
		for (const url of ["javascript:alert(1)", "ftp://x.org", "https://", "https://a b.org", "mailto:a@b.org"]) {
			expect(saveItemInputSchema.safeParse({ itemId: "lib_1", url }).success, url).toBe(false);
		}
	});

	it("needs an item and keeps untouched fields out of the output", () => {
		expect(saveItemInputSchema.safeParse({ title: "No id" }).success).toBe(false);
		expect(saveItemInputSchema.parse({ itemId: "lib_1" })).toEqual({ itemId: "lib_1" });
		expect(saveItemInputSchema.safeParse({ itemId: "../x" }).success).toBe(false);
	});

	it("trims the title and refuses a blank one", () => {
		expect(saveItemInputSchema.parse({ itemId: "lib_1", title: "  Hello  " }).title).toBe("Hello");
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", title: "   " }).success).toBe(false);
	});

	it("never lets NaN or a silly year through", () => {
		expect(saveItemInputSchema.parse({ itemId: "lib_1", year: "2024" }).year).toBe(2024);
		expect(saveItemInputSchema.parse({ itemId: "lib_1", year: 2024 }).year).toBe(2024);
		expect(saveItemInputSchema.parse({ itemId: "lib_1", year: null }).year).toBeNull();
		expect(saveItemInputSchema.parse({ itemId: "lib_1", year: "" }).year).toBeNull();
		for (const year of ["abc", Number.NaN, 1899, 2101, 2024.5, Infinity, {}, []]) {
			expect(saveItemInputSchema.safeParse({ itemId: "lib_1", year }).success, String(year)).toBe(false);
		}
	});

	it("caps tags at the repository limit", () => {
		const ids = (n: number) => Array.from({ length: n }, (_, i) => `ltg_${i}`);
		expect(MAX_TAGS).toBe(40);
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", tagIds: ids(40) }).success).toBe(true);
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", tagIds: ids(41) }).success).toBe(false);
	});

	it("validates blocks and refuses a page too large for one D1 row", () => {
		expect(MAX_BLOCKS_BYTES).toBe(1_500_000);
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", blocks: textBlocks(100, 10_000) }).success).toBe(true); // ~1.0 MB
		const tooBig = saveItemInputSchema.safeParse({ itemId: "lib_1", blocks: textBlocks(160, 10_000) }); // ~1.6 MB
		expect(tooBig.success).toBe(false);
		expect(tooBig.error?.issues[0]?.message).toMatch(/too long|too large/i);
		// Counted in bytes, not characters: 375,000 emoji is 750,000 characters but 1.5 MB of UTF-8.
		const emoji = (count: number, per: number) => textBlocks(count, 1).map((b) => ({ ...b, props: { text: "😀".repeat(per) } }));
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", blocks: emoji(100, 2_500) }).success).toBe(true);
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", blocks: emoji(150, 2_500) }).success).toBe(false);
		// Blocks go through the same schema the editor uses.
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", blocks: [{ id: "b", type: "link", props: { url: "http://x.org", title: "t" } }] }).success).toBe(false);
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", blocks: [{ id: "b", type: "mystery", props: {} }] }).success).toBe(false);
	});

	it("keeps authors short and facets inside the vocabulary", () => {
		expect(saveItemInputSchema.parse({ itemId: "lib_1", authors: [{ name: " Ana ", memberId: "mem_1" }, { name: "Bea" }] }).authors).toEqual([
			{ name: "Ana", memberId: "mem_1" },
			{ name: "Bea" },
		]);
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", authors: [{ name: "" }] }).success).toBe(false);
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", authors: Array.from({ length: 21 }, () => ({ name: "A" })) }).success).toBe(false);
		expect(saveItemInputSchema.parse({ itemId: "lib_1", subtype: "IDF", formatDetail: "SLE", engagementType: "C-Team", source: "member" })).toMatchObject({ subtype: "IDF", engagementType: "C-Team" });
		expect(saveItemInputSchema.parse({ itemId: "lib_1", subtype: null, formatDetail: null, engagementType: null })).toMatchObject({ subtype: null });
		for (const bad of [{ subtype: "Podcast" }, { formatDetail: "Webinar" }, { engagementType: "XTE" }, { source: "friends" }, { format: "audio" }]) {
			expect(saveItemInputSchema.safeParse({ itemId: "lib_1", ...bad }).success, JSON.stringify(bad)).toBe(false);
		}
	});

	it("caps the summary", () => {
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", dek: "x".repeat(500) }).success).toBe(true);
		expect(saveItemInputSchema.safeParse({ itemId: "lib_1", dek: "x".repeat(501) }).success).toBe(false);
	});
});

describe("createDraftInputSchema", () => {
	it("takes a kind, a title and an optional list, and defaults the format", () => {
		expect(createDraftInputSchema.parse({ kind: "guide", title: " My guide ", listId: "" })).toEqual({ kind: "guide", title: "My guide" });
		expect(createDraftInputSchema.parse({ kind: "guide", title: "T", listId: "lst_1" })).toMatchObject({ listId: "lst_1" });
	});

	it("only accepts a format the kind can take", () => {
		expect(createDraftInputSchema.safeParse({ kind: "reading", format: "link", title: "T" }).success).toBe(true);
		expect(createDraftInputSchema.safeParse({ kind: "case_study", format: "file", title: "T" }).success).toBe(true);
		expect(createDraftInputSchema.safeParse({ kind: "guide", format: "file", title: "T" }).success).toBe(false);
		expect(createDraftInputSchema.safeParse({ kind: "website", format: "page", title: "T" }).success).toBe(false);
		expect(createDraftInputSchema.safeParse({ kind: "podcast", title: "T" }).success).toBe(false);
		expect(createDraftInputSchema.safeParse({ kind: "guide", title: "" }).success).toBe(false);
	});
});

describe("publishInputSchema", () => {
	it("makes the client-data answer an explicit yes or no", () => {
		expect(publishInputSchema.safeParse({ itemId: "lib_1", containsClientData: false }).success).toBe(true);
		expect(publishInputSchema.safeParse({ itemId: "lib_1", containsClientData: true }).success).toBe(true);
		expect(publishInputSchema.safeParse({ itemId: "lib_1" }).success).toBe(false);
		expect(publishInputSchema.safeParse({ itemId: "lib_1", containsClientData: "false" }).success).toBe(false);
	});
});

describe("attachFileInputSchema and isOwnFileKey", () => {
	const key = "library/lib_1/mem_1/lfile_abc.pdf";
	const file = { itemId: "lib_1", key, name: "Module.pdf", type: "application/pdf", bytes: 1234 };

	it("accepts what the upload route returns", () => {
		expect(attachFileInputSchema.safeParse(file).success).toBe(true);
	});

	it("refuses a type that does not match the stored extension, a missing size and odd names", () => {
		expect(attachFileInputSchema.safeParse({ ...file, type: "text/html" }).success).toBe(false);
		expect(attachFileInputSchema.safeParse({ ...file, key: "library/lib_1/mem_1/lfile_abc.docx" }).success).toBe(false);
		expect(attachFileInputSchema.safeParse({ ...file, key: "library/lib_1/mem_1/lfile_abc.exe" }).success).toBe(false);
		expect(attachFileInputSchema.safeParse({ ...file, bytes: 0 }).success).toBe(false);
		expect(attachFileInputSchema.safeParse({ ...file, bytes: 51 * 1024 * 1024 }).success).toBe(false);
		expect(attachFileInputSchema.safeParse({ ...file, bytes: Number.NaN }).success).toBe(false);
		expect(attachFileInputSchema.safeParse({ ...file, name: "" }).success).toBe(false);
		expect(attachFileInputSchema.safeParse({ ...file, name: "x".repeat(256) }).success).toBe(false);
	});

	it("only treats the actor's own folder under the same item as theirs", () => {
		expect(isOwnFileKey(key, "lib_1", "mem_1")).toBe(true);
		expect(isOwnFileKey(key, "lib_2", "mem_1")).toBe(false); // another item
		expect(isOwnFileKey(key, "lib_1", "mem_2")).toBe(false); // another member's upload
		expect(isOwnFileKey("library/lib_1/mem_1/../mem_2/x.pdf", "lib_1", "mem_1")).toBe(false);
		expect(isOwnFileKey("avatars/mem_1/a.png", "lib_1", "mem_1")).toBe(false);
		expect(isOwnFileKey("library/lib_1/mem_1/", "lib_1", "mem_1")).toBe(false);
		expect(isOwnFileKey("library/lib_1/mem_1/a/b.pdf", "lib_1", "mem_1")).toBe(false);
	});
});

describe("publishProblems", () => {
	const ready = { title: "T", fileKey: null, url: null, blocks: [] };

	it("asks a file for its file, a link for its address and a page for some content", () => {
		expect(publishProblems({ ...ready, format: "file" })).toEqual(["Upload the file."]);
		expect(publishProblems({ ...ready, format: "file", fileKey: "library/a/b/c.pdf" })).toEqual([]);
		expect(publishProblems({ ...ready, format: "link" })).toEqual(["Add the link."]);
		expect(publishProblems({ ...ready, format: "link", url: "https://x.org" })).toEqual([]);
		expect(publishProblems({ ...ready, format: "page" })).toEqual(["Write something on the page."]);
		// A page of empty blocks is still empty; a divider or an embed counts.
		expect(publishProblems({ ...ready, format: "page", blocks: [{ id: "a", type: "text", props: { text: "  " } }] })).toHaveLength(1);
		expect(publishProblems({ ...ready, format: "page", blocks: [{ id: "a", type: "divider", props: {} }] })).toEqual([]);
	});

	it("always needs a title", () => {
		expect(publishProblems({ ...ready, format: "link", url: "https://x.org", title: "  " })).toEqual(["Add a title."]);
	});
});

describe("actionErrorMessage", () => {
	it("keeps a member-facing message and replaces the production placeholder", () => {
		expect(actionErrorMessage(new Error("Only a draft can be published."), "Try again.")).toBe("Only a draft can be published.");
		expect(actionErrorMessage(new Error("An error occurred in the Server Components render. The specific message is omitted."), "Try again.")).toBe("Try again.");
		expect(actionErrorMessage("boom", "Try again.")).toBe("Try again.");
	});
});
