import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getItem: vi.fn(),
	updateItem: vi.fn(async () => ({})),
	setItemTags: vi.fn(async () => undefined),
	redirect: vi.fn((url: string) => {
		throw new Error(`REDIRECT ${url}`);
	}),
}));

vi.mock("@/db", () => ({
	getRepositories: async () => ({
		library: { getItem: mocks.getItem, updateItem: mocks.updateItem },
		libraryTags: { setItemTags: mocks.setItemTags },
	}),
}));
vi.mock("@/server/auth/actor", () => ({ requireActor: async () => ({ memberId: "mem_1", roles: ["member"] }) }));
vi.mock("@/server/features", () => ({ assertFeatureEnabled: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { createDraftAction, saveItemAction } from "./editor-actions";

const item = (over: object) => ({
	id: "lib_1",
	canEdit: true,
	status: "published",
	format: "link",
	title: "Title",
	fileKey: null,
	url: "https://x.org",
	blocksJson: [],
	...over,
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe("saveItemAction on a live item", () => {
	it("refuses to clear the link of a published link item and writes nothing", async () => {
		mocks.getItem.mockResolvedValue(item({}));
		expect(await saveItemAction({ itemId: "lib_1", url: null })).toEqual({ ok: false, error: "Add the link." });
		expect(mocks.updateItem).not.toHaveBeenCalled();
	});

	it("refuses to empty a published page", async () => {
		mocks.getItem.mockResolvedValue(item({ format: "page", url: null, blocksJson: [{ id: "a", type: "text", props: { text: "Body" } }] }));
		expect(await saveItemAction({ itemId: "lib_1", blocks: [] })).toEqual({ ok: false, error: "Write something on the page." });
		expect(mocks.updateItem).not.toHaveBeenCalled();
	});

	it("allows the same clearing on a draft", async () => {
		mocks.getItem.mockResolvedValue(item({ status: "draft" }));
		expect(await saveItemAction({ itemId: "lib_1", url: null })).toEqual({ ok: true });
		expect(mocks.updateItem).toHaveBeenCalledWith(expect.anything(), "lib_1", { url: null });
	});

	it("saves an ordinary edit of a live item, without reading it first", async () => {
		expect(await saveItemAction({ itemId: "lib_1", dek: "New summary", tagIds: ["ltg_1"] })).toEqual({ ok: true });
		expect(mocks.getItem).not.toHaveBeenCalled();
		expect(mocks.updateItem).toHaveBeenCalledWith(expect.anything(), "lib_1", { dek: "New summary" });
		expect(mocks.setItemTags).toHaveBeenCalledWith(expect.anything(), "lib_1", ["ltg_1"]);
	});

	it("will not take a bare format change, which would swap a live item's body", async () => {
		const result = await saveItemAction({ itemId: "lib_1", format: "file" });
		expect(result.ok).toBe(false);
		expect(mocks.updateItem).not.toHaveBeenCalled();
	});

	it("says an item it cannot edit is not found", async () => {
		mocks.getItem.mockResolvedValue(item({ canEdit: false }));
		expect(await saveItemAction({ itemId: "lib_1", url: null })).toEqual({ ok: false, error: "Library item not found." });
	});
});

describe("createDraftAction", () => {
	const form = (fields: Record<string, string>) => {
		const data = new FormData();
		for (const [key, value] of Object.entries(fields)) data.set(key, value);
		return data;
	};

	it("sends a whitespace-only title back to the form with a code, not an error page", async () => {
		await expect(createDraftAction(form({ kind: "guide", format: "page", title: "   ", listId: "lst_1" }))).rejects.toThrow(
			"REDIRECT /portal/library/new?problem=title&for=page&list=lst_1",
		);
	});

	it("never puts a list id it does not trust into the link", async () => {
		await expect(createDraftAction(form({ kind: "guide", format: "page", title: "", listId: "x&problem=evil" }))).rejects.toThrow(
			"REDIRECT /portal/library/new?problem=title&for=page",
		);
	});
});
