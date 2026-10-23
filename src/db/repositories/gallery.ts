import { and, desc, eq, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { auditLogs, crsEvents, galleryFolders, galleryHearts, galleryItems, galleryTags, members, terms, type GalleryItemKind, type GalleryTagKind } from "@/db/schema";
import { createId } from "@/lib/ids";
import { createFolderTree, daysLeft, purgeCutoff, type FolderTree } from "@/lib/gallery/tree";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type * as schema from "../schema";
import { auditInsertValues, type AuditRecordInput } from "./audit";

type Db = DrizzleD1Database<typeof schema>;
type Folder = InferSelectModel<typeof galleryFolders>;
export type GalleryItem = InferSelectModel<typeof galleryItems>;
type Tree = FolderTree<Folder>;

export type GalleryItemView = Pick<
	GalleryItem,
	| "id"
	| "folderId"
	| "kind"
	| "fileKey"
	| "posterKey"
	| "contentType"
	| "sizeBytes"
	| "durationSeconds"
	| "originalName"
	| "caption"
	| "takenAt"
	| "eventId"
	| "uploadedBy"
	| "createdAt"
	| "viewCount"
> & { uploaderName: string; eventTitle: string | null; heartCount: number; hearted: boolean; tags: GalleryTagView[] };

/** A person tag's label is the member's current name; a topic tag's is what was typed. */
export type GalleryTagView = { id: string; kind: GalleryTagKind; memberId: string | null; label: string };

export type GalleryCover = Pick<GalleryItem, "fileKey" | "posterKey" | "kind">;
export type GalleryFolderCard = {
	id: string;
	name: string;
	isPublic: boolean;
	isEventAlbum: boolean;
	/** When the album's event started, for event albums and albums tagged with an event. */
	eventDate: Date | null;
	itemCount: number;
	folderCount: number;
	/** Newest upload directly inside, for sorting albums by activity. */
	latestAt: Date | null;
	cover: GalleryCover | null;
};
export type GalleryCrumb = { id: string; name: string };

export type GalleryFolderView = {
	/** Null at the top level. */
	folder: (Pick<Folder, "id" | "name" | "parentId" | "eventId" | "isPublic"> & { eventTitle: string | null; publicFromParent: boolean }) | null;
	path: GalleryCrumb[];
	folders: GalleryFolderCard[];
	items: GalleryItemView[];
	/** The event untagged photos here belong to: this folder's tag, or the nearest one above it. */
	inheritedEvent: { id: string; title: string } | null;
};

export type GalleryDeletedItem = GalleryItemView & { deletedAt: Date; deletedByName: string; daysLeft: number; canRestore: boolean };
export type GalleryDeletedFolder = {
	id: string;
	name: string;
	itemCount: number;
	cover: GalleryCover | null;
	deletedAt: Date;
	deletedByName: string;
	daysLeft: number;
	canRestore: boolean;
};
export type GalleryDeletedView = { items: GalleryDeletedItem[]; folders: GalleryDeletedFolder[]; seesEveryone: boolean };

/** What the public site may show: no uploader, nothing about members. */
export type GalleryPublicItem = Pick<GalleryItem, "id" | "kind" | "fileKey" | "posterKey" | "contentType" | "durationSeconds" | "caption" | "takenAt">;
export type GalleryPublicView = { folder: { id: string; name: string } | null; path: GalleryCrumb[]; folders: GalleryFolderCard[]; items: GalleryPublicItem[] };

/** For move pickers. `isPublic` includes public folders above it, so a picker can warn that moving there publishes. */
export type GalleryFolderOption = { id: string; name: string; parentId: string | null; depth: number; isPublic: boolean };
export type GalleryEventOption = { id: string; title: string; startsAt: Date };

export type CreateGalleryItemInput = {
	id: string;
	folderId: string | null;
	kind: GalleryItemKind;
	fileKey: string;
	posterKey: string | null;
	contentType: string;
	sizeBytes: number;
	durationSeconds: number | null;
	originalName: string;
	caption: string | null;
	takenAt: Date | null;
	eventId: string | null;
};

/** How a list of photos is ordered. Every mode except recent only lists photos that have some of what it counts. */
export type GallerySort = "recent" | "loved" | "viewed" | "tagged";
export type GalleryBrowseInput = { sort: GallerySort; q?: string; personId?: string };
export type GalleryBrowseView = { items: GalleryItemView[]; albums: GalleryFolderCard[] };
export type GalleryMemberOption = { id: string; name: string };

/**
 * The gallery's front page. Recent events lead (empty ones too, while the event is recent, so there is always
 * somewhere to put new photos); older event albums with photos fold into school years; member albums sit apart.
 */
export type GalleryHomeView = {
	recentEvents: GalleryFolderCard[];
	albums: GalleryFolderCard[];
	archive: { key: string; name: string; albums: GalleryFolderCard[] }[];
	highlights: { sort: GallerySort; items: GalleryItemView[] };
	/** Photos sitting at the top level, outside any album. */
	looseCount: number;
	photosOfMe: number;
};

export type GalleryItemPatch = { caption?: string | null; takenAt?: Date | null; eventId?: string | null };
export type GalleryFolderPatch = { name?: string; eventId?: string | null; isPublic?: boolean };

export type GalleryRepository = {
	folderView(actor: Actor, folderId: string | null): Promise<GalleryFolderView | null>;
	eventItems(actor: Actor, eventId: string): Promise<GalleryItemView[]>;
	publicView(folderId: string | null): Promise<GalleryPublicView | null>;
	folderOptions(actor: Actor): Promise<GalleryFolderOption[]>;
	eventOptions(actor: Actor): Promise<GalleryEventOption[]>;
	createItem(actor: Actor, input: CreateGalleryItemInput): Promise<GalleryItem>;
	updateItem(actor: Actor, itemId: string, patch: GalleryItemPatch): Promise<void>;
	moveItems(actor: Actor, itemIds: string[], folderId: string | null): Promise<void>;
	deleteItems(actor: Actor, itemIds: string[]): Promise<void>;
	createFolder(actor: Actor, input: { name: string; parentId: string | null }): Promise<string>;
	updateFolder(actor: Actor, folderId: string, patch: GalleryFolderPatch): Promise<void>;
	moveFolder(actor: Actor, folderId: string, parentId: string | null): Promise<void>;
	deleteFolder(actor: Actor, folderId: string): Promise<void>;
	listDeleted(actor: Actor, now?: Date): Promise<GalleryDeletedView>;
	restore(actor: Actor, input: { itemIds: string[]; folderIds: string[] }): Promise<void>;
	homeView(actor: Actor, now?: Date): Promise<GalleryHomeView>;
	browse(actor: Actor, input: GalleryBrowseInput): Promise<GalleryBrowseView>;
	/** The event's own album, made first if the event has ended. Null for an event that has not ended or does not get one. */
	eventAlbum(actor: Actor, eventId: string, now?: Date): Promise<{ id: string } | null>;
	recordView(actor: Actor, itemId: string): Promise<void>;
	setHeart(actor: Actor, itemId: string, on: boolean): Promise<{ heartCount: number }>;
	addTag(actor: Actor, itemId: string, input: { memberId: string } | { label: string }): Promise<void>;
	removeTag(actor: Actor, tagId: string): Promise<void>;
	memberOptions(actor: Actor): Promise<GalleryMemberOption[]>;
	/** For the storage proxy. A null actor is a signed-out visitor, who may only read public items. */
	canReadObject(actor: Actor | null, itemId: string): Promise<boolean>;
};

// D1 allows 100 bound parameters per statement.
const ID_CHUNK = 90;
const MAX_NAME = 120;
const MAX_CAPTION = 2000;
const MAX_TOPIC = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
/** An event album stays on the front page, even empty, for this long after its event. */
export const RECENT_EVENT_DAYS = 60;
const RECENT_EVENT_LIMIT = 6;
const BROWSE_LIMIT = 120;

const STALE = "Some of these were moved or deleted by someone else. Refresh and try again.";

/** Restoring other people's deletions and publishing folders. Super admins pass every can() check. */
export const canManageGallery = (actor: Actor) => can(actor, "gallery:manage");

async function inChunks<T, R>(values: T[], run: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
	const out: R[] = [];
	for (let start = 0; start < values.length; start += ID_CHUNK) out.push(...(await run(values.slice(start, start + ID_CHUNK))));
	return out;
}

async function commit(db: Db, statements: BatchItem<"sqlite">[]): Promise<void> {
	const [first, ...rest] = statements;
	if (first) await db.batch([first, ...rest]);
}

const newestFirst = [desc(sql`coalesce(${galleryItems.takenAt}, ${galleryItems.createdAt})`), desc(galleryItems.createdAt)];

async function loadTree(db: Db): Promise<Tree> {
	return createFolderTree(await db.select().from(galleryFolders));
}

async function namesFor(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
	const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
	const rows = await inChunks(unique, (chunk) =>
		db.select({ id: members.id, fullName: members.fullName, name: members.name, email: members.email }).from(members).where(inArray(members.id, chunk)),
	);
	return new Map(rows.map((row) => [row.id, row.fullName ?? row.name ?? row.email]));
}

async function eventTitles(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
	const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
	const rows = await inChunks(unique, (chunk) => db.select({ id: crsEvents.id, title: crsEvents.title }).from(crsEvents).where(inArray(crsEvents.id, chunk)));
	return new Map(rows.map((row) => [row.id, row.title]));
}

type Decorated = GalleryItem & { uploaderName: string; eventTitle: string | null; heartCount: number; hearted: boolean; tags: GalleryTagView[] };

async function decorate(db: Db, items: GalleryItem[], viewerId: string | null): Promise<Decorated[]> {
	const ids = items.map((item) => item.id);
	const [names, titles, heartRows, mine, tagRows] = await Promise.all([
		namesFor(db, items.map((item) => item.uploadedBy)),
		eventTitles(db, items.map((item) => item.eventId)),
		inChunks(ids, (chunk) =>
			db.select({ itemId: galleryHearts.itemId, count: sql<number>`count(*)` }).from(galleryHearts).where(inArray(galleryHearts.itemId, chunk)).groupBy(galleryHearts.itemId),
		),
		viewerId
			? inChunks(ids, (chunk) => db.select({ itemId: galleryHearts.itemId }).from(galleryHearts).where(and(inArray(galleryHearts.itemId, chunk), eq(galleryHearts.memberId, viewerId))))
			: Promise.resolve([]),
		inChunks(ids, (chunk) =>
			db
				.select({ id: galleryTags.id, itemId: galleryTags.itemId, kind: galleryTags.kind, memberId: galleryTags.memberId, label: galleryTags.label })
				.from(galleryTags)
				.where(inArray(galleryTags.itemId, chunk))
				.orderBy(galleryTags.createdAt),
		),
	]);
	const people = await namesFor(db, tagRows.map((tag) => tag.memberId));
	const hearts = new Map(heartRows.map((row) => [row.itemId, Number(row.count)]));
	const hearted = new Set(mine.map((row) => row.itemId));
	const tags = new Map<string, GalleryTagView[]>();
	for (const tag of tagRows) {
		const label = (tag.memberId && people.get(tag.memberId)) || tag.label;
		tags.set(tag.itemId, [...(tags.get(tag.itemId) ?? []), { id: tag.id, kind: tag.kind, memberId: tag.memberId, label }]);
	}
	return items.map((item) => ({
		...item,
		// The email snapshot keeps the uploader identifiable after their member row is gone.
		uploaderName: (item.uploadedBy && names.get(item.uploadedBy)) || item.uploaderEmail,
		eventTitle: item.eventId ? titles.get(item.eventId) ?? null : null,
		heartCount: hearts.get(item.id) ?? 0,
		hearted: hearted.has(item.id),
		tags: tags.get(item.id) ?? [],
	}));
}

function toView(item: Decorated): GalleryItemView {
	return {
		id: item.id,
		folderId: item.folderId,
		kind: item.kind,
		fileKey: item.fileKey,
		posterKey: item.posterKey,
		contentType: item.contentType,
		sizeBytes: item.sizeBytes,
		durationSeconds: item.durationSeconds,
		originalName: item.originalName,
		caption: item.caption,
		takenAt: item.takenAt,
		eventId: item.eventId,
		uploadedBy: item.uploadedBy,
		createdAt: item.createdAt,
		viewCount: item.viewCount,
		uploaderName: item.uploaderName,
		eventTitle: item.eventTitle,
		heartCount: item.heartCount,
		hearted: item.hearted,
		tags: item.tags,
	};
}

/** Live item count and newest item of each folder, counting only items directly inside it. */
async function folderStats(db: Db, folderIds: string[]): Promise<Map<string, { count: number; latestAt: Date; cover: GalleryCover }>> {
	const rows = await inChunks(folderIds, async (chunk) => {
		const ranked = db
			.select({
				folderId: galleryItems.folderId,
				fileKey: galleryItems.fileKey,
				posterKey: galleryItems.posterKey,
				kind: galleryItems.kind,
				count: sql<number>`count(*) over (partition by ${galleryItems.folderId})`.as("count"),
				latest: sql<number>`max(${galleryItems.createdAt}) over (partition by ${galleryItems.folderId})`.as("latest"),
				rank: sql<number>`row_number() over (partition by ${galleryItems.folderId} order by coalesce(${galleryItems.takenAt}, ${galleryItems.createdAt}) desc)`.as("rank"),
			})
			.from(galleryItems)
			.where(and(inArray(galleryItems.folderId, chunk), isNull(galleryItems.deletedAt)))
			.as("ranked");
		return db.select().from(ranked).where(eq(ranked.rank, 1));
	});
	return new Map(
		rows.map((row) => [row.folderId as string, { count: Number(row.count), latestAt: new Date(Number(row.latest)), cover: { fileKey: row.fileKey, posterKey: row.posterKey, kind: row.kind } }]),
	);
}

async function folderCards(db: Db, tree: Tree, folders: Folder[]): Promise<GalleryFolderCard[]> {
	const eventIds = [...new Set(folders.map((folder) => folder.eventId).filter((id): id is string => Boolean(id)))];
	const [stats, events] = await Promise.all([
		folderStats(db, folders.map((folder) => folder.id)),
		inChunks(eventIds, (chunk) => db.select({ id: crsEvents.id, startsAt: crsEvents.startsAt }).from(crsEvents).where(inArray(crsEvents.id, chunk))),
	]);
	const eventDates = new Map(events.map((event) => [event.id, event.startsAt]));
	return folders
		.map((folder) => ({
			id: folder.id,
			name: folder.name,
			isPublic: folder.isPublic,
			isEventAlbum: folder.isEventAlbum,
			eventDate: folder.eventId ? eventDates.get(folder.eventId) ?? null : null,
			itemCount: stats.get(folder.id)?.count ?? 0,
			folderCount: tree.children(folder.id).length,
			latestAt: stats.get(folder.id)?.latestAt ?? null,
			cover: stats.get(folder.id)?.cover ?? null,
		}))
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

const folderLabel = (tree: Tree, folderId: string | null) =>
	folderId === null ? "the top level" : `"${tree.path(folderId).map((folder) => folder.name).join(" / ")}"`;

function cleanName(name: string): string {
	const trimmed = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
	if (!trimmed) throw new Error("Give the album a name.");
	return trimmed;
}

const cleanCaption = (caption: string | null | undefined) => caption?.trim().slice(0, MAX_CAPTION) || null;

function audit(actor: Actor, input: Omit<AuditRecordInput, "category">) {
	return auditInsertValues(actor, { ...input, category: "gallery" });
}

/** The cron acts for nobody. The detail carries what a reader needs once the row it points at is gone. */
function systemAudit(input: Omit<AuditRecordInput, "category">): InferInsertModel<typeof auditLogs> {
	return {
		id: createId("aud"),
		actorMemberId: null,
		actorContext: "system",
		action: input.action,
		targetType: input.targetType,
		targetId: input.targetId,
		detail: input.detail ?? null,
		targetMemberId: input.targetMemberId ?? null,
		category: "gallery",
	};
}

async function assertEvent(db: Db, eventId: string | null | undefined): Promise<void> {
	if (!eventId) return;
	const [event] = await db.select({ id: crsEvents.id }).from(crsEvents).where(and(eq(crsEvents.id, eventId), isNull(crsEvents.deletedAt))).limit(1);
	if (!event) throw new Error("That event no longer exists.");
}

function assertLiveFolder(tree: Tree, folderId: string | null): void {
	if (!tree.isLive(folderId)) throw new Error("That album no longer exists.");
}

/** Every requested item, visible (not deleted, folder chain live). Throws if any is missing so a stale screen never half-applies. */
async function liveItems(db: Db, tree: Tree, itemIds: string[]): Promise<GalleryItem[]> {
	const ids = [...new Set(itemIds)];
	if (ids.length === 0) throw new Error("Choose at least one photo or video.");
	const rows = await inChunks(ids, (chunk) => db.select().from(galleryItems).where(and(inArray(galleryItems.id, chunk), isNull(galleryItems.deletedAt))));
	const live = rows.filter((item) => tree.isLive(item.folderId));
	if (live.length !== ids.length) throw new Error(ids.length === 1 ? "That photo or video no longer exists." : STALE);
	return live;
}

function liveFolder(tree: Tree, folderId: string): Folder {
	const folder = tree.get(folderId);
	if (!folder || !tree.isLive(folderId)) throw new Error("That album no longer exists.");
	return folder;
}

export function createGalleryRepository(db: Db): GalleryRepository {
	const heartCount = sql<number>`(select count(*) from ${galleryHearts} where ${galleryHearts.itemId} = ${galleryItems.id})`;
	const tagCount = sql<number>`(select count(*) from ${galleryTags} where ${galleryTags.itemId} = ${galleryItems.id})`;

	/**
	 * Photos across every album. Search matches captions, topics, tagged people (by their current name) and the
	 * photo's own event; album names and event titles match albums, returned separately.
	 * ponytail: LIKE scans; add an FTS table if the gallery reaches tens of thousands of photos.
	 */
	async function browseItems(actor: Actor, input: GalleryBrowseInput): Promise<GalleryBrowseView> {
		const query = (input.q ?? "").replace(/[%_\\]/g, " ").trim().toLowerCase();
		const pattern = `%${query}%`;
		const conditions: (SQL | undefined)[] = [isNull(galleryItems.deletedAt)];
		if (input.personId) {
			conditions.push(
				sql`exists (select 1 from ${galleryTags} where ${galleryTags.itemId} = ${galleryItems.id} and ${galleryTags.kind} = 'person' and ${galleryTags.memberId} = ${input.personId})`,
			);
		}
		if (query) {
			conditions.push(sql`(
				lower(coalesce(${galleryItems.caption}, '')) like ${pattern}
				or exists (select 1 from ${galleryTags} where ${galleryTags.itemId} = ${galleryItems.id} and lower(${galleryTags.label}) like ${pattern})
				or exists (select 1 from ${galleryTags} join ${members} on ${members.id} = ${galleryTags.memberId}
					where ${galleryTags.itemId} = ${galleryItems.id}
					and (lower(coalesce(${members.fullName}, '')) like ${pattern} or lower(coalesce(${members.name}, '')) like ${pattern} or lower(coalesce(${members.nickname}, '')) like ${pattern}))
				or exists (select 1 from ${crsEvents} where ${crsEvents.id} = ${galleryItems.eventId} and lower(${crsEvents.title}) like ${pattern})
			)`);
		}
		const order =
			input.sort === "loved"
				? [desc(heartCount), desc(galleryItems.viewCount), desc(galleryItems.createdAt)]
				: input.sort === "viewed"
					? [desc(galleryItems.viewCount), desc(heartCount), desc(galleryItems.createdAt)]
					: input.sort === "tagged"
						? [desc(tagCount), desc(galleryItems.createdAt)]
						: [desc(galleryItems.createdAt)];
		if (input.sort === "loved") conditions.push(sql`${heartCount} > 0`);
		if (input.sort === "viewed") conditions.push(sql`${galleryItems.viewCount} > 0`);
		if (input.sort === "tagged") conditions.push(sql`${tagCount} > 0`);
		const tree = await loadTree(db);
		// Photos hidden by a deleted album are dropped after the query, so read a little extra.
		const rows = (await db.select().from(galleryItems).where(and(...conditions)).orderBy(...order).limit(BROWSE_LIMIT + 80))
			.filter((item) => tree.isLive(item.folderId))
			.slice(0, BROWSE_LIMIT);
		let albums: GalleryFolderCard[] = [];
		if (query) {
			const live = tree.all().filter((folder) => tree.isLive(folder.id));
			const titles = await eventTitles(db, live.map((folder) => folder.eventId));
			const matches = live.filter((folder) => folder.name.toLowerCase().includes(query) || (folder.eventId && titles.get(folder.eventId)?.toLowerCase().includes(query)));
			albums = (await folderCards(db, tree, matches.slice(0, 24))).filter((card) => card.itemCount > 0 || card.folderCount > 0 || !card.isEventAlbum);
		}
		return { items: (await decorate(db, rows, actor.memberId)).map(toView), albums };
	}

	/** A few photos for the front page: the most loved, else the most viewed, else the newest. */
	async function highlightsFor(actor: Actor): Promise<GalleryHomeView["highlights"]> {
		for (const sort of ["loved", "viewed", "recent"] as const) {
			const { items } = await browseItems(actor, { sort });
			if (items.length) return { sort, items: items.slice(0, 7) };
		}
		return { sort: "recent", items: [] };
	}

	return {
		async folderView(actor, folderId) {
			const tree = await loadTree(db);
			if (!tree.isLive(folderId)) return null;
			const folder = folderId ? tree.get(folderId)! : null;
			const inheritedId = tree.eventId(folderId);
			const [rows, cards, titles] = await Promise.all([
				db
					.select()
					.from(galleryItems)
					.where(and(folderId ? eq(galleryItems.folderId, folderId) : isNull(galleryItems.folderId), isNull(galleryItems.deletedAt)))
					.orderBy(...newestFirst),
				folderCards(db, tree, tree.children(folderId)),
				eventTitles(db, [folder?.eventId ?? null, inheritedId]),
			]);
			return {
				folder: folder
					? {
							id: folder.id,
							name: folder.name,
							parentId: folder.parentId,
							eventId: folder.eventId,
							isPublic: folder.isPublic,
							eventTitle: folder.eventId ? titles.get(folder.eventId) ?? null : null,
							publicFromParent: tree.isPublic(folder.parentId),
						}
					: null,
				path: tree.path(folderId).map(({ id, name }) => ({ id, name })),
				folders: cards,
				items: (await decorate(db, rows, actor.memberId)).map(toView),
				inheritedEvent: inheritedId && titles.has(inheritedId) ? { id: inheritedId, title: titles.get(inheritedId)! } : null,
			};
		},

		async eventItems(actor, eventId) {
			const tree = await loadTree(db);
			// A photo's own event tag wins; an untagged photo takes the nearest tag of the folders above it.
			const folderIds = tree
				.all()
				.map(({ id }) => id)
				.filter((id) => tree.isLive(id) && tree.eventId(id) === eventId);
			const [direct, inherited] = await Promise.all([
				db.select().from(galleryItems).where(and(eq(galleryItems.eventId, eventId), isNull(galleryItems.deletedAt))),
				inChunks(folderIds, (chunk) =>
					db.select().from(galleryItems).where(and(inArray(galleryItems.folderId, chunk), isNull(galleryItems.eventId), isNull(galleryItems.deletedAt))),
				),
			]);
			const items = [...direct.filter((item) => tree.isLive(item.folderId)), ...inherited].sort(
				(a, b) => (b.takenAt ?? b.createdAt).getTime() - (a.takenAt ?? a.createdAt).getTime() || b.createdAt.getTime() - a.createdAt.getTime(),
			);
			return (await decorate(db, items, actor.memberId)).map(toView);
		},

		async publicView(folderId) {
			const tree = await loadTree(db);
			const card = (items: GalleryItem[]) =>
				items.map(({ id, kind, fileKey, posterKey, contentType, durationSeconds, caption, takenAt }) => ({ id, kind, fileKey, posterKey, contentType, durationSeconds, caption, takenAt }));
			if (folderId === null) {
				// The top of the public gallery lists each public folder that is not already inside another public folder.
				const roots = (await db.select().from(galleryFolders).where(eq(galleryFolders.isPublic, true))).filter(
					(folder) => tree.isLive(folder.id) && !tree.isPublic(folder.parentId),
				);
				return { folder: null, path: [], folders: await folderCards(db, tree, roots), items: [] };
			}
			if (!tree.isLive(folderId) || !tree.isPublic(folderId)) return null;
			const folder = tree.get(folderId)!;
			const [rows, cards] = await Promise.all([
				db.select().from(galleryItems).where(and(eq(galleryItems.folderId, folderId), isNull(galleryItems.deletedAt))).orderBy(...newestFirst),
				folderCards(db, tree, tree.children(folderId)),
			]);
			return {
				folder: { id: folder.id, name: folder.name },
				path: tree.publicPath(folderId).map(({ id, name }) => ({ id, name })),
				folders: cards,
				items: card(rows),
			};
		},

		async folderOptions() {
			const tree = await loadTree(db);
			const out: GalleryFolderOption[] = [];
			const walk = (parentId: string | null, depth: number) => {
				for (const folder of tree.children(parentId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
					out.push({ id: folder.id, name: folder.name, parentId, depth, isPublic: tree.isPublic(folder.id) });
					walk(folder.id, depth + 1);
				}
			};
			walk(null, 0);
			return out;
		},

		async eventOptions() {
			return db
				.select({ id: crsEvents.id, title: crsEvents.title, startsAt: crsEvents.startsAt })
				.from(crsEvents)
				.where(isNull(crsEvents.deletedAt))
				.orderBy(desc(crsEvents.startsAt))
				.limit(150);
		},

		async createItem(actor, input) {
			const prefix = `gallery/${input.id}/${actor.memberId}/`;
			if (!input.fileKey.startsWith(prefix) || (input.posterKey && !input.posterKey.startsWith(prefix))) {
				throw new Error("Upload keys are assigned by the server.");
			}
			const tree = await loadTree(db);
			assertLiveFolder(tree, input.folderId);
			await assertEvent(db, input.eventId);
			const [uploader] = await db.select({ email: members.email }).from(members).where(eq(members.id, actor.memberId)).limit(1);
			if (!uploader) throw new Error("Authentication required.");
			const item: InferInsertModel<typeof galleryItems> = {
				id: input.id,
				folderId: input.folderId,
				kind: input.kind,
				fileKey: input.fileKey,
				posterKey: input.posterKey,
				contentType: input.contentType,
				sizeBytes: input.sizeBytes,
				durationSeconds: input.durationSeconds,
				originalName: input.originalName.trim().slice(0, 255) || "Untitled",
				caption: cleanCaption(input.caption),
				takenAt: input.takenAt,
				eventId: input.eventId,
				uploadedBy: actor.memberId,
				uploaderEmail: uploader.email,
			};
			await commit(db, [
				db.insert(galleryItems).values(item),
				db.insert(auditLogs).values(
					audit(actor, {
						action: "gallery:upload",
						targetType: "gallery_item",
						targetId: input.id,
						targetMemberId: actor.memberId,
						detail: `${item.originalName} into ${folderLabel(tree, input.folderId)}`,
					}),
				),
			]);
			const [created] = await db.select().from(galleryItems).where(eq(galleryItems.id, input.id)).limit(1);
			return created;
		},

		async updateItem(actor, itemId, patch) {
			const tree = await loadTree(db);
			const [item] = await liveItems(db, tree, [itemId]);
			const set: Partial<InferInsertModel<typeof galleryItems>> = {};
			const changed: string[] = [];
			if ("caption" in patch && cleanCaption(patch.caption) !== item.caption) {
				set.caption = cleanCaption(patch.caption);
				changed.push("caption");
			}
			if ("takenAt" in patch && (patch.takenAt?.getTime() ?? null) !== (item.takenAt?.getTime() ?? null)) {
				set.takenAt = patch.takenAt ?? null;
				changed.push("date");
			}
			if ("eventId" in patch && (patch.eventId ?? null) !== item.eventId) {
				await assertEvent(db, patch.eventId);
				set.eventId = patch.eventId ?? null;
				changed.push("event");
			}
			if (changed.length === 0) return;
			await commit(db, [
				db.update(galleryItems).set({ ...set, updatedAt: new Date() }).where(eq(galleryItems.id, itemId)),
				db.insert(auditLogs).values(
					audit(actor, { action: "gallery:edit", targetType: "gallery_item", targetId: itemId, targetMemberId: item.uploadedBy, detail: `${item.originalName}: ${changed.join(", ")}` }),
				),
			]);
		},

		async moveItems(actor, itemIds, folderId) {
			const tree = await loadTree(db);
			assertLiveFolder(tree, folderId);
			const moving = (await liveItems(db, tree, itemIds)).filter((item) => item.folderId !== folderId);
			const now = new Date();
			await commit(db, [
				...moving.map((item) => db.update(galleryItems).set({ folderId, updatedAt: now }).where(eq(galleryItems.id, item.id))),
				...moving.map((item) =>
					db.insert(auditLogs).values(
						audit(actor, {
							action: "gallery:move",
							targetType: "gallery_item",
							targetId: item.id,
							targetMemberId: item.uploadedBy,
							detail: `${item.originalName}: from ${folderLabel(tree, item.folderId)} to ${folderLabel(tree, folderId)}`,
						}),
					),
				),
			]);
		},

		async deleteItems(actor, itemIds) {
			const tree = await loadTree(db);
			const items = await liveItems(db, tree, itemIds);
			const now = new Date();
			await commit(db, [
				...items.map((item) => db.update(galleryItems).set({ deletedAt: now, deletedBy: actor.memberId }).where(eq(galleryItems.id, item.id))),
				...items.map((item) =>
					db.insert(auditLogs).values(
						audit(actor, {
							action: "gallery:delete",
							targetType: "gallery_item",
							targetId: item.id,
							targetMemberId: item.uploadedBy,
							detail: `${item.originalName} from ${folderLabel(tree, item.folderId)}`,
						}),
					),
				),
			]);
		},

		async createFolder(actor, input) {
			const tree = await loadTree(db);
			assertLiveFolder(tree, input.parentId);
			const id = createId("gfd");
			const name = cleanName(input.name);
			await commit(db, [
				db.insert(galleryFolders).values({ id, parentId: input.parentId, name, createdBy: actor.memberId }),
				db.insert(auditLogs).values(audit(actor, { action: "gallery:folder_create", targetType: "gallery_folder", targetId: id, detail: `${name} in ${folderLabel(tree, input.parentId)}` })),
			]);
			return id;
		},

		async updateFolder(actor, folderId, patch) {
			const tree = await loadTree(db);
			const folder = liveFolder(tree, folderId);
			const set: Partial<InferInsertModel<typeof galleryFolders>> = {};
			const changed: string[] = [];
			if (patch.name !== undefined && cleanName(patch.name) !== folder.name) {
				set.name = cleanName(patch.name);
				changed.push(`renamed from "${folder.name}" to "${set.name}"`);
			}
			if (patch.eventId !== undefined && patch.eventId !== folder.eventId) {
				await assertEvent(db, patch.eventId);
				set.eventId = patch.eventId;
				changed.push(patch.eventId ? "tagged an event" : "removed the event tag");
			}
			if (patch.isPublic !== undefined && patch.isPublic !== folder.isPublic) {
				// Publishing puts photos in front of anyone on the internet, so it is not an everyday member action.
				if (!canManageGallery(actor)) throw new Error("Only photo gallery admins can change what is public.");
				set.isPublic = patch.isPublic;
				changed.push(patch.isPublic ? "made public" : "made members-only");
			}
			if (changed.length === 0) return;
			await commit(db, [
				db.update(galleryFolders).set({ ...set, updatedAt: new Date() }).where(eq(galleryFolders.id, folderId)),
				db.insert(auditLogs).values(audit(actor, { action: "gallery:folder_edit", targetType: "gallery_folder", targetId: folderId, detail: `${folder.name}: ${changed.join(", ")}` })),
			]);
		},

		async moveFolder(actor, folderId, parentId) {
			const tree = await loadTree(db);
			const folder = liveFolder(tree, folderId);
			assertLiveFolder(tree, parentId);
			if (tree.wouldCycle(folderId, parentId)) throw new Error("An album cannot go inside itself.");
			if (folder.parentId === parentId) return;
			await commit(db, [
				db.update(galleryFolders).set({ parentId, updatedAt: new Date() }).where(eq(galleryFolders.id, folderId)),
				db.insert(auditLogs).values(
					audit(actor, {
						action: "gallery:folder_move",
						targetType: "gallery_folder",
						targetId: folderId,
						detail: `${folder.name}: from ${folderLabel(tree, folder.parentId)} to ${folderLabel(tree, parentId)}`,
					}),
				),
			]);
		},

		async deleteFolder(actor, folderId) {
			const tree = await loadTree(db);
			const folder = liveFolder(tree, folderId);
			// One row hides the whole subtree; restoring it brings everything back together.
			await commit(db, [
				db.update(galleryFolders).set({ deletedAt: new Date(), deletedBy: actor.memberId }).where(eq(galleryFolders.id, folderId)),
				db.insert(auditLogs).values(
					audit(actor, { action: "gallery:folder_delete", targetType: "gallery_folder", targetId: folderId, detail: `${folder.name} from ${folderLabel(tree, folder.parentId)}` }),
				),
			]);
		},

		async listDeleted(actor, now = new Date()) {
			const seesEveryone = canManageGallery(actor);
			const tree = await loadTree(db);
			const rows = await db
				.select()
				.from(galleryItems)
				.where(and(isNotNull(galleryItems.deletedAt), seesEveryone ? undefined : eq(galleryItems.deletedBy, actor.memberId)))
				.orderBy(desc(galleryItems.deletedAt));
			const folders = (await db.select().from(galleryFolders).where(isNotNull(galleryFolders.deletedAt)).orderBy(desc(galleryFolders.deletedAt))).filter(
				(folder) => seesEveryone || folder.deletedBy === actor.memberId,
			);
			const subtrees = new Map(folders.map((folder) => [folder.id, [folder.id, ...tree.descendants(folder.id).map((child) => child.id)]]));
			const [stats, deleters, items] = await Promise.all([
				folderStats(db, [...new Set([...subtrees.values()].flat())]),
				namesFor(db, [...rows.map((row) => row.deletedBy), ...folders.map((folder) => folder.deletedBy)]),
				decorate(db, rows, actor.memberId),
			]);
			const canRestore = (deletedBy: string | null) => seesEveryone || deletedBy === actor.memberId;
			return {
				seesEveryone,
				items: items.map((item) => ({
					...toView(item),
					deletedAt: item.deletedAt!,
					deletedByName: (item.deletedBy && deleters.get(item.deletedBy)) || "a deleted member",
					daysLeft: daysLeft(item.deletedAt!, now),
					canRestore: canRestore(item.deletedBy),
				})),
				folders: folders.map((folder) => {
					const inside = subtrees.get(folder.id)!.map((id) => stats.get(id)).filter((stat) => stat !== undefined);
					return {
						id: folder.id,
						name: folder.name,
						itemCount: inside.reduce((sum, stat) => sum + stat.count, 0),
						cover: inside[0]?.cover ?? null,
						deletedAt: folder.deletedAt!,
						deletedByName: (folder.deletedBy && deleters.get(folder.deletedBy)) || "a deleted member",
						daysLeft: daysLeft(folder.deletedAt!, now),
						canRestore: canRestore(folder.deletedBy),
					};
				}),
			};
		},

		async restore(actor, input) {
			const folderIds = [...new Set(input.folderIds)];
			const itemIds = [...new Set(input.itemIds)];
			if (folderIds.length + itemIds.length === 0) throw new Error("Choose something to restore.");
			const tree = await loadTree(db);
			const allowed = (deletedBy: string | null) => canManageGallery(actor) || deletedBy === actor.memberId;
			const folders = folderIds.map((id) => {
				const folder = tree.get(id);
				if (!folder?.deletedAt) throw new Error(STALE);
				if (!allowed(folder.deletedBy)) throw new Error("You can only restore what you deleted.");
				return folder;
			});
			const items = await inChunks(itemIds, (chunk) => db.select().from(galleryItems).where(and(inArray(galleryItems.id, chunk), isNotNull(galleryItems.deletedAt))));
			if (items.length !== itemIds.length) throw new Error(STALE);
			for (const item of items) if (!allowed(item.deletedBy)) throw new Error("You can only restore what you deleted.");

			// Undelete in memory first, so a photo restored along with its folder goes back into that folder.
			for (const folder of folders) folder.deletedAt = null;
			const statements: BatchItem<"sqlite">[] = [];
			const now = new Date();
			for (const folder of folders) {
				const parentId = tree.nearestLive(folder.parentId);
				const moved = parentId !== folder.parentId ? `, into ${folderLabel(tree, parentId)} because its album is gone` : "";
				statements.push(
					db.update(galleryFolders).set({ deletedAt: null, deletedBy: null, parentId, updatedAt: now }).where(eq(galleryFolders.id, folder.id)),
					db.insert(auditLogs).values(audit(actor, { action: "gallery:folder_restore", targetType: "gallery_folder", targetId: folder.id, detail: `${folder.name}${moved}` })),
				);
				folder.parentId = parentId;
			}
			for (const item of items) {
				const folderId = tree.nearestLive(item.folderId);
				const moved = folderId !== item.folderId ? `, into ${folderLabel(tree, folderId)} because its album is gone` : "";
				statements.push(
					db.update(galleryItems).set({ deletedAt: null, deletedBy: null, folderId, updatedAt: now }).where(eq(galleryItems.id, item.id)),
					db.insert(auditLogs).values(
						audit(actor, { action: "gallery:restore", targetType: "gallery_item", targetId: item.id, targetMemberId: item.uploadedBy, detail: `${item.originalName}${moved}` }),
					),
				);
			}
			await commit(db, statements);
		},

		async homeView(actor, now = new Date()) {
			// The cron makes event albums every minute; doing it here too covers environments without a cron.
			await ensureEventAlbums(db, now);
			const tree = await loadTree(db);
			const [cards, termRows, [loose], [mine], highlights] = await Promise.all([
				folderCards(db, tree, tree.children(null)),
				db.select({ id: terms.id, name: terms.name, startsAt: terms.startsAt, endsAt: terms.endsAt }).from(terms).orderBy(desc(terms.startsAt)),
				db.select({ count: sql<number>`count(*)` }).from(galleryItems).where(and(isNull(galleryItems.folderId), isNull(galleryItems.deletedAt))),
				db
					.select({ count: sql<number>`count(distinct ${galleryTags.itemId})` })
					.from(galleryTags)
					.innerJoin(galleryItems, eq(galleryItems.id, galleryTags.itemId))
					.where(and(eq(galleryTags.kind, "person"), eq(galleryTags.memberId, actor.memberId), isNull(galleryItems.deletedAt))),
				highlightsFor(actor),
			]);
			const hasPhotos = (card: GalleryFolderCard) => card.itemCount > 0 || card.folderCount > 0;
			const recent = (card: GalleryFolderCard) => card.eventDate !== null && now.getTime() - card.eventDate.getTime() < RECENT_EVENT_DAYS * DAY_MS;
			const byEventDate = (a: GalleryFolderCard, b: GalleryFolderCard) => (b.eventDate?.getTime() ?? 0) - (a.eventDate?.getTime() ?? 0);
			const eventAlbums = cards.filter((card) => card.isEventAlbum).sort(byEventDate);
			// An empty event album only shows while its event is recent; older empty ones wait, hidden, until someone fills them.
			const recentEvents = eventAlbums.filter((card) => hasPhotos(card) || recent(card)).slice(0, RECENT_EVENT_LIMIT);
			const shown = new Set(recentEvents.map((card) => card.id));
			const archive: GalleryHomeView["archive"] = [];
			for (const card of eventAlbums.filter((card) => !shown.has(card.id) && hasPhotos(card))) {
				const term = termRows.find((row) => card.eventDate && card.eventDate >= row.startsAt && card.eventDate <= row.endsAt);
				const key = term?.id ?? "earlier";
				const group = archive.find((entry) => entry.key === key) ?? archive[archive.push({ key, name: term?.name ?? "Earlier", albums: [] }) - 1];
				group.albums.push(card);
			}
			const albums = cards
				.filter((card) => !card.isEventAlbum)
				.sort((a, b) => (b.latestAt?.getTime() ?? 0) - (a.latestAt?.getTime() ?? 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
			return { recentEvents, albums, archive, highlights, looseCount: Number(loose?.count ?? 0), photosOfMe: Number(mine?.count ?? 0) };
		},

		async browse(actor, input) {
			return browseItems(actor, input);
		},

		async eventAlbum(_actor, eventId, now = new Date()) {
			await ensureEventAlbums(db, now, eventId);
			const [album] = await db
				.select({ id: galleryFolders.id })
				.from(galleryFolders)
				.where(and(eq(galleryFolders.eventId, eventId), eq(galleryFolders.isEventAlbum, true), isNull(galleryFolders.deletedAt)))
				.limit(1);
			return album ?? null;
		},

		async recordView(_actor, itemId) {
			// Popularity only, so it is not audited and does not touch updated_at.
			await db
				.update(galleryItems)
				.set({ viewCount: sql`${galleryItems.viewCount} + 1` })
				.where(and(eq(galleryItems.id, itemId), isNull(galleryItems.deletedAt)));
		},

		async setHeart(actor, itemId, on) {
			const tree = await loadTree(db);
			await liveItems(db, tree, [itemId]);
			if (on) await db.insert(galleryHearts).values({ itemId, memberId: actor.memberId }).onConflictDoNothing();
			else await db.delete(galleryHearts).where(and(eq(galleryHearts.itemId, itemId), eq(galleryHearts.memberId, actor.memberId)));
			const [row] = await db.select({ count: sql<number>`count(*)` }).from(galleryHearts).where(eq(galleryHearts.itemId, itemId));
			return { heartCount: Number(row?.count ?? 0) };
		},

		async addTag(actor, itemId, input) {
			const tree = await loadTree(db);
			const [item] = await liveItems(db, tree, [itemId]);
			let tag: InferInsertModel<typeof galleryTags>;
			if ("memberId" in input) {
				const [person] = await db
					.select({ id: members.id, fullName: members.fullName, name: members.name, email: members.email, status: members.status })
					.from(members)
					.where(eq(members.id, input.memberId))
					.limit(1);
				if (!person || person.status !== "active") throw new Error("That member is not in the portal.");
				const label = person.fullName ?? person.name ?? person.email;
				tag = { id: createId("gtag"), itemId, kind: "person", key: person.id, memberId: person.id, label, taggedBy: actor.memberId };
			} else {
				const label = input.label.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC);
				if (!label) throw new Error("Type a person or a topic to tag.");
				tag = { id: createId("gtag"), itemId, kind: "topic", key: label.toLowerCase(), memberId: null, label, taggedBy: actor.memberId };
			}
			const inserted = await db.insert(galleryTags).values(tag).onConflictDoNothing().returning({ id: galleryTags.id });
			if (inserted.length === 0) return; // already tagged
			await db.insert(auditLogs).values(
				audit(actor, {
					action: "gallery:tag",
					targetType: "gallery_item",
					targetId: itemId,
					targetMemberId: tag.memberId ?? item.uploadedBy,
					detail: `${item.originalName}: tagged ${tag.kind === "person" ? tag.label : `"${tag.label}"`}`,
				}),
			);
		},

		async removeTag(actor, tagId) {
			const [tag] = await db.select().from(galleryTags).where(eq(galleryTags.id, tagId)).limit(1);
			if (!tag) return;
			const tree = await loadTree(db);
			const [item] = await liveItems(db, tree, [tag.itemId]);
			await commit(db, [
				db.delete(galleryTags).where(eq(galleryTags.id, tagId)),
				db.insert(auditLogs).values(
					audit(actor, {
						action: "gallery:untag",
						targetType: "gallery_item",
						targetId: tag.itemId,
						targetMemberId: tag.memberId ?? item.uploadedBy,
						detail: `${item.originalName}: removed ${tag.kind === "person" ? tag.label : `"${tag.label}"`}`,
					}),
				),
			]);
		},

		async memberOptions() {
			const rows = await db
				.select({ id: members.id, fullName: members.fullName, name: members.name, email: members.email })
				.from(members)
				.where(eq(members.status, "active"));
			return rows
				.map((row) => ({ id: row.id, name: row.fullName ?? row.name ?? row.email }))
				.sort((a, b) => a.name.localeCompare(b.name));
		},

		async canReadObject(actor, itemId) {
			const [item] = await db
				.select({ folderId: galleryItems.folderId, deletedAt: galleryItems.deletedAt, deletedBy: galleryItems.deletedBy })
				.from(galleryItems)
				.where(eq(galleryItems.id, itemId))
				.limit(1);
			if (!item) return false;
			// ponytail: one folder-list read per file request; cache the tree per isolate if thumbnails get slow.
			const tree = await loadTree(db);
			if (!item.deletedAt && tree.isLive(item.folderId)) return actor !== null || tree.isPublic(item.folderId);
			if (!actor) return false;
			if (canManageGallery(actor)) return true;
			// Recently deleted shows its own thumbnails: the deleter sees what they deleted, item or whole folder.
			if (item.deletedAt) return item.deletedBy === actor.memberId;
			return tree.chain(item.folderId).some((folder) => folder.deletedAt && folder.deletedBy === actor.memberId);
		},
	};
}

/**
 * Purges what has been deleted for 30 days: R2 files first, then rows, so a failed file delete leaves the row
 * for the next run instead of an orphaned file. A purged folder takes everything under it. Bounded per run.
 */
export async function purgeExpiredGallery(
	db: Db,
	removeFiles: (item: Pick<GalleryItem, "id" | "fileKey">) => Promise<void>,
	now = new Date(),
	limit = 50,
): Promise<{ items: number; folders: number }> {
	const cutoff = purgeCutoff(now);
	const tree = await loadTree(db);
	const expired = (await db.select().from(galleryFolders).where(lt(galleryFolders.deletedAt, cutoff))).filter(
		// An expired folder inside another expired folder goes with its parent.
		(folder) => !tree.chain(folder.parentId).some((above) => above.deletedAt && above.deletedAt < cutoff),
	);
	const subtrees = expired.map((folder) => ({ folder, ids: [folder.id, ...tree.descendants(folder.id).map((child) => child.id)] }));
	const inExpiredFolder = subtrees.flatMap((subtree) => subtree.ids);

	const itemsDue = await db.select().from(galleryItems).where(lt(galleryItems.deletedAt, cutoff)).limit(limit);
	const swept = await inChunks(inExpiredFolder, (chunk) => db.select().from(galleryItems).where(inArray(galleryItems.folderId, chunk)).limit(limit));
	const doomed = [...new Map([...itemsDue, ...swept].map((item) => [item.id, item])).values()].slice(0, limit);

	const results = await Promise.allSettled(doomed.map((item) => removeFiles(item)));
	const gone = doomed.filter((_, index) => results[index].status === "fulfilled");
	for (const [index, result] of results.entries()) {
		if (result.status === "rejected") console.error("gallery purge: file delete failed", doomed[index].id, result.reason);
	}
	await commit(db, [
		...gone.map((item) => db.delete(galleryItems).where(eq(galleryItems.id, item.id))),
		...gone.map((item) =>
			db.insert(auditLogs).values(
				systemAudit({
					action: "gallery:purge",
					targetType: "gallery_item",
					targetId: item.id,
					targetMemberId: item.uploadedBy,
					detail: `${item.originalName}, uploaded by ${item.uploaderEmail}, 30 days after it was deleted`,
				}),
			),
		),
	]);

	let folders = 0;
	for (const { folder, ids } of subtrees) {
		const left = await inChunks(ids, (chunk) => db.select({ id: galleryItems.id }).from(galleryItems).where(inArray(galleryItems.folderId, chunk)).limit(1));
		if (left.length > 0) continue; // the next run clears the rest of its items first
		// Deepest first: a folder row cannot go while a child still points at it.
		const byDepth = ids.map((id) => ({ id, depth: tree.chain(id).length })).sort((a, b) => b.depth - a.depth);
		const statements: BatchItem<"sqlite">[] = [];
		for (let start = 0; start < byDepth.length; start += ID_CHUNK) {
			statements.push(db.delete(galleryFolders).where(inArray(galleryFolders.id, byDepth.slice(start, start + ID_CHUNK).map(({ id }) => id))));
		}
		statements.push(
			db.insert(auditLogs).values(
				systemAudit({
					action: "gallery:folder_purge",
					targetType: "gallery_folder",
					targetId: folder.id,
					detail: `${folder.name}${ids.length > 1 ? ` and ${ids.length - 1} folders inside it` : ""}, 30 days after it was deleted`,
				}),
			),
		);
		await commit(db, statements);
		folders += ids.length;
	}
	return { items: gone.length, folders };
}

/**
 * Gives every event that has ended its own album, so members always have somewhere to put its photos. Runs from the
 * cron and from the gallery's front page; idempotent (one album per event, enforced by a unique index). Birthdays and
 * informational events get none. An album someone deleted is not remade while it waits in Recently deleted.
 */
export async function ensureEventAlbums(db: Db, now = new Date(), onlyEventId?: string): Promise<number> {
	const due = await db
		.select({ id: crsEvents.id, title: crsEvents.title })
		.from(crsEvents)
		.where(
			and(
				onlyEventId ? eq(crsEvents.id, onlyEventId) : undefined,
				isNull(crsEvents.deletedAt),
				eq(crsEvents.status, "approved"),
				eq(crsEvents.readOnly, false),
				sql`${crsEvents.type} <> 'birthday'`,
				sql`coalesce(${crsEvents.endsAt}, ${crsEvents.startsAt}) < ${now.getTime()}`,
				sql`not exists (select 1 from ${galleryFolders} where ${galleryFolders.eventId} = ${crsEvents.id} and ${galleryFolders.isEventAlbum} = 1)`,
			),
		)
		.limit(80);
	await commit(
		db,
		due.map((event) =>
			db
				.insert(galleryFolders)
				.values({ id: createId("gfd"), name: event.title.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) || "Event", eventId: event.id, isEventAlbum: true })
				.onConflictDoNothing(),
		),
	);
	return due.length;
}

export function createUnavailableGalleryRepository(): GalleryRepository {
	const unavailable = () => {
		throw new Error("The gallery is unavailable through this repository adapter.");
	};
	return {
		folderView: unavailable,
		eventItems: unavailable,
		publicView: unavailable,
		folderOptions: unavailable,
		eventOptions: unavailable,
		createItem: unavailable,
		updateItem: unavailable,
		moveItems: unavailable,
		deleteItems: unavailable,
		createFolder: unavailable,
		updateFolder: unavailable,
		moveFolder: unavailable,
		deleteFolder: unavailable,
		listDeleted: unavailable,
		restore: unavailable,
		homeView: unavailable,
		browse: unavailable,
		eventAlbum: unavailable,
		recordView: unavailable,
		setHeart: unavailable,
		addTag: unavailable,
		removeTag: unavailable,
		memberOptions: unavailable,
		canReadObject: unavailable,
	};
}

