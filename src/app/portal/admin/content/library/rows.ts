import type { LibraryItem, LibraryList, LibraryReport } from "@/db/repositories/library";
import type { LibraryTag } from "@/db/repositories/library-tags";
import { KIND_LABELS, REPORT_REASON_OPTIONS, SOURCE_LABELS } from "@/lib/library/taxonomy";

/**
 * What the moderation page hands to its client components: display fields only. Member ids (owners, reporters,
 * resolvers) stay on the server, and every date arrives already formatted.
 */

const WHEN = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric" });
const when = (date: Date | null) => (date ? WHEN.format(date) : "");

export type ItemRow = {
	id: string;
	title: string;
	/** Kind, source and credited authors, as one line. */
	meta: string;
	/** Pending: when it was submitted. Taken down: when it last changed. */
	when: string;
	/** The owner said it includes client names or client data, which is why it waits. */
	clientData: boolean;
	/** Why it was taken down, as the owner sees it. */
	reason: string | null;
	/** Whether anyone owns it. Only the fact, never the id: an ownerless item cannot be sent back. */
	hasOwner: boolean;
};

export function toItemRow(item: LibraryItem): ItemRow {
	const authors = item.authorsJson.map((author) => author.name).join(", ");
	return {
		id: item.id,
		title: item.title,
		meta: [KIND_LABELS[item.kind], SOURCE_LABELS[item.source], authors].filter(Boolean).join(" · "),
		when: item.status === "pending_review" ? when(item.publishedAt) : when(item.updatedAt),
		clientData: item.containsClientData === true,
		reason: item.moderationReason,
		hasOwner: item.createdBy !== null,
	};
}

export type ListRow = { id: string; name: string; when: string; reason: string | null };

export function toListRow(list: LibraryList): ListRow {
	return { id: list.id, name: list.name, when: when(list.takenDownAt), reason: list.moderationReason };
}

export type ReportRow = {
	id: string;
	/** The target's page, which a moderator can open even while it is taken down. */
	href: string;
	targetTitle: string;
	targetKind: "Item" | "List";
	/** Still up (a published item, a list that is not taken down). Anything else has nothing left to take down. */
	live: boolean;
	reason: string;
	details: string;
	when: string;
};

export function toReportRow(report: LibraryReport & { targetTitle: string; targetLive: boolean }): ReportRow {
	const isList = !report.itemId && Boolean(report.listId);
	return {
		id: report.id,
		href: isList ? `/portal/library/lists/${report.listId}` : `/portal/library/${report.itemId}`,
		targetTitle: report.targetTitle,
		targetKind: isList ? "List" : "Item",
		live: report.targetLive,
		reason: REPORT_REASON_OPTIONS[report.reason],
		details: report.details,
		when: when(report.createdAt),
	};
}

export type TagRow = { id: string; name: string; groupName: string; itemCount: number };
export type TagGroup = { groupName: string; tags: TagRow[] };

/** The repository already orders by group, then name; this only folds the neighbours into their group. */
export function groupTags(tags: LibraryTag[]): TagGroup[] {
	const groups = new Map<string, TagRow[]>();
	for (const tag of tags) {
		const row = { id: tag.id, name: tag.name, groupName: tag.groupName, itemCount: tag.itemCount };
		groups.set(tag.groupName, [...(groups.get(tag.groupName) ?? []), row]);
	}
	return [...groups].map(([groupName, rows]) => ({ groupName, tags: rows }));
}

const items = (count: number) => `${count.toLocaleString("en-US")} ${count === 1 ? "item" : "items"}`;

/** "Not used yet", "1 item" or "12 items": every item, drafts and confidential ones included. */
export const usedByText = (count: number) => (count === 0 ? "Not used yet" : items(count));

export const deleteTagText = (name: string, count: number) =>
	count === 0
		? `No item carries "${name}". It will be deleted.`
		: `${items(count)} will lose the tag "${name}". The tag is deleted, and this cannot be undone.`;

export const mergeTagText = (from: string, into: string, count: number) =>
	count === 0
		? `No item carries "${from}". It will be deleted, and "${into}" stays as it is.`
		: `${items(count)} carrying "${from}" will carry "${into}" instead (an item that already has both keeps "${into}" once). "${from}" is deleted, and this cannot be undone.`;
