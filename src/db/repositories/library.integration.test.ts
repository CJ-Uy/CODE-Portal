import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
	auditLogs,
	libraryComments,
	libraryItemMemberDays,
	libraryItems,
	libraryItemTags,
	libraryListItems,
	libraryLists,
	libraryReports,
	libraryTags,
} from "@/db/schema";
import type { LibraryBlock } from "@/lib/library/blocks";
import { createAuditRepository } from "./audit";
import { createLibraryRepository, refreshSearchTextMany } from "./library";
import type { LibraryModerationEvent } from "./library";
import { actors, insertItem, resetLibrary, seedMembers } from "./library-test-fixtures";

const db = drizzle(env.DB, { schema });
const audit = createAuditRepository(db);
const repo = createLibraryRepository(db, audit);

async function addTag(id: string, name: string): Promise<string> {
	await db.insert(libraryTags).values({ id, name, slug: name.toLowerCase() });
	return id;
}

async function tagItem(itemId: string, tagId: string): Promise<void> {
	await db.insert(libraryItemTags).values({ itemId, tagId });
}

async function saveToList(listId: string, memberId: string, itemId: string): Promise<void> {
	await db.insert(libraryLists).values({ id: listId, memberId, name: listId }).onConflictDoNothing();
	await db.insert(libraryListItems).values({ listId, libraryItemId: itemId, addedBy: memberId });
}

async function auditActions(): Promise<string[]> {
	const rows = await db.select().from(auditLogs);
	return rows.map((row) => row.action).sort();
}

beforeEach(async () => {
	await resetLibrary();
	await seedMembers(["owner", "other", "moderator"]);
});

