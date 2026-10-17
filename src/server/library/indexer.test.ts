import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { libraryItems } from "@/db/schema";
import { insertItem, resetLibrary } from "@/db/repositories/library-test-fixtures";
import type { LibraryBlock } from "@/lib/library/blocks";
import type { LibraryAi, LibraryVectors } from "./ai";
import { chunkText, deindexItem, indexItem, MAX_CHUNKS, rebuildIndexBatch } from "./indexer";

const db = drizzle(env.DB, { schema });

function fakeAi(markdown = "") {
	const calls: string[] = [];
	const ai: LibraryAi = {
		embed: async (texts) => (calls.push(`embed:${texts.length}`), texts.map(() => [0.1, 0.2])),
		keywords: async () => "{}",
		toMarkdown: async (file) => (calls.push(`toMarkdown:${file.name}`), markdown),
	};
	return { ai, calls };
}

function fakeVectorize() {
	const upserted: VectorizeVector[][] = [];
	const deleted: string[][] = [];
	const vectorize: LibraryVectors = {
		query: async () => ({ matches: [], count: 0 }),
		getByIds: async () => [],
		upsert: async (vectors) => (upserted.push(vectors), { ids: vectors.map((vector) => vector.id), count: vectors.length }),
		deleteByIds: async (ids) => (deleted.push(ids), { ids, count: ids.length }),
	};
	return { vectorize, upserted, deleted };
}

const storage = { getObject: async () => ({ body: new Blob(["%PDF synthetic"]).stream() }) };

const paragraphs = (...texts: string[]): LibraryBlock[] => texts.map((text, n) => ({ id: `b${n}`, type: "text", props: { text } }));

async function row(id: string) {
	const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, id));
	return item;
}

beforeEach(resetLibrary);

describe("chunkText", () => {
	it("chunks on paragraph boundaries under the limit", () => {
		const chunks = chunkText(["a".repeat(1500), "b".repeat(1500)].join("\n\n"), 2000);
		expect(chunks).toHaveLength(2);
	});

	it("packs short paragraphs together and cuts one that is longer than a chunk", () => {
		expect(chunkText("one\n\ntwo\n\nthree", 2000)).toEqual(["one\n\ntwo\n\nthree"]);
		const cut = chunkText("x".repeat(4500), 2000);
		expect(cut.map((chunk) => chunk.length)).toEqual([2000, 2000, 500]);
		expect(chunkText("  \n\n ")).toEqual([]);
	});
});

