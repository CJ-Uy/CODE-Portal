import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { createAuditRepository } from "@/db/repositories/audit";
import { createLibraryRepository } from "@/db/repositories/library";
import type { Db, LibraryItem } from "@/db/repositories/library";
import { libraryItems, libraryItemTags, libraryTags } from "@/db/schema";
import { blocksToPlainText } from "@/lib/library/blocks";
import { runInBackground } from "@/server/cloudflare";
import type { StorageAdapter } from "@/storage/types";
import { getLibraryBindings } from "./ai";
import type { LibraryAi, LibraryVectors, SmartBindings } from "./ai";

export type IndexDeps = { ai: LibraryAi; vectorize: LibraryVectors; db: Db; storage: Pick<StorageAdapter, "getObject"> };

/** ~500 tokens. */
const CHUNK_CHARS = 2000;
// ponytail: text past 100 chunks (~200k characters) is not embedded; plain search still reads it. Raise both together.
export const MAX_CHUNKS = 100;
const EXTRACTED_TEXT_CAP = 200_000;
// Bigger files are indexed by title, summary and tags only: the whole file is held in memory for the conversion.
const CONVERT_MAX_BYTES = 10 * 1024 * 1024;
// What toMarkdown is trusted with here (spec 12.2). Slides and sheets get title, summary and tags.
const CONVERTIBLE = /\.(pdf|docx)$/i;
const REBUILD_BATCH = 10;

/** Pieces no longer than `max`: whole, else line by line, else cut at the limit. */
function pieces(text: string, max: number): string[] {
	if (text.length <= max) return [text];
	const lines = text.split("\n").filter((line) => line.trim());
	if (lines.length > 1) return lines.flatMap((line) => pieces(line, max));
	const cut: string[] = [];
	for (let start = 0; start < text.length; start += max) cut.push(text.slice(start, start + max));
	return cut;
}

/** Paragraphs packed into chunks of at most `maxChars`; a paragraph longer than that is split on its own. */
export function chunkText(text: string, maxChars = CHUNK_CHARS): string[] {
	const chunks: string[] = [];
	let current = "";
	for (const paragraph of text.split(/\n\s*\n/)) {
		for (const piece of pieces(paragraph.trim(), maxChars)) {
			if (!piece) continue;
			if (current && current.length + 2 + piece.length > maxChars) {
				chunks.push(current);
				current = piece;
			} else current = current ? `${current}\n\n${piece}` : piece;
		}
	}
	if (current) chunks.push(current);
	return chunks;
}

const chunkIds = (itemId: string, from: number) => Array.from({ length: Math.max(0, MAX_CHUNKS - from) }, (_, n) => `${itemId}:${from + n}`);

/**
 * A file's text. setFile empties extractedText, so text that is still there belongs to this file and is reused instead of
 * converting again. A file that is missing or cannot be converted gives "", and the item is indexed by its title,
 * summary and tags. A failing conversion service throws, so the item stays unindexed and the rebuild retries it.
 */
async function fileText(item: LibraryItem, deps: IndexDeps): Promise<string> {
	if (item.extractedText) return item.extractedText;
	const name = item.fileName ?? item.fileKey ?? "";
	if (!item.fileKey || !CONVERTIBLE.test(name) || (item.fileBytes ?? 0) > CONVERT_MAX_BYTES) return "";
	const object = await deps.storage.getObject(item.fileKey).catch(() => null);
	if (!object?.body) return "";
	const markdown = await deps.ai.toMarkdown({ name, blob: await new Response(object.body).blob() });
	return markdown.slice(0, EXTRACTED_TEXT_CAP);
}

/**
 * Brings one item's vectors in line with it. A published item is embedded as `${itemId}:${n}` chunks (its stale chunks
 * deleted), and a file's text is stored for plain search. A published confidential item is never sent to a model: its
 * vectors are deleted and that is all. Both are marked indexed. Drafts and items under review are left alone; take-down
 * and delete call deindexItem.
 */
