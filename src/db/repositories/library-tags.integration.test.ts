import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs, libraryItemTags } from "@/db/schema";
import { createAuditRepository } from "./audit";
import { createLibraryRepository } from "./library";
import { createLibraryTagsRepository } from "./library-tags";
import { actors, insertItem, resetLibrary, seedMembers } from "./library-test-fixtures";

const db = drizzle(env.DB, { schema });
const audit = createAuditRepository(db);
const repo = createLibraryRepository(db, audit);
const tags = createLibraryTagsRepository(db, audit);

async function auditRows() {
	const rows = await db.select().from(auditLogs);
	return rows.map((row) => ({ action: row.action, category: row.category, targetId: row.targetId, detail: row.detail }));
}

/** Adds `count` published items already carrying `tagId`, each with a deliberately stale index entry. */
async function tagManyItems(tagId: string, count: number): Promise<void> {
	for (let i = 0; i < count; i++) await insertItem({ id: `lib_many_${i}`, searchText: "stale" });
	await db.run(sql`INSERT INTO library_item_tags (item_id, tag_id) SELECT id, ${tagId} FROM library_items`);
}

beforeEach(async () => {
	await resetLibrary();
	await seedMembers(["owner", "other", "moderator"]);
});

describe("library tags repository", () => {
	it("creates tags idempotently by slug", async () => {
		const a = await tags.createTag(actors.other, "Leadership");
		const b = await tags.createTag(actors.other, "  leadership ");
		expect(b.id).toBe(a.id);
		expect(a.groupName).toBe("Ungrouped");
		expect((await tags.listTags()).length).toBe(1);
	});

	it("lists tags for moderators with every item counted, whatever its status or confidentiality", async () => {
		const alpha = await tags.createTag(actors.other, "Alpha");
		const beta = await tags.createTag(actors.other, "Beta");
		const shown = await insertItem({});
		const draft = await insertItem({ status: "draft", createdBy: "owner" });
		const secret = await insertItem({ confidentiality: "confidential" });
		for (const id of [shown, draft, secret]) await tags.setItemTags(actors.moderator, id, [alpha.id]);
		// Members see one item on the tag; a moderator deciding whether it can go sees all three.
		expect((await tags.listTags()).map((t) => `${t.name}:${t.itemCount}`)).toEqual(["Alpha:1", "Beta:0"]);
		expect((await tags.listTagsForModeration(actors.moderator)).map((t) => `${t.name}:${t.itemCount}`)).toEqual(["Alpha:3", "Beta:0"]);
		expect((await tags.listTagsForModeration(actors.moderator)).map((t) => t.id)).toEqual([alpha.id, beta.id]);
		await expect(tags.listTagsForModeration(actors.other)).rejects.toThrow("Not authorized");
	});

	it("collapses inner whitespace and rejects empty or oversized names", async () => {
		const a = await tags.createTag(actors.other, "Team   Building");
		expect(a.name).toBe("Team Building");
		expect((await tags.createTag(actors.other, "team building")).id).toBe(a.id);
		await expect(tags.createTag(actors.other, "   ")).rejects.toThrow();
		await expect(tags.createTag(actors.other, "x".repeat(61))).rejects.toThrow();
	});

	it("lists by group then name, counting only items members can see", async () => {
		const zeta = await tags.createTag(actors.other, "zeta");
		const alpha = await tags.createTag(actors.other, "Alpha");
		const beta = await tags.createTag(actors.other, "Beta");
		await tags.regroupTag(actors.moderator, beta.id, "Skills");
		const shown = await insertItem({});
		const draft = await insertItem({ status: "draft", createdBy: "owner" });
		const secret = await insertItem({ confidentiality: "confidential" });
		for (const id of [shown, draft, secret]) await tags.setItemTags(actors.moderator, id, [alpha.id]);
		const listed = await tags.listTags();
		expect(listed.map((t) => `${t.groupName}/${t.name}`)).toEqual(["Skills/Beta", "Ungrouped/Alpha", "Ungrouped/zeta"]);
		expect(listed.find((t) => t.id === alpha.id)?.itemCount).toBe(1);
		expect(listed.find((t) => t.id === zeta.id)?.itemCount).toBe(0);
	});

	it("only owners and moderators retag an item", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await expect(tags.setItemTags(actors.other, id, [])).rejects.toThrow();
		await tags.setItemTags(actors.moderator, id, []);
	});

	it("lets an owner retag their own item and refreshes search", async () => {
		const t = await tags.createTag(actors.owner, "Rare Word");
		const id = await insertItem({ createdBy: "owner" });
		await tags.setItemTags(actors.owner, id, [t.id, t.id]);
		expect((await repo.search(actors.other, { q: "rare word" })).total).toBe(1);
		await tags.setItemTags(actors.owner, id, []);
		expect((await repo.search(actors.other, { q: "rare word" })).total).toBe(0);
	});

	it("rejects an unknown tag without touching the existing tags", async () => {
		const t = await tags.createTag(actors.owner, "Keep");
		const id = await insertItem({ createdBy: "owner" });
		await tags.setItemTags(actors.owner, id, [t.id]);
		await expect(tags.setItemTags(actors.owner, id, [t.id, "ltg_missing"])).rejects.toThrow();
		expect((await repo.getItem(actors.owner, id))?.tags.map((x) => x.name)).toEqual(["Keep"]);
	});

	it("does not let a member retag an item they cannot see", async () => {
		const id = await insertItem({ status: "draft", createdBy: "owner" });
		await expect(tags.setItemTags(actors.other, id, [])).rejects.toThrow("Library item not found.");
		await expect(tags.setItemTags(actors.owner, "lib_missing", [])).rejects.toThrow("Library item not found.");
	});

	it("merge retags every item and refreshes search", async () => {
		const from = await tags.createTag(actors.other, "Leading");
		const into = await tags.createTag(actors.other, "Leadership");
		const id = await insertItem({ title: "Talk" });
		await tags.setItemTags(actors.moderator, id, [from.id]);
		await tags.mergeTags(actors.moderator, from.id, into.id);
		expect((await repo.getItem(actors.other, id))?.tags.map((t) => t.name)).toEqual(["Leadership"]);
		expect((await repo.search(actors.other, { q: "leadership" })).total).toBe(1);
		expect((await repo.search(actors.other, { q: "leading" })).total).toBe(0);
		expect((await tags.listTags()).map((t) => t.id)).toEqual([into.id]);
	});

	it("merge keeps one row for items that already carry both tags", async () => {
		const from = await tags.createTag(actors.other, "Old");
		const into = await tags.createTag(actors.other, "New");
		const both = await insertItem({});
		const onlyFrom = await insertItem({});
		await tags.setItemTags(actors.moderator, both, [from.id, into.id]);
		await tags.setItemTags(actors.moderator, onlyFrom, [from.id]);
		await tags.mergeTags(actors.moderator, from.id, into.id);
		const rows = await db.select().from(libraryItemTags);
		expect(rows.map((r) => `${r.itemId}:${r.tagId}`).sort()).toEqual([`${both}:${into.id}`, `${onlyFrom}:${into.id}`].sort());
		expect((await tags.listTags())[0].itemCount).toBe(2);
	});

	it("merge of a tag on 120 items retags and re-indexes all of them in one go", async () => {
		const from = await tags.createTag(actors.other, "Many");
		const into = await tags.createTag(actors.other, "Plenty");
		await tagManyItems(from.id, 120);
		await tags.mergeTags(actors.moderator, from.id, into.id);
		expect((await tags.listTags()).map((t) => [t.name, t.itemCount])).toEqual([["Plenty", 120]]);
		expect((await repo.search(actors.other, { q: "plenty" })).total).toBe(120);
		expect((await repo.search(actors.other, { q: "stale" })).total).toBe(0);
		expect((await repo.search(actors.other, { q: "many" })).total).toBe(0);
	});

	it("delete of a tag on 120 items re-indexes all of them without the tag name", async () => {
		const doomed = await tags.createTag(actors.other, "Doomed");
		await tagManyItems(doomed.id, 120);
		expect((await tags.listTags())[0].itemCount).toBe(120);
		await tags.deleteTag(actors.moderator, doomed.id);
		expect((await repo.search(actors.other, { q: "doomed" })).total).toBe(0);
		expect((await repo.search(actors.other, { q: "stale" })).total).toBe(0);
		expect((await repo.search(actors.other, { q: "untitled" })).total).toBe(120);
	});

	it("rename of a tag on 120 items re-indexes all of them under the new name", async () => {
		const t = await tags.createTag(actors.other, "Before");
		await tagManyItems(t.id, 120);
		await tags.renameTag(actors.moderator, t.id, "After");
		expect((await repo.search(actors.other, { q: "after" })).total).toBe(120);
		expect((await repo.search(actors.other, { q: "before" })).total).toBe(0);
	});

	it("caps an item at 40 tags", async () => {
		const made: string[] = [];
		for (let i = 0; i < 41; i++) made.push((await tags.createTag(actors.owner, `Cap ${i}`)).id);
		const id = await insertItem({ createdBy: "owner" });
		await expect(tags.setItemTags(actors.owner, id, made)).rejects.toThrow("An item can have at most 40 tags.");
		expect((await repo.getItem(actors.owner, id))?.tags).toEqual([]);
		await tags.setItemTags(actors.owner, id, made.slice(0, 40));
		expect((await repo.getItem(actors.owner, id))?.tags).toHaveLength(40);
		// Repeats collapse before the cap is checked.
		await tags.setItemTags(actors.owner, id, Array.from({ length: 50 }, () => made[0]));
		expect((await repo.getItem(actors.owner, id))?.tags).toHaveLength(1);
	});

	it("merge refuses a tag into itself or a missing tag", async () => {
		const a = await tags.createTag(actors.other, "Solo");
		await expect(tags.mergeTags(actors.moderator, a.id, a.id)).rejects.toThrow();
		await expect(tags.mergeTags(actors.moderator, a.id, "ltg_missing")).rejects.toThrow();
		await expect(tags.mergeTags(actors.moderator, "ltg_missing", a.id)).rejects.toThrow();
		expect((await tags.listTags()).length).toBe(1);
	});

	it("rename updates the name, the slug and every tagged item's search text", async () => {
		const t = await tags.createTag(actors.other, "Old Name");
		const id = await insertItem({});
		await tags.setItemTags(actors.moderator, id, [t.id]);
		await tags.renameTag(actors.moderator, t.id, "  Fresh   Name ");
		expect((await repo.getItem(actors.other, id))?.tags.map((x) => x.name)).toEqual(["Fresh Name"]);
		expect((await repo.search(actors.other, { q: "fresh name" })).total).toBe(1);
		expect((await repo.search(actors.other, { q: "old name" })).total).toBe(0);
		expect((await tags.createTag(actors.other, "fresh name")).id).toBe(t.id);
	});

	it("rename allows a case change but refuses another tag's name", async () => {
		const a = await tags.createTag(actors.other, "alpha");
		await tags.createTag(actors.other, "Beta");
		await tags.renameTag(actors.moderator, a.id, "ALPHA");
		expect((await tags.listTags()).find((t) => t.id === a.id)?.name).toBe("ALPHA");
		await expect(tags.renameTag(actors.moderator, a.id, " beta ")).rejects.toThrow();
		await expect(tags.renameTag(actors.moderator, a.id, "  ")).rejects.toThrow();
		await expect(tags.renameTag(actors.moderator, "ltg_missing", "Gamma")).rejects.toThrow();
	});

	it("regroup moves a tag between groups, and an empty group means Ungrouped", async () => {
		const t = await tags.createTag(actors.other, "Facilitation");
		await tags.regroupTag(actors.moderator, t.id, "  Skills ");
		expect((await tags.listTags())[0].groupName).toBe("Skills");
		await tags.regroupTag(actors.moderator, t.id, "  ");
		expect((await tags.listTags())[0].groupName).toBe("Ungrouped");
	});

	it("delete removes the tag from every item and from search", async () => {
		const t = await tags.createTag(actors.other, "Doomed");
		const id = await insertItem({});
		await tags.setItemTags(actors.moderator, id, [t.id]);
		expect((await repo.search(actors.other, { q: "doomed" })).total).toBe(1);
		await tags.deleteTag(actors.moderator, t.id);
		expect((await repo.getItem(actors.other, id))?.tags).toEqual([]);
		expect((await repo.search(actors.other, { q: "doomed" })).total).toBe(0);
		expect(await tags.listTags()).toEqual([]);
		await expect(tags.deleteTag(actors.moderator, t.id)).rejects.toThrow();
	});

	it("keeps rename, regroup, merge and delete for moderators", async () => {
		const a = await tags.createTag(actors.other, "A");
		const b = await tags.createTag(actors.other, "B");
		await expect(tags.renameTag(actors.other, a.id, "Z")).rejects.toThrow("Not authorized");
		await expect(tags.regroupTag(actors.other, a.id, "G")).rejects.toThrow("Not authorized");
		await expect(tags.mergeTags(actors.other, a.id, b.id)).rejects.toThrow("Not authorized");
		await expect(tags.deleteTag(actors.other, a.id)).rejects.toThrow("Not authorized");
		expect((await tags.listTags()).map((t) => `${t.groupName}/${t.name}`)).toEqual(["Ungrouped/A", "Ungrouped/B"]);
		expect(await auditRows()).toEqual([]);
	});

	it("audits rename, regroup, merge and delete under the library category", async () => {
		const a = await tags.createTag(actors.other, "Aa");
		const b = await tags.createTag(actors.other, "Bb");
		const c = await tags.createTag(actors.other, "Cc");
		await tags.renameTag(actors.moderator, a.id, "Aaa");
		await tags.regroupTag(actors.moderator, a.id, "Skills");
		await tags.mergeTags(actors.moderator, b.id, a.id);
		await tags.deleteTag(actors.moderator, c.id);
		const rows = await auditRows();
		expect(rows.map((r) => r.action).sort()).toEqual(["library:tag_delete", "library:tag_merge", "library:tag_regroup", "library:tag_rename"]);
		expect(new Set(rows.map((r) => r.category))).toEqual(new Set(["library"]));
		expect(rows.find((r) => r.action === "library:tag_merge")?.detail).toContain("Bb");
	});

	it("related ranks by shared tags and never returns hidden items", async () => {
		const a = await tags.createTag(actors.owner, "A");
		const b = await tags.createTag(actors.owner, "B");
		const base = await insertItem({});
		const two = await insertItem({});
		const one = await insertItem({});
		const hidden = await insertItem({ status: "draft", createdBy: "owner" });
		await tags.setItemTags(actors.moderator, base, [a.id, b.id]);
		await tags.setItemTags(actors.moderator, two, [a.id, b.id]);
		await tags.setItemTags(actors.moderator, one, [a.id]);
		await tags.setItemTags(actors.moderator, hidden, [a.id, b.id]);
		expect((await repo.related(actors.other, base)).map((c) => c.id)).toEqual([two, one]);
	});
});
