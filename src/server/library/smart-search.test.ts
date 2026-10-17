import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { libraryItemTags, libraryTags } from "@/db/schema";
import { createAuditRepository } from "@/db/repositories/audit";
import { createLibraryRepository } from "@/db/repositories/library";
import { actors, insertItem, resetLibrary, seedMembers } from "@/db/repositories/library-test-fixtures";
import { createLibraryTagsRepository } from "@/db/repositories/library-tags";
import { createMembersRepository } from "@/db/repositories/members";
import type { MemberDb } from "@/db/repositories/members";
import type { LibraryAi, LibraryVectors } from "./ai";
import { getLibraryAi, getLibraryBindings, LIBRARY_EMBED_MODEL, LIBRARY_KEYWORD_MODEL } from "./ai";
import { fuseRankings, parseKeywordOutput, searchLibrary, smartRelated, smartSearch, smartSearchPreference } from "./smart-search";

const db = drizzle(env.DB, { schema });
const audit = createAuditRepository(db);
const repos = { library: createLibraryRepository(db, audit), libraryTags: createLibraryTagsRepository(db, audit) };

// Where OpenNext keeps the Worker env; getCloudflareEnv reads it, so the real flag and binding checks run on this.
const CONTEXT = Symbol.for("__cloudflare-context__");
const workerEnv = (values: Record<string, unknown>) => {
	(globalThis as Record<symbol, unknown>)[CONTEXT] = { env: values, ctx: { waitUntil: () => undefined }, cf: {} };
};
afterEach(() => {
	delete (globalThis as Record<symbol, unknown>)[CONTEXT];
});

/** Records every call, so a test can say "the model was never asked". */
function fakeAi(overrides: Partial<LibraryAi> = {}): LibraryAi & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		embed: async (texts) => (calls.push("embed"), texts.map(() => [0.1, 0.2])),
		keywords: async () => (calls.push("keywords"), '{"tags":[],"words":[]}'),
		toMarkdown: async () => (calls.push("toMarkdown"), ""),
		...overrides,
	};
}

/** Answers every query with `ids`, best first, whatever the vector. */
function fakeVectorize(ids: string[]): LibraryVectors {
	return {
		query: async () => ({ matches: ids.map((id, rank) => ({ id, score: 1 - rank / 100 })), count: ids.length }),
		getByIds: async (wanted) => wanted.filter((id) => ids.includes(id)).map((id) => ({ id, values: [0.1, 0.2] })),
		upsert: async (vectors) => ({ ids: vectors.map((vector) => vector.id), count: vectors.length }),
		deleteByIds: async (deleted) => ({ ids: deleted, count: deleted.length }),
	};
}

async function addTag(id: string, name: string, itemIds: string[]): Promise<void> {
	await db.insert(libraryTags).values({ id, name, slug: name.toLowerCase() });
	for (const itemId of itemIds) await db.insert(libraryItemTags).values({ itemId, tagId: id });
}

beforeEach(async () => {
	await resetLibrary();
	await seedMembers(["owner", "other", "moderator"]);
});

describe("parseKeywordOutput", () => {
	it("accepts only JSON with known tags and caps counts", () => {
		expect(parseKeywordOutput('{"tags":["Motivation","Nope"],"words":["show up","a","b","c"]}', ["Motivation"])).toEqual({
			tags: ["Motivation"],
			words: ["show up", "a", "b"],
		});
		expect(parseKeywordOutput("Sure! Here are some keywords: motivation", ["Motivation"])).toEqual({ tags: [], words: [] });
	});

	it("matches tags case-insensitively, keeps the tag's own spelling, and allows at most 5", () => {
		const names = ["A", "B", "C", "D", "E", "F"];
		expect(parseKeywordOutput('{"tags":["a","b","c","d","e","f"]}', names).tags).toEqual(["A", "B", "C", "D", "E"]);
		expect(parseKeywordOutput('{"tags":["member engagement"]}', ["Member Engagement"]).tags).toEqual(["Member Engagement"]);
	});

	it("rejects the wrong shape outright", () => {
		expect(parseKeywordOutput('{"tags":"Motivation"}', ["Motivation"])).toEqual({ tags: [], words: [] });
		expect(parseKeywordOutput('["Motivation"]', ["Motivation"])).toEqual({ tags: [], words: [] });
		expect(parseKeywordOutput("", ["Motivation"])).toEqual({ tags: [], words: [] });
	});
});