describe("library repository: access and publishing", () => {
	it("search runs in SQL and finds item 150 of 150", async () => {
		for (let i = 0; i < 150; i++) await insertItem({ id: `lib_${i}`, title: i === 0 ? "Oldest Needle" : `Item ${i}`, publishedAt: new Date(i) });
		const { cards, total } = await repo.search(actors.other, { q: "needle" });
		expect(total).toBe(1);
		expect(cards[0].id).toBe("lib_0");
	}, 30_000);

	it("hides drafts, pending, taken-down and confidential items from search and getItem", async () => {
		await insertItem({ id: "d", title: "Zeta", status: "draft", createdBy: "owner" });
		await insertItem({ id: "p", title: "Zeta", status: "pending_review", createdBy: "owner" });
		await insertItem({ id: "t", title: "Zeta", status: "taken_down", createdBy: "owner" });
		await insertItem({ id: "c", title: "Zeta", confidentiality: "confidential" });
		expect((await repo.search(actors.other, { q: "zeta" })).total).toBe(0);
		expect(await repo.getItem(actors.other, "d")).toBeNull();
		expect(await repo.getItem(actors.owner, "d")).not.toBeNull();
		expect(await repo.getItem(actors.moderator, "p")).not.toBeNull();
		expect(await repo.getItem(actors.moderator, "c")).not.toBeNull(); // publishing role holds library:manage
		expect((await repo.search(actors.moderator, { q: "zeta" })).total).toBe(1); // only the confidential one is published
	});

	it("publishing with client data goes to review and approval publishes it", async () => {
		const item = await repo.createDraft(actors.owner, { kind: "case_study", title: "Case" });
		expect(await repo.publish(actors.owner, item.id, { containsClientData: true })).toBe("pending_review");
		await expect(repo.publish(actors.other, item.id, { containsClientData: false })).rejects.toThrow();
		await repo.moderate(actors.moderator, item.id, "approve");
		expect((await repo.getItem(actors.other, item.id))?.status).toBe("published");
	});

	it("take down needs a reason and keeps the item for its owner", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await expect(repo.moderate(actors.moderator, id, "take_down")).rejects.toThrow(/reason/i);
		await repo.moderate(actors.moderator, id, "take_down", "Client data");
		expect((await repo.getItem(actors.owner, id))?.moderationReason).toBe("Client data");
		expect(await repo.getItem(actors.other, id)).toBeNull();
	});

	it("members cannot comment on items they cannot see", async () => {
		const id = await insertItem({ status: "draft", createdBy: "owner" });
		await expect(repo.addComment(actors.other, { itemId: id, anonymous: false, body: "hi" })).rejects.toThrow();
	});

	it("only library:manage deletes, and returns file keys", async () => {
		const id = await insertItem({ fileKey: "library/x/m/f.pdf" });
		await expect(repo.deleteItem(actors.owner, id)).rejects.toThrow();
		expect(await repo.deleteItem(actors.moderator, id)).toEqual({ fileKeys: ["library/x/m/f.pdf"] });
	});

	it("publishes straight away without client data, audits it, and refuses a second publish", async () => {
		const item = await repo.createDraft(actors.owner, { kind: "guide", title: "Guide" });
		const before = item.publishedAt.getTime();
		expect(await repo.publish(actors.owner, item.id, { containsClientData: false })).toBe("published");
		const live = await repo.getItem(actors.other, item.id);
		expect(live).toMatchObject({ status: "published", containsClientData: false });
		expect(live!.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
		await expect(repo.publish(actors.owner, item.id, { containsClientData: false })).rejects.toThrow();
		expect(await auditActions()).toEqual(["library:publish"]);
	});

	it("only the owner publishes, not even a moderator", async () => {
		const item = await repo.createDraft(actors.owner, { kind: "guide", title: "Guide" });
		await expect(repo.publish(actors.moderator, item.id, { containsClientData: false })).rejects.toThrow();
		await expect(repo.publish(actors.owner, "missing", { containsClientData: false })).rejects.toThrow();
	});

	it("walks the review transitions, audits each one, and fires the hook", async () => {
		const events: LibraryModerationEvent[] = [];
		const hooked = createLibraryRepository(db, audit, (event) => {
			events.push(event);
		});
		const item = await hooked.createDraft(actors.owner, { kind: "case_study", title: "Case" });
		await hooked.publish(actors.owner, item.id, { containsClientData: true });
		await db.update(libraryItems).set({ publishedAt: new Date(1000) }).where(eq(libraryItems.id, item.id));

		await expect(hooked.moderate(actors.moderator, item.id, "send_back")).rejects.toThrow(/reason/i);
		await hooked.moderate(actors.moderator, item.id, "send_back", "Blur the client name");
		let row = (await hooked.getItem(actors.owner, item.id))!;
		expect(row).toMatchObject({ status: "draft", moderationReason: "Blur the client name" });

		await hooked.publish(actors.owner, item.id, { containsClientData: true });
		expect((await hooked.getItem(actors.owner, item.id))!.moderationReason).toBeNull();
		await hooked.moderate(actors.moderator, item.id, "approve");
		row = (await hooked.getItem(actors.other, item.id))!;
		expect(row.status).toBe("published");
		expect(row.publishedAt.getTime()).toBeGreaterThan(1000);

		await hooked.moderate(actors.moderator, item.id, "take_down", "Complaint");
		await hooked.moderate(actors.moderator, item.id, "restore");
		row = (await hooked.getItem(actors.other, item.id))!;
		expect(row).toMatchObject({ status: "published", moderationReason: null });

		expect(await auditActions()).toEqual(
			["library:approve", "library:restore", "library:send_back", "library:submit_review", "library:submit_review", "library:take_down"].sort(),
		);
		expect(events.map((event) => event.action)).toEqual(["submit_review", "send_back", "submit_review", "approve", "take_down", "restore"]);
		expect(events[1]).toMatchObject({ itemId: item.id, ownerId: "owner", reason: "Blur the client name", title: "Case" });
	});

	it("rejects transitions from the wrong status and from non-moderators", async () => {
		const published = await insertItem({ createdBy: "owner" });
		const draft = await insertItem({ status: "draft", createdBy: "owner" });
		await expect(repo.moderate(actors.moderator, published, "approve")).rejects.toThrow();
		await expect(repo.moderate(actors.moderator, published, "restore")).rejects.toThrow();
		await expect(repo.moderate(actors.moderator, draft, "take_down", "x")).rejects.toThrow();
		await expect(repo.moderate(actors.owner, published, "take_down", "x")).rejects.toThrow();
		await expect(repo.moderate(actors.moderator, "missing", "approve")).rejects.toThrow();
		expect((await repo.getItem(actors.other, published))?.status).toBe("published");
	});
});

