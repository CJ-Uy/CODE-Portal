/** How long a deleted photo, video or folder can be restored before the cron purges it. */
export const RECOVERY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FolderNode = {
	id: string;
	parentId: string | null;
	name: string;
	eventId: string | null;
	isPublic: boolean;
	deletedAt: Date | null;
};

/** Whole days left to restore something deleted at `deletedAt`: 30 right after the delete, 0 once it is due for purging. */
export function daysLeft(deletedAt: Date, now: Date): number {
	return Math.max(0, RECOVERY_DAYS - Math.floor((now.getTime() - deletedAt.getTime()) / DAY_MS));
}

/** Anything deleted before this instant is due for purging. */
export function purgeCutoff(now: Date): Date {
	return new Date(now.getTime() - RECOVERY_DAYS * DAY_MS);
}

/**
 * The gallery's folders as a tree. A folder's own deleted_at hides it and everything under it, so whether a
 * folder is visible, public or tied to an event depends on its ancestors. The whole folder list is small
 * enough to hold in memory and walk.
 * ponytail: loads every folder per request; index an ancestor path column if folders reach the thousands.
 */
export function createFolderTree<T extends FolderNode>(folders: T[]) {
	const byId = new Map(folders.map((folder) => [folder.id, folder]));

	/** The folder itself, then each parent up to the top level. Empty for the top level or an unknown id. */
	function chain(id: string | null): T[] {
		const out: T[] = [];
		const seen = new Set<string>();
		for (let current = id ? byId.get(id) : undefined; current && !seen.has(current.id); current = current.parentId ? byId.get(current.parentId) : undefined) {
			seen.add(current.id);
			out.push(current);
		}
		return out;
	}

	/** Visible: it exists and neither it nor anything above it is deleted. The top level (null) always is. */
	function isLive(id: string | null): boolean {
		if (id === null) return true;
		const folders = chain(id);
		return folders.length > 0 && folders.every((folder) => !folder.deletedAt);
	}

	function descendants(id: string): T[] {
		const out: T[] = [];
		const queue = [id];
		while (queue.length) {
			const next = queue.shift();
			for (const folder of folders) {
				if (folder.parentId === next && !out.includes(folder)) {
					out.push(folder);
					queue.push(folder.id);
				}
			}
		}
		return out;
	}

	return {
		all: () => folders,
		get: (id: string) => byId.get(id),
		chain,
		isLive,
		/** Live folders directly inside `id` (null for the top level). */
		children: (id: string | null) => folders.filter((folder) => folder.parentId === id && !folder.deletedAt),
		/** Every folder under `id`, at any depth, deleted or not. Not `id` itself. */
		descendants,
		/** Public when this folder or any folder above it is marked public. Does not check that it is live. */
		isPublic: (id: string | null) => chain(id).some((folder) => folder.isPublic),
		/** The nearest event tag, looking up from this folder. */
		eventId: (id: string | null) => chain(id).find((folder) => folder.eventId)?.eventId ?? null,
		/** Where a restored thing goes when its folder is gone: the deepest folder above it that is still live, or the top level. */
		nearestLive(id: string | null): string | null {
			const folders = chain(id);
			for (let index = 0; index < folders.length; index++) {
				if (folders.slice(index).every((folder) => !folder.deletedAt)) return folders[index].id;
			}
			return null;
		},
		/** True when moving `folderId` under `parentId` would put a folder inside itself. */
		wouldCycle: (folderId: string, parentId: string | null) => chain(parentId).some((folder) => folder.id === folderId),
		/** Breadcrumbs from the top level down to `id`. */
		path: (id: string | null) => chain(id).reverse(),
		/** Breadcrumbs for the public site: from the highest public folder down to `id`, so private parents never show. */
		publicPath(id: string | null): T[] {
			const folders = chain(id);
			const top = folders.findLastIndex((folder) => folder.isPublic);
			return top < 0 ? [] : folders.slice(0, top + 1).reverse();
		},
	};
}

export type FolderTree<T extends FolderNode = FolderNode> = ReturnType<typeof createFolderTree<T>>;