describe("fuseRankings", () => {
	it("fuses rankings with reciprocal rank", () => {
		expect(fuseRankings(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c", "b"]);
	});
});

describe("smartSearch", () => {
	it("returns null on timeout so the page falls back", async () => {
		const ai = fakeAi({ embed: () => new Promise(() => {}) });
		expect(await smartSearch(actors.other, "burnout", { ai, vectorize: fakeVectorize([]), repos, timeoutMs: 20 })).toBeNull();
	});

	it("returns null when the model or the index fails", async () => {
		const failing = fakeAi({ keywords: async () => Promise.reject(new Error("down")) });
		expect(await smartSearch(actors.other, "burnout", { ai: failing, vectorize: fakeVectorize([]), repos })).toBeNull();
		const brokenIndex = { ...fakeVectorize([]), query: async () => Promise.reject(new Error("down")) };
		expect(await smartSearch(actors.other, "burnout", { ai: fakeAi(), vectorize: brokenIndex, repos })).toBeNull();
	});

	it("never returns ids the actor cannot see even if Vectorize does", async () => {
		const conf = await insertItem({ title: "Secret", confidentiality: "confidential" });
		const draft = await insertItem({ title: "Draft", status: "draft", createdBy: "owner" });
		const shown = await insertItem({ title: "Open notes" });
		const vectorize = fakeVectorize([`${conf}:0`, `${draft}:0`, "lib_deleted:0", `${shown}:3`]);
		const res = await smartSearch(actors.other, "secret", { ai: fakeAi({}), vectorize, repos });
		expect(res?.ids ?? []).not.toContain(conf);
		expect(res?.ids).toEqual([shown]);
	});

	it("turns known tags into tag chips and the rest into word chips, and drops removed chips", async () => {
		const tagged = await insertItem({ title: "Roll call" });
		const worded = await insertItem({ title: "Attendance tracker" });
		await addTag("ltg_mot", "Motivation", [tagged]);
		const ai = fakeAi({ keywords: async () => '{"tags":["motivation"],"words":["attendance"]}' });
		const vectorize = fakeVectorize([`${tagged}:0`]);

		const res = await smartSearch(actors.other, "how do i get members to show up", { ai, vectorize, repos });
		expect(res?.chips).toEqual([{ label: "Motivation", tagId: "ltg_mot" }, { label: "attendance" }]);
		expect(res?.ids).toEqual([tagged, worded]);

		const without = await smartSearch(actors.other, "how do i get members to show up", { ai, vectorize, repos }, { without: ["motivation", "attendance"] });
		expect(without?.chips).toEqual([]);
		expect(without?.ids).toEqual([tagged]);
	});

	it("lets a tag chip boost only what the query found, never add an item of its own", async () => {
		const meaning = await insertItem({ title: "Keeping volunteers" });
		const keyword = await insertItem({ title: "Burnout checklist" });
		const offTopic = await insertItem({ title: "Most-saved org chart" });
		await addTag("ltg_mot", "Motivation", [keyword, offTopic]);
		// offTopic is the tag's most-saved item, but neither the vectors nor plain search found it.
		await db.insert(schema.libraryLists).values({ id: "lst_1", memberId: "owner", name: "Saves" });
		await db.insert(schema.libraryListItems).values({ listId: "lst_1", libraryItemId: offTopic, addedBy: "owner" });
		const ai = fakeAi({ keywords: async () => '{"tags":["Motivation"]}' });

		const res = await smartSearch(actors.other, "burnout", { ai, vectorize: fakeVectorize([`${meaning}:0`]), repos });
		expect(res?.ids).not.toContain(offTopic);
		// The tag lifts the keyword match above the vector match it tied with.
		expect(res?.ids).toEqual([keyword, meaning]);
	});

	it("drops a word chip that only repeats the search", async () => {
		const ai = fakeAi({ keywords: async () => '{"words":["Burnout","rest"]}' });
		const res = await smartSearch(actors.other, "burnout", { ai, vectorize: fakeVectorize([]), repos });
		expect(res?.chips).toEqual([{ label: "rest" }]);
	});

	it("logs why it fell back in fixed words, never the search", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			await smartSearch(actors.other, "secret plans", { ai: fakeAi({ embed: () => new Promise(() => {}) }), vectorize: fakeVectorize([]), repos, timeoutMs: 20 });
			await smartSearch(actors.other, "secret plans", { ai: fakeAi({ embed: async () => Promise.reject(new Error("secret plans failed")) }), vectorize: fakeVectorize([]), repos });
			await smartSearch(actors.other, "secret plans", { ai: fakeAi({ keywords: async () => "Here you go: secret plans" }), vectorize: fakeVectorize([]), repos });
			expect(log.mock.calls).toEqual([["Library smart search fell back: timeout"], ["Library smart search fell back: error"], ["Library smart search fell back: invalid"]]);
		} finally {
			log.mockRestore();
		}
	});

	it("keeps the member's filters on every list it fuses", async () => {
		const guide = await insertItem({ title: "Burnout guide", kind: "guide" });
		await insertItem({ title: "Burnout essay", kind: "article" });
		const res = await smartSearch(actors.other, "burnout", { ai: fakeAi(), vectorize: fakeVectorize([]), repos }, { filters: { kinds: ["guide"] } });
		expect(res?.ids).toEqual([guide]);
	});
});

