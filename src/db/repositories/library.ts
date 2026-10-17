import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
	libraryComments,
	libraryItems,
	libraryItemTags,
	libraryLists,
	libraryReports,
	libraryTags,
	memberRoles,
	members,
	roles,
	type LibraryConfidentiality,
	type LibraryReportReason,
} from "@/db/schema";
import { createId } from "@/lib/ids";
import { blocksToPlainText, readMinutes } from "@/lib/library/blocks";
import type { LibraryBlock } from "@/lib/library/blocks";
import { allowedFormats, defaultFormat, defaultPublicReadiness, defaultSource, REPORT_REASONS } from "@/lib/library/taxonomy";
import type {
	LibraryAuthor,
	LibraryFormat,
	LibraryKind,
	LibraryPublicReadiness,
	LibrarySource,
	LibraryStatus,
} from "@/lib/library/taxonomy";
import type { Actor } from "@/server/auth/permissions";
import { can, roleKeys } from "@/server/auth/permissions";
import type * as schema from "../schema";
import type { AuditRepository } from "./audit";
import { canEditItem, canSeeItem, publishedVisibleWhere } from "./library-access";
import { createLibraryListsRepository } from "./library-lists";
import { notify } from "./notifications";
import type { NotifyInput } from "./notifications";

export type LibraryItem = InferSelectModel<typeof libraryItems>;
export type LibraryList = InferSelectModel<typeof libraryLists>;
export type LibraryReport = InferSelectModel<typeof libraryReports>;

export type LibraryItemDraftInput = {
	kind: LibraryKind;
	/** Defaults from the kind. Only a format the kind allows (a Book/paper may be a link, a Case study a file). */
	format?: LibraryFormat;
	title: string;
	dek?: string;
	source?: LibrarySource;
	authors?: LibraryAuthor[];
	subtype?: string | null;
	formatDetail?: string | null;
	engagementType?: string | null;
	year?: number | null;
	url?: string | null;
	blocks?: LibraryBlock[];
	tagIds?: string[];
};

export type LibraryCard = Pick<
	LibraryItem,
	| "id"
	| "kind"
	| "format"
	| "source"
	| "title"
	| "dek"
	| "authorsJson"
	| "year"
	| "subtype"
	| "formatDetail"
	| "engagementType"
	| "publicReadiness"
	| "confidentiality"
	| "status"
	| "fileType"
	| "fileCode"
> & { tagNames: string[]; saves: number };

export type LibrarySearchInput = {
	q?: string;
	kinds?: LibraryKind[];
	sources?: LibrarySource[];
	/** Items must carry every one of these tags. */
	tagIds?: string[];
	subtype?: string;
	formatDetail?: string;
	engagementType?: string;
	sort?: "relevance" | "newest" | "most_saved" | "most_read";
	limit?: number;
	offset?: number;
	/** Smart search: restrict to these, and keep their order when sort = relevance. */
	onlyIds?: string[];
};

export type LibraryItemView = LibraryItem & {
	tags: { id: string; name: string }[];
	authors: (LibraryAuthor & { stillInCode: boolean })[];
	canEdit: boolean;
};

export type LibraryCommentView = {
	id: string;
	parentId: string | null;
	body: string;
	hidden: boolean;
	anonymous: boolean;
	createdAt: Date;
	authorName: string;
};

/**
 * Fired after a status transition that someone needs to hear about. The notifications themselves are sent by the
 * repository; this hook is for anything extra a caller wants to do with the same event.
 */
export type LibraryModerationEvent = {
	action: "submit_review" | "approve" | "send_back" | "take_down" | "restore";
	itemId: string;
	title: string;
	/** The item's owner; null for seeded items nobody owns. */
	ownerId: string | null;
	actorId: string;
	reason: string | null;
};
export type LibraryModerationHook = (event: LibraryModerationEvent) => Promise<void> | void;

export type Db = DrizzleD1Database<typeof schema>;

