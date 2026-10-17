import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs, libraryLists, libraryReports } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createLibraryRepository } from "./library";
import type { Db } from "./library";
import { createLibraryListsRepository } from "./library-lists";
import { actors, insertItem, resetLibrary, seedMembers } from "./library-test-fixtures";

const db = drizzle(env.DB, { schema });
const audit = createAuditRepository(db);
const repo = createLibraryRepository(db, audit);
const lists = createLibraryListsRepository(db, audit);

const second: Actor = { memberId: "moderator2", roles: ["publishing"] };
const admin: Actor = { memberId: "admin", roles: ["super"] };

async function grant(memberId: string, roleKey: string): Promise<void> {
	await env.DB.prepare("INSERT INTO member_roles (member_id, role_id) SELECT ?, id FROM roles WHERE key = ?").bind(memberId, roleKey).run();
}

type FeedRow = { kind: string; title: string; body: string; href: string | null };

async function feed(memberId: string): Promise<FeedRow[]> {
	const { results } = await env.DB.prepare("SELECT kind, title, body, href FROM notifications WHERE member_id = ? ORDER BY rowid").bind(memberId).all<FeedRow>();
	return results;
}

const kinds = async (memberId: string) => (await feed(memberId)).map((row) => row.kind);

async function totalNotifications(): Promise<number> {
	const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications").first<{ n: number }>();
	return row?.n ?? 0;
}

async function auditActions(): Promise<string[]> {
	return (await db.select().from(auditLogs)).map((row) => row.action).sort();
}

/** A shared list owned by `owner`. */
async function sharedList(name = "Pack"): Promise<string> {
	const listId = await lists.createList(actors.owner, { name });
	await lists.setShared(actors.owner, listId, true);
	return listId;
}

/** A db whose first read is followed by `interfere`: another request landing between a repository's read and its write. */
function afterFirstRead(interfere: () => Promise<void>): Db {
	let armed = true;
	return new Proxy(db, {
		get(target, prop) {
			const value = Reflect.get(target, prop);
			if (prop !== "select") return typeof value === "function" ? value.bind(target) : value;
			return (...args: unknown[]) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reaching into drizzle's builders, test only
				const builder = (value as any).apply(target, args);
				const from = builder.from.bind(builder);
				builder.from = (...fromArgs: unknown[]) => {
					const query = from(...fromArgs);
					const run = query.then.bind(query);
					query.then = (ok: never, fail: never) =>
						run(async (rows: unknown) => {
							if (armed) {
								armed = false;
								await interfere();
							}
							return rows;
						}).then(ok, fail);
					return query;
				};
				return builder;
			};
		},
	}) as Db;
}

beforeEach(async () => {
	await resetLibrary();
	await seedMembers(["owner", "other", "moderator", "moderator2", "admin", "editor", "bystander"]);
	await grant("moderator", "publishing");
	await grant("moderator2", "publishing");
	await grant("admin", "super");
});

