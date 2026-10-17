import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createList: vi.fn(async () => "lst_new"),
	updateList: vi.fn(async () => undefined),
	deleteList: vi.fn(async () => undefined),
	setShared: vi.fn(async () => undefined),
	addEditor: vi.fn(async () => undefined),
	removeEditor: vi.fn(async () => undefined),
	removeItem: vi.fn(async () => undefined),
	setNote: vi.fn<(actor: unknown, input: unknown) => Promise<void>>(async () => undefined),
	reorder: vi.fn(async () => undefined),
	addComment: vi.fn(async () => undefined),
	setCommentHidden: vi.fn(async () => undefined),
	setPinned: vi.fn(async () => undefined),
	takeDown: vi.fn(async () => undefined),
	restore: vi.fn(async () => undefined),
	revalidatePath: vi.fn(),
	assertFeatureEnabled: vi.fn(),
	redirect: vi.fn((url: string) => {
		throw new Error(`REDIRECT ${url}`);
	}),
}));

vi.mock("@/db", () => ({
	getRepositories: async () => ({
		libraryLists: {
			createList: mocks.createList,
			updateList: mocks.updateList,
			deleteList: mocks.deleteList,
			setShared: mocks.setShared,
			addEditor: mocks.addEditor,
			removeEditor: mocks.removeEditor,
			removeItem: mocks.removeItem,
			setNote: mocks.setNote,
			reorder: mocks.reorder,
			addComment: mocks.addComment,
			setCommentHidden: mocks.setCommentHidden,
			setPinned: mocks.setPinned,
			takeDown: mocks.takeDown,
			restore: mocks.restore,
		},
	}),
}));
vi.mock("@/server/auth/actor", () => ({ requireActor: async () => ({ memberId: "mem_1", roles: ["member"] }) }));
vi.mock("@/server/features", () => ({ assertFeatureEnabled: mocks.assertFeatureEnabled }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
	addEditorAction,
	addListCommentAction,
	createListAction,
	deleteListAction,
	removeEditorAction,
	removeListItemAction,
	reorderAction,
	restoreListAction,
	setListCommentHiddenAction,
	setNoteAction,
	setPinnedAction,
	setSharedAction,
	takeDownListAction,
	updateListAction,
} from "./list-actions";

const actor = expect.objectContaining({ memberId: "mem_1" });
const paths = () => mocks.revalidatePath.mock.calls.map(([path]) => path);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("list actions: what reaches the repository", () => {
	it("createListAction trims, returns the new id and refreshes both pages", async () => {
		await expect(createListAction({ name: "  Reading pack ", description: " for new hires " })).resolves.toEqual({ listId: "lst_new" });
		expect(mocks.createList).toHaveBeenCalledWith(actor, { name: "Reading pack", description: "for new hires" });
		expect(paths()).toEqual(["/portal/library/lists", "/portal/library/lists/lst_new"]);
	});

	it("updateListAction sends only the fields that were sent", async () => {
		await updateListAction({ listId: "lst_1", name: "Renamed" });
		expect(mocks.updateList).toHaveBeenCalledWith(actor, "lst_1", { name: "Renamed" });
		expect(paths()).toEqual(["/portal/library/lists", "/portal/library/lists/lst_1"]);
	});

	it("reorderAction passes the whole new order through", async () => {
		await reorderAction({ listId: "lst_1", itemIds: ["lib_2", "lib_1", "lib_3"] });
		expect(mocks.reorder).toHaveBeenCalledWith(actor, "lst_1", ["lib_2", "lib_1", "lib_3"]);
		expect(paths()).toEqual(["/portal/library/lists", "/portal/library/lists/lst_1"]);
	});

	it("setNoteAction trims the note and allows clearing it", async () => {
		await setNoteAction({ listId: "lst_1", itemId: "lib_1", note: "  read first " });
		await setNoteAction({ listId: "lst_1", itemId: "lib_1", note: "" });
		expect(mocks.setNote.mock.calls.map(([, input]) => input)).toEqual([
			{ listId: "lst_1", itemId: "lib_1", note: "read first" },
			{ listId: "lst_1", itemId: "lib_1", note: "" },
		]);
	});

	it("removeListItemAction also refreshes the item page, which shows where it is saved", async () => {
		await removeListItemAction({ listId: "lst_1", itemId: "lib_1" });
		expect(mocks.removeItem).toHaveBeenCalledWith(actor, { listId: "lst_1", itemId: "lib_1" });
		expect(paths()).toEqual(["/portal/library/lists", "/portal/library/lists/lst_1", "/portal/library/lib_1"]);
	});

	it("the comment actions carry the anonymous flag, the parent and the hidden state", async () => {
		await addListCommentAction({ listId: "lst_1", parentId: "llc_1", anonymous: true, body: " nice " });
		expect(mocks.addComment).toHaveBeenCalledWith(actor, { listId: "lst_1", parentId: "llc_1", anonymous: true, body: "nice" });
		await setListCommentHiddenAction({ listId: "lst_1", commentId: "llc_2", hidden: true });
		expect(mocks.setCommentHidden).toHaveBeenCalledWith(actor, "llc_2", true);
	});

	it("the moderation actions pass their arguments straight through", async () => {
		await setPinnedAction({ listId: "lst_1", pinned: true, pinOrder: 2 });
		expect(mocks.setPinned).toHaveBeenCalledWith(actor, "lst_1", true, 2);
		await setPinnedAction({ listId: "lst_1", pinned: false });
		expect(mocks.setPinned).toHaveBeenLastCalledWith(actor, "lst_1", false, undefined);
		await takeDownListAction({ listId: "lst_1", reason: " off topic " });
		expect(mocks.takeDown).toHaveBeenCalledWith(actor, "lst_1", "off topic");
		await restoreListAction({ listId: "lst_1" });
		expect(mocks.restore).toHaveBeenCalledWith(actor, "lst_1");
		await setSharedAction({ listId: "lst_1", shared: true });
		expect(mocks.setShared).toHaveBeenCalledWith(actor, "lst_1", true);
		await addEditorAction({ listId: "lst_1", memberId: "mem_2" });
		expect(mocks.addEditor).toHaveBeenCalledWith(actor, "lst_1", "mem_2");
	});
});

describe("list actions: leaving and deleting", () => {
	it("deleteListAction goes back to the lists", async () => {
		await expect(deleteListAction({ listId: "lst_1" })).rejects.toThrow("REDIRECT /portal/library/lists");
		expect(mocks.deleteList).toHaveBeenCalledWith(actor, "lst_1");
		expect(paths()).toContain("/portal/library/lists/lst_1");
	});

	it("an owner removing an editor stays on the page", async () => {
		await removeEditorAction({ listId: "lst_1", memberId: "mem_2" });
		expect(mocks.removeEditor).toHaveBeenCalledWith(actor, "lst_1", "mem_2");
		expect(mocks.redirect).not.toHaveBeenCalled();
	});

	it("an editor removing themselves leaves, and goes back to the lists", async () => {
		await expect(removeEditorAction({ listId: "lst_1", memberId: "mem_1" })).rejects.toThrow("REDIRECT /portal/library/lists");
		expect(mocks.removeEditor).toHaveBeenCalledWith(actor, "lst_1", "mem_1");
	});

	it("nothing is redirected when the repository refuses", async () => {
		mocks.removeEditor.mockRejectedValueOnce(new Error("Only the list owner can remove editors."));
		await expect(removeEditorAction({ listId: "lst_1", memberId: "mem_1" })).rejects.toThrow("Only the list owner");
		mocks.deleteList.mockRejectedValueOnce(new Error("The Saved list can't be deleted."));
		await expect(deleteListAction({ listId: "lst_saved" })).rejects.toThrow("Saved list");
		expect(mocks.redirect).not.toHaveBeenCalled();
	});
});

describe("list actions: input that must not get through", () => {
	it("bad input never reaches a repository and names the first problem", async () => {
		await expect(createListAction({ name: "   " })).rejects.toThrow("A list name is required.");
		await expect(updateListAction({ listId: "lst_1", color: "red" })).rejects.toThrow("Use a color like #0c315c.");
		await expect(setNoteAction({ listId: "lst_1", itemId: "lib_1", note: "x".repeat(2001) })).rejects.toThrow("at most 2000");
		await expect(reorderAction({ listId: "lst_1", itemIds: ["../x"] })).rejects.toThrow();
		await expect(addListCommentAction({ listId: "lst_1", anonymous: false, body: "  " })).rejects.toThrow("Write something first.");
		await expect(takeDownListAction({ listId: "lst_1", reason: "" })).rejects.toThrow("A reason is required.");
		await expect(setPinnedAction({ listId: "lst_1", pinned: true, pinOrder: 1.5 })).rejects.toThrow("whole number");
		await expect(setSharedAction({ listId: "", shared: true })).rejects.toThrow();
		for (const mock of [mocks.createList, mocks.updateList, mocks.setNote, mocks.reorder, mocks.addComment, mocks.takeDown, mocks.setPinned, mocks.setShared]) {
			expect(mock).not.toHaveBeenCalled();
		}
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("every action checks the feature flag first", async () => {
		mocks.assertFeatureEnabled.mockImplementation(() => {
			throw new Error("Library is off.");
		});
		await expect(createListAction({ name: "x" })).rejects.toThrow("Library is off.");
		await expect(reorderAction({ listId: "lst_1", itemIds: [] })).rejects.toThrow("Library is off.");
		await expect(takeDownListAction({ listId: "lst_1", reason: "x" })).rejects.toThrow("Library is off.");
		expect(mocks.createList).not.toHaveBeenCalled();
		expect(mocks.reorder).not.toHaveBeenCalled();
		expect(mocks.takeDown).not.toHaveBeenCalled();
		mocks.assertFeatureEnabled.mockReset();
	});

	it("a repository refusal reaches the caller untouched and skips the refresh", async () => {
		mocks.setShared.mockRejectedValueOnce(new Error("This list was taken down by a moderator, so it can't be shared."));
		await expect(setSharedAction({ listId: "lst_1", shared: true })).rejects.toThrow("taken down by a moderator");
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});
});