describe("library repository: drafts and edits", () => {
	it("creates a draft owned by the actor with defaults from the kind", async () => {
		const tagId = await addTag("tag_a", "Alpha Tag");
		const item = await repo.createDraft(actors.owner, {
			kind: "reading",
			title: "  A Book  ",
			dek: "Short summary",
			authors: [{ name: "Jane Roe" }],
			year: 2020,
			tagIds: [tagId],
			blocks: [{ id: "b1", type: "text", props: { text: "needle in the body" } }],
		});
		expect(item).toMatchObject({
			title: "A Book",
			status: "draft",
			createdBy: "owner",
			format: "file",
			source: "outside",
			publicReadiness: "not_eligible",
			year: 2020,
		});
		expect(item.readMinutes).toBe(1);
		expect(item.searchText).toContain("a book");
		expect(item.searchText).toContain("jane roe");
		expect(item.searchText).toContain("alpha tag");
		expect(item.searchText).toContain("needle in the body");
		const view = await repo.getItem(actors.owner, item.id);
		expect(view?.tags).toEqual([{ id: "tag_a", name: "Alpha Tag" }]);
		expect(await repo.createDraft(actors.owner, { kind: "website", title: "Site", source: "member" })).toMatchObject({ format: "link", source: "member" });
	});

	it("requires a title and an http(s) link", async () => {
		await expect(repo.createDraft(actors.owner, { kind: "guide", title: "   " })).rejects.toThrow(/title/i);
		await expect(repo.createDraft(actors.owner, { kind: "website", title: "Site", url: "javascript:alert(1)" })).rejects.toThrow(/link/i);
		const ok = await repo.createDraft(actors.owner, { kind: "website", title: "Site", url: "https://example.org/x" });
		await expect(repo.updateItem(actors.owner, ok.id, { url: "data:text/html,hi" })).rejects.toThrow(/link/i);
	});

	it("lets the owner and a moderator edit, and nobody else", async () => {
		const id = await insertItem({ createdBy: "owner", title: "Before" });
		await expect(repo.updateItem(actors.other, id, { title: "Hacked" })).rejects.toThrow();
		await repo.updateItem(actors.owner, id, { title: "After" });
		await repo.updateItem(actors.moderator, id, { dek: "Fixed by a moderator" });
		const row = (await repo.getItem(actors.owner, id))!;
		expect(row).toMatchObject({ title: "After", dek: "Fixed by a moderator", canEdit: true });
		expect((await repo.getItem(actors.other, id))!.canEdit).toBe(false);
		expect((await repo.getItem(actors.moderator, id))!.canEdit).toBe(true);
		expect(await auditActions()).toEqual(["library:update"]); // the owner's own edit is not audited
	});

	it("an edit of a published item keeps it published and refreshes search text and read time", async () => {
		const id = await insertItem({ createdBy: "owner", title: "Plain Title" });
		const words = Array.from({ length: 450 }, () => "word").join(" ");
		const updated = await repo.updateItem(actors.owner, id, {
			title: "Renamed Title",
			authors: [{ name: "Ana Reyes" }],
			blocks: [{ id: "b1", type: "text", props: { text: `uniqueblockword ${words}` } }],
		});
		expect(updated.status).toBe("published");
		expect(updated.readMinutes).toBe(2);
		expect(updated.searchText).toContain("renamed title");
		expect(updated.searchText).not.toContain("plain title");
		expect((await repo.search(actors.other, { q: "uniqueblockword ana" })).cards.map((c) => c.id)).toEqual([id]);
		expect((await repo.search(actors.other, { q: "plain" })).total).toBe(0);
	});

	it("replaces tags on update and re-derives format when the kind changes", async () => {
		const a = await addTag("tag_a", "Alpha");
		const b = await addTag("tag_b", "Beta");
		const item = await repo.createDraft(actors.owner, { kind: "guide", title: "Guide", tagIds: [a] });
		const updated = await repo.updateItem(actors.owner, item.id, { kind: "template", tagIds: [b] });
		expect(updated).toMatchObject({ kind: "template", format: "file" });
		expect((await repo.getItem(actors.owner, item.id))!.tags).toEqual([{ id: "tag_b", name: "Beta" }]);
		expect(updated.searchText).toContain("beta");
		expect(updated.searchText).not.toContain("alpha");
		const same = await repo.updateItem(actors.owner, item.id, { kind: "template", title: "Renamed" });
		expect(same.format).toBe("file");
	});

	it("setFile records the file for the owner, clears stale extracted text, and refuses others", async () => {
		const id = await insertItem({ createdBy: "owner", extractedText: "stalecontent" });
		const file = { key: "library/x/owner/new.pdf", name: "new.pdf", type: "application/pdf", bytes: 10 };
		await expect(repo.setFile(actors.other, id, file)).rejects.toThrow();
		await repo.setFile(actors.owner, id, file);
		const [row] = await db.select().from(libraryItems).where(eq(libraryItems.id, id));
		expect(row).toMatchObject({ fileKey: file.key, fileName: "new.pdf", fileType: "application/pdf", fileBytes: 10, extractedText: "" });
		expect(row.searchText).not.toContain("stalecontent");
	});

	it("lists every status of the actor's own items", async () => {
		await insertItem({ id: "m1", status: "draft", createdBy: "owner" });
		await insertItem({ id: "m2", status: "taken_down", createdBy: "owner" });
		await insertItem({ id: "m3", createdBy: "owner" });
		await insertItem({ id: "x1", createdBy: "other" });
		expect((await repo.listMine(actors.owner)).map((item) => item.id).sort()).toEqual(["m1", "m2", "m3"]);
	});

	it("setExtractedText feeds search and ignores a missing item", async () => {
		const id = await insertItem({ title: "Scanned" });
		await repo.setExtractedText(id, "Findable ocrterm inside");
		expect((await repo.search(actors.other, { q: "ocrterm" })).cards.map((c) => c.id)).toEqual([id]);
		await expect(repo.setExtractedText("missing", "x")).resolves.toBeUndefined();
	});
});