describe("library reports and the moderation queue", () => {
	it("a report resolved as taken_down takes the item down with the reason", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await repo.report(actors.other, { itemId: id, reason: "client_data" });
		const { reports } = await repo.moderationQueue(actors.moderator);
		await repo.resolveReport(actors.moderator, reports[0].id, "taken_down", "Names client org");
		expect((await repo.getItem(actors.owner, id))?.status).toBe("taken_down");
		expect((await repo.getItem(actors.owner, id))?.moderationReason).toBe("Names client org");
		expect((await repo.moderationQueue(actors.moderator)).reports).toHaveLength(0);
	});

	it("rejects a report with no target or two targets", async () => {
		await expect(repo.report(actors.other, { reason: "other" })).rejects.toThrow();
		const itemId = await insertItem({});
		const listId = await sharedList();
		await expect(repo.report(actors.other, { itemId, listId, reason: "other" })).rejects.toThrow();
		expect(await db.select().from(libraryReports)).toHaveLength(0);
	});

	it("validates the reason and caps the details at 1000 characters", async () => {
		const itemId = await insertItem({});
		await expect(repo.report(actors.other, { itemId, reason: "spam" as never })).rejects.toThrow();
		await expect(repo.report(actors.other, { itemId, reason: "other", details: "x".repeat(1001) })).rejects.toThrow(/1000/);
		await repo.report(actors.other, { itemId, reason: "other", details: ` ${"x".repeat(1000)} ` });
		const [row] = await db.select().from(libraryReports);
		expect(row.details).toHaveLength(1000);
	});

	it("only lets a member report what they can see: visible items and shared lists", async () => {
		const draft = await insertItem({ status: "draft", createdBy: "owner" });
		const privateList = await lists.createList(actors.owner, { name: "Private" });
		const downList = await sharedList("Down");
		await lists.takeDown(actors.moderator, downList, "Spam");
		await expect(repo.report(actors.other, { itemId: draft, reason: "other" })).rejects.toThrow(/not found/i);
		await expect(repo.report(actors.other, { itemId: "missing", reason: "other" })).rejects.toThrow(/not found/i);
		await expect(repo.report(actors.other, { listId: privateList, reason: "other" })).rejects.toThrow(/not found/i);
		await expect(repo.report(actors.other, { listId: downList, reason: "other" })).rejects.toThrow(/not found/i);
		await repo.report(actors.other, { listId: await sharedList(), reason: "inappropriate" });
		expect(await db.select().from(libraryReports)).toHaveLength(1);
	});

	it("tells every moderator about a new report, but never the reporter", async () => {
		const itemId = await insertItem({ title: "Leaky", createdBy: "owner" });
		await repo.report(actors.other, { itemId, reason: "copyright" });
		for (const id of ["moderator", "moderator2", "admin"]) {
			expect(await feed(id)).toEqual([
				{ kind: "library_needs_review", title: "New library report", body: 'A copyright report was filed on "Leaky".', href: "/portal/admin/content/library" },
			]);
		}
		for (const id of ["owner", "other", "bystander", "editor"]) expect(await feed(id)).toEqual([]);

		await repo.report(actors.moderator, { itemId, reason: "other" });
		expect(await kinds("moderator")).toEqual(["library_needs_review"]); // still only the first
		expect(await kinds("moderator2")).toEqual(["library_needs_review", "library_needs_review"]);
	});

	it("keeps one open report per member and target, so a repeat does not flood the moderators", async () => {
		const itemId = await insertItem({});
		await repo.report(actors.other, { itemId, reason: "other" });
		await repo.report(actors.other, { itemId, reason: "copyright" });
		expect(await db.select().from(libraryReports)).toHaveLength(1);
		expect(await kinds("moderator")).toEqual(["library_needs_review"]);

		await repo.report(actors.owner, { itemId, reason: "other" });
		expect(await db.select().from(libraryReports)).toHaveLength(2);
		// Once resolved, the same member can report again.
		const { reports } = await repo.moderationQueue(actors.moderator);
		for (const report of reports) await repo.resolveReport(actors.moderator, report.id, "dismissed");
		await repo.report(actors.other, { itemId, reason: "other" });
		expect((await repo.moderationQueue(actors.moderator)).reports).toHaveLength(1);
	});

	it("moderationQueue lists what needs a moderator, and only for moderators", async () => {
		await expect(repo.moderationQueue(actors.other)).rejects.toThrow();
		const pending = await insertItem({ status: "pending_review", createdBy: "owner", title: "Waiting" });
		const down = await insertItem({ status: "taken_down", createdBy: "owner", title: "Gone" });
		const flagged = await insertItem({ title: "Flagged item", createdBy: "owner" });
		await insertItem({ title: "Fine" });
		const pack = await sharedList("Flagged pack");
		const bad = await sharedList("Bad pack");
		await lists.takeDown(actors.moderator, bad, "Spam");
		await repo.report(actors.other, { itemId: flagged, reason: "broken_file" });
		await repo.report(actors.other, { listId: pack, reason: "inappropriate", details: "rude" });
		const dismissed = await insertItem({ title: "Dismissed item" });
		await repo.report(actors.other, { itemId: dismissed, reason: "other" });

		let queue = await repo.moderationQueue(actors.moderator);
		const dismissedReport = queue.reports.find((report) => report.itemId === dismissed)!;
		await repo.resolveReport(actors.moderator, dismissedReport.id, "dismissed");

		queue = await repo.moderationQueue(admin);
		expect(queue.pending.map((item) => item.id)).toEqual([pending]);
		expect(queue.takenDown.map((item) => item.id)).toEqual([down]);
		expect(queue.takenDownLists.map((list) => list.id)).toEqual([bad]);
		// Reports made in the same millisecond have no defined order, so compare them by title.
		const reports = [...queue.reports].sort((a, b) => a.targetTitle.localeCompare(b.targetTitle));
		expect(reports.map((report) => ({ itemId: report.itemId, listId: report.listId, targetTitle: report.targetTitle, details: report.details }))).toEqual([
			{ itemId: flagged, listId: null, targetTitle: "Flagged item", details: "" },
			{ itemId: null, listId: pack, targetTitle: "Flagged pack", details: "rude" },
		]);
	});

	it("dismissing a report leaves the target up and writes an audit row", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await repo.report(actors.other, { itemId: id, reason: "other" });
		const { reports } = await repo.moderationQueue(actors.moderator);
		await repo.resolveReport(actors.moderator, reports[0].id, "dismissed");
		expect((await repo.getItem(actors.other, id))?.status).toBe("published");
		expect(await repo.moderationQueue(actors.moderator)).toMatchObject({ reports: [] });
		const [row] = await db.select().from(libraryReports);
		expect(row).toMatchObject({ resolution: "dismissed", resolvedBy: "moderator" });
		expect(row.resolvedAt).toBeInstanceOf(Date);
		expect(await auditActions()).toEqual(["library:report_dismissed"]);
		expect(await feed("owner")).toEqual([]); // resolving a report tells the owner nothing; only the three moderators heard about it
		expect(await totalNotifications()).toBe(3);
	});

	it("resolveReport needs library:moderate, an open report, and a reason to take down", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await repo.report(actors.other, { itemId: id, reason: "other" });
		const [report] = (await repo.moderationQueue(actors.moderator)).reports;
		await expect(repo.resolveReport(actors.other, report.id, "dismissed")).rejects.toThrow();
		await expect(repo.resolveReport(actors.moderator, "missing", "dismissed")).rejects.toThrow(/not found/i);
		await expect(repo.resolveReport(actors.moderator, report.id, "taken_down")).rejects.toThrow(/reason/i);
		// The failed attempts changed nothing: the report is still open and the item still up.
		expect((await repo.moderationQueue(actors.moderator)).reports).toHaveLength(1);
		expect((await repo.getItem(actors.other, id))?.status).toBe("published");

		await repo.resolveReport(actors.moderator, report.id, "dismissed");
		await expect(repo.resolveReport(actors.moderator, report.id, "dismissed")).rejects.toThrow(/not found|already/i);
	});

	it("a list report resolved as taken_down takes the list down", async () => {
		const listId = await sharedList();
		await repo.report(actors.other, { listId, reason: "inappropriate" });
		const [report] = (await repo.moderationQueue(actors.moderator)).reports;
		await repo.resolveReport(actors.moderator, report.id, "taken_down", "Not for the library");
		const [row] = await db.select().from(libraryLists).where(eq(libraryLists.id, listId));
		expect(row.takenDownAt).not.toBeNull();
		expect(row).toMatchObject({ moderationReason: "Not for the library", shared: false, pinned: false });
		expect((await repo.moderationQueue(actors.moderator)).reports).toHaveLength(0);
	});

	it("resolves a report on a target that is already taken down without asking for a reason", async () => {
		const id = await insertItem({ createdBy: "owner" });
		const listId = await sharedList();
		await repo.report(actors.other, { itemId: id, reason: "other" });
		await repo.report(actors.other, { listId, reason: "other" });
		await repo.moderate(actors.moderator, id, "take_down", "First");
		await lists.takeDown(actors.moderator, listId, "First");
		for (const report of (await repo.moderationQueue(actors.moderator)).reports) await repo.resolveReport(actors.moderator, report.id, "taken_down");
		expect((await repo.moderationQueue(actors.moderator)).reports).toHaveLength(0);
		expect((await repo.getItem(actors.owner, id))?.moderationReason).toBe("First");
	});
});