export type LibraryRepository = {
	search(actor: Actor, input: LibrarySearchInput): Promise<{ cards: LibraryCard[]; total: number }>;
	getItem(actor: Actor, id: string): Promise<LibraryItemView | null>;
	createDraft(actor: Actor, input: LibraryItemDraftInput): Promise<LibraryItem>;
	updateItem(actor: Actor, id: string, input: Partial<LibraryItemDraftInput>): Promise<LibraryItem>;
	setFile(actor: Actor, id: string, file: { key: string; name: string; type: string; bytes: number }): Promise<void>;
	publish(actor: Actor, id: string, input: { containsClientData: boolean }): Promise<LibraryStatus>;
	moderate(actor: Actor, id: string, action: "approve" | "send_back" | "take_down" | "restore", reason?: string): Promise<void>;
	/** Owner or library:moderate, on a published item: it goes back to pending_review, hidden until a moderator approves it. */
	flagClientData(actor: Actor, id: string): Promise<LibraryStatus>;
	/** Exactly one target the actor can see (an item, or a shared list). Details at most 1000 characters. A repeat by the same member while their report is open does nothing. */
	report(actor: Actor, input: { itemId?: string; listId?: string; reason: LibraryReport["reason"]; details?: string }): Promise<void>;
	/** library:moderate. "taken_down" takes a published item or a live list down first (the reason is required then); a target that is already out of view just has its report closed. */
	resolveReport(actor: Actor, reportId: string, resolution: "dismissed" | "taken_down", reason?: string): Promise<void>;
	/** library:moderate. Pending items oldest first, taken-down items and lists newest first, open reports only (oldest first). */
	moderationQueue(actor: Actor): Promise<{
		pending: LibraryItem[];
		takenDown: LibraryItem[];
		takenDownLists: LibraryList[];
		/** `targetLive`: the item is published, or the list is not taken down. Resolving the report of anything else just closes it. */
		reports: (LibraryReport & { targetTitle: string; targetLive: boolean })[];
	}>;
	/** library:moderate. Published items the search index has not read yet (indexedAt is null), whatever their confidentiality. */
	unindexedCount(actor: Actor): Promise<number>;
	setPublicReadiness(actor: Actor, id: string, value: LibraryPublicReadiness | null): Promise<void>;
	setConfidentiality(actor: Actor, id: string, value: Exclude<LibraryConfidentiality, "public">): Promise<void>;
	deleteItem(actor: Actor, id: string): Promise<{ fileKeys: string[] }>;
	listMine(actor: Actor): Promise<LibraryItem[]>;
	/** Any member. Active members by name, for crediting a co-author; never their email. At least one word of 2 characters, at most 8 results. */
	searchMembers(actor: Actor, query: string): Promise<{ id: string; name: string }[]>;
	listComments(actor: Actor, itemId: string): Promise<LibraryCommentView[]>;
	addComment(actor: Actor, input: { itemId: string; parentId?: string | null; anonymous: boolean; body: string }): Promise<void>;
	setCommentHidden(actor: Actor, commentId: string, hidden: boolean): Promise<void>;
	related(actor: Actor, id: string, limit?: number): Promise<LibraryCard[]>;
	setExtractedText(id: string, text: string): Promise<void>;
	requestAccess(actor: Actor, itemId: string): Promise<void>;
};

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_WORDS = 8;
const EXTRACTED_TEXT_INDEX_CAP = 200_000;
// D1 rejects LIKE patterns longer than 50 bytes ("pattern too complex").
const LIKE_PATTERN_MAX_BYTES = 50;
const LIKE_ESCAPE = sql.raw("ESCAPE '\\'");
const utf8 = new TextEncoder();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(value)));

/** `%word%` with LIKE metacharacters escaped, clipped to the D1 pattern limit on a character boundary. */
function likePattern(text: string): string {
	let body = "";
	let bytes = 2;
	for (const char of text) {
		const piece = /[\\%_]/.test(char) ? `\\${char}` : char;
		const size = utf8.encode(piece).length;
		if (bytes + size > LIKE_PATTERN_MAX_BYTES) break;
		body += piece;
		bytes += size;
	}
	return `%${body}%`;
}

function searchWords(q: string | undefined): string[] {
	return [...new Set((q ?? "").toLowerCase().split(/\s+/).filter(Boolean))].slice(0, MAX_WORDS);
}

/** Whether an edit touches what smart search embeds (title, summary, page body, tags). The editor's save uses the same test to decide whether to re-index. */
export function changesIndexedText(input: Partial<Pick<LibraryItemDraftInput, "title" | "dek" | "blocks" | "tagIds">>): boolean {
	return input.title !== undefined || input.dek !== undefined || input.blocks !== undefined || input.tagIds !== undefined;
}

/** What a stored link may look like. The item page checks the same pattern before it renders one as a link. */
export const LINK_URL = /^https?:\/\/\S+$/i;

function assertLink(url: string | null | undefined): void {
	if (url && !LINK_URL.test(url)) throw new Error("Use a link that starts with http:// or https://");
}

function requireFormat(kind: LibraryKind, format: LibraryFormat): LibraryFormat {
	if (!allowedFormats(kind).includes(format)) throw new Error("That type cannot be used with this format.");
	return format;
}

function requireTitle(title: string): string {
	const trimmed = title.trim();
	if (!trimmed) throw new Error("A title is required.");
	return trimmed;
}

/** Image keys the item points at in R2, plus its file: everything deleteItem must hand back for cleanup. */
function storageKeys(item: Pick<LibraryItem, "fileKey" | "blocksJson">): string[] {
	const keys = new Set<string>();
	if (item.fileKey) keys.add(item.fileKey);
	for (const block of item.blocksJson) if (block.type === "image" && block.props.key) keys.add(block.props.key);
	return [...keys];
}

/** searchText = lower(title, summary, file code, authors, tags, block text, extracted text up to 200k chars). */
function buildSearchText(item: LibraryItem, tagNames: string[]): string {
	return [
		item.title,
		item.dek,
		item.fileCode,
		...item.authorsJson.map((author) => author.name),
		...tagNames,
		blocksToPlainText(item.blocksJson),
		item.extractedText.slice(0, EXTRACTED_TEXT_INDEX_CAP),
	]
		.filter(Boolean)
		.join("\n")
		.toLowerCase();
}

// Each chunk binds one id per item; D1 allows 100 bound parameters per statement.
const ID_CHUNK = 40;

/**
 * The searchText updates for these items, built but not run, so a caller can commit them in the same
 * `db.batch` as the change that makes them necessary. `rewriteTagNames` lets that caller pass the tag names
 * the items WILL have (a merge or delete that has not been applied yet). Unknown ids are skipped.
 */
export async function planSearchTextRefresh(
	db: Db,
	itemIds: string[],
	rewriteTagNames?: (names: string[]) => string[],
): Promise<BatchItem<"sqlite">[]> {
	const ids = [...new Set(itemIds)];
	const updates: BatchItem<"sqlite">[] = [];
	for (let start = 0; start < ids.length; start += ID_CHUNK) {
		const chunk = ids.slice(start, start + ID_CHUNK);
		const [items, tagRows] = await Promise.all([
			db.select().from(libraryItems).where(inArray(libraryItems.id, chunk)),
			db
				.select({ itemId: libraryItemTags.itemId, name: libraryTags.name })
				.from(libraryItemTags)
				.innerJoin(libraryTags, eq(libraryTags.id, libraryItemTags.tagId))
				.where(inArray(libraryItemTags.itemId, chunk)),
		]);
		const namesByItem = new Map<string, string[]>();
		for (const row of tagRows) namesByItem.set(row.itemId, [...(namesByItem.get(row.itemId) ?? []), row.name]);
		for (const item of items) {
			const names = namesByItem.get(item.id) ?? [];
			const searchText = buildSearchText(item, rewriteTagNames ? rewriteTagNames(names) : names);
			updates.push(db.update(libraryItems).set({ searchText }).where(eq(libraryItems.id, item.id)));
		}
	}
	return updates;
}