describe("library repository: setting moderation fields", () => {
	it("public readiness is a moderator call", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await expect(repo.setPublicReadiness(actors.owner, id, "public_ready")).rejects.toThrow();
		await repo.setPublicReadiness(actors.moderator, id, "needs_adapting");
		expect((await repo.getItem(actors.other, id))!.publicReadiness).toBe("needs_adapting");
		await repo.setPublicReadiness(actors.moderator, id, null);
		expect((await repo.getItem(actors.other, id))!.publicReadiness).toBeNull();
		expect(await auditActions()).toEqual(["library:set_public_readiness", "library:set_public_readiness"]);
	});

	it("confidentiality needs library:manage and hides the item from members", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await expect(repo.setConfidentiality(actors.owner, id, "confidential")).rejects.toThrow();
		await expect(repo.setConfidentiality(actors.other, id, "confidential")).rejects.toThrow();
		await repo.setConfidentiality(actors.moderator, id, "confidential");
		expect(await repo.getItem(actors.other, id)).toBeNull();
		expect((await repo.search(actors.other, {})).total).toBe(0);
		await repo.setConfidentiality(actors.moderator, id, "members");
		expect(await repo.getItem(actors.other, id)).not.toBeNull();
		expect(await auditActions()).toEqual(["library:set_confidentiality", "library:set_confidentiality"]);
	});
});