describe("library notifications: moderation", () => {
	it("notifies the owner when an item is taken down", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await repo.moderate(actors.moderator, id, "take_down", "Broken file");
		const rows = await env.DB.prepare("SELECT kind FROM notifications WHERE member_id = 'owner'").all();
		expect(rows.results).toEqual([{ kind: "library_moderated" }]);
	});

	it("walks an item through review: moderators hear about submissions, the owner about every decision", async () => {
		const item = await repo.createDraft(actors.owner, { kind: "case_study", title: "Case" });
		await repo.publish(actors.owner, item.id, { containsClientData: true });
		for (const id of ["moderator", "moderator2", "admin"]) {
			expect(await feed(id)).toEqual([
				{ kind: "library_needs_review", title: "Library item waiting for review", body: '"Case" is waiting for review.', href: "/portal/admin/content/library" },
			]);
		}
		expect(await feed("owner")).toEqual([]);

		await repo.moderate(actors.moderator, item.id, "send_back", "Blur the client name");
		await repo.publish(actors.owner, item.id, { containsClientData: true });
		await repo.moderate(second, item.id, "approve");
		await repo.moderate(actors.moderator, item.id, "take_down", "Complaint");
		await repo.moderate(actors.moderator, item.id, "restore");

		const href = `/portal/library/${item.id}`;
		expect(await feed("owner")).toEqual([
			{ kind: "library_moderated", title: "Your library item was sent back", body: '"Case" needs changes: Blur the client name', href },
			{ kind: "library_moderated", title: "Your library item was approved", body: '"Case" is now published.', href },
			{ kind: "library_moderated", title: "Your library item was taken down", body: '"Case" was taken down: Complaint', href },
			{ kind: "library_moderated", title: "Your library item was restored", body: '"Case" is published again.', href },
		]);
		expect(await kinds("moderator")).toEqual(["library_needs_review", "library_needs_review"]);
		expect(await kinds("other")).toEqual([]);
	});

	it("notifies no one about an ownerless item, and never the actor about their own action", async () => {
		const seeded = await insertItem({});
		await repo.moderate(actors.moderator, seeded, "take_down", "Old");
		expect(await totalNotifications()).toBe(0);

		const mine = await insertItem({ createdBy: "moderator" });
		await repo.moderate(actors.moderator, mine, "take_down", "Mine");
		expect(await feed("moderator")).toEqual([]);
		await repo.moderate(second, mine, "restore");
		expect(await kinds("moderator")).toEqual(["library_moderated"]);

		const draft = await repo.createDraft(actors.moderator, { kind: "guide", title: "G" });
		await repo.publish(actors.moderator, draft.id, { containsClientData: true });
		expect(await kinds("moderator")).toEqual(["library_moderated"]); // not told about its own submission
		expect(await kinds("moderator2")).toEqual(["library_needs_review"]);
	});

	it("a failing notification never fails the moderation action", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await env.DB.prepare("CREATE TRIGGER fail_notify BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'notify is down'); END").run();
		try {
			await repo.moderate(actors.moderator, id, "take_down", "Reason");
			const item = await repo.createDraft(actors.owner, { kind: "guide", title: "Draft" });
			await expect(repo.publish(actors.owner, item.id, { containsClientData: true })).resolves.toBe("pending_review");
			await repo.report(actors.other, { itemId: await insertItem({}), reason: "other" });
		} finally {
			await env.DB.prepare("DROP TRIGGER fail_notify").run();
		}
		expect((await repo.getItem(actors.owner, id))?.status).toBe("taken_down");
		expect(await db.select().from(libraryReports)).toHaveLength(1);
		expect(await totalNotifications()).toBe(0);
	});
});