export async function indexItem(itemId: string, deps: IndexDeps): Promise<void> {
	const [item] = await deps.db.select().from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
	if (!item || item.status !== "published") return;

	if (item.confidentiality === "confidential") await deindexItem(itemId, deps);
	else {
		const tags = await deps.db
			.select({ name: libraryTags.name })
			.from(libraryItemTags)
			.innerJoin(libraryTags, eq(libraryTags.id, libraryItemTags.tagId))
			.where(eq(libraryItemTags.itemId, itemId));
		// Pages and links are already in searchText (blocks, title, summary); only a file's text is new to plain search.
		let body = "";
		if (item.format === "file") {
			body = await fileText(item, deps);
			if (body !== item.extractedText) await createLibraryRepository(deps.db, createAuditRepository(deps.db)).setExtractedText(itemId, body);
		} else if (item.format === "page") body = blocksToPlainText(item.blocksJson);

		const doc = [item.title, item.dek, tags.map((tag) => tag.name).join(", "), body].filter((part) => part.trim()).join("\n\n");
		const chunks = chunkText(doc).slice(0, MAX_CHUNKS);
		const vectors = await deps.ai.embed(chunks);
		await deps.vectorize.upsert(chunks.map((_, n) => ({ id: `${itemId}:${n}`, values: vectors[n], metadata: { itemId, chunk: n } })));
		await deps.vectorize.deleteByIds(chunkIds(itemId, chunks.length));
	}
	// Only if nothing changed while this ran: an edit in the meantime cleared indexedAt, and it must stay cleared.
	await deps.db
		.update(libraryItems)
		.set({ indexedAt: new Date() })
		.where(and(eq(libraryItems.id, itemId), eq(libraryItems.updatedAt, item.updatedAt)));
}

/** Deletes every chunk id the item could have. Unknown ids are a no-op in Vectorize, so this needs no record of how many there were. */
export async function deindexItem(itemId: string, deps: Pick<IndexDeps, "vectorize">): Promise<void> {
	await deps.vectorize.deleteByIds(chunkIds(itemId, 0));
}

/**
 * One "Rebuild search index" click: up to 10 published items with no indexedAt, one at a time. An item that fails stays
 * unindexed for the next click. ponytail: one that always fails keeps its slot; ten of those would stall the rebuild.
 */
export async function rebuildIndexBatch(deps: IndexDeps): Promise<{ indexed: number; remaining: number }> {
	const unindexed = and(eq(libraryItems.status, "published"), isNull(libraryItems.indexedAt));
	const batch = await deps.db.select({ id: libraryItems.id }).from(libraryItems).where(unindexed).orderBy(asc(libraryItems.id)).limit(REBUILD_BATCH);
	let indexed = 0;
	for (const { id } of batch) {
		try {
			await indexItem(id, deps);
			indexed++;
		} catch {
			// Left unindexed. Nothing about the item or its text is logged.
		}
	}
	const [left] = await deps.db.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(libraryItems).where(unindexed);
	return { indexed, remaining: left?.n ?? 0 };
}

/**
 * The real D1 and storage. Imported here, not at the top: the client module loads better-sqlite3, which the Workers test
 * pool cannot. Bindings exist only on a deployed Worker, so this is always D1.
 */
export async function indexDeps(bindings: SmartBindings): Promise<IndexDeps> {
	const [{ getD1Db }, { getStorageAdapter }] = await Promise.all([import("@/db/client"), import("@/storage")]);
	return { ...bindings, db: getD1Db(), storage: await getStorageAdapter() };
}

/**
 * After a change to an item: re-index it ("index") or drop its vectors ("deindex") once the response is sent. Best
 * effort, because waitUntil has a short budget. The change itself cleared indexedAt in the same write, so an index that
 * fails here is picked up by the admin rebuild. Runs whenever the bindings exist, flag or not, so the index is ready
 * before members are shown smart search. Does nothing without the bindings.
 */
export function scheduleLibraryIndex(itemId: string, op: "index" | "deindex"): void {
	// Never throws: the change that called this has already been saved.
	try {
		const bindings = getLibraryBindings();
		if (!bindings) return;
		const task = async () => {
			const deps = await indexDeps(bindings);
			await (op === "index" ? indexItem(itemId, deps) : deindexItem(itemId, deps));
		};
		// The item id only: an error could quote the item's text.
		runInBackground(task().catch(() => console.error(`Library search index: ${op} failed for ${itemId}.`)));
	} catch {
		console.error(`Library search index: could not schedule ${op} for ${itemId}.`);
	}
}