describe("library repository: delete", () => {
	it("removes the item and everything hanging off it, returns every file key, and keeps one audit row", async () => {
		const blocks: LibraryBlock[] = [
			{ id: "b1", type: "image", props: { key: "library/x/owner/one.png", alt: "one" } },
			{ id: "b2", type: "text", props: { text: "hi" } },
			{ id: "b3", type: "image", props: { key: "library/x/owner/one.png", alt: "again" } },
			{ id: "b4", type: "image", props: { key: "library/x/owner/two.png", alt: "two" } },
		];
		const id = await insertItem({ title: "Doomed", createdBy: "owner", fileKey: "library/x/owner/f.pdf", blocksJson: blocks });
		const tagId = await addTag("tag_a", "Alpha");
		await tagItem(id, tagId);
		await saveToList("lst_other", "other", id);
		await db.insert(libraryComments).values({ id: "lcm_1", libraryItemId: id, memberId: "other", body: "hi" });
		await db.insert(libraryReports).values({ id: "rep_1", itemId: id, memberId: "other", reason: "other" });
		await db.insert(libraryItemMemberDays).values({ itemId: id, memberId: "other", day: "2026-10-16", opens: 1 });

		const { fileKeys } = await repo.deleteItem(actors.moderator, id);
		expect([...fileKeys].sort()).toEqual(["library/x/owner/f.pdf", "library/x/owner/one.png", "library/x/owner/two.png"]);

		expect(await db.select().from(libraryItems).where(eq(libraryItems.id, id))).toEqual([]);
		for (const table of [libraryComments, libraryReports, libraryItemMemberDays, libraryItemTags, libraryListItems]) {
			expect(await db.select().from(table)).toEqual([]);
		}
		expect(await db.select().from(libraryLists)).toHaveLength(1); // the list stays, it just lost a row
		expect(await db.select().from(libraryTags)).toHaveLength(1);
		const rows = await db.select().from(auditLogs);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ action: "library:delete", targetId: id, actorMemberId: "moderator", targetMemberId: "owner" });
		expect(rows[0].detail).toContain("Doomed");
	});

	it("deleting an unknown item fails", async () => {
		await expect(repo.deleteItem(actors.moderator, "missing")).rejects.toThrow();
	});
});

describe("library repository: comments", () => {
	it("hides hidden comments from members, keeps anonymous names from members, and gates unseen items", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await repo.addComment(actors.other, { itemId: id, anonymous: true, body: "  first  " });
		await repo.addComment(actors.owner, { itemId: id, anonymous: false, body: "second" });
		await db.update(libraryComments).set({ createdAt: new Date(1000) }).where(eq(libraryComments.body, "first"));
		const asMember = await repo.listComments(actors.owner, id);
		expect(asMember.map((c) => [c.body, c.authorName])).toEqual([
			["first", "Anonymous"],
			["second", "owner"],
		]);
		await repo.setCommentHidden(actors.moderator, asMember[0].id, true);
		expect((await repo.listComments(actors.owner, id)).map((c) => c.body)).toEqual(["second"]);
		expect((await repo.listComments(actors.moderator, id)).map((c) => [c.body, c.authorName])).toEqual([
			["first", "other"], // anonymity never hides the author from moderators
			["second", "owner"],
		]);
		await expect(repo.setCommentHidden(actors.owner, asMember[0].id, false)).rejects.toThrow();

		await db.update(libraryItems).set({ status: "draft" }).where(eq(libraryItems.id, id));
		expect(await repo.listComments(actors.other, id)).toEqual([]);
		await expect(repo.addComment(actors.other, { itemId: id, anonymous: false, body: "late" })).rejects.toThrow();
		await expect(repo.addComment(actors.owner, { itemId: id, anonymous: false, body: "   " })).rejects.toThrow();
	});

	it("only replies to a comment on the same item", async () => {
		const one = await insertItem({});
		const two = await insertItem({});
		await repo.addComment(actors.other, { itemId: one, anonymous: false, body: "root" });
		const [root] = await repo.listComments(actors.other, one);
		await repo.addComment(actors.owner, { itemId: one, parentId: root.id, anonymous: false, body: "reply" });
		await expect(repo.addComment(actors.owner, { itemId: two, parentId: root.id, anonymous: false, body: "cross" })).rejects.toThrow();
		await expect(repo.addComment(actors.owner, { itemId: one, parentId: "missing", anonymous: false, body: "ghost" })).rejects.toThrow();
	});
});

