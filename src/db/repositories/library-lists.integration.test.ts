import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs, libraryListComments, libraryListItems, libraryListMembers, libraryLists } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createLibraryRepository } from "./library";
import { createLibraryListsRepository } from "./library-lists";
import type { LibraryListView } from "./library-lists";
import { actors, insertItem, resetLibrary, seedMembers } from "./library-test-fixtures";

const db = drizzle(env.DB, { schema });
const audit = createAuditRepository(db);
const repo = createLibraryRepository(db, audit);
const lists = createLibraryListsRepository(db, audit);

// A signed-in member with no relationship to the lists below.
const viewer: Actor = { memberId: "viewer", roles: ["member"] };

// Comments posted in the same millisecond have no defined order, so tests compare them sorted by body.
const byBody = <T extends { body: string }>(rows: T[]) => [...rows].sort((a, b) => a.body.localeCompare(b.body));

const order = (view: LibraryListView | null) => (view?.items ?? []).map((item) => (item.available ? item.card.id : item.itemId));

async function auditRows() {
	const rows = await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
	return rows.map((row) => ({ action: row.action, targetType: row.targetType, targetId: row.targetId, category: row.category, detail: row.detail, targetMemberId: row.targetMemberId }));
}

/** A shared list owned by `owner` with `other` as editor. */
async function sharedPack(): Promise<string> {
	const listId = await lists.createList(actors.owner, { name: "Pack" });
	await lists.addEditor(actors.owner, listId, "other");
	await lists.setShared(actors.owner, listId, true);
	return listId;
}

beforeEach(async () => {
	await resetLibrary();
	await seedMembers(["owner", "other", "moderator", "viewer"]);
});

describe("library lists: visibility", () => {
	it("shows hidden items as unavailable placeholders to viewers", async () => {
		const listId = await lists.createList(actors.owner, { name: "STE pack" });
		const pub = await insertItem({ title: "Pub" });
		const draft = await insertItem({ title: "Mine", status: "draft", createdBy: "owner" });
		await lists.addItem(actors.owner, { listId, itemId: pub });
		await lists.addItem(actors.owner, { listId, itemId: draft });
		await lists.setShared(actors.owner, listId, true);
		const view = await lists.getList(actors.other, listId);
		expect(view?.items.map((i) => i.available)).toEqual([true, false]);
		// A placeholder carries nothing about the item beyond its id and slot.
		expect(view?.items[1]).toEqual({ available: false, itemId: draft, position: 1 });
		// The owner can open their own draft.
		expect((await lists.getList(actors.owner, listId))?.items.map((i) => i.available)).toEqual([true, true]);
	});

	it("treats confidential, pending and taken-down items as unavailable to members", async () => {
		const listId = await sharedPack();
		await lists.addEditor(actors.owner, listId, "moderator");
		const ok = await insertItem({});
		const secret = await insertItem({ confidentiality: "confidential" });
		const pending = await insertItem({ status: "pending_review", createdBy: "owner" });
		const down = await insertItem({ status: "taken_down" });
		// The moderator sees everything, so can file all four.
		for (const itemId of [ok, secret, pending, down]) await lists.addItem(actors.moderator, { listId, itemId });
		expect((await lists.getList(viewer, listId))?.items.map((i) => i.available)).toEqual([true, false, false, false]);
		expect((await lists.getList(actors.moderator, listId))?.items.map((i) => i.available)).toEqual([true, true, true, true]);
	});

	it("unshared lists are invisible to non-members", async () => {
		const listId = await lists.createList(actors.owner, { name: "Private" });
		expect(await lists.getList(actors.other, listId)).toBeNull();
		expect(await lists.getList(actors.owner, "lst_missing")).toBeNull();
	});

	it("shows an unshared list to its owner and editors, and a shared list to any member", async () => {
		const listId = await lists.createList(actors.owner, { name: "Pack" });
		await lists.addEditor(actors.owner, listId, "other");
		expect((await lists.getList(actors.owner, listId))?.role).toBe("owner");
		expect((await lists.getList(actors.other, listId))?.role).toBe("editor");
		expect(await lists.getList(viewer, listId)).toBeNull();
		await lists.setShared(actors.owner, listId, true);
		expect((await lists.getList(viewer, listId))?.role).toBe("viewer");
	});

	it("describes the list with owner, editors, notes and who added each item", async () => {
		const listId = await sharedPack();
		const itemId = await insertItem({ title: "Deck" });
		await lists.addItem(actors.other, { listId, itemId, note: "  start here  " });
		const view = await lists.getList(viewer, listId);
		expect(view).toMatchObject({ id: listId, name: "Pack", ownerName: "owner", shared: true, isDefault: false, itemCount: 1, moderationReason: null });
		expect(view?.editors).toEqual([{ memberId: "other", name: "other" }]);
		const [row] = view!.items;
		expect(row).toMatchObject({ available: true, note: "start here", addedByName: "other", position: 0 });
		expect(row.available && row.addedAt).toBeInstanceOf(Date);
		expect(row.available && row.card.title).toBe("Deck");
	});

	it("loads cards for lists longer than one bind chunk", async () => {
		const listId = await lists.createList(actors.owner, { name: "Long" });
		const ids: string[] = [];
		for (let i = 0; i < 45; i++) ids.push(await insertItem({ title: `Doc ${i}`, searchText: "x" }));
		for (const itemId of ids) await lists.addItem(actors.owner, { listId, itemId });
		const view = await lists.getList(actors.owner, listId);
		expect(order(view)).toEqual(ids);
		expect(view?.items.every((item) => item.available)).toBe(true);
	});
});