// ponytail: the new texts are held in memory together (up to ~200k chars per item). Fine for hundreds of items; commit per chunk if a tag ever spans thousands.
/** Recomputes searchText for many items: chunked reads, then every update in one `db.batch`. */
export async function refreshSearchTextMany(db: Db, itemIds: string[]): Promise<void> {
	const [first, ...rest] = await planSearchTextRefresh(db, itemIds);
	if (first) await db.batch([first, ...rest]);
}

export async function refreshSearchText(db: Db, itemId: string): Promise<void> {
	await refreshSearchTextMany(db, [itemId]);
}

// Written out in plain SQL on purpose: drizzle strips table prefixes from columns inside a single-table
// select list, which would turn `... = library_items.id` into an ambiguous `... = id` in these subqueries.
const savesOf = sql<number>`(SELECT COUNT(DISTINCT li.added_by) FROM library_list_items li WHERE li.library_item_id = library_items.id)`;
const secondsReadOf = sql<number>`(SELECT COALESCE(SUM(md.active_seconds), 0) FROM library_item_member_days md WHERE md.item_id = library_items.id)`;
const tagNamesOf = sql<string | null>`(SELECT json_group_array(t.name) FROM library_item_tags it INNER JOIN library_tags t ON t.id = it.tag_id WHERE it.item_id = library_items.id)`;

const cardColumns = {
	id: libraryItems.id,
	kind: libraryItems.kind,
	format: libraryItems.format,
	source: libraryItems.source,
	title: libraryItems.title,
	dek: libraryItems.dek,
	authorsJson: libraryItems.authorsJson,
	year: libraryItems.year,
	subtype: libraryItems.subtype,
	formatDetail: libraryItems.formatDetail,
	engagementType: libraryItems.engagementType,
	publicReadiness: libraryItems.publicReadiness,
	confidentiality: libraryItems.confidentiality,
	status: libraryItems.status,
	fileType: libraryItems.fileType,
	fileCode: libraryItems.fileCode,
	tagNamesJson: tagNamesOf,
	saves: savesOf.mapWith(Number),
};

async function selectCardsFrom(db: Db, where: SQL | undefined, order: SQL[], limit: number, offset: number): Promise<LibraryCard[]> {
	const rows = await db.select(cardColumns).from(libraryItems).where(where).orderBy(...order).limit(limit).offset(offset);
	return rows.map(({ tagNamesJson, ...card }) => ({
		...card,
		tagNames: (JSON.parse(tagNamesJson ?? "[]") as string[]).sort(),
	}));
}

/**
 * Cards for these items, in no particular order, with NO visibility filtering: the caller has already decided
 * which items this reader may see. Unknown ids are skipped.
 */
export async function cardsByIds(db: Db, itemIds: string[]): Promise<LibraryCard[]> {
	const ids = [...new Set(itemIds)];
	const chunks: string[][] = [];
	for (let start = 0; start < ids.length; start += ID_CHUNK) chunks.push(ids.slice(start, start + ID_CHUNK));
	const found = await Promise.all(chunks.map((chunk) => selectCardsFrom(db, inArray(libraryItems.id, chunk), [], chunk.length, 0)));
	return found.flat();
}

// How a reason reads inside a sentence ("A copyright report was filed ..."). Keyed by the type, so a new reason cannot be left without one.
const REPORT_REASON_LABELS: Record<LibraryReportReason, string> = {
	client_data: "client data",
	inappropriate: "inappropriate content",
	copyright: "copyright",
	broken_file: "broken file",
	other: "general",
};
const REPORT_DETAILS_MAX = 1000;
// Where a moderator lands from a notification: "waiting for approval" is the page's first tab, a report has its own.
const MODERATION_QUEUE_HREF = "/portal/admin/content/library";
const MODERATION_REPORTS_HREF = `${MODERATION_QUEUE_HREF}?tab=reports`;

/**
 * Notifications are a courtesy: nothing that goes wrong while sending one may fail or undo the action that
 * triggered it. The error is dropped on purpose, so no member data ends up in a log.
 */
export async function quietly(task: () => Promise<unknown>): Promise<void> {
	try {
		await task();
	} catch {
		// dropped: see above
	}
}

/** One notification per distinct recipient, skipping `except` (the member who did the thing) and missing ids. */
export async function notifyMembers(
	db: Db,
	recipients: Iterable<string | null>,
	except: string,
	message: Omit<NotifyInput, "memberId">,
): Promise<void> {
	const ids = [...new Set(recipients)].filter((id): id is string => id !== null && id !== except);
	await Promise.all(ids.map((memberId) => quietly(() => notify(db, { ...message, memberId }))));
}

/** How a notification names a member: their full name, else their display name. */
export async function memberLabel(db: Db, memberId: string): Promise<string> {
	const [row] = await db.select({ fullName: members.fullName, name: members.name }).from(members).where(eq(members.id, memberId)).limit(1);
	return row?.fullName || row?.name || "A member";
}

// Asked of can() rather than listed by hand, so a role granted library:moderate later is not silently left out (super always passes).
const MODERATOR_ROLE_KEYS = roleKeys.filter((key) => can({ memberId: "", roles: [key] }, "library:moderate"));