describe("library repository: getItem", () => {
	it("marks authors who are still active members", async () => {
		await seedMembers(["alum"]);
		await env.DB.prepare("UPDATE members SET status = 'alumni' WHERE id = 'alum'").run();
		const id = await insertItem({
			authorsJson: [{ name: "Owner Person", memberId: "owner" }, { name: "Alum Person", memberId: "alum" }, { name: "Outsider" }, { name: "Ghost", memberId: "gone" }],
		});
		const view = (await repo.getItem(actors.other, id))!;
		expect(view.authors.map((a) => [a.name, a.stillInCode])).toEqual([
			["Owner Person", true],
			["Alum Person", false],
			["Outsider", false],
			["Ghost", false],
		]);
	});

	it("returns null for a missing item", async () => {
		expect(await repo.getItem(actors.other, "nope")).toBeNull();
	});
});

describe("library repository: search", () => {
	it("needs every word, case-insensitively, across title, summary, author, tag, file code and text", async () => {
		const tagId = await addTag("tag_a", "Delta Topic");
		const id = await insertItem({ title: "Alpha Report", dek: "beta summary", fileCode: "IDF-042", authorsJson: [{ name: "Gamma Person" }] });
		await tagItem(id, tagId);
		await repo.updateItem(actors.moderator, id, { dek: "beta summary" }); // re-derives search text with the tag
		for (const q of ["gamma delta", "ALPHA beta", "idf-042", "  report   topic  "]) {
			expect((await repo.search(actors.other, { q })).cards.map((c) => c.id)).toEqual([id]);
		}
		expect((await repo.search(actors.other, { q: "alpha zzz" })).total).toBe(0);
	});

	it("treats % and _ as plain characters and survives a very long word", async () => {
		await insertItem({ id: "pct", title: "100% done" });
		await insertItem({ id: "num", title: "1000 done" });
		await insertItem({ id: "und", title: "a_b" });
		await insertItem({ id: "ab", title: "axb" });
		expect((await repo.search(actors.other, { q: "100%" })).cards.map((c) => c.id)).toEqual(["pct"]);
		expect((await repo.search(actors.other, { q: "a_b" })).cards.map((c) => c.id)).toEqual(["und"]);
		expect((await repo.search(actors.other, { q: "%" })).cards.map((c) => c.id)).toEqual(["pct"]);
		expect((await repo.search(actors.other, { q: "x".repeat(300) })).total).toBe(0);
		expect((await repo.search(actors.other, { q: "é".repeat(60) })).total).toBe(0);
	});

	it("filters by type, source and facets", async () => {
		await insertItem({ id: "a", kind: "code_document", source: "code", subtype: "Module", formatDetail: "SLE", engagementType: "STE" });
		await insertItem({ id: "b", kind: "article", source: "member" });
		await insertItem({ id: "c", kind: "reading", source: "outside", subtype: "Book" });
		const ids = async (input: Parameters<typeof repo.search>[1]) => (await repo.search(actors.other, input)).cards.map((c) => c.id).sort();
		expect(await ids({ kinds: ["article", "reading"] })).toEqual(["b", "c"]);
		expect(await ids({ sources: ["code"] })).toEqual(["a"]);
		expect(await ids({ subtype: "Book" })).toEqual(["c"]);
		expect(await ids({ formatDetail: "SLE" })).toEqual(["a"]);
		expect(await ids({ engagementType: "STE", kinds: ["code_document"] })).toEqual(["a"]);
		expect(await ids({ kinds: [] })).toEqual(["a", "b", "c"]);
	});

	it("tag filters keep only items carrying every selected tag", async () => {
		const a = await addTag("tag_a", "A");
		const b = await addTag("tag_b", "B");
		const both = await insertItem({});
		const onlyA = await insertItem({});
		await insertItem({});
		await tagItem(both, a);
		await tagItem(both, b);
		await tagItem(onlyA, a);
		const ids = async (tagIds: string[]) => (await repo.search(actors.other, { tagIds })).cards.map((c) => c.id).sort();
		expect(await ids([a, b])).toEqual([both]);
		expect(await ids([a, a, b])).toEqual([both]);
		expect(await ids([a])).toEqual([both, onlyA].sort());
	});

	it("sorts by newest, most saved (distinct members) and most read", async () => {
		const old = await insertItem({ title: "Old", publishedAt: new Date(1000) });
		const mid = await insertItem({ title: "Mid", publishedAt: new Date(2000) });
		const fresh = await insertItem({ title: "Fresh", publishedAt: new Date(3000) });
		// old: saved by 2 members; mid: one member saved it into two lists (counts once)
		await saveToList("lst_o1", "owner", old);
		await saveToList("lst_o2", "other", old);
		await saveToList("lst_m1", "owner", mid);
		await saveToList("lst_m2", "owner", mid);
		await db.insert(libraryItemMemberDays).values([
			{ itemId: mid, memberId: "owner", day: "2026-10-15", activeSeconds: 100 },
			{ itemId: mid, memberId: "other", day: "2026-10-16", activeSeconds: 200 },
			{ itemId: fresh, memberId: "owner", day: "2026-10-16", activeSeconds: 50 },
		]);
		const order = async (sort: "newest" | "most_saved" | "most_read" | "relevance") => (await repo.search(actors.other, { sort })).cards.map((c) => c.id);
		expect(await order("newest")).toEqual([fresh, mid, old]);
		expect(await order("relevance")).toEqual([fresh, mid, old]);
		expect(await order("most_saved")).toEqual([old, mid, fresh]);
		expect(await order("most_read")).toEqual([mid, fresh, old]);
		const cards = (await repo.search(actors.other, { sort: "most_saved" })).cards;
		expect(cards.map((c) => c.saves)).toEqual([2, 1, 0]);
	});

	it("ranks title matches above summary matches above the rest, newest first within a tier", async () => {
		const body = await insertItem({ title: "Other thing", extractedText: "mentions quokka once", publishedAt: new Date(9000) });
		const dekOld = await insertItem({ title: "Beta", dek: "about quokka", publishedAt: new Date(1000) });
		const dekNew = await insertItem({ title: "Gamma", dek: "about quokka too", publishedAt: new Date(2000) });
		const title = await insertItem({ title: "Quokka handbook", publishedAt: new Date(500) });
		const { cards } = await repo.search(actors.other, { q: "quokka" });
		expect(cards.map((c) => c.id)).toEqual([title, dekNew, dekOld, body]);
	});

	it("onlyIds restricts the result and keeps the given order under relevance", async () => {
		const a = await insertItem({ title: "A", publishedAt: new Date(3000) });
		const b = await insertItem({ title: "B", publishedAt: new Date(2000) });
		const c = await insertItem({ title: "C", publishedAt: new Date(1000) });
		await insertItem({ title: "D", publishedAt: new Date(4000) });
		const draft = await insertItem({ title: "E", status: "draft", createdBy: "owner" });
		expect((await repo.search(actors.other, { onlyIds: [c, a, draft, b] })).cards.map((x) => x.id)).toEqual([c, a, b]);
		expect((await repo.search(actors.other, { onlyIds: [c, a, b], sort: "newest" })).cards.map((x) => x.id)).toEqual([a, b, c]);
		expect((await repo.search(actors.other, { onlyIds: [] })).total).toBe(0);
	});

	it("pages with a default of 24, a cap of 100 and a total over all matches", async () => {
		for (let i = 0; i < 130; i++) await insertItem({ id: `lib_${String(i).padStart(3, "0")}`, title: `Row ${i}`, publishedAt: new Date(i) });
		const first = await repo.search(actors.other, {});
		expect(first.cards).toHaveLength(24);
		expect(first.total).toBe(130);
		expect(first.cards[0].id).toBe("lib_129");
		expect((await repo.search(actors.other, { limit: 500 })).cards).toHaveLength(100);
		expect((await repo.search(actors.other, { limit: 0 })).cards).toHaveLength(1);
		const tail = await repo.search(actors.other, { limit: 100, offset: 100 });
		expect(tail.cards).toHaveLength(30);
		expect(tail.cards[29].id).toBe("lib_000");
		expect((await repo.search(actors.other, { offset: -5, limit: 1 })).cards[0].id).toBe("lib_129");
	}, 30_000);

	it("cards carry the card fields, tag names and no body", async () => {
		const a = await addTag("tag_a", "Zebra");
		const b = await addTag("tag_b", "Aardvark");
		const id = await insertItem({
			title: "Card",
			dek: "sum",
			kind: "code_document",
			format: "file",
			authorsJson: [{ name: "Ana" }],
			year: 2024,
			fileCode: "IDF-001",
			fileType: "application/pdf",
			publicReadiness: "public_ready",
			blocksJson: [{ id: "b", type: "text", props: { text: "secret body" } }],
		});
		await tagItem(id, a);
		await tagItem(id, b);
		const [card] = (await repo.search(actors.other, {})).cards;
		expect(card).toMatchObject({
			id,
			kind: "code_document",
			format: "file",
			source: "code",
			title: "Card",
			dek: "sum",
			authorsJson: [{ name: "Ana" }],
			year: 2024,
			fileCode: "IDF-001",
			fileType: "application/pdf",
			publicReadiness: "public_ready",
			confidentiality: "members",
			status: "published",
			tagNames: ["Aardvark", "Zebra"],
			saves: 0,
		});
		expect(card).not.toHaveProperty("blocksJson");
		expect(card).not.toHaveProperty("searchText");
	});
});

