import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { eq } from "drizzle-orm";
import { createGalleryRepository, ensureEventAlbums, purgeExpiredGallery, type CreateGalleryItemInput } from "./gallery";

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
		expect(rows.at(-1)?.detail).toContain('into "Trip" because its album is gone');
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

async function insertEvent(id: string, overrides: { title?: string; status?: string; startsAt?: number; endsAt?: number | null; type?: string; readOnly?: boolean } = {}) {
	const startsAt = overrides.startsAt ?? Date.now() - 3 * DAY;
	await env.DB.prepare(
		"INSERT INTO crs_events (id, title, type, status, place, starts_at, ends_at, read_only, description, created_by, checkin_secret) VALUES (?, ?, ?, ?, 'Hall', ?, ?, ?, '', 'ana', 's')",
	)
		.bind(id, overrides.title ?? id, overrides.type ?? "official", overrides.status ?? "approved", startsAt, overrides.endsAt === undefined ? startsAt + 2 * 60 * 60 * 1000 : overrides.endsAt, overrides.readOnly ? 1 : 0)
		.run();
}

async function eventAlbums() {
	return db.select({ id: schema.galleryFolders.id, eventId: schema.galleryFolders.eventId, name: schema.galleryFolders.name }).from(schema.galleryFolders).where(eq(schema.galleryFolders.isEventAlbum, true));
}

describe("gallery hearts, views and tags", () => {
	it("counts hearts per member and shows the viewer's own heart", async () => {
		const item = await upload(ana);
		expect(await gallery.setHeart(ben, item.id, true)).toEqual({ heartCount: 1 });
		expect(await gallery.setHeart(ben, item.id, true)).toEqual({ heartCount: 1 });
		expect(await gallery.setHeart(ana, item.id, true)).toEqual({ heartCount: 2 });
		const [seenByBen] = (await gallery.folderView(ben, null))!.items;
		expect([seenByBen.heartCount, seenByBen.hearted]).toEqual([2, true]);
		await gallery.setHeart(ben, item.id, false);
		const [seenByKeeper] = (await gallery.folderView(keeper, null))!.items;
		expect([seenByKeeper.heartCount, seenByKeeper.hearted]).toEqual([1, false]);
		await gallery.deleteItems(ana, [item.id]);
		await expect(gallery.setHeart(ben, item.id, true)).rejects.toThrow("no longer exists");
	});

	it("counts views without touching the photo's edit time", async () => {
		const item = await upload(ana);
		await gallery.recordView(ben, item.id);
		await gallery.recordView(keeper, item.id);
		const [row] = await db.select().from(schema.galleryItems).where(eq(schema.galleryItems.id, item.id));
		expect(row.viewCount).toBe(2);
		expect(row.updatedAt.getTime()).toBe(item.updatedAt.getTime());
	});

	it("tags people by member and topics by text, once each, and audits both ways", async () => {
		const item = await upload(ana);
		await gallery.addTag(ben, item.id, { memberId: "keeper" });
		await gallery.addTag(ben, item.id, { memberId: "keeper" });
		await gallery.addTag(ben, item.id, { label: "  #Awarding  night " });
		await gallery.addTag(keeper, item.id, { label: "awarding NIGHT" });
		const [view] = (await gallery.folderView(ana, null))!.items;
		expect(view.tags.map((tag) => [tag.kind, tag.label])).toEqual([
			["person", "KEEPER"],
			["topic", "Awarding night"],
		]);
		await env.DB.prepare("UPDATE members SET full_name = 'Kee Per' WHERE id = 'keeper'").run();
		const [renamed] = (await gallery.folderView(ana, null))!.items;
		expect(renamed.tags[0].label).toBe("Kee Per");
		await gallery.removeTag(ana, view.tags[1].id);
		const rows = (await auditRows()).filter((row) => row.action === "gallery:tag" || row.action === "gallery:untag");
		expect(rows.map((row) => [row.action, row.actorMemberId, row.targetMemberId])).toEqual([
			["gallery:tag", "ben", "keeper"],
			["gallery:tag", "ben", "ana"],
			["gallery:untag", "ana", "ana"],
		]);
		await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = 'boss'").run();
		await expect(gallery.addTag(ana, item.id, { memberId: "boss" })).rejects.toThrow("not in the portal");
	});
});

