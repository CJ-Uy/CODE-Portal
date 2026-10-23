import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createGalleryRepository, purgeExpiredGallery, type CreateGalleryItemInput } from "./gallery";

const db = drizzle(env.DB, { schema });
const gallery = createGalleryRepository(db);
const DAY = 24 * 60 * 60 * 1000;

const ana: Actor = { memberId: "ana", roles: ["member"] };
const ben: Actor = { memberId: "ben", roles: ["member"] };
const keeper: Actor = { memberId: "keeper", roles: ["gallery"] };
const boss: Actor = { memberId: "boss", roles: ["super"] };

beforeEach(async () => {
	for (const table of ["audit_logs", "gallery_items", "gallery_folders", "crs_events", "members"]) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
	for (const id of ["ana", "ben", "keeper", "boss"]) {
		await env.DB.prepare("INSERT INTO members (id, email, full_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
			.bind(id, `${id}@example.org`, id.toUpperCase(), Date.now(), Date.now())
			.run();
	}
	await env.DB.prepare(
		"INSERT INTO crs_events (id, title, type, place, starts_at, description, created_by, checkin_secret) VALUES ('evt', 'Retreat', 'official', 'Hall', ?, '', 'ana', 's')",
	)
		.bind(Date.now())
		.run();
});

let counter = 0;
async function upload(actor: Actor, overrides: Partial<CreateGalleryItemInput> = {}) {
	const id = overrides.id ?? `gal_${++counter}`;
	return gallery.createItem(actor, {
		id,
		folderId: null,
		kind: "photo",
		fileKey: `gallery/${id}/${actor.memberId}/original.jpg`,
		posterKey: null,
		contentType: "image/jpeg",
		sizeBytes: 1000,
		durationSeconds: null,
		originalName: `${id}.jpg`,
		caption: null,
		takenAt: null,
		eventId: null,
		...overrides,
	});
}

async function auditRows() {
	return db.select().from(schema.auditLogs).orderBy(schema.auditLogs.createdAt);
}

describe("gallery uploads and edits", () => {
	it("records the uploader permanently, including an email that outlives the member row", async () => {
		const item = await upload(ana, { caption: "  hello  " });
		expect(item.uploadedBy).toBe("ana");
		expect(item.uploaderEmail).toBe("ana@example.org");
		expect(item.caption).toBe("hello");

		// Anyone can edit and move, and doing so never changes who uploaded it.
		const folder = await gallery.createFolder(ben, { name: "Trip", parentId: null });
		await gallery.updateItem(ben, item.id, { caption: "edited", eventId: "evt" });
		await gallery.moveItems(ben, [item.id], folder);
		const view = await gallery.folderView(ana, folder);
		expect(view?.items.map((row) => [row.id, row.uploadedBy, row.caption, row.eventTitle])).toEqual([[item.id, "ana", "edited", "Retreat"]]);

		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM members WHERE id = 'ana'").run();
		const after = await gallery.folderView(ben, folder);
		expect(after?.items[0].uploaderName).toBe("ana@example.org");
	});

	it("refuses keys the server did not assign to this member and item", async () => {
		await expect(upload(ana, { fileKey: "gallery/gal_x/ben/original.jpg", id: "gal_x" })).rejects.toThrow("assigned by the server");
	});

	it("audits upload, edit and move with who did it", async () => {
		const item = await upload(ana);
		const folder = await gallery.createFolder(ben, { name: "Trip", parentId: null });
		await gallery.updateItem(ben, item.id, { caption: "x" });
		await gallery.moveItems(ben, [item.id], folder);
		const rows = await auditRows();
		expect(rows.map((row) => [row.action, row.actorMemberId, row.category])).toEqual([
			["gallery:upload", "ana", "gallery"],
			["gallery:folder_create", "ben", "gallery"],
			["gallery:edit", "ben", "gallery"],
			["gallery:move", "ben", "gallery"],
		]);
		expect(rows[3].detail).toContain('from the top level to "Trip"');
		expect(rows[3].targetMemberId).toBe("ana");
	});

	it("lets only gallery admins publish a folder", async () => {
		const folder = await gallery.createFolder(ana, { name: "Open day", parentId: null });
		await expect(gallery.updateFolder(ana, folder, { isPublic: true })).rejects.toThrow("Only photo gallery admins");
		await gallery.updateFolder(keeper, folder, { isPublic: true });
		const item = await upload(ben, { folderId: folder });
		expect(await gallery.canReadObject(null, item.id)).toBe(true);
		expect((await gallery.publicView(null))?.folders.map((card) => card.name)).toEqual(["Open day"]);
	});

	it("keeps a folder from moving inside itself", async () => {
		const top = await gallery.createFolder(ana, { name: "Top", parentId: null });
		const inner = await gallery.createFolder(ana, { name: "Inner", parentId: top });
		await expect(gallery.moveFolder(ben, top, inner)).rejects.toThrow("cannot go inside itself");
	});
});

describe("gallery soft delete and restore", () => {
	it("hides a deleted photo, keeps the file readable only for whoever can restore it", async () => {
		const item = await upload(ana);
		await gallery.deleteItems(ben, [item.id]);
		expect((await gallery.folderView(ana, null))?.items).toEqual([]);
		expect(await gallery.canReadObject(ana, item.id)).toBe(false);
		expect(await gallery.canReadObject(ben, item.id)).toBe(true);
		expect(await gallery.canReadObject(keeper, item.id)).toBe(true);
		expect(await gallery.canReadObject(null, item.id)).toBe(false);
	});

	it("lets the deleter, a gallery admin or a super admin restore, and nobody else", async () => {
		const [one, two, three] = [await upload(ana), await upload(ana), await upload(ana)];
		await gallery.deleteItems(ben, [one.id, two.id, three.id]);
		await expect(gallery.restore(ana, { itemIds: [one.id], folderIds: [] })).rejects.toThrow("only restore what you deleted");
		await gallery.restore(ben, { itemIds: [one.id], folderIds: [] });
		await gallery.restore(keeper, { itemIds: [two.id], folderIds: [] });
		await gallery.restore(boss, { itemIds: [three.id], folderIds: [] });
		expect((await gallery.folderView(ana, null))?.items).toHaveLength(3);
	});

	it("shows members only their own deletions with days left, and admins everyone's", async () => {
		const item = await upload(ana);
		await gallery.deleteItems(ben, [item.id]);
		const now = new Date(Date.now() + 10 * DAY);
		expect((await gallery.listDeleted(ana, now)).items).toEqual([]);
		const mine = await gallery.listDeleted(ben, now);
		expect(mine.items.map((row) => [row.id, row.daysLeft, row.canRestore, row.deletedByName])).toEqual([[item.id, 20, true, "BEN"]]);
		const admin = await gallery.listDeleted(keeper, now);
		expect(admin.seesEveryone).toBe(true);
		expect(admin.items).toHaveLength(1);
	});

	it("hides a whole folder with one delete and brings it back together", async () => {
		const trip = await gallery.createFolder(ana, { name: "Trip", parentId: null });
		const day = await gallery.createFolder(ana, { name: "Day 1", parentId: trip });
		const photo = await upload(ana, { folderId: day });
		await gallery.deleteFolder(ben, trip);
		expect(await gallery.folderView(ana, day)).toBeNull();
		expect(await gallery.canReadObject(ana, photo.id)).toBe(false);
		expect(await gallery.canReadObject(ben, photo.id)).toBe(true);
		const deleted = await gallery.listDeleted(ben);
		expect(deleted.folders.map((folder) => [folder.name, folder.itemCount])).toEqual([["Trip", 1]]);
		await gallery.restore(ben, { itemIds: [], folderIds: [trip] });
		expect((await gallery.folderView(ana, day))?.items.map((row) => row.id)).toEqual([photo.id]);
	});

	it("restores a photo into the nearest live folder when its own folder is gone", async () => {
		const trip = await gallery.createFolder(ana, { name: "Trip", parentId: null });
		const day = await gallery.createFolder(ana, { name: "Day 1", parentId: trip });
		const photo = await upload(ana, { folderId: day });
		await gallery.deleteItems(ana, [photo.id]);
		await gallery.deleteFolder(ben, day);
		await gallery.restore(ana, { itemIds: [photo.id], folderIds: [] });
		expect((await gallery.folderView(ana, trip))?.items.map((row) => row.id)).toEqual([photo.id]);
		const rows = await auditRows();
		expect(rows.at(-1)?.detail).toContain('into "Trip" because its folder is gone');
	});

	it("audits delete and restore, naming the uploader as the target", async () => {
		const item = await upload(ana);
		await gallery.deleteItems(ben, [item.id]);
		await gallery.restore(keeper, { itemIds: [item.id], folderIds: [] });
		const rows = (await auditRows()).filter((row) => row.action !== "gallery:upload");
		expect(rows.map((row) => [row.action, row.actorMemberId, row.targetMemberId])).toEqual([
			["gallery:delete", "ben", "ana"],
			["gallery:restore", "keeper", "ana"],
		]);
	});
});

describe("gallery 30-day purge", () => {
	it("purges files then rows after 30 days, leaves younger deletions alone, and audits as the system", async () => {
		const old = await upload(ana);
		const young = await upload(ana);
		await gallery.deleteItems(ben, [old.id, young.id]);
		await env.DB.prepare("UPDATE gallery_items SET deleted_at = ? WHERE id = ?").bind(Date.now() - 31 * DAY, old.id).run();
		const removed: string[] = [];
		const result = await purgeExpiredGallery(db, async (item) => void removed.push(item.fileKey));
		expect(result).toEqual({ items: 1, folders: 0 });
		expect(removed).toEqual([old.fileKey]);
		expect((await gallery.listDeleted(keeper)).items.map((row) => row.id)).toEqual([young.id]);
		const purge = (await auditRows()).find((row) => row.action === "gallery:purge");
		expect(purge).toMatchObject({ actorMemberId: null, actorContext: "system", targetId: old.id, targetMemberId: "ana" });
		expect(purge?.detail).toContain("uploaded by ana@example.org");
	});

	it("keeps the row when its file delete fails, for the next run", async () => {
		const item = await upload(ana);
		await gallery.deleteItems(ana, [item.id]);
		await env.DB.prepare("UPDATE gallery_items SET deleted_at = ?").bind(Date.now() - 31 * DAY).run();
		const result = await purgeExpiredGallery(db, async () => {
			throw new Error("R2 down");
		});
		expect(result.items).toBe(0);
		expect((await gallery.listDeleted(ana)).items).toHaveLength(1);
	});

	it("purges an expired folder with everything under it", async () => {
		const trip = await gallery.createFolder(ana, { name: "Trip", parentId: null });
		const day = await gallery.createFolder(ana, { name: "Day 1", parentId: trip });
		const keep = await gallery.createFolder(ana, { name: "Keep", parentId: null });
		const inside = await upload(ana, { folderId: day });
		const outside = await upload(ana, { folderId: keep });
		await gallery.deleteFolder(ben, trip);
		await env.DB.prepare("UPDATE gallery_folders SET deleted_at = ? WHERE id = ?").bind(Date.now() - 31 * DAY, trip).run();
		const removed: string[] = [];
		expect(await purgeExpiredGallery(db, async (item) => void removed.push(item.id))).toEqual({ items: 1, folders: 2 });
		expect(removed).toEqual([inside.id]);
		const folders = await db.select({ id: schema.galleryFolders.id }).from(schema.galleryFolders);
		expect(folders.map((folder) => folder.id)).toEqual([keep]);
		expect((await gallery.folderView(ana, keep))?.items.map((row) => row.id)).toEqual([outside.id]);
		expect((await auditRows()).filter((row) => row.actorContext === "system").map((row) => row.action)).toEqual(["gallery:purge", "gallery:folder_purge"]);
	});
});

describe("gallery event pages", () => {
	it("shows photos tagged with the event or sitting in a folder tagged with it", async () => {
		const folder = await gallery.createFolder(ana, { name: "Retreat", parentId: null });
		await gallery.updateFolder(ana, folder, { eventId: "evt" });
		const sub = await gallery.createFolder(ana, { name: "Day 1", parentId: folder });
		const inFolder = await upload(ana, { folderId: sub, takenAt: new Date(2000) });
		const tagged = await upload(ben, { eventId: "evt", takenAt: new Date(3000) });
		await upload(ben);
		expect((await gallery.eventItems(ana, "evt")).map((row) => row.id)).toEqual([tagged.id, inFolder.id]);
	});
});