describe("searchLibrary: when smart search runs", () => {
	const search = { q: "burnout", limit: 24, offset: 0 };

	it("smart search off by flag: no AI call, even with both bindings in the Worker env", async () => {
		const run: string[] = [];
		const AI = {
			run: async (model: string) => (run.push(model), model.includes("bge") ? { data: [[0.1, 0.2]] } : { response: '{"tags":[],"words":[]}' }),
			toMarkdown: async () => (run.push("toMarkdown"), { format: "markdown", data: "" }),
		};
		await insertItem({ title: "Burnout" });

		workerEnv({ ...env, FEATURE_LIBRARY_SMART_SEARCH: "false", AI, VECTORIZE: fakeVectorize([]) });
		expect(getLibraryAi()).toBeNull();
		expect(getLibraryBindings()).not.toBeNull(); // indexing and the admin rebuild still have them
		const off = await searchLibrary(actors.other, { ...search, smart: true }, { smart: getLibraryAi(), preference: true, repos });
		expect(run).toEqual([]);
		expect(off.total).toBe(1);
		expect(off.chips).toEqual([]);

		// The same env with the flag on reaches the model, so the test above is not passing by accident.
		workerEnv({ ...env, FEATURE_LIBRARY_SMART_SEARCH: "true", AI, VECTORIZE: fakeVectorize([]) });
		await searchLibrary(actors.other, { ...search, smart: true }, { smart: getLibraryAi(), preference: true, repos });
		expect(run.sort()).toEqual([LIBRARY_EMBED_MODEL, LIBRARY_KEYWORD_MODEL].sort());
	});

	it("member preference off: no AI call", async () => {
		const ai = fakeAi();
		await searchLibrary(actors.other, { ...search, smart: null }, { smart: { ai, vectorize: fakeVectorize([]) }, preference: false, repos });
		expect(ai.calls).toEqual([]);
	});

	it("smart=0 overrides the preference being on, and smart=1 the preference being off", async () => {
		const ai = fakeAi();
		await searchLibrary(actors.other, { ...search, smart: false }, { smart: { ai, vectorize: fakeVectorize([]) }, preference: true, repos });
		expect(ai.calls).toEqual([]);
		await searchLibrary(actors.other, { ...search, smart: true }, { smart: { ai, vectorize: fakeVectorize([]) }, preference: false, repos });
		expect(ai.calls.sort()).toEqual(["embed", "keywords"]);
	});

	it("pages over the smart ids, and falls back to plain search when smart search fails", async () => {
		const ids = [];
		for (let i = 0; i < 3; i++) ids.push(await insertItem({ title: `Note ${i}` }));
		const vectorize = fakeVectorize(ids.map((id) => `${id}:0`));
		const page2 = await searchLibrary(actors.other, { q: "unrelated words", limit: 2, offset: 2, smart: true }, { smart: { ai: fakeAi(), vectorize }, preference: true, repos });
		expect(page2.total).toBe(3);
		expect(page2.cards.map((card) => card.id)).toEqual([ids[2]]);

		await insertItem({ title: "Burnout" });
		const broken = fakeAi({ embed: async () => Promise.reject(new Error("down")) });
		const plain = await searchLibrary(actors.other, { ...search, smart: true }, { smart: { ai: broken, vectorize }, preference: true, repos });
		expect(plain.cards.map((card) => card.title)).toEqual(["Burnout"]);
		expect(plain.chips).toEqual([]);
	});
});

describe("smartRelated", () => {
	it("is null for an item that was never indexed, so the page uses the tag shelf", async () => {
		const item = await insertItem({ title: "Base" });
		expect(await smartRelated(actors.other, item, { vectorize: fakeVectorize([]), repos })).toBeNull();
	});

	it("ranks similar items, never the item itself or anything hidden", async () => {
		const base = await insertItem({ title: "Base" });
		const near = await insertItem({ title: "Near" });
		const conf = await insertItem({ title: "Hidden", confidentiality: "confidential" });
		const vectorize = fakeVectorize([`${base}:0`, `${conf}:1`, `${near}:2`]);
		expect(await smartRelated(actors.other, base, { vectorize, repos })).toEqual([near]);
	});

	it("is null for an item the actor cannot see", async () => {
		const conf = await insertItem({ title: "Hidden", confidentiality: "confidential" });
		expect(await smartRelated(actors.other, conf, { vectorize: fakeVectorize([`${conf}:0`]), repos })).toBeNull();
	});

	it("fits both index lookups in one budget", async () => {
		const base = await insertItem({ title: "Base" });
		const slow = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 25));
		const index = fakeVectorize([`${base}:0`]);
		const vectorize = { ...index, getByIds: (ids: string[]) => index.getByIds(ids).then(slow), query: (vector: number[]) => index.query(vector).then(slow) };
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			// Each step alone fits in 40 ms; the two together do not.
			expect(await smartRelated(actors.other, base, { vectorize, repos, timeoutMs: 40 })).toBeNull();
		} finally {
			log.mockRestore();
		}
	});
});

describe("smartSearchPreference", () => {
	it("is on for a member who never touched the switch, and follows it after", async () => {
		const members = createMembersRepository(db as unknown as MemberDb, audit);
		expect(await smartSearchPreference(members, actors.other)).toBe(true);
		await members.updateProfile(actors.other, "other", { librarySmartSearch: false });
		expect(await smartSearchPreference(members, actors.other)).toBe(false);
	});
});