describe("gallery browsing and search", () => {
	it("sorts by hearts, views or tags, listing only photos that have some", async () => {
		const [quiet, loved, viewed, tagged] = [await upload(ana), await upload(ana), await upload(ana), await upload(ana)];
		await gallery.setHeart(ben, loved.id, true);
		await gallery.setHeart(ana, loved.id, true);
		await gallery.setHeart(ben, viewed.id, true);
		await gallery.recordView(ben, viewed.id);
		await gallery.addTag(ben, tagged.id, { label: "group photo" });
		await gallery.addTag(ben, tagged.id, { memberId: "ana" });
		const ids = async (sort: "loved" | "viewed" | "tagged" | "recent") => (await gallery.browse(ana, { sort })).items.map((item) => item.id);
		expect(await ids("loved")).toEqual([loved.id, viewed.id]);
		expect(await ids("viewed")).toEqual([viewed.id]);
		expect(await ids("tagged")).toEqual([tagged.id]);
		expect(await ids("recent")).toHaveLength(4);
		expect((await ids("recent")).includes(quiet.id)).toBe(true);
	});

	it("finds photos by caption, topic, tagged person and event, and albums by name", async () => {
		const album = await gallery.createFolder(ana, { name: "Summit Day 1", parentId: null });
		const captioned = await upload(ana, { caption: "Sunset at the venue", folderId: album });
		const topical = await upload(ana);
		await gallery.addTag(ben, topical.id, { label: "Awarding" });
		const person = await upload(ana);
		await gallery.addTag(ben, person.id, { memberId: "keeper" });
		const evented = await upload(ana, { eventId: "evt" });
		const find = async (q: string) => (await gallery.browse(ana, { sort: "recent", q })).items.map((item) => item.id);
		expect(await find("sunset")).toEqual([captioned.id]);
		expect(await find("award")).toEqual([topical.id]);
		expect(await find("keep")).toEqual([person.id]);
		expect(await find("retreat")).toEqual([evented.id]);
		expect((await gallery.browse(ana, { sort: "recent", q: "summit" })).albums.map((card) => card.name)).toEqual(["Summit Day 1"]);
		expect((await gallery.browse(ana, { sort: "recent", personId: "keeper" })).items.map((item) => item.id)).toEqual([person.id]);
	});

	it("leaves out photos hidden by a deleted album", async () => {
		const album = await gallery.createFolder(ana, { name: "Gone", parentId: null });
		await upload(ana, { folderId: album, caption: "hidden one" });
		await gallery.deleteFolder(ana, album);
		expect((await gallery.browse(ana, { sort: "recent", q: "hidden" })).items).toEqual([]);
	});
});

describe("gallery event albums", () => {
	it("gives each ended, approved event one album, and skips the rest", async () => {
		await insertEvent("past", { title: "General Assembly" });
		await insertEvent("future", { startsAt: Date.now() + 5 * DAY });
		await insertEvent("pending", { status: "pending" });
		await insertEvent("bday", { type: "birthday" });
		await insertEvent("notice", { readOnly: true });
		expect(await ensureEventAlbums(db)).toBe(1);
		expect(await ensureEventAlbums(db)).toBe(0);
		expect((await eventAlbums()).map((album) => [album.eventId, album.name])).toEqual([["past", "General Assembly"]]);
		expect(await gallery.eventAlbum(ana, "past")).toEqual({ id: (await eventAlbums())[0].id });
		expect(await gallery.eventAlbum(ana, "future")).toBeNull();
	});

	it("does not remake an album that waits in Recently deleted", async () => {
		await insertEvent("past");
		await ensureEventAlbums(db);
		const [album] = await eventAlbums();
		await gallery.deleteFolder(ben, album.id);
		expect(await ensureEventAlbums(db)).toBe(0);
		expect(await gallery.eventAlbum(ana, "past")).toBeNull();
	});
});