describe("library lists: editing", () => {
	it("editors add and reorder; unknown ids are ignored and positions stay dense", async () => {
		const listId = await lists.createList(actors.owner, { name: "Pack" });
		await lists.addEditor(actors.owner, listId, "other");
		const [a, b, c] = [await insertItem({}), await insertItem({}), await insertItem({})];
		for (const id of [a, b, c]) await lists.addItem(actors.other, { listId, itemId: id });
		await lists.reorder(actors.other, listId, [c, "nope", a]);
		const view = await lists.getList(actors.owner, listId);
		expect(view?.items.map((i) => (i.available ? i.card.id : i.itemId))).toEqual([c, a, b]);
		expect(view?.items.map((i) => i.position)).toEqual([0, 1, 2]);
	});

	it("reorder repairs gaps left by removals and ignores repeated ids", async () => {
		const listId = await lists.createList(actors.owner, { name: "Pack" });
		const [a, b, c, d] = [await insertItem({}), await insertItem({}), await insertItem({}), await insertItem({})];
		for (const id of [a, b, c, d]) await lists.addItem(actors.owner, { listId, itemId: id });
		await lists.removeItem(actors.owner, { listId, itemId: b });
		await lists.reorder(actors.owner, listId, [d, d, a]);
		const view = await lists.getList(actors.owner, listId);
		expect(order(view)).toEqual([d, a, c]);
		expect(view?.items.map((i) => i.position)).toEqual([0, 1, 2]);
		await lists.reorder(actors.owner, listId, []);
		expect(order(await lists.getList(actors.owner, listId))).toEqual([d, a, c]);
	});

	it("concurrent reorders leave one complete order with dense positions", async () => {
		const listId = await sharedPack();
		const [a, b, c] = [await insertItem({}), await insertItem({}), await insertItem({})];
		for (const id of [a, b, c]) await lists.addItem(actors.owner, { listId, itemId: id });
		await Promise.all([lists.reorder(actors.owner, listId, [c, b, a]), lists.reorder(actors.other, listId, [b, a, c])]);
		const view = await lists.getList(actors.owner, listId);
		expect(view?.items.map((i) => i.position)).toEqual([0, 1, 2]);
		expect([[c, b, a], [b, a, c]]).toContainEqual(order(view));
	});

	it("appends new items at the end and ignores a second add of the same item", async () => {
		const listId = await lists.createList(actors.owner, { name: "Pack" });
		const [a, b] = [await insertItem({}), await insertItem({})];
		await lists.addItem(actors.owner, { listId, itemId: a, note: "first" });
		await lists.addItem(actors.owner, { listId, itemId: b });
		await lists.addItem(actors.owner, { listId, itemId: a, note: "again" });
		const view = await lists.getList(actors.owner, listId);
		expect(order(view)).toEqual([a, b]);
		expect(view?.items[0]).toMatchObject({ note: "first", position: 0 });
		expect(view?.items[1]).toMatchObject({ note: "", position: 1 });
	});

	it("removes items and sets notes", async () => {
		const listId = await lists.createList(actors.owner, { name: "Pack" });
		const [a, b] = [await insertItem({}), await insertItem({})];
		await lists.addItem(actors.owner, { listId, itemId: a });
		await lists.addItem(actors.owner, { listId, itemId: b });
		await lists.setNote(actors.owner, { listId, itemId: a, note: "  read first " });
		await lists.removeItem(actors.owner, { listId, itemId: b });
		const view = await lists.getList(actors.owner, listId);
		expect(order(view)).toEqual([a]);
		expect(view?.items[0]).toMatchObject({ note: "read first" });
		await lists.setNote(actors.owner, { listId, itemId: a, note: "" });
		expect((await lists.getList(actors.owner, listId))?.items[0]).toMatchObject({ note: "" });
		await expect(lists.setNote(actors.owner, { listId, itemId: a, note: "x".repeat(2001) })).rejects.toThrow(/2000/);
		await expect(lists.setNote(actors.owner, { listId, itemId: b, note: "gone" })).rejects.toThrow("not in this list");
	});

	it("cannot add an item you cannot see", async () => {
		const listId = await lists.createList(actors.other, { name: "Mine" });
		const draft = await insertItem({ status: "draft", createdBy: "owner" });
		await expect(lists.addItem(actors.other, { listId, itemId: draft })).rejects.toThrow("Library item not found.");
		await expect(lists.addItem(actors.other, { listId, itemId: "lib_missing" })).rejects.toThrow("Library item not found.");
		const secret = await insertItem({ confidentiality: "confidential" });
		await expect(lists.addItem(actors.other, { listId, itemId: secret })).rejects.toThrow("Library item not found.");
	});

	it("counts a save once per member across lists", async () => {
		const id = await insertItem({});
		const l1 = await lists.ensureSaved(actors.owner);
		const l2 = await lists.createList(actors.owner, { name: "Two" });
		await lists.addItem(actors.owner, { listId: l1, itemId: id });
		await lists.addItem(actors.owner, { listId: l2, itemId: id });
		const { cards } = await repo.search(actors.other, {});
		expect(cards.find((c) => c.id === id)?.saves).toBe(1);
	});

	it("credits the editor, not the owner, when an editor adds an item", async () => {
		const listId = await lists.createList(actors.owner, { name: "Pack" });
		await lists.addEditor(actors.owner, listId, "other");
		const id = await insertItem({});
		await lists.addItem(actors.other, { listId, itemId: id });
		const [row] = await db.select().from(libraryListItems).where(eq(libraryListItems.listId, listId));
		expect(row.addedBy).toBe("other");
		const own = await lists.ensureSaved(actors.owner);
		await lists.addItem(actors.owner, { listId: own, itemId: id });
		expect((await repo.search(viewer, {})).cards.find((c) => c.id === id)?.saves).toBe(2);
	});
});

