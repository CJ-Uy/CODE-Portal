import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getItem: vi.fn(),
	deleteItem: vi.fn(),
	report: vi.fn(async () => undefined),
	moderate: vi.fn(async () => undefined),
	ensureSaved: vi.fn(async () => "lst_saved_mem_1"),
	addItem: vi.fn(async () => undefined),
	removeItem: vi.fn(async () => undefined),
	deleteObject: vi.fn<(key: string) => Promise<void>>(async () => undefined),
	scheduleLibraryIndex: vi.fn(),
	redirect: vi.fn((url: string) => {
		throw new Error(`REDIRECT ${url}`);
	}),
}));

vi.mock("@/db", () => ({
	getRepositories: async () => ({
		library: { getItem: mocks.getItem, deleteItem: mocks.deleteItem, report: mocks.report, moderate: mocks.moderate },
		libraryLists: { ensureSaved: mocks.ensureSaved, addItem: mocks.addItem, removeItem: mocks.removeItem },
	}),
}));
vi.mock("@/storage", () => ({ getStorageAdapter: async () => ({ deleteObject: mocks.deleteObject }) }));
vi.mock("@/server/auth/actor", () => ({ requireActor: async () => ({ memberId: "mem_1", roles: ["library_admin"] }) }));
vi.mock("@/server/features", () => ({ assertFeatureEnabled: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/library/indexer", () => ({ scheduleLibraryIndex: mocks.scheduleLibraryIndex }));

import { deleteItemAction, moderateItemAction, reportAction, toggleSaveAction } from "./item-actions";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getItem.mockResolvedValue({ id: "lib_1", title: "Org Design Basics" });
});

describe("deleteItemAction", () => {
	it("deletes only the objects under the item's own prefix, then goes to the library", async () => {
		mocks.deleteItem.mockResolvedValue({
			fileKeys: ["library/lib_1/mem_2/file.pdf", "library/lib_2/mem_3/theirs.pdf", "avatars/mem_1/me.png", "library/lib_1/mem_2/figure.png"],
		});
		await expect(deleteItemAction({ itemId: "lib_1", confirmTitle: "Org Design Basics" })).rejects.toThrow("REDIRECT /portal/library");
		expect(mocks.deleteObject.mock.calls.map(([key]) => key)).toEqual(["library/lib_1/mem_2/file.pdf", "library/lib_1/mem_2/figure.png"]);
		expect(mocks.scheduleLibraryIndex).toHaveBeenCalledWith("lib_1", "deindex");
	});

	it("needs the title typed exactly (surrounding spaces aside) and deletes nothing otherwise", async () => {
		await expect(deleteItemAction({ itemId: "lib_1", confirmTitle: "org design basics" })).rejects.toThrow("Type the title exactly");
		await expect(deleteItemAction({ itemId: "lib_1", confirmTitle: "" })).rejects.toThrow("Type the title exactly");
		expect(mocks.deleteItem).not.toHaveBeenCalled();
		expect(mocks.deleteObject).not.toHaveBeenCalled();

		mocks.deleteItem.mockResolvedValue({ fileKeys: [] });
		await expect(deleteItemAction({ itemId: "lib_1", confirmTitle: "  Org Design Basics " })).rejects.toThrow("REDIRECT");
		expect(mocks.deleteItem).toHaveBeenCalledOnce();
	});

	it("reads an item the actor cannot see as not found, before any title check", async () => {
		mocks.getItem.mockResolvedValue(null);
		await expect(deleteItemAction({ itemId: "lib_1", confirmTitle: "x" })).rejects.toThrow("Library item not found.");
		expect(mocks.deleteItem).not.toHaveBeenCalled();
	});

	it("does not touch storage when the repository refuses (no library:manage)", async () => {
		mocks.deleteItem.mockRejectedValue(new Error("Not authorized to manage the library."));
		await expect(deleteItemAction({ itemId: "lib_1", confirmTitle: "Org Design Basics" })).rejects.toThrow("Not authorized");
		expect(mocks.deleteObject).not.toHaveBeenCalled();
	});

	it("still finishes when a storage delete fails", async () => {
		mocks.deleteItem.mockResolvedValue({ fileKeys: ["library/lib_1/mem_2/file.pdf", "library/lib_1/mem_2/figure.png"] });
		mocks.deleteObject.mockRejectedValueOnce(new Error("R2 down"));
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(deleteItemAction({ itemId: "lib_1", confirmTitle: "Org Design Basics" })).rejects.toThrow("REDIRECT /portal/library");
		expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
		expect(log).toHaveBeenCalledOnce();
		log.mockRestore();
	});
});

describe("toggleSaveAction", () => {
	it("resolves 'saved' to the member's default list, creating it on first use", async () => {
		await toggleSaveAction({ itemId: "lib_1", listId: "saved", saved: true });
		expect(mocks.ensureSaved).toHaveBeenCalledOnce();
		expect(mocks.addItem).toHaveBeenCalledWith(expect.anything(), { listId: "lst_saved_mem_1", itemId: "lib_1" });
	});

	it("adds to and removes from a named list without touching Saved", async () => {
		await toggleSaveAction({ itemId: "lib_1", listId: "lst_9", saved: true });
		await toggleSaveAction({ itemId: "lib_1", listId: "lst_9", saved: false });
		expect(mocks.ensureSaved).not.toHaveBeenCalled();
		expect(mocks.addItem).toHaveBeenCalledWith(expect.anything(), { listId: "lst_9", itemId: "lib_1" });
		expect(mocks.removeItem).toHaveBeenCalledWith(expect.anything(), { listId: "lst_9", itemId: "lib_1" });
	});

	it("rejects bad input before any repository call", async () => {
		await expect(toggleSaveAction({ itemId: "../x", listId: "saved", saved: true })).rejects.toThrow();
		await expect(toggleSaveAction({ itemId: "lib_1", listId: "", saved: true })).rejects.toThrow();
		expect(mocks.addItem).not.toHaveBeenCalled();
	});
});

describe("reportAction and moderateItemAction", () => {
	it("reports with a known reason and trimmed details", async () => {
		await reportAction({ itemId: "lib_1", reason: "copyright", details: "  the scan is from a book  " });
		expect(mocks.report).toHaveBeenCalledWith(expect.anything(), { itemId: "lib_1", reason: "copyright", details: "the scan is from a book" });
		await expect(reportAction({ itemId: "lib_1", reason: "spam" })).rejects.toThrow();
		await expect(reportAction({ reason: "other" })).rejects.toThrow("Report one item or one list.");
		expect(mocks.report).toHaveBeenCalledOnce();
	});

	it("will not send back or take down without a reason", async () => {
		await expect(moderateItemAction({ itemId: "lib_1", action: "take_down" })).rejects.toThrow("A reason is required.");
		await expect(moderateItemAction({ itemId: "lib_1", action: "send_back", reason: "  " })).rejects.toThrow("A reason is required.");
		expect(mocks.moderate).not.toHaveBeenCalled();
		await moderateItemAction({ itemId: "lib_1", action: "take_down", reason: " Names a client. " });
		expect(mocks.moderate).toHaveBeenCalledWith(expect.anything(), "lib_1", "take_down", "Names a client.");
	});

	it("drops a taken-down item from the smart-search index and re-reads a restored one", async () => {
		await moderateItemAction({ itemId: "lib_1", action: "take_down", reason: "Names a client." });
		await moderateItemAction({ itemId: "lib_2", action: "restore" });
		await moderateItemAction({ itemId: "lib_3", action: "send_back", reason: "Needs a summary." });
		expect(mocks.scheduleLibraryIndex.mock.calls).toEqual([
			["lib_1", "deindex"],
			["lib_2", "index"],
		]);
	});
});