describe("library notifications: editors and comments", () => {
	it("tells a newly added editor, once", async () => {
		const listId = await lists.createList(actors.owner, { name: "Reading pack" });
		await lists.addEditor(actors.owner, listId, "editor");
		await lists.addEditor(actors.owner, listId, "editor");
		expect(await feed("editor")).toEqual([
			{
				kind: "library_list_editor",
				title: "You can now edit a list",
				body: 'owner added you as an editor of "Reading pack".',
				href: `/portal/library/lists/${listId}`,
			},
		]);
		expect(await feed("owner")).toEqual([]);
	});

	it("an item comment tells the owner, never the commenter", async () => {
		await env.DB.prepare("UPDATE members SET full_name = 'Zorro Quill' WHERE id = 'other'").run();
		const id = await insertItem({ title: "Field notes", createdBy: "owner" });
		await repo.addComment(actors.other, { itemId: id, anonymous: false, body: "Helpful" });
		expect(await feed("owner")).toEqual([
			{ kind: "library_comment", title: "New comment on your library item", body: 'Zorro Quill commented on "Field notes".', href: `/portal/library/${id}` },
		]);
		expect(await feed("other")).toEqual([]);

		await repo.addComment(actors.owner, { itemId: id, anonymous: false, body: "Thanks" });
		expect(await kinds("owner")).toEqual(["library_comment"]); // replying to yourself is not news
		expect(await totalNotifications()).toBe(1);
	});

	it("an anonymous comment still notifies, without the commenter's name", async () => {
		await env.DB.prepare("UPDATE members SET full_name = 'Zorro Quill', name = 'Zorro' WHERE id = 'other'").run();
		const id = await insertItem({ title: "Field notes", createdBy: "owner" });
		await repo.addComment(actors.other, { itemId: id, anonymous: true, body: "Psst" });
		const [row] = await feed("owner");
		expect(row.kind).toBe("library_comment");
		expect(row.body).toBe('Someone commented on "Field notes".');
		expect(`${row.title} ${row.body}`).not.toMatch(/zorro|quill|other/i);
	});

	it("an ownerless item's comments notify no one", async () => {
		const id = await insertItem({});
		await repo.addComment(actors.other, { itemId: id, anonymous: false, body: "Hi" });
		expect(await totalNotifications()).toBe(0);
	});

	it("a list comment tells the owner and every editor except the commenter", async () => {
		await env.DB.prepare("UPDATE members SET full_name = 'Zorro Quill' WHERE id = 'other'").run();
		const listId = await sharedList("Pack");
		await lists.addEditor(actors.owner, listId, "other");
		await lists.addEditor(actors.owner, listId, "editor");
		const before = await totalNotifications(); // the two editor invitations

		await lists.addComment(actors.other, { listId, anonymous: false, body: "Nice" });
		expect(await feed("owner")).toEqual([
			{ kind: "library_comment", title: "New comment on your list", body: 'Zorro Quill commented on "Pack".', href: `/portal/library/lists/${listId}` },
		]);
		expect(await kinds("editor")).toEqual(["library_list_editor", "library_comment"]);
		expect(await kinds("other")).toEqual(["library_list_editor"]);
		expect(await totalNotifications()).toBe(before + 2);

		// A viewer's anonymous comment reaches the owner and both editors, nameless.
		await lists.addComment(actors.moderator, { listId, anonymous: true, body: "Hmm" });
		const last = (await feed("owner")).at(-1)!;
		expect(last.body).toBe('Someone commented on "Pack".');
		expect(await kinds("other")).toEqual(["library_list_editor", "library_comment"]);
		expect(await kinds("moderator")).toEqual([]);
	});
});