describe("library repository: search text refresh", () => {
	it("refreshSearchTextMany re-indexes every item across chunks and skips unknown or repeated ids", async () => {
		const ids: string[] = [];
		for (let i = 0; i < 90; i++) ids.push(await insertItem({ title: `Doc ${i}`, searchText: "stale" }));
		const tag = await addTag("tg_cohort", "Cohort");
		await tagItem(ids[89], tag);
		await refreshSearchTextMany(db, [...ids, ...ids.slice(0, 5), "lib_missing"]);
		const rows = await db.select({ id: libraryItems.id, text: libraryItems.searchText }).from(libraryItems);
		expect(rows).toHaveLength(90);
		for (const row of rows) expect(row.text).not.toContain("stale");
		expect(rows.find((row) => row.id === ids[89])?.text).toBe("doc 89\ncohort");
		expect(rows.find((row) => row.id === ids[0])?.text).toBe("doc 0");
	});

	it("refreshSearchTextMany with nothing to do is a no-op", async () => {
		await refreshSearchTextMany(db, []);
		await refreshSearchTextMany(db, ["lib_missing"]);
	});
});

describe("library repository: legacy favorites shim", () => {
	it("keeps toggleFavorite and listFavorites on the Saved list", async () => {
		const open = await insertItem({ title: "Open" });
		expect(await repo.toggleFavorite(actors.other, open)).toBe(true);
		expect((await repo.listFavorites(actors.other)).map((item) => item.id)).toEqual([open]);
		expect((await repo.listFavorites(actors.moderator)).map((item) => item.id)).toEqual([]);
		expect(await repo.toggleFavorite(actors.other, open)).toBe(false);
		expect(await repo.listFavorites(actors.other)).toEqual([]);
		expect(await db.select().from(libraryLists).where(eq(libraryLists.memberId, "other"))).toHaveLength(1);
	});

	it("refuses to save an item the member cannot see, so it cannot inflate the save count", async () => {
		const hidden = await insertItem({ title: "Hidden", confidentiality: "confidential" });
		const draft = await insertItem({ title: "Draft", status: "draft", createdBy: "owner" });
		for (const itemId of [hidden, draft, "lib_missing"]) {
			await expect(repo.toggleFavorite(actors.other, itemId)).rejects.toThrow("Library item not found.");
		}
		// Nothing was written, not even an empty Saved list.
		expect(await db.select().from(libraryLists).where(eq(libraryLists.memberId, "other"))).toEqual([]);
		expect(await db.select().from(libraryListItems)).toEqual([]);
		// The owner can still save their own draft.
		expect(await repo.toggleFavorite(actors.owner, draft)).toBe(true);
	});

	it("lets a member un-save an item that has since become hidden", async () => {
		const id = await insertItem({ title: "Soon gone" });
		expect(await repo.toggleFavorite(actors.other, id)).toBe(true);
		await repo.moderate(actors.moderator, id, "take_down", "Broken file");
		expect(await repo.toggleFavorite(actors.other, id)).toBe(false);
		expect(await db.select().from(libraryListItems)).toEqual([]);
	});
});
