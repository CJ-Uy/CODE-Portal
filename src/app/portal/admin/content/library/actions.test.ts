import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	roles: ["publishing"] as string[],
	featureOn: true,
	moderate: vi.fn(async () => undefined),
	resolveReport: vi.fn(async () => undefined),
	moderationQueue: vi.fn(),
	restore: vi.fn(async () => undefined),
	renameTag: vi.fn(async () => undefined),
	regroupTag: vi.fn(async () => undefined),
	mergeTags: vi.fn(async () => undefined),
	deleteTag: vi.fn(async () => undefined),
	revalidatePath: vi.fn(),
}));

vi.mock("@/db", () => ({
	getRepositories: async () => ({
		library: { moderate: mocks.moderate, resolveReport: mocks.resolveReport, moderationQueue: mocks.moderationQueue },
		libraryLists: { restore: mocks.restore },
		libraryTags: { renameTag: mocks.renameTag, regroupTag: mocks.regroupTag, mergeTags: mocks.mergeTags, deleteTag: mocks.deleteTag },
	}),
}));
vi.mock("@/server/auth/actor", () => ({ requireActor: async () => ({ memberId: "mem_1", roles: mocks.roles }) }));
vi.mock("@/server/features", () => ({
	assertFeatureEnabled: () => {
		if (!mocks.featureOn) throw new Error("Feature disabled");
	},
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
	approveItemAction,
	closeReportAction,
	deleteTagAction,
	dismissReportAction,
	mergeTagsAction,
	regroupTagAction,
	renameTagAction,
	restoreItemAction,
	restoreListFromQueueAction,
	sendBackItemAction,
	takeDownReportAction,
} from "./actions";

const PAGE = "/portal/admin/content/library";
const paths = () => mocks.revalidatePath.mock.calls.map(([path]) => path as string);

beforeEach(() => {
	vi.clearAllMocks();
	mocks.roles = ["publishing"];
	mocks.featureOn = true;
	mocks.moderationQueue.mockResolvedValue({
		pending: [],
		takenDown: [],
		takenDownLists: [],
		reports: [
			{ id: "lrp_item", itemId: "lib_9", listId: null, targetTitle: "An item" },
			{ id: "lrp_list", itemId: null, listId: "lst_9", targetTitle: "A list" },
		],
	});
});

describe("who may call these", () => {
	it("turns away a member before any repository call, and a disabled library before that", async () => {
		mocks.roles = ["member"];
		await expect(approveItemAction({ itemId: "lib_1" })).rejects.toThrow("Not authorized");
		await expect(renameTagAction({ tagId: "ltg_1", name: "New" })).rejects.toThrow("Not authorized");
		await expect(dismissReportAction({ reportId: "lrp_item" })).rejects.toThrow("Not authorized");
		await expect(closeReportAction({ reportId: "lrp_item" })).rejects.toThrow("Not authorized");
		mocks.roles = ["publishing"];
		mocks.featureOn = false;
		await expect(approveItemAction({ itemId: "lib_1" })).rejects.toThrow("Feature disabled");
		for (const mock of [mocks.moderate, mocks.resolveReport, mocks.moderationQueue, mocks.renameTag]) expect(mock).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});
});

describe("item actions", () => {
	it("approve and restore call the repository and refresh this page and the item", async () => {
		await approveItemAction({ itemId: "lib_1" });
		expect(mocks.moderate).toHaveBeenLastCalledWith(expect.objectContaining({ memberId: "mem_1" }), "lib_1", "approve");
		expect(paths()).toEqual([PAGE, "/portal/library/lib_1", "/portal/library", "/portal/library/lists", "/portal/library/mine"]);
		await restoreItemAction({ itemId: "lib_2" });
		expect(mocks.moderate).toHaveBeenLastCalledWith(expect.anything(), "lib_2", "restore");
	});

	it("send back needs a reason of at most 500 characters and sends it trimmed", async () => {
		await expect(sendBackItemAction({ itemId: "lib_1", reason: "  " })).rejects.toThrow("A reason is required.");
		await expect(sendBackItemAction({ itemId: "lib_1", reason: "x".repeat(501) })).rejects.toThrow("at most 500");
		expect(mocks.moderate).not.toHaveBeenCalled();
		await sendBackItemAction({ itemId: "lib_1", reason: "  Add a source. " });
		expect(mocks.moderate).toHaveBeenCalledWith(expect.anything(), "lib_1", "send_back", "Add a source.");
	});

	it("rejects an id that is not an item id before anything runs", async () => {
		await expect(approveItemAction({ itemId: "../x" })).rejects.toThrow("Unknown library item.");
		expect(mocks.moderate).not.toHaveBeenCalled();
	});

	it("does not refresh anything when the repository refuses", async () => {
		mocks.moderate.mockRejectedValueOnce(new Error("Cannot approve an item that is published."));
		await expect(approveItemAction({ itemId: "lib_1" })).rejects.toThrow("Cannot approve");
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});
});

describe("restoreListFromQueueAction", () => {
	it("restores and refreshes this page and the list, without sending the moderator anywhere", async () => {
		await restoreListFromQueueAction({ listId: "lst_1" });
		expect(mocks.restore).toHaveBeenCalledWith(expect.anything(), "lst_1");
		expect(paths()).toEqual([PAGE, "/portal/library", "/portal/library/lists", "/portal/library/lists/lst_1"]);
	});
});

describe("report actions", () => {
	it("dismiss resolves the report and refreshes the item it belongs to", async () => {
		await dismissReportAction({ reportId: "lrp_item" });
		expect(mocks.resolveReport).toHaveBeenCalledWith(expect.anything(), "lrp_item", "dismissed", undefined);
		expect(paths()).toContain("/portal/library/lib_9");
	});

	it("take down on a list report passes the reason and refreshes that list", async () => {
		await takeDownReportAction({ reportId: "lrp_list", reason: " Spam " });
		expect(mocks.resolveReport).toHaveBeenCalledWith(expect.anything(), "lrp_list", "taken_down", "Spam");
		expect(paths()).toContain("/portal/library/lists/lst_9");
	});

	it("close resolves a report on something already out of view without a reason, and refreshes it", async () => {
		await closeReportAction({ reportId: "lrp_item" });
		expect(mocks.resolveReport).toHaveBeenCalledWith(expect.anything(), "lrp_item", "taken_down", undefined);
		expect(paths()).toEqual([PAGE, "/portal/library/lib_9", "/portal/library", "/portal/library/lists", "/portal/library/mine"]);
	});

	it("close cannot take down something still live: the repository refuses it without a reason", async () => {
		mocks.resolveReport.mockRejectedValueOnce(new Error("A reason is required."));
		await expect(closeReportAction({ reportId: "lrp_item" })).rejects.toThrow("A reason is required.");
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("take down needs a reason", async () => {
		await expect(takeDownReportAction({ reportId: "lrp_item", reason: "" })).rejects.toThrow("A reason is required.");
		expect(mocks.resolveReport).not.toHaveBeenCalled();
	});

	it("refuses a report that is not in the open queue, so a crafted id never reaches the repository", async () => {
		await expect(dismissReportAction({ reportId: "lrp_gone" })).rejects.toThrow("already resolved");
		await expect(closeReportAction({ reportId: "lrp_gone" })).rejects.toThrow("already resolved");
		expect(mocks.resolveReport).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});
});

describe("tag actions", () => {
	it("rename, regroup, merge and delete go to the repository and refresh the page and the library", async () => {
		await renameTagAction({ tagId: "ltg_1", name: "  New name " });
		expect(mocks.renameTag).toHaveBeenCalledWith(expect.anything(), "ltg_1", "New name");
		await regroupTagAction({ tagId: "ltg_1", groupName: "" });
		expect(mocks.regroupTag).toHaveBeenCalledWith(expect.anything(), "ltg_1", "");
		await mergeTagsAction({ fromId: "ltg_1", intoId: "ltg_2" });
		expect(mocks.mergeTags).toHaveBeenCalledWith(expect.anything(), "ltg_1", "ltg_2");
		await deleteTagAction({ tagId: "ltg_2" });
		expect(mocks.deleteTag).toHaveBeenCalledWith(expect.anything(), "ltg_2");
		expect(mocks.revalidatePath.mock.calls).toEqual([
			[PAGE],
			["/portal/library", "layout"],
			[PAGE],
			["/portal/library", "layout"],
			[PAGE],
			["/portal/library", "layout"],
			[PAGE],
			["/portal/library", "layout"],
		]);
	});

	it("checks names and ids first", async () => {
		await expect(renameTagAction({ tagId: "ltg_1", name: "" })).rejects.toThrow("A tag name is required.");
		await expect(renameTagAction({ tagId: "ltg_1", name: "x".repeat(61) })).rejects.toThrow("at most 60");
		await expect(mergeTagsAction({ fromId: "ltg_1", intoId: "ltg_1" })).rejects.toThrow("Pick two different tags");
		await expect(deleteTagAction({ tagId: "" })).rejects.toThrow();
		for (const mock of [mocks.renameTag, mocks.mergeTags, mocks.deleteTag]) expect(mock).not.toHaveBeenCalled();
	});
});