describe("gallery front page", () => {
	const now = new Date("2026-10-23T00:00:00+08:00");
	async function schoolYear() {
		await env.DB.prepare("DELETE FROM terms").run();
		await env.DB.prepare("INSERT INTO terms (id, name, retained_at, probation_below, starts_at, ends_at) VALUES ('sy25', 'SY 2025-2026', 10, 5, ?, ?)")
			.bind(new Date("2025-08-01T00:00:00+08:00").getTime(), new Date("2026-05-31T00:00:00+08:00").getTime())
			.run();
	}

	it("puts recent events first, hides old empty ones, and keeps member albums apart", async () => {
		await schoolYear();
		await insertEvent("fresh", { title: "Leadership Summit", startsAt: now.getTime() - 5 * DAY });
		await insertEvent("old-full", { title: "Christmas Party", startsAt: new Date("2025-12-12T18:00:00+08:00").getTime() });
		await insertEvent("old-empty", { title: "Org Fair", startsAt: new Date("2025-09-01T10:00:00+08:00").getTime() });
		await insertEvent("ancient", { title: "Founding Day", startsAt: new Date("2024-03-01T10:00:00+08:00").getTime() });
		await ensureEventAlbums(db, now);
		const albumFor = async (eventId: string) => (await eventAlbums()).find((album) => album.eventId === eventId)!.id;
		await upload(ana, { folderId: await albumFor("old-full") });
		await upload(ana, { folderId: await albumFor("ancient") });
		const mine = await gallery.createFolder(ana, { name: "Org shirts", parentId: null });
		const tagged = await upload(ben, { folderId: mine });
		await gallery.addTag(ben, tagged.id, { memberId: "ana" });
		await gallery.setHeart(ben, tagged.id, true);
		await upload(ana);

		const home = await gallery.homeView(ana, now);
		expect(home.recentEvents.map((card) => card.name)).toEqual(["Leadership Summit", "Christmas Party", "Founding Day"]);
		expect(home.archive).toEqual([]);
		expect(home.albums.map((card) => card.name)).toEqual(["Org shirts"]);
		expect(home.highlights.sort).toBe("loved");
		expect(home.highlights.items.map((item) => item.id)).toEqual([tagged.id]);
		expect([home.looseCount, home.photosOfMe]).toEqual([1, 1]);
		await env.DB.prepare("DELETE FROM terms").run();
	});

	it("moves event albums past the first six into their school year", async () => {
		await schoolYear();
		const dates = ["2025-07-15", "2025-08-15", "2025-09-15", "2025-10-15", "2025-11-15", "2025-12-15", "2026-01-15", "2026-02-15"];
		for (const [index, date] of dates.entries()) {
			await insertEvent(`e${index + 1}`, { title: `Event ${index + 1}`, startsAt: new Date(`${date}T10:00:00+08:00`).getTime() });
		}
		await ensureEventAlbums(db, now);
		for (const album of await eventAlbums()) await upload(ana, { folderId: album.id });
		const home = await gallery.homeView(ana, now);
		expect(home.recentEvents.map((card) => card.name)).toEqual(["Event 8", "Event 7", "Event 6", "Event 5", "Event 4", "Event 3"]);
		expect(home.archive.map((group) => [group.name, group.albums.map((card) => card.name)])).toEqual([
			["SY 2025-2026", ["Event 2"]],
			["Earlier", ["Event 1"]],
		]);
		await env.DB.prepare("DELETE FROM terms").run();
	});
});