describe("flagging an item as containing client data", () => {
	it("moves a published item back into review, hides it, and tells the moderators", async () => {
		const id = await insertItem({ title: "Oops", createdBy: "owner" });
		expect(await repo.flagClientData(actors.owner, id)).toBe("pending_review");
		expect(await repo.getItem(actors.other, id)).toBeNull();
		expect(await repo.getItem(actors.owner, id)).toMatchObject({ status: "pending_review", containsClientData: true });
		expect((await repo.search(actors.other, { q: "oops" })).total).toBe(0);
		expect(await feed("moderator")).toEqual([
			{ kind: "library_needs_review", title: "Library item waiting for review", body: '"Oops" is waiting for review.', href: "/portal/admin/content/library" },
		]);
		expect(await kinds("admin")).toEqual(["library_needs_review"]);
		expect(await feed("owner")).toEqual([]);
		expect(await auditActions()).toEqual(["library:flag_client_data"]);

		await repo.moderate(actors.moderator, id, "approve");
		expect(await repo.getItem(actors.other, id)).toMatchObject({ status: "published", containsClientData: true });
	});

	it("is for the owner and moderators only, and only while the item is published", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await expect(repo.flagClientData(actors.other, id)).rejects.toThrow(/not found/i);
		await expect(repo.flagClientData(actors.owner, "missing")).rejects.toThrow(/not found/i);
		expect((await repo.getItem(actors.other, id))?.status).toBe("published");

		const draft = await insertItem({ status: "draft", createdBy: "owner" });
		const pending = await insertItem({ status: "pending_review", createdBy: "owner" });
		const down = await insertItem({ status: "taken_down", createdBy: "owner" });
		for (const blocked of [draft, pending, down]) await expect(repo.flagClientData(actors.owner, blocked)).rejects.toThrow(/published/i);

		// A moderator can flag someone else's item; the other moderators are told, the flagging one is not.
		expect(await repo.flagClientData(actors.moderator, id)).toBe("pending_review");
		expect(await kinds("moderator")).toEqual([]);
		expect(await kinds("moderator2")).toEqual(["library_needs_review"]);
	});
});

