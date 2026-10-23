import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { InferSelectModel, SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { importantLinks, linkCategories } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { LinkKind } from "@/lib/link-kinds";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type * as schema from "../schema";
import type { AuditRepository } from "./audit";

export type ImportantLink = InferSelectModel<typeof importantLinks>;
export type LinkCategory = InferSelectModel<typeof linkCategories>;
export type LinkCategoryWithLinks = LinkCategory & { links: ImportantLink[] };
/** Categories in admin order, then the links filed under no category ("Other links"). */
export type LinkDirectory = { categories: LinkCategoryWithLinks[]; uncategorized: ImportantLink[] };

export type ImportantLinkInput = {
	title: string;
	url: string;
	description: string | null;
	kind: LinkKind | null;
	categoryId: string | null;
	showInSidebar: boolean;
};
export type LinkCategoryInput = { name: string };
export type MoveDirection = "up" | "down";

type Db = DrizzleD1Database<typeof schema>;

export type ImportantLinksRepository = {
	/** What members see: nothing archived, and no link from an archived category. */
	listDirectory(actor: Actor): Promise<LinkDirectory>;
	/** Everything, archived included, for the editor. */
	listForEditing(actor: Actor): Promise<LinkDirectory>;
	/** Visible links marked for the sidebar, in directory order. */
	listSidebar(actor: Actor): Promise<ImportantLink[]>;
	createLink(actor: Actor, input: ImportantLinkInput): Promise<ImportantLink>;
	updateLink(actor: Actor, id: string, input: ImportantLinkInput): Promise<ImportantLink>;
	setLinkArchived(actor: Actor, id: string, archived: boolean): Promise<void>;
	moveLink(actor: Actor, id: string, direction: MoveDirection): Promise<void>;
	createCategory(actor: Actor, input: LinkCategoryInput): Promise<LinkCategory>;
	updateCategory(actor: Actor, id: string, input: LinkCategoryInput): Promise<LinkCategory>;
	setCategoryArchived(actor: Actor, id: string, archived: boolean): Promise<void>;
	moveCategory(actor: Actor, id: string, direction: MoveDirection): Promise<void>;
};

function assertConfigure(actor: Actor): void {
	if (!can(actor, "nav:configure")) {
		throw new Error("Not authorized to manage important links.");
	}
}

export function groupDirectory(categories: LinkCategory[], links: ImportantLink[]): LinkDirectory {
	const byCategory = new Map(categories.map((category) => [category.id, [] as ImportantLink[]]));
	const uncategorized: ImportantLink[] = [];
	for (const link of links) {
		const bucket = link.categoryId ? byCategory.get(link.categoryId) : uncategorized;
		bucket?.push(link);
	}
	return { categories: categories.map((category) => ({ ...category, links: byCategory.get(category.id) ?? [] })), uncategorized };
}

/** Moves one id a step within its ordered siblings; null when it is already at that end. */
export function reorderedIds(ids: string[], id: string, direction: MoveDirection): string[] | null {
	const from = ids.indexOf(id);
	const to = direction === "up" ? from - 1 : from + 1;
	if (from < 0 || to < 0 || to >= ids.length) return null;
	const next = [...ids];
	[next[from], next[to]] = [next[to], next[from]];
	return next;
}

// One statement renumbers every sibling 0..n-1, so a move never leaves two rows sharing a position.
function positionsFor(column: typeof importantLinks.id | typeof linkCategories.id, ids: string[]): SQL {
	return sql`case ${column} ${sql.join(ids.map((id, index) => sql`when ${id} then ${index}`), sql` `)} end`;
}

export function createImportantLinksRepository(db: Db, audit: AuditRepository): ImportantLinksRepository {
	const sameCategory = (categoryId: string | null) =>
		categoryId ? eq(importantLinks.categoryId, categoryId) : isNull(importantLinks.categoryId);

	async function nextLinkPosition(categoryId: string | null): Promise<number> {
		const [row] = await db.select({ value: max(importantLinks.position) }).from(importantLinks).where(sameCategory(categoryId));
		return (row?.value ?? -1) + 1;
	}

	async function findLink(id: string): Promise<ImportantLink> {
		const [link] = await db.select().from(importantLinks).where(eq(importantLinks.id, id));
		if (!link) throw new Error("Important link not found.");
		return link;
	}

	async function record(actor: Actor, action: string, targetType: "important_link" | "link_category", targetId: string) {
		await audit.record(actor, { action, targetType, targetId, category: "member" });
	}

	return {
		async listDirectory() {
			const categories = await db
				.select()
				.from(linkCategories)
				.where(isNull(linkCategories.archivedAt))
				.orderBy(asc(linkCategories.position), asc(linkCategories.createdAt));
			const links = await db
				.select()
				.from(importantLinks)
				.where(isNull(importantLinks.archivedAt))
				.orderBy(asc(importantLinks.position), asc(importantLinks.createdAt));
			// A link in an archived category has no bucket in groupDirectory, so it drops out here.
			return groupDirectory(categories, links);
		},
		async listForEditing(actor) {
			assertConfigure(actor);
			const categories = await db.select().from(linkCategories).orderBy(asc(linkCategories.position), asc(linkCategories.createdAt));
			const links = await db.select().from(importantLinks).orderBy(asc(importantLinks.position), asc(importantLinks.createdAt));
			return groupDirectory(categories, links);
		},
		async listSidebar() {
			const rows = await db
				.select({ link: importantLinks })
				.from(importantLinks)
				.leftJoin(linkCategories, eq(importantLinks.categoryId, linkCategories.id))
				.where(and(eq(importantLinks.showInSidebar, true), isNull(importantLinks.archivedAt), isNull(linkCategories.archivedAt)))
				.orderBy(
					sql`${linkCategories.id} is null`,
					asc(linkCategories.position),
					asc(importantLinks.position),
					asc(importantLinks.createdAt),
				);
			return rows.map((row) => row.link);
		},
		async createLink(actor, input) {
			assertConfigure(actor);
			const [link] = await db
				.insert(importantLinks)
				.values({ id: createId("ilk"), ...input, position: await nextLinkPosition(input.categoryId), createdBy: actor.memberId })
				.returning();
			await record(actor, "important_link:create", "important_link", link.id);
			return link;
		},
		async updateLink(actor, id, input) {
			assertConfigure(actor);
			const current = await findLink(id);
			// Moving to another category puts the link at the end of that category.
			const position = current.categoryId === input.categoryId ? current.position : await nextLinkPosition(input.categoryId);
			const [link] = await db
				.update(importantLinks)
				.set({ ...input, position, updatedAt: new Date() })
				.where(eq(importantLinks.id, id))
				.returning();
			await record(actor, "important_link:update", "important_link", id);
			return link;
		},
		async setLinkArchived(actor, id, archived) {
			assertConfigure(actor);
			await findLink(id);
			await db
				.update(importantLinks)
				.set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
				.where(eq(importantLinks.id, id));
			await record(actor, archived ? "important_link:archive" : "important_link:restore", "important_link", id);
		},
		async moveLink(actor, id, direction) {
			assertConfigure(actor);
			const link = await findLink(id);
			const siblings = await db
				.select({ id: importantLinks.id })
				.from(importantLinks)
				.where(and(sameCategory(link.categoryId), isNull(importantLinks.archivedAt)))
				.orderBy(asc(importantLinks.position), asc(importantLinks.createdAt));
			const ids = reorderedIds(siblings.map((row) => row.id), id, direction);
			if (!ids) return;
			await db
				.update(importantLinks)
				.set({ position: positionsFor(importantLinks.id, ids), updatedAt: new Date() })
				.where(inArray(importantLinks.id, ids));
			await record(actor, "important_link:reorder", "important_link", id);
		},
		async createCategory(actor, input) {
			assertConfigure(actor);
			const [row] = await db.select({ value: max(linkCategories.position) }).from(linkCategories);
			const [category] = await db
				.insert(linkCategories)
				.values({ id: createId("lcat"), name: input.name, position: (row?.value ?? -1) + 1, createdBy: actor.memberId })
				.returning();
			await record(actor, "link_category:create", "link_category", category.id);
			return category;
		},
		async updateCategory(actor, id, input) {
			assertConfigure(actor);
			const [category] = await db
				.update(linkCategories)
				.set({ name: input.name, updatedAt: new Date() })
				.where(eq(linkCategories.id, id))
				.returning();
			if (!category) throw new Error("Link category not found.");
			await record(actor, "link_category:update", "link_category", id);
			return category;
		},
		async setCategoryArchived(actor, id, archived) {
			assertConfigure(actor);
			const [category] = await db
				.update(linkCategories)
				.set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
				.where(eq(linkCategories.id, id))
				.returning({ id: linkCategories.id });
			if (!category) throw new Error("Link category not found.");
			await record(actor, archived ? "link_category:archive" : "link_category:restore", "link_category", id);
		},
		async moveCategory(actor, id, direction) {
			assertConfigure(actor);
			const siblings = await db
				.select({ id: linkCategories.id })
				.from(linkCategories)
				.where(isNull(linkCategories.archivedAt))
				.orderBy(asc(linkCategories.position), asc(linkCategories.createdAt));
			const ids = reorderedIds(siblings.map((row) => row.id), id, direction);
			if (!ids) return;
			await db
				.update(linkCategories)
				.set({ position: positionsFor(linkCategories.id, ids), updatedAt: new Date() })
				.where(inArray(linkCategories.id, ids));
			await record(actor, "link_category:reorder", "link_category", id);
		},
	};
}

export function createUnavailableImportantLinksRepository(): ImportantLinksRepository {
	const unavailable = () => {
		throw new Error("Important links are unavailable through this repository adapter.");
	};
	return {
		listDirectory: unavailable,
		listForEditing: unavailable,
		listSidebar: unavailable,
		createLink: unavailable,
		updateLink: unavailable,
		setLinkArchived: unavailable,
		moveLink: unavailable,
		createCategory: unavailable,
		updateCategory: unavailable,
		setCategoryArchived: unavailable,
		moveCategory: unavailable,
	};
}