describe("library lists: roles", () => {
	it("keeps strangers out of unshared lists, without revealing they exist", async () => {
		const listId = await lists.createList(actors.owner, { name: "Private" });
		const itemId = await insertItem({});
		await lists.addItem(actors.owner, { listId, itemId });
		const gone = /List not found\./;
		await expect(lists.updateList(viewer, listId, { name: "x" })).rejects.toThrow(gone);
		await expect(lists.deleteList(viewer, listId)).rejects.toThrow(gone);
		await expect(lists.setShared(viewer, listId, true)).rejects.toThrow(gone);
		await expect(lists.addEditor(viewer, listId, "viewer")).rejects.toThrow(gone);
		await expect(lists.removeEditor(viewer, listId, "viewer")).rejects.toThrow(gone);
		await expect(lists.addItem(viewer, { listId, itemId })).rejects.toThrow(gone);
		await expect(lists.removeItem(viewer, { listId, itemId })).rejects.toThrow(gone);
		await expect(lists.setNote(viewer, { listId, itemId, note: "x" })).rejects.toThrow(gone);
		await expect(lists.reorder(viewer, listId, [itemId])).rejects.toThrow(gone);
		await expect(lists.addComment(viewer, { listId, anonymous: false, body: "hi" })).rejects.toThrow(gone);
		expect(await lists.listComments(viewer, listId)).toEqual([]);
		expect((await lists.getList(actors.owner, listId))?.itemCount).toBe(1);
	});

	it("lets viewers of a shared list read and comment but not change it", async () => {
		const listId = await lists.createList(actors.owner, { name: "Shared" });
		const itemId = await insertItem({});
		await lists.addItem(actors.owner, { listId, itemId });
		await lists.setShared(actors.owner, listId, true);
		const denied = /Only the owner and editors can change this list\./;
		await expect(lists.addItem(viewer, { listId, itemId: await insertItem({}) })).rejects.toThrow(denied);
		await expect(lists.removeItem(viewer, { listId, itemId })).rejects.toThrow(denied);
		await expect(lists.setNote(viewer, { listId, itemId, note: "x" })).rejects.toThrow(denied);
		await expect(lists.reorder(viewer, listId, [itemId])).rejects.toThrow(denied);
		const ownerOnly = /Only the list owner can do that\./;
		await expect(lists.updateList(viewer, listId, { name: "x" })).rejects.toThrow(ownerOnly);
		await expect(lists.deleteList(viewer, listId)).rejects.toThrow(ownerOnly);
		await expect(lists.setShared(viewer, listId, false)).rejects.toThrow(ownerOnly);
		await expect(lists.addEditor(viewer, listId, "viewer")).rejects.toThrow(ownerOnly);
		await lists.addComment(viewer, { listId, anonymous: false, body: "Nice" });
		expect(await lists.listComments(viewer, listId)).toHaveLength(1);
		expect(order(await lists.getList(actors.owner, listId))).toEqual([itemId]);
	});

	it("limits editors to the items, never the list itself", async () => {
		const listId = await sharedPack();
		const ownerOnly = /Only the list owner can do that\./;
		await expect(lists.updateList(actors.other, listId, { name: "x" })).rejects.toThrow(ownerOnly);
		await expect(lists.deleteList(actors.other, listId)).rejects.toThrow(ownerOnly);
		await expect(lists.setShared(actors.other, listId, false)).rejects.toThrow(ownerOnly);
		await expect(lists.addEditor(actors.other, listId, "viewer")).rejects.toThrow(ownerOnly);
		const itemId = await insertItem({});
		await lists.addItem(actors.other, { listId, itemId });
		await lists.setNote(actors.other, { listId, itemId, note: "mine" });
		await lists.removeItem(actors.other, { listId, itemId });
		expect((await lists.getList(actors.owner, listId))?.itemCount).toBe(0);
	});

	it("creates lists with a trimmed name and validates names, descriptions and colors", async () => {
		const listId = await lists.createList(actors.owner, { name: "  Team   building ", description: " Games " });
		expect(await lists.getList(actors.owner, listId)).toMatchObject({ name: "Team building", description: "Games", color: "#0c315c", shared: false, isDefault: false });
		await expect(lists.createList(actors.owner, { name: "   " })).rejects.toThrow("A list name is required.");
		await expect(lists.createList(actors.owner, { name: "x".repeat(101) })).rejects.toThrow(/100/);
		await expect(lists.createList(actors.owner, { name: "ok", description: "x".repeat(1001) })).rejects.toThrow(/1000/);
		await lists.updateList(actors.owner, listId, { name: "Renamed", description: "", color: "#AABBCC" });
		expect(await lists.getList(actors.owner, listId)).toMatchObject({ name: "Renamed", description: "", color: "#aabbcc" });
		await lists.updateList(actors.owner, listId, { description: "Only this" });
		expect(await lists.getList(actors.owner, listId)).toMatchObject({ name: "Renamed", description: "Only this" });
		await expect(lists.updateList(actors.owner, listId, { color: "red; background:url(x)" })).rejects.toThrow(/color/);
		await expect(lists.updateList(actors.owner, listId, { name: " " })).rejects.toThrow("A list name is required.");
	});

	it("deletes a list with its items, editors and comments, but never the Saved list", async () => {
		const listId = await sharedPack();
		await lists.addItem(actors.owner, { listId, itemId: await insertItem({}) });
		await lists.addComment(actors.other, { listId, anonymous: false, body: "hi" });
		await lists.deleteList(actors.owner, listId);
		expect(await lists.getList(actors.owner, listId)).toBeNull();
		expect(await db.select().from(libraryListItems).where(eq(libraryListItems.listId, listId))).toEqual([]);
		expect(await db.select().from(libraryListMembers).where(eq(libraryListMembers.listId, listId))).toEqual([]);
		expect(await db.select().from(libraryListComments).where(eq(libraryListComments.listId, listId))).toEqual([]);
		const saved = await lists.ensureSaved(actors.owner);
		await expect(lists.deleteList(actors.owner, saved)).rejects.toThrow("Saved list");
		expect(await lists.getList(actors.owner, saved)).not.toBeNull();
	});

	it("manages editors: the owner adds and removes, an editor can leave, nobody else", async () => {
		const listId = await lists.createList(actors.owner, { name: "Pack" });
		await lists.addEditor(actors.owner, listId, "other");
		await lists.addEditor(actors.owner, listId, "other");
		await lists.addEditor(actors.owner, listId, "moderator");
		// Editors are listed in the order they joined; two joined in one millisecond fall back to member id.
		expect((await lists.getList(actors.owner, listId))?.editors.map((e) => e.memberId).sort()).toEqual(["moderator", "other"]);
		await expect(lists.addEditor(actors.owner, listId, "owner")).rejects.toThrow("already has full access");
		await expect(lists.addEditor(actors.owner, listId, "nobody")).rejects.toThrow("Member not found.");
		// An editor cannot remove another editor.
		await expect(lists.removeEditor(actors.other, listId, "moderator")).rejects.toThrow("Only the list owner");
		// A member who is not an editor cannot "leave".
		await expect(lists.removeEditor(viewer, listId, "viewer")).rejects.toThrow("List not found.");
		await lists.removeEditor(actors.other, listId, "other");
		expect((await lists.getList(actors.owner, listId))?.editors.map((e) => e.memberId)).toEqual(["moderator"]);
		await lists.removeEditor(actors.owner, listId, "moderator");
		expect((await lists.getList(actors.owner, listId))?.editors).toEqual([]);
		expect(await lists.getList(actors.other, listId)).toBeNull();
	});

	it("does not let a shared-list viewer leave as an editor they are not", async () => {
		const listId = await lists.createList(actors.owner, { name: "Shared" });
		await lists.setShared(actors.owner, listId, true);
		await expect(lists.removeEditor(viewer, listId, "viewer")).rejects.toThrow("Only the list owner");
	});

	it("only adds active members as editors", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES ('pend','pend@example.org','pend','pending')").run();
		const listId = await lists.createList(actors.owner, { name: "Pack" });
		await expect(lists.addEditor(actors.owner, listId, "pend")).rejects.toThrow("Member not found.");
	});

	it("tells you which of your lists hold an item, own and editable only", async () => {
		const itemId = await insertItem({});
		const mine = await lists.createList(actors.other, { name: "Mine" });
		await lists.createList(actors.other, { name: "Empty" });
		const editable = await lists.createList(actors.owner, { name: "Editable" });
		const theirs = await lists.createList(actors.owner, { name: "Theirs" });
		await lists.addEditor(actors.owner, editable, "other");
		await lists.setShared(actors.owner, theirs, true);
		await lists.addItem(actors.other, { listId: mine, itemId });
		await lists.addItem(actors.owner, { listId: editable, itemId });
		await lists.addItem(actors.owner, { listId: theirs, itemId });
		expect(await lists.savedIn(actors.other, itemId)).toEqual([editable, mine].sort());
		expect(await lists.savedIn(viewer, itemId)).toEqual([]);
		expect(await lists.savedIn(actors.other, "lib_missing")).toEqual([]);
	});
});