/** Holders of library:moderate: active members with a role that grants it. */
async function moderatorIds(db: Db): Promise<string[]> {
	const rows = await db
		.selectDistinct({ id: memberRoles.memberId })
		.from(memberRoles)
		.innerJoin(roles, eq(roles.id, memberRoles.roleId))
		.innerJoin(members, eq(members.id, memberRoles.memberId))
		.where(and(inArray(roles.key, MODERATOR_ROLE_KEYS), eq(members.status, "active")));
	return rows.map((row) => row.id);
}

export function createLibraryRepository(db: Db, audit: AuditRepository, onModerated: LibraryModerationHook = () => {}): LibraryRepository {
	async function loadItem(id: string): Promise<LibraryItem | null> {
		const [row] = await db.select().from(libraryItems).where(eq(libraryItems.id, id)).limit(1);
		return row ?? null;
	}

	async function requireEditable(actor: Actor, id: string): Promise<LibraryItem> {
		const row = await loadItem(id);
		if (!row || !canEditItem(actor, row)) throw new Error("Library item not found.");
		return row;
	}

	async function requireModeratable(actor: Actor, id: string): Promise<LibraryItem> {
		if (!can(actor, "library:moderate")) throw new Error("Not authorized to moderate the library.");
		const row = await loadItem(id);
		if (!row || !canSeeItem(actor, row)) throw new Error("Library item not found.");
		return row;
	}

	/** Throws before anything is written, so a bad tag id never leaves a half-saved item behind. */
	async function assertTagsExist(tagIds: string[]): Promise<string[]> {
		const unique = [...new Set(tagIds)];
		if (unique.length === 0) return unique;
		const found = await db.select({ id: libraryTags.id }).from(libraryTags).where(inArray(libraryTags.id, unique));
		if (found.length !== unique.length) throw new Error("Unknown tag.");
		return unique;
	}

	async function replaceTags(itemId: string, tagIds: string[]): Promise<void> {
		await db.delete(libraryItemTags).where(eq(libraryItemTags.itemId, itemId));
		if (tagIds.length > 0) await db.insert(libraryItemTags).values(tagIds.map((tagId) => ({ itemId, tagId })));
	}

	const selectCards = (where: SQL | undefined, order: SQL[], limit: number, offset: number) => selectCardsFrom(db, where, order, limit, offset);

	async function audited(actor: Actor, action: string, item: Pick<LibraryItem, "id">, detail?: string | null): Promise<void> {
		await audit.record(actor, { action, targetType: "library_item", targetId: item.id, category: "library", detail });
	}

	async function transition(
		actor: Actor,
		row: LibraryItem,
		from: LibraryStatus,
		to: LibraryStatus,
		set: Partial<InferInsertModel<typeof libraryItems>>,
	): Promise<void> {
		// Guarding on the status we read keeps two simultaneous clicks from both "winning".
		const moved = await db
			.update(libraryItems)
			.set({ ...set, status: to, updatedAt: new Date() })
			.where(and(eq(libraryItems.id, row.id), eq(libraryItems.status, from)))
			.returning({ id: libraryItems.id });
		if (moved.length === 0) throw new Error("This item changed while you were working on it. Reload and try again.");
	}

	/** The owner hears about every decision on their item, moderators about every item that needs one. */
	async function announce(event: LibraryModerationEvent): Promise<void> {
		await quietly(async () => {
			const quoted = `"${event.title}"`;
			if (event.action === "submit_review") {
				await notifyMembers(db, await moderatorIds(db), event.actorId, {
					kind: "library_needs_review",
					title: "Library item waiting for review",
					body: `${quoted} is waiting for review.`,
					href: MODERATION_QUEUE_HREF,
				});
				return;
			}
			const [title, body] = {
				approve: ["Your library item was approved", `${quoted} is now published.`],
				send_back: ["Your library item was sent back", `${quoted} needs changes: ${event.reason}`],
				take_down: ["Your library item was taken down", `${quoted} was taken down: ${event.reason}`],
				restore: ["Your library item was restored", `${quoted} is published again.`],
			}[event.action];
			await notifyMembers(db, [event.ownerId], event.actorId, { kind: "library_moderated", title, body, href: `/portal/library/${event.itemId}` });
		});
		await onModerated(event);
	}

	const repo: LibraryRepository = {
		async search(actor, input) {
			const limit = clamp(input.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
			const offset = Math.max(0, Math.trunc(input.offset ?? 0));
			const words = searchWords(input.q);
			const tagIds = [...new Set(input.tagIds ?? [])];
			const sort = input.sort ?? "relevance";

			// ponytail: LIKE over search_text; switch to FTS5 if the corpus outgrows a few thousand items.
			const where = and(
				publishedVisibleWhere(actor),
				...words.map((word) => sql`${libraryItems.searchText} LIKE ${likePattern(word)} ${LIKE_ESCAPE}`),
				input.kinds?.length ? inArray(libraryItems.kind, input.kinds) : undefined,
				input.sources?.length ? inArray(libraryItems.source, input.sources) : undefined,
				input.subtype ? eq(libraryItems.subtype, input.subtype) : undefined,
				input.formatDetail ? eq(libraryItems.formatDetail, input.formatDetail) : undefined,
				input.engagementType ? eq(libraryItems.engagementType, input.engagementType) : undefined,
				tagIds.length
					? sql`${libraryItems.id} IN (SELECT item_id FROM library_item_tags WHERE tag_id IN (SELECT value FROM json_each(${JSON.stringify(tagIds)})) GROUP BY item_id HAVING COUNT(DISTINCT tag_id) = ${tagIds.length})`
					: undefined,
				input.onlyIds ? sql`${libraryItems.id} IN (SELECT value FROM json_each(${JSON.stringify(input.onlyIds)}))` : undefined,
			);

			const phrase = likePattern(words.join(" "));
			const newest = [desc(libraryItems.publishedAt), asc(libraryItems.id)];
			let order: SQL[];
			if (sort === "most_saved") order = [desc(savesOf), ...newest];
			else if (sort === "most_read") order = [desc(secondsReadOf), ...newest];
			else if (sort === "relevance" && input.onlyIds)
				order = [sql`(SELECT CAST(key AS INTEGER) FROM json_each(${JSON.stringify(input.onlyIds)}) WHERE value = ${libraryItems.id})`, ...newest];
			else if (sort === "relevance" && words.length)
				order = [
					sql`CASE WHEN lower(${libraryItems.title}) LIKE ${phrase} ${LIKE_ESCAPE} THEN 0 WHEN lower(${libraryItems.dek}) LIKE ${phrase} ${LIKE_ESCAPE} THEN 1 ELSE 2 END`,
					...newest,
				];
			else order = newest;

			const [cards, [count]] = await Promise.all([
				selectCards(where, order, limit, offset),
				db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(libraryItems).where(where),
			]);
			return { cards, total: count?.total ?? 0 };
		},

		async getItem(actor, id) {
			const row = await loadItem(id);
			if (!row || !canSeeItem(actor, row)) return null;
			const memberIds = [...new Set(row.authorsJson.flatMap((author) => (author.memberId ? [author.memberId] : [])))];
			const [tags, active] = await Promise.all([
				db
					.select({ id: libraryTags.id, name: libraryTags.name })
					.from(libraryItemTags)
					.innerJoin(libraryTags, eq(libraryTags.id, libraryItemTags.tagId))
					.where(eq(libraryItemTags.itemId, id))
					.orderBy(asc(libraryTags.name)),
				memberIds.length
					? db.select({ id: members.id }).from(members).where(and(inArray(members.id, memberIds), eq(members.status, "active")))
					: Promise.resolve([]),
			]);
			const stillIn = new Set(active.map((member) => member.id));
			return {
				...row,
				tags,
				authors: row.authorsJson.map((author) => ({ ...author, stillInCode: author.memberId ? stillIn.has(author.memberId) : false })),
				canEdit: canEditItem(actor, row),
			};
		},

		async createDraft(actor, input) {
			const title = requireTitle(input.title);
			assertLink(input.url);
			const tagIds = await assertTagsExist(input.tagIds ?? []);
			const id = createId("lib");
			await db.insert(libraryItems).values({
				id,
				kind: input.kind,
				format: requireFormat(input.kind, input.format ?? defaultFormat(input.kind)),
				source: input.source ?? defaultSource(input.kind),
				status: "draft",
				title,
				dek: input.dek?.trim() ?? "",
				authorsJson: input.authors ?? [],
				subtype: input.subtype ?? null,
				formatDetail: input.formatDetail ?? null,
				engagementType: input.engagementType ?? null,
				year: input.year ?? null,
				url: input.url ?? null,
				publicReadiness: defaultPublicReadiness(input.kind),
				createdBy: actor.memberId,
				...(input.blocks ? { blocksJson: input.blocks, readMinutes: readMinutes(blocksToPlainText(input.blocks)) } : {}),
			});
			await replaceTags(id, tagIds);
			await refreshSearchText(db, id);
			return (await loadItem(id))!;
		},

		async updateItem(actor, id, input) {
			const row = await requireEditable(actor, id);
			assertLink(input.url);
			const set: Partial<InferInsertModel<typeof libraryItems>> = { updatedAt: new Date() };
			const kindChanged = input.kind !== undefined && input.kind !== row.kind;
			if (kindChanged || input.format !== undefined) {
				const kind = input.kind ?? row.kind;
				const format = requireFormat(kind, input.format ?? (kindChanged ? defaultFormat(kind) : row.format));
				// The body belongs to the format: a live item that switched would lose its file, link or page.
				if (format !== row.format && row.status !== "draft") throw new Error("Only a draft can change its format.");
				set.kind = kind;
				set.format = format;
			}
			if (input.title !== undefined) set.title = requireTitle(input.title);
			if (input.dek !== undefined) set.dek = input.dek.trim();
			if (input.source !== undefined) set.source = input.source;
			if (input.authors !== undefined) set.authorsJson = input.authors;
			if (input.subtype !== undefined) set.subtype = input.subtype;
			if (input.formatDetail !== undefined) set.formatDetail = input.formatDetail;
			if (input.engagementType !== undefined) set.engagementType = input.engagementType;
			if (input.year !== undefined) set.year = input.year;
			if (input.url !== undefined) set.url = input.url;
			if (input.blocks !== undefined) {
				set.blocksJson = input.blocks;
				set.readMinutes = readMinutes(blocksToPlainText(input.blocks));
			}
			// What smart search embeds changed: unindexed until the indexer reads it again, so the rebuild catches a missed re-index.
			if (changesIndexedText(input)) set.indexedAt = null;
			const tagIds = input.tagIds === undefined ? undefined : await assertTagsExist(input.tagIds);
			await db.update(libraryItems).set(set).where(eq(libraryItems.id, id));
			if (tagIds) await replaceTags(id, tagIds);
			await refreshSearchText(db, id);
			// Owners edit (and autosave) freely; only someone else's hands on the item are worth a row.
			if (row.createdBy !== actor.memberId) await audited(actor, "library:update", row);
			return (await loadItem(id))!;
		},

		async setFile(actor, id, file) {
			await requireEditable(actor, id);
			// Only this item's own uploads: another item's object or an avatar must not become (and later be deleted as) this item's file.
			if (!file.key.startsWith(`library/${id}/`) || file.key.includes("..")) throw new Error("Invalid file key.");
			// A new file makes the old extracted text (and its index entry) wrong, so it goes until the indexer re-reads.
			await db
				.update(libraryItems)
				.set({ fileKey: file.key, fileName: file.name, fileType: file.type, fileBytes: file.bytes, extractedText: "", indexedAt: null, updatedAt: new Date() })
				.where(eq(libraryItems.id, id));
			await refreshSearchText(db, id);
		},

		async publish(actor, id, input) {
			const row = await loadItem(id);
			if (!row || row.createdBy !== actor.memberId) throw new Error("Library item not found.");
			if (row.status !== "draft") throw new Error("Only a draft can be published.");
			const to: LibraryStatus = input.containsClientData ? "pending_review" : "published";
			await transition(actor, row, "draft", to, { containsClientData: input.containsClientData, moderationReason: null, publishedAt: new Date(), indexedAt: null });
			await audited(actor, to === "published" ? "library:publish" : "library:submit_review", row);
			if (to === "pending_review") {
				await announce({ action: "submit_review", itemId: id, title: row.title, ownerId: row.createdBy, actorId: actor.memberId, reason: null });
			}
			return to;
		},

		async moderate(actor, id, action, reason) {
			const row = await requireModeratable(actor, id);
			const why = reason?.trim() || null;
			if ((action === "send_back" || action === "take_down") && !why) throw new Error("A reason is required.");
			// Going live clears indexedAt in the same write: if the background index fails, the rebuild still finds the item.
			const rules = {
				approve: { from: "pending_review", to: "published", set: { moderationReason: null, publishedAt: new Date(), indexedAt: null } },
				send_back: { from: "pending_review", to: "draft", set: { moderationReason: why } },
				take_down: { from: "published", to: "taken_down", set: { moderationReason: why } },
				restore: { from: "taken_down", to: "published", set: { moderationReason: null, indexedAt: null } },
			} as const;
			const rule = rules[action];
			if (row.status !== rule.from) throw new Error(`Cannot ${action.replace("_", " ")} an item that is ${row.status.replace("_", " ")}.`);
			await transition(actor, row, rule.from, rule.to, rule.set);
			await audited(actor, `library:${action}`, row, why);
			await announce({ action, itemId: id, title: row.title, ownerId: row.createdBy, actorId: actor.memberId, reason: why });
		},

		async flagClientData(actor, id) {
			const row = await requireEditable(actor, id);
			if (row.status !== "published") throw new Error("Only a published item can be flagged for review.");
			await transition(actor, row, "published", "pending_review", { containsClientData: true, moderationReason: null, indexedAt: null });
			await audited(actor, "library:flag_client_data", row);
			await announce({ action: "submit_review", itemId: id, title: row.title, ownerId: row.createdBy, actorId: actor.memberId, reason: null });
			return "pending_review";
		},

		async report(actor, input) {
			if (Boolean(input.itemId) === Boolean(input.listId)) throw new Error("Report one item or one list.");
			if (!REPORT_REASONS.includes(input.reason)) throw new Error("Choose a reason for the report.");
			const details = (input.details ?? "").trim();
			if (details.length > REPORT_DETAILS_MAX) throw new Error(`Details can be at most ${REPORT_DETAILS_MAX} characters.`);
			let title: string;
			if (input.itemId) {
				const item = await loadItem(input.itemId);
				if (!item || !canSeeItem(actor, item)) throw new Error("Library item not found.");
				title = item.title;
			} else {
				// Only shared lists carry a Report button, so a private or taken-down list reads as missing.
				const [list] = await db.select().from(libraryLists).where(eq(libraryLists.id, input.listId!)).limit(1);
				if (!list || !list.shared || list.takenDownAt) throw new Error("List not found.");
				title = list.name;
			}
			const target = input.itemId ? eq(libraryReports.itemId, input.itemId) : eq(libraryReports.listId, input.listId!);
			const [open] = await db
				.select({ id: libraryReports.id })
				.from(libraryReports)
				.where(and(target, eq(libraryReports.memberId, actor.memberId), isNull(libraryReports.resolvedAt)))
				.limit(1);
			if (open) return;
			await db.insert(libraryReports).values({
				id: createId("lrp"),
				itemId: input.itemId || null,
				listId: input.listId || null,
				memberId: actor.memberId,
				reason: input.reason,
				details,
			});
			await quietly(async () =>
				notifyMembers(db, await moderatorIds(db), actor.memberId, {
					kind: "library_needs_review",
					title: "New library report",
					body: `${/^[aeiou]/i.test(REPORT_REASON_LABELS[input.reason]) ? "An" : "A"} ${REPORT_REASON_LABELS[input.reason]} report was filed on "${title}".`,
					href: MODERATION_REPORTS_HREF,
				}),
			);
		},

		async resolveReport(actor, reportId, resolution, reason) {
			if (!can(actor, "library:moderate")) throw new Error("Not authorized to moderate the library.");
			if (resolution !== "dismissed" && resolution !== "taken_down") throw new Error("Unknown resolution.");
			const [report] = await db.select().from(libraryReports).where(eq(libraryReports.id, reportId)).limit(1);
			if (!report || report.resolvedAt) throw new Error("Report not found.");
			if (resolution === "taken_down") {
				// Only a published item can be taken down. Anything else (already down, or pulled back into review or to a draft
				// since the report) is already out of public view, so the report is just closed, with no reason needed.
				if (report.itemId) {
					const item = await loadItem(report.itemId);
					if (item?.status === "published") await repo.moderate(actor, report.itemId, "take_down", reason);
				} else if (report.listId) {
					const [list] = await db.select({ takenDownAt: libraryLists.takenDownAt }).from(libraryLists).where(eq(libraryLists.id, report.listId)).limit(1);
					if (list && !list.takenDownAt) await createLibraryListsRepository(db, audit).takeDown(actor, report.listId, reason ?? "");
				}
			}
			// ponytail: the take-down above is already committed if two moderators resolve one report at once. The loser
			// gets "already resolved" and the target stays down, which is what both of them asked for.
			const resolved = await db
				.update(libraryReports)
				.set({ resolution, resolvedBy: actor.memberId, resolvedAt: new Date() })
				.where(and(eq(libraryReports.id, reportId), isNull(libraryReports.resolvedAt)))
				.returning({ id: libraryReports.id });
			if (resolved.length === 0) throw new Error("This report was already resolved.");
			const target = report.itemId ? `item=${report.itemId}` : `list=${report.listId}`;
			await audit.record(actor, {
				action: `library:report_${resolution}`,
				targetType: "library_report",
				targetId: reportId,
				category: "library",
				detail: `${target}${reason?.trim() ? `; ${reason.trim()}` : ""}`,
			});
		},

		async moderationQueue(actor) {
			if (!can(actor, "library:moderate")) throw new Error("Not authorized to moderate the library.");
			const [pending, takenDown, takenDownLists, reports] = await Promise.all([
				db.select().from(libraryItems).where(eq(libraryItems.status, "pending_review")).orderBy(asc(libraryItems.publishedAt), asc(libraryItems.id)),
				db.select().from(libraryItems).where(eq(libraryItems.status, "taken_down")).orderBy(desc(libraryItems.updatedAt), asc(libraryItems.id)),
				db.select().from(libraryLists).where(isNotNull(libraryLists.takenDownAt)).orderBy(desc(libraryLists.takenDownAt), asc(libraryLists.id)),
				db
					.select({ report: libraryReports, itemTitle: libraryItems.title, itemStatus: libraryItems.status, listName: libraryLists.name, listTakenDownAt: libraryLists.takenDownAt })
					.from(libraryReports)
					.leftJoin(libraryItems, eq(libraryItems.id, libraryReports.itemId))
					.leftJoin(libraryLists, eq(libraryLists.id, libraryReports.listId))
					.where(isNull(libraryReports.resolvedAt))
					.orderBy(asc(libraryReports.createdAt), asc(libraryReports.id)),
			]);
			return {
				pending: pending.filter((item) => canSeeItem(actor, item)),
				takenDown: takenDown.filter((item) => canSeeItem(actor, item)),
				takenDownLists,
				reports: reports.map(({ report, itemTitle, itemStatus, listName, listTakenDownAt }) => ({
					...report,
					targetTitle: itemTitle ?? listName ?? "Deleted",
					targetLive: report.itemId ? itemStatus === "published" : Boolean(report.listId) && !listTakenDownAt,
				})),
			};
		},

		async unindexedCount(actor) {
			if (!can(actor, "library:moderate")) throw new Error("Not authorized to moderate the library.");
			const [row] = await db
				.select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
				.from(libraryItems)
				.where(and(eq(libraryItems.status, "published"), isNull(libraryItems.indexedAt)));
			return row?.n ?? 0;
		},

		async setPublicReadiness(actor, id, value) {
			const row = await requireModeratable(actor, id);
			await db.update(libraryItems).set({ publicReadiness: value, updatedAt: new Date() }).where(eq(libraryItems.id, id));
			await audited(actor, "library:set_public_readiness", row, value ?? "unreviewed");
		},

		async setConfidentiality(actor, id, value) {
			if (!can(actor, "library:manage")) throw new Error("Not authorized to manage the library.");
			const row = await loadItem(id);
			if (!row) throw new Error("Library item not found.");
			// Either way the index has to change (vectors dropped, or embedded again); unindexed until it has.
			await db.update(libraryItems).set({ confidentiality: value, updatedAt: new Date(), indexedAt: null }).where(eq(libraryItems.id, id));
			await audited(actor, "library:set_confidentiality", row, value);
		},

		async deleteItem(actor, id) {
			if (!can(actor, "library:manage")) throw new Error("Not authorized to manage the library.");
			const row = await loadItem(id);
			if (!row) throw new Error("Library item not found.");
			// Tags, comments, reports, activity rows and list entries go with it through the foreign keys.
			await db.delete(libraryItems).where(eq(libraryItems.id, id));
			await audit.record(actor, {
				action: "library:delete",
				targetType: "library_item",
				targetId: id,
				category: "library",
				detail: `title=${row.title}; owner=${row.createdBy ?? "none"}`,
				targetMemberId: row.createdBy,
			});
			return { fileKeys: storageKeys(row) };
		},

		async listMine(actor) {
			return db.select().from(libraryItems).where(eq(libraryItems.createdBy, actor.memberId)).orderBy(desc(libraryItems.updatedAt), asc(libraryItems.id));
		},

		async searchMembers(_actor, query) {
			const words = searchWords(query);
			// One real word is needed: "a b" would match half the roster.
			if (!words.some((word) => word.length >= 2)) return [];
			const rows = await db
				.select({ id: members.id, fullName: members.fullName, name: members.name })
				.from(members)
				.where(
					and(
						eq(members.status, "active"),
						...words.map((word) => {
							const pattern = likePattern(word);
							return sql`(lower(coalesce(${members.fullName}, '')) LIKE ${pattern} ${LIKE_ESCAPE} OR lower(coalesce(${members.name}, '')) LIKE ${pattern} ${LIKE_ESCAPE} OR lower(coalesce(${members.nickname}, '')) LIKE ${pattern} ${LIKE_ESCAPE})`;
						}),
					),
				)
				.orderBy(asc(sql`lower(coalesce(${members.fullName}, ${members.name}, ''))`), asc(members.id))
				.limit(8);
			return rows.map((row) => ({ id: row.id, name: row.fullName || row.name || "Member" }));
		},

		async listComments(actor, itemId) {
			const item = await loadItem(itemId);
			if (!item || !canSeeItem(actor, item)) return [];
			const canModerate = can(actor, "library:moderate");
			const rows = await db
				.select({
					id: libraryComments.id,
					parentId: libraryComments.parentId,
					body: libraryComments.body,
					hidden: libraryComments.hidden,
					anonymous: libraryComments.anonymous,
					createdAt: libraryComments.createdAt,
					fullName: members.fullName,
					name: members.name,
				})
				.from(libraryComments)
				.innerJoin(members, eq(members.id, libraryComments.memberId))
				.where(eq(libraryComments.libraryItemId, itemId))
				.orderBy(asc(libraryComments.createdAt), asc(libraryComments.id));
			return rows
				.filter((row) => canModerate || !row.hidden)
				.map((row) => ({
					id: row.id,
					parentId: row.parentId,
					body: row.body,
					hidden: row.hidden,
					anonymous: row.anonymous,
					createdAt: row.createdAt,
					// Anonymity hides identity from members but never from moderators.
					authorName: row.anonymous && !canModerate ? "Anonymous" : (row.fullName ?? row.name ?? "Member"),
				}));
		},

		async addComment(actor, input) {
			const body = input.body.trim();
			if (!body) throw new Error("Comment cannot be empty.");
			const item = await loadItem(input.itemId);
			if (!item || !canSeeItem(actor, item)) throw new Error("Library item not found.");
			if (input.parentId) {
				const [parent] = await db
					.select({ id: libraryComments.id })
					.from(libraryComments)
					.where(and(eq(libraryComments.id, input.parentId), eq(libraryComments.libraryItemId, input.itemId)))
					.limit(1);
				if (!parent) throw new Error("Comment not found.");
			}
			await db.insert(libraryComments).values({
				id: createId("lcm"),
				libraryItemId: input.itemId,
				memberId: actor.memberId,
				parentId: input.parentId ?? null,
				anonymous: input.anonymous,
				body,
			});
			await quietly(async () => {
				if (!item.createdBy || item.createdBy === actor.memberId) return;
				// Anonymity holds here too: the owner is told that someone commented, not who.
				const who = input.anonymous ? "Someone" : await memberLabel(db, actor.memberId);
				await notifyMembers(db, [item.createdBy], actor.memberId, {
					kind: "library_comment",
					title: "New comment on your library item",
					body: `${who} commented on "${item.title}".`,
					href: `/portal/library/${item.id}`,
				});
			});
		},

		async setCommentHidden(actor, commentId, hidden) {
			if (!can(actor, "library:moderate")) throw new Error("Not authorized to moderate comments.");
			await db.update(libraryComments).set({ hidden }).where(eq(libraryComments.id, commentId));
			await audit.record(actor, {
				action: hidden ? "library:comment_hide" : "library:comment_unhide",
				targetType: "library_comment",
				targetId: commentId,
				category: "library",
			});
		},

		async related(actor, id, limit = 6) {
			const base = await loadItem(id);
			if (!base || !canSeeItem(actor, base)) return [];
			const ranked = await db
				.select({ id: libraryItemTags.itemId })
				.from(libraryItemTags)
				.innerJoin(libraryItems, eq(libraryItems.id, libraryItemTags.itemId))
				.where(
					and(
						sql`${libraryItemTags.tagId} IN (SELECT tag_id FROM library_item_tags WHERE item_id = ${id})`,
						ne(libraryItemTags.itemId, id),
						publishedVisibleWhere(actor),
					),
				)
				.groupBy(libraryItemTags.itemId)
				.orderBy(sql`COUNT(*) DESC`, desc(savesOf), desc(libraryItems.publishedAt), asc(libraryItems.id))
				.limit(clamp(limit, 1, 50));
			const ids = ranked.map((row) => row.id);
			if (ids.length === 0) return [];
			const cards = await selectCards(inArray(libraryItems.id, ids), [], ids.length, 0);
			return ids.flatMap((itemId) => cards.filter((card) => card.id === itemId));
		},

		async setExtractedText(id, text) {
			// A missing item is a no-op: it may have been deleted while the indexer was reading its file.
			await db.update(libraryItems).set({ extractedText: text }).where(eq(libraryItems.id, id));
			await refreshSearchText(db, id);
		},

		async requestAccess(actor, itemId) {
			// ponytail: record the request in the audit trail only. A notification fan-out
			// to library:manage holders lands with the notifications proxy work; the manual
			// grant flow is unchanged until then.
			await audit.record(actor, {
				action: "library:access_request",
				targetType: "library_item",
				targetId: itemId,
				category: "library",
			});
		},
	};
	return repo;
}

export function createUnavailableLibraryRepository(): LibraryRepository {
	const unavailable = () => {
		throw new Error("The library is unavailable through this repository adapter.");
	};
	return {
		search: unavailable,
		getItem: unavailable,
		createDraft: unavailable,
		updateItem: unavailable,
		setFile: unavailable,
		publish: unavailable,
		moderate: unavailable,
		flagClientData: unavailable,
		report: unavailable,
		resolveReport: unavailable,
		moderationQueue: unavailable,
		unindexedCount: unavailable,
		setPublicReadiness: unavailable,
		setConfidentiality: unavailable,
		deleteItem: unavailable,
		listMine: unavailable,
		searchMembers: unavailable,
		listComments: unavailable,
		addComment: unavailable,
		setCommentHidden: unavailable,
		related: unavailable,
		setExtractedText: unavailable,
		requestAccess: unavailable,
	};
}