describe("moderators reading lists under review", () => {
	async function owned(name: string): Promise<string> {
		return lists.createList(actors.owner, { name });
	}

	it("lets a moderator read a taken-down list, and nobody else outside the list", async () => {
		const listId = await sharedList("Pack");
		await lists.takeDown(actors.moderator, listId, "Spam");
		expect(await lists.getList(actors.other, listId)).toBeNull();
		expect(await lists.getList(admin, listId)).toMatchObject({ id: listId, name: "Pack", moderationReason: "Spam", role: "viewer" });
		expect(await lists.getList(actors.moderator, listId)).not.toBeNull();
	});

	it("lets a moderator read an unshared list while a report on it is open", async () => {
		const listId = await sharedList("Pack");
		await repo.report(actors.other, { listId, reason: "inappropriate" });
		await lists.setShared(actors.owner, listId, false); // the owner hides it after being reported
		expect(await lists.getList(actors.other, listId)).toBeNull();
		expect(await lists.getList(actors.moderator, listId)).toMatchObject({ id: listId, shared: false });

		const [report] = (await repo.moderationQueue(actors.moderator)).reports;
		await repo.resolveReport(actors.moderator, report.id, "dismissed");
		expect(await lists.getList(actors.moderator, listId)).toBeNull(); // no open report any more
	});

	it("still hides an ordinary unshared list from a moderator", async () => {
		const listId = await owned("Private");
		expect(await lists.getList(actors.moderator, listId)).toBeNull();
		expect(await lists.getList(admin, listId)).toBeNull();
		expect(await lists.listComments(actors.moderator, listId)).toEqual([]);
		// An open report on a different list opens nothing here.
		await repo.report(actors.other, { listId: await sharedList("Other"), reason: "other" });
		expect(await lists.getList(actors.moderator, listId)).toBeNull();
	});

	it("shows a moderator the comments of a taken-down list, hidden and anonymous ones included", async () => {
		const listId = await sharedList("Pack");
		await lists.addComment(actors.other, { listId, anonymous: true, body: "Secret" });
		await lists.addComment(actors.other, { listId, anonymous: false, body: "Rude" });
		const rude = (await lists.listComments(actors.other, listId)).find((comment) => comment.body === "Rude")!;
		await lists.setCommentHidden(actors.moderator, rude.id, true);
		await lists.takeDown(actors.moderator, listId, "Spam");

		expect(await lists.listComments(actors.other, listId)).toEqual([]);
		const view = await lists.listComments(actors.moderator, listId);
		expect(view.map((comment) => [comment.body, comment.hidden, comment.authorName]).sort()).toEqual([
			["Rude", true, "other"],
			["Secret", false, "other"],
		]);
		// Reading is all a moderator gets: commenting keeps the ordinary rule.
		await expect(lists.addComment(actors.moderator, { listId, anonymous: false, body: "Hello" })).rejects.toThrow(/not found/i);
	});
});

describe("small fixes", () => {
	it("setPinned refuses a list that was unshared after the moderator's read", async () => {
		const listId = await sharedList("Pack");
		const racing = createLibraryListsRepository(afterFirstRead(() => lists.setShared(actors.owner, listId, false)), audit);
		await expect(racing.setPinned(actors.moderator, listId, true)).rejects.toThrow(/shared/i);
		const [row] = await db.select().from(libraryLists).where(eq(libraryLists.id, listId));
		expect(row).toMatchObject({ shared: false, pinned: false });
		expect(await auditActions()).toEqual([]);
	});

	it("setPinned still pins and unpins a shared list", async () => {
		const listId = await sharedList("Pack");
		await lists.setPinned(actors.moderator, listId, true);
		expect((await lists.collections(actors.other)).map((list) => list.id)).toEqual([listId]);
		await lists.setPinned(actors.moderator, listId, false);
		expect(await lists.collections(actors.other)).toEqual([]);
	});

	it("the legacy addToList only files items the member can see", async () => {
		const mine = await repo.createList(actors.other, { name: "Mine", color: "#000000" });
		const draft = await insertItem({ status: "draft", createdBy: "owner" });
		const confidential = await insertItem({ confidentiality: "confidential" });
		const open = await insertItem({});
		await expect(repo.addToList(actors.other, { listId: mine.id, itemId: draft })).rejects.toThrow(/not found/i);
		await expect(repo.addToList(actors.other, { listId: mine.id, itemId: confidential })).rejects.toThrow(/not found/i);
		await expect(repo.addToList(actors.other, { listId: mine.id, itemId: "missing" })).rejects.toThrow(/not found/i);
		await repo.addToList(actors.other, { listId: mine.id, itemId: open });
		expect((await lists.getList(actors.other, mine.id))?.items).toHaveLength(1);
	});
});