describe("library lists: saved and summaries", () => {
	it("creates the Saved list once, on a predictable id", async () => {
		const first = await lists.ensureSaved(actors.other);
		const second = await lists.ensureSaved(actors.other);
		expect(second).toBe(first);
		expect(first).toBe("lst_saved_other");
		const rows = await db.select().from(libraryLists).where(eq(libraryLists.memberId, "other"));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ name: "Saved", isDefault: true, shared: false });
		const itemId = await insertItem({});
		await lists.addItem(actors.other, { listId: first, itemId });
		expect(order(await lists.getList(actors.other, first))).toEqual([itemId]);
	});

	it("lets a member take an item out of a list after it has been taken down", async () => {
		const itemId = await insertItem({ title: "Soon gone" });
		const saved = await lists.ensureSaved(actors.other);
		await lists.addItem(actors.other, { listId: saved, itemId });
		await repo.moderate(actors.moderator, itemId, "take_down", "Broken file");
		await lists.removeItem(actors.other, { listId: saved, itemId });
		expect(await db.select().from(libraryListItems)).toEqual([]);
	});

	it("lists the member's lists with Saved first, then the lists they edit, with counts and roles", async () => {
		const saved = await lists.ensureSaved(actors.other);
		const own = await lists.createList(actors.other, { name: "Own" });
		const theirs = await lists.createList(actors.owner, { name: "Theirs" });
		await lists.addEditor(actors.owner, theirs, "other");
		await lists.createList(actors.owner, { name: "Not mine" });
		const a = await insertItem({});
		await lists.addItem(actors.other, { listId: own, itemId: a });
		await lists.addItem(actors.other, { listId: theirs, itemId: a });
		await lists.addItem(actors.other, { listId: saved, itemId: a });
		const { owned, editable } = await lists.myLists(actors.other);
		expect(owned.map((l) => [l.name, l.role, l.itemCount, l.isDefault])).toEqual([
			["Saved", "owner", 1, true],
			["Own", "owner", 1, false],
		]);
		expect(editable.map((l) => [l.id, l.role, l.itemCount])).toEqual([[theirs, "editor", 1]]);
		expect(await lists.myLists(viewer)).toEqual({ owned: [], editable: [] });
	});
});