describe("indexItem", () => {
	it("embeds a published page under itemId:n with the item id in the metadata, and marks it indexed", async () => {
		const id = await insertItem({ title: "Running a retreat", dek: "Plan it in four weeks", blocksJson: paragraphs("Book the venue early.") });
		const { ai } = fakeAi();
		const { vectorize, upserted } = fakeVectorize();
		await indexItem(id, { ai, vectorize, db, storage });
		expect(upserted).toHaveLength(1);
		expect(upserted[0].map((vector) => vector.id)).toEqual([`${id}:0`]);
		expect(upserted[0][0].metadata).toEqual({ itemId: id, chunk: 0 });
		expect((await row(id)).indexedAt).not.toBeNull();
		// A page's text is already in its search text; nothing is copied into extractedText.
		expect((await row(id)).extractedText).toBe("");
	});

	it("reads a file once through toMarkdown and stores the text for plain search", async () => {
		const id = await insertItem({ title: "Org design deck", format: "file", fileKey: `library/x/owner/deck.pdf`, fileName: "deck.pdf", fileBytes: 100 });
		const { ai, calls } = fakeAi("Synthetic module text about onboarding.");
		await indexItem(id, { ai, vectorize: fakeVectorize().vectorize, db, storage });
		expect(calls).toContain("toMarkdown:deck.pdf");
		expect((await row(id)).extractedText).toBe("Synthetic module text about onboarding.");
		expect((await row(id)).searchText).toContain("onboarding");

		calls.length = 0;
		await indexItem(id, { ai, vectorize: fakeVectorize().vectorize, db, storage });
		expect(calls.filter((call) => call.startsWith("toMarkdown"))).toEqual([]);
	});

	it("indexes a file it cannot convert by its title, summary and tags only", async () => {
		const id = await insertItem({ title: "Slides", format: "file", fileKey: "library/x/owner/s.pptx", fileName: "s.pptx", fileBytes: 100 });
		const { ai, calls } = fakeAi("never used");
		const { vectorize, upserted } = fakeVectorize();
		await indexItem(id, { ai, vectorize, db, storage });
		expect(calls.some((call) => call.startsWith("toMarkdown"))).toBe(false);
		expect(upserted[0]).toHaveLength(1);
	});

	it("deletes the stale chunk ids when an item gets shorter", async () => {
		const id = await insertItem({ title: "Long", blocksJson: paragraphs("a".repeat(1900), "b".repeat(1900), "c".repeat(1900)) });
		const { ai } = fakeAi();
		const first = fakeVectorize();
		await indexItem(id, { ai, vectorize: first.vectorize, db, storage });
		expect(first.upserted[0].length).toBeGreaterThanOrEqual(3);

		await db.update(libraryItems).set({ blocksJson: paragraphs("short now") }).where(eq(libraryItems.id, id));
		const second = fakeVectorize();
		await indexItem(id, { ai, vectorize: second.vectorize, db, storage });
		expect(second.upserted[0].map((vector) => vector.id)).toEqual([`${id}:0`]);
		const deleted = second.deleted.flat();
		expect(deleted).toEqual(expect.arrayContaining([`${id}:1`, `${id}:2`]));
		expect(deleted).not.toContain(`${id}:0`);
	});

	it("de-indexes a confidential item without sending it to any model, and still marks it read", async () => {
		const id = await insertItem({ title: "Client engagement notes", confidentiality: "confidential", format: "file", fileKey: "library/x/owner/c.pdf", fileName: "c.pdf", fileBytes: 100 });
		const { ai, calls } = fakeAi("Synthetic client text");
		const { vectorize, upserted, deleted } = fakeVectorize();
		await indexItem(id, { ai, vectorize, db, storage });
		expect(upserted).toEqual([]);
		expect(calls).toEqual([]);
		expect(deleted.flat()).toEqual(expect.arrayContaining([`${id}:0`, `${id}:${MAX_CHUNKS - 1}`]));
		expect((await row(id)).indexedAt).not.toBeNull();
		expect((await row(id)).extractedText).toBe("");
	});

	it("leaves drafts alone", async () => {
		const id = await insertItem({ title: "Draft", status: "draft" });
		const { ai, calls } = fakeAi();
		const { vectorize, upserted, deleted } = fakeVectorize();
		await indexItem(id, { ai, vectorize, db, storage });
		expect([calls, upserted, deleted]).toEqual([[], [], []]);
		expect((await row(id)).indexedAt).toBeNull();
	});
});

describe("deindexItem", () => {
	it("deletes every chunk id the item could have", async () => {
		const { vectorize, deleted } = fakeVectorize();
		await deindexItem("lib_gone", { vectorize });
		expect(deleted.flat()).toHaveLength(MAX_CHUNKS);
		expect(deleted.flat()[0]).toBe("lib_gone:0");
	});
});

describe("rebuildIndexBatch", () => {
	it("reads 10 unindexed published items per call and reports what is left", async () => {
		for (let i = 0; i < 12; i++) await insertItem({ title: `Item ${i}` });
		await insertItem({ title: "Draft", status: "draft" });
		await insertItem({ title: "Done", indexedAt: new Date() });
		const deps = { ai: fakeAi().ai, vectorize: fakeVectorize().vectorize, db, storage };
		expect(await rebuildIndexBatch(deps)).toEqual({ indexed: 10, remaining: 2 });
		expect(await rebuildIndexBatch(deps)).toEqual({ indexed: 2, remaining: 0 });
	});

	it("skips an item that fails and keeps going", async () => {
		await insertItem({ title: "One" });
		await insertItem({ title: "Two" });
		const ai: LibraryAi = { ...fakeAi().ai, embed: async () => Promise.reject(new Error("down")) };
		expect(await rebuildIndexBatch({ ai, vectorize: fakeVectorize().vectorize, db, storage })).toEqual({ indexed: 0, remaining: 2 });
	});
});