describe("library lists: sharing, collections and takedown", () => {
	it("taken-down lists cannot be re-shared and leave collections", async () => {
		const listId = await lists.createList(actors.owner, { name: "Pack" });
		await lists.setShared(actors.owner, listId, true);
		await lists.setPinned(actors.moderator, listId, true);
		await lists.takeDown(actors.moderator, listId, "Spam");
		expect(await lists.collections(actors.other)).toEqual([]);
		await expect(lists.setShared(actors.owner, listId, true)).rejects.toThrow();
	});

	it("takes a list down with a reason, hides it from viewers, and restores it unshared", async () => {
		const listId = await sharedPack();
		await lists.setPinned(actors.moderator, listId, true);
		await lists.takeDown(actors.moderator, listId, "  Spam links  ");
		const [row] = await db.select().from(libraryLists).where(eq(libraryLists.id, listId));
		expect(row).toMatchObject({ shared: false, pinned: false, moderationReason: "Spam links" });
		expect(row.takenDownAt).toBeInstanceOf(Date);
		expect(await lists.getList(viewer, listId)).toBeNull();
		expect(await lists.listComments(viewer, listId)).toEqual([]);
		// The owner and editors still open it and see why.
		expect(await lists.getList(actors.owner, listId)).toMatchObject({ moderationReason: "Spam links", shared: false, pinned: false });
		expect((await lists.getList(actors.owner, listId))?.takenDownAt).toBeInstanceOf(Date);
		expect(await lists.getList(actors.other, listId)).not.toBeNull();
		await expect(lists.takeDown(actors.moderator, listId, "again")).rejects.toThrow("already taken down");
		await lists.restore(actors.moderator, listId);
		expect(await lists.getList(actors.owner, listId)).toMatchObject({ moderationReason: null, takenDownAt: null, shared: false });
		expect(await lists.getList(viewer, listId)).toBeNull();
		await expect(lists.restore(actors.moderator, listId)).rejects.toThrow("not taken down");
		await lists.setShared(actors.owner, listId, true);
		expect(await lists.getList(viewer, listId)).not.toBeNull();
	});

	it("limits moderation to library:moderate and requires a reason", async () => {
		const listId = await sharedPack();
		const denied = /Not authorized to moderate the library\./;
		await expect(lists.takeDown(actors.owner, listId, "Spam")).rejects.toThrow(denied);
		await expect(lists.restore(actors.owner, listId)).rejects.toThrow(denied);
		await expect(lists.setPinned(actors.owner, listId, true)).rejects.toThrow(denied);
		await expect(lists.setCommentHidden(actors.owner, "llc_x", true)).rejects.toThrow(denied);
		await expect(lists.takeDown(actors.moderator, listId, "   ")).rejects.toThrow("A reason is required.");
		await expect(lists.takeDown(actors.moderator, listId, "x".repeat(501))).rejects.toThrow(/500/);
		await expect(lists.takeDown(actors.moderator, "lst_missing", "Spam")).rejects.toThrow("List not found.");
		expect((await lists.getList(viewer, listId))?.shared).toBe(true);
	});

	it("audits take down, restore and pin changes", async () => {
		const listId = await sharedPack();
		await lists.setPinned(actors.moderator, listId, true);
		await lists.setPinned(actors.moderator, listId, false);
		await lists.takeDown(actors.moderator, listId, "Spam");
		await lists.restore(actors.moderator, listId);
		// Audit rows share a millisecond, so look them up by action rather than by position.
		const rows = await auditRows();
		expect(rows.map((r) => r.action).sort()).toEqual(["library:list_pin", "library:list_restore", "library:list_take_down", "library:list_unpin"]);
		const takeDown = rows.find((r) => r.action === "library:list_take_down");
		expect(takeDown).toMatchObject({ targetType: "library_list", targetId: listId, category: "library", targetMemberId: "owner" });
		expect(takeDown?.detail).toBe("list=Pack; Spam");
	});

	it("pins only shared lists, in moderator order, and lists them for everyone", async () => {
		const [a, b, c] = [await sharedList("A"), await sharedList("B"), await sharedList("C")];
		const unshared = await lists.createList(actors.owner, { name: "Hidden" });
		await expect(lists.setPinned(actors.moderator, unshared, true)).rejects.toThrow("Only shared lists can be pinned.");
		await lists.setPinned(actors.moderator, a, true); // first free slot: 0
		await lists.setPinned(actors.moderator, b, true); // then 1
		await lists.setPinned(actors.moderator, c, true, 5);
		const names = async (actor: Actor) => (await lists.collections(actor)).map((l) => l.name);
		expect(await names(viewer)).toEqual(["A", "B", "C"]);
		expect((await lists.collections(viewer))[0]).toMatchObject({ role: "viewer", pinned: true, shared: true, itemCount: 0 });
		await lists.setPinned(actors.moderator, a, true, 9);
		expect(await names(actors.other)).toEqual(["B", "C", "A"]);
		// Re-pinning without an order keeps the one it has; a newly pinned list without one goes last.
		await lists.setPinned(actors.moderator, a, true);
		const d = await sharedList("D");
		await lists.setPinned(actors.moderator, d, true);
		expect(await names(actors.other)).toEqual(["B", "C", "A", "D"]);
		await lists.setPinned(actors.moderator, b, false);
		expect(await names(actors.other)).toEqual(["C", "A", "D"]);
		await expect(lists.setPinned(actors.moderator, a, true, 1.5)).rejects.toThrow(/whole number/);
	});

	it("reports the viewer's own role on a collection", async () => {
		const listId = await sharedPack();
		await lists.setPinned(actors.moderator, listId, true);
		expect((await lists.collections(actors.owner))[0].role).toBe("owner");
		expect((await lists.collections(actors.other))[0].role).toBe("editor");
		expect((await lists.collections(viewer))[0].role).toBe("viewer");
	});

	it("unpins a list when its owner stops sharing it", async () => {
		const listId = await sharedPack();
		await lists.setPinned(actors.moderator, listId, true);
		await lists.setShared(actors.owner, listId, false);
		expect(await lists.collections(viewer)).toEqual([]);
		const [row] = await db.select().from(libraryLists).where(eq(libraryLists.id, listId));
		expect(row.pinned).toBe(false);
		await lists.setShared(actors.owner, listId, true);
		expect(await lists.collections(viewer)).toEqual([]);
	});

	it("lets an owner unshare a taken-down list, but not share it", async () => {
		const listId = await sharedPack();
		await lists.takeDown(actors.moderator, listId, "Spam");
		await lists.setShared(actors.owner, listId, false);
		await expect(lists.setShared(actors.owner, listId, true)).rejects.toThrow("taken down");
	});
});

describe("library lists: comments", () => {
	it("hides anonymous authors from everyone except moderators", async () => {
		const listId = await sharedPack();
		await lists.addComment(actors.other, { listId, anonymous: true, body: "  Honest take  " });
		await lists.addComment(viewer, { listId, anonymous: false, body: "Agreed" });
		const asOwner = byBody(await lists.listComments(actors.owner, listId));
		expect(asOwner.map((c) => [c.body, c.authorName, c.anonymous])).toEqual([
			["Agreed", "viewer", false],
			["Honest take", "Anonymous", true],
		]);
		expect(asOwner[1]).toMatchObject({ parentId: null, hidden: false });
		expect(asOwner[1].createdAt).toBeInstanceOf(Date);
		const asModerator = byBody(await lists.listComments(actors.moderator, listId));
		expect(asModerator.map((c) => c.authorName)).toEqual(["viewer", "other"]);
	});

	it("lets moderators hide a comment: gone for members, still visible to moderators", async () => {
		const listId = await sharedPack();
		await lists.addComment(actors.other, { listId, anonymous: false, body: "Rude" });
		await lists.addComment(actors.other, { listId, anonymous: false, body: "Kind" });
		const rude = (await lists.listComments(actors.owner, listId)).find((c) => c.body === "Rude")!;
		await lists.setCommentHidden(actors.moderator, rude.id, true);
		expect((await lists.listComments(actors.owner, listId)).map((c) => c.body)).toEqual(["Kind"]);
		expect(byBody(await lists.listComments(actors.moderator, listId))).toMatchObject([
			{ body: "Kind", hidden: false },
			{ body: "Rude", hidden: true },
		]);
		await lists.setCommentHidden(actors.moderator, rude.id, false);
		expect(await lists.listComments(actors.owner, listId)).toHaveLength(2);
		await expect(lists.setCommentHidden(actors.moderator, "llc_missing", true)).rejects.toThrow("Comment not found.");
		const audited = (await auditRows()).map((r) => [r.action, r.targetType, r.targetId]);
		expect(audited).toHaveLength(2);
		expect(audited).toContainEqual(["library:list_comment_hide", "library_list_comment", rude.id]);
		expect(audited).toContainEqual(["library:list_comment_unhide", "library_list_comment", rude.id]);
	});

	it("validates bodies and replies", async () => {
		const listId = await sharedPack();
		await expect(lists.addComment(actors.other, { listId, anonymous: false, body: "   " })).rejects.toThrow("Comment cannot be empty.");
		await expect(lists.addComment(actors.other, { listId, anonymous: false, body: "x".repeat(4001) })).rejects.toThrow(/4000/);
		await lists.addComment(actors.other, { listId, anonymous: false, body: "x".repeat(4000) });
		const [parent] = await lists.listComments(actors.owner, listId);
		await lists.addComment(actors.owner, { listId, parentId: parent.id, anonymous: false, body: "Reply" });
		expect((await lists.listComments(actors.owner, listId)).find((c) => c.body === "Reply")?.parentId).toBe(parent.id);
		await expect(lists.addComment(actors.owner, { listId, parentId: "llc_missing", anonymous: false, body: "Orphan" })).rejects.toThrow("Comment not found.");
		// A reply cannot point at a comment on another list.
		const other = await lists.createList(actors.owner, { name: "Other" });
		await expect(lists.addComment(actors.owner, { listId: other, parentId: parent.id, anonymous: false, body: "Cross" })).rejects.toThrow("Comment not found.");
	});

	it("keeps comments off lists the member cannot open", async () => {
		const listId = await lists.createList(actors.owner, { name: "Private" });
		await lists.addComment(actors.owner, { listId, anonymous: false, body: "Note to self" });
		await expect(lists.addComment(viewer, { listId, anonymous: false, body: "hi" })).rejects.toThrow("List not found.");
		expect(await lists.listComments(viewer, listId)).toEqual([]);
		expect(await lists.listComments(actors.owner, listId)).toHaveLength(1);
		expect(await lists.listComments(actors.owner, "lst_missing")).toEqual([]);
	});
});

async function sharedList(name: string): Promise<string> {
	const listId = await lists.createList(actors.owner, { name });
	await lists.setShared(actors.owner, listId, true);
	return listId;
}
