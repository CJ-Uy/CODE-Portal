import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { libraryItemMemberDays, libraryListItems, libraryLists } from "@/db/schema";
import { createLibraryActivityRepository } from "./library-activity";
import { actors, insertItem, resetLibrary, seedMembers } from "./library-test-fixtures";

const db = drizzle(env.DB, { schema });
const activity = createLibraryActivityRepository(db);

async function saveToList(memberId: string, itemId: string, at: Date): Promise<void> {
	await db.insert(libraryLists).values({ id: `lst_${memberId}`, memberId, name: memberId }).onConflictDoNothing();
	await db.insert(libraryListItems).values({ listId: `lst_${memberId}`, libraryItemId: itemId, addedBy: memberId, createdAt: at });
}

async function seedDay(itemId: string, day: string, opens: number, activeSeconds: number): Promise<void> {
	await db.insert(libraryItemMemberDays).values({ itemId, memberId: "other", day, opens, activeSeconds });
}

beforeEach(async () => {
	await resetLibrary();
	await seedMembers(["owner", "other", "moderator", "third"]);
});

describe("library activity: record and stats", () => {
	it("caps one member at 2h per item per day even from two tabs", async () => {
		const id = await insertItem({});
		const now = new Date("2026-10-16T02:00:00Z");
		for (let i = 0; i < 600; i++) await activity.record(actors.other, id, { kind: "active", seconds: 30 }, now); // two tabs' worth
		expect((await activity.statsFor([id])).get(id)?.activeSeconds).toBe(7_200);
	}, 20_000);

	it("credits only what is left under the cap", async () => {
		const id = await insertItem({});
		await seedDay(id, "2026-10-16", 0, 7_190);
		await activity.record(actors.other, id, { kind: "active", seconds: 30 }, new Date("2026-10-16T02:00:00Z"));
		expect((await activity.statsFor([id])).get(id)?.activeSeconds).toBe(7_200);
	});

	it("holds the cap when pings land at the same instant", async () => {
		const id = await insertItem({});
		const now = new Date("2026-10-16T02:00:00Z");
		await seedDay(id, "2026-10-16", 0, 7_170);
		// Every ping reads 7,170 before any write lands, so each is credited the full 30 by creditSeconds alone.
		await Promise.all(Array.from({ length: 15 }, () => activity.record(actors.other, id, { kind: "active", seconds: 30 }, now)));
		const seconds = (await activity.statsFor([id])).get(id)?.activeSeconds ?? 0;
		expect(seconds).toBeLessThanOrEqual(7_200);
		expect(seconds).toBe(7_200);
	});

	it("starts a fresh cap on the next UTC+8 day", async () => {
		const id = await insertItem({});
		for (let i = 0; i < 250; i++) await activity.record(actors.other, id, { kind: "active", seconds: 30 }, new Date("2026-10-16T02:00:00Z"));
		// 2026-10-16T16:30Z is 00:30 on the 17th in UTC+8.
		await activity.record(actors.other, id, { kind: "active", seconds: 30 }, new Date("2026-10-16T16:30:00Z"));
		expect((await activity.statsFor([id])).get(id)?.activeSeconds).toBe(7_230);
	}, 20_000);

	it("credits at most one ping's worth and whole seconds", async () => {
		const id = await insertItem({});
		await activity.record(actors.other, id, { kind: "active", seconds: 500 });
		await activity.record(actors.other, id, { kind: "active", seconds: 4.9 });
		await activity.record(actors.other, id, { kind: "active" });
		expect((await activity.statsFor([id])).get(id)?.activeSeconds).toBe(34);
	});

	it("ignores pings for items the member cannot see", async () => {
		const id = await insertItem({ status: "draft", createdBy: "owner" });
		await activity.record(actors.other, id, { kind: "open" });
		expect((await activity.statsFor([id])).get(id)?.opens ?? 0).toBe(0);
	});

	it("ignores pings for items that do not exist", async () => {
		await expect(activity.record(actors.other, "lib_missing", { kind: "open" })).resolves.toBeUndefined();
		expect(await db.select().from(libraryItemMemberDays)).toEqual([]);
	});

	it("lets the owner ping their own draft", async () => {
		const id = await insertItem({ status: "draft", createdBy: "owner" });
		await activity.record(actors.owner, id, { kind: "open" });
		expect((await activity.statsFor([id])).get(id)?.opens).toBe(1);
	});

	it("counts opens, unique readers and downloads", async () => {
		const id = await insertItem({});
		await activity.record(actors.other, id, { kind: "open" });
		await activity.record(actors.other, id, { kind: "open" });
		await activity.record(actors.owner, id, { kind: "download" });
		expect((await activity.statsFor([id])).get(id)).toMatchObject({ opens: 2, uniqueReaders: 1, downloads: 1 });
	});

	it("sums across days and members, and counts saves by distinct member", async () => {
		const id = await insertItem({});
		await activity.record(actors.other, id, { kind: "open" }, new Date("2026-10-15T02:00:00Z"));
		await activity.record(actors.other, id, { kind: "open" }, new Date("2026-10-16T02:00:00Z"));
		await activity.record(actors.owner, id, { kind: "open" }, new Date("2026-10-16T02:00:00Z"));
		await saveToList("other", id, new Date());
		await saveToList("owner", id, new Date());
		expect((await activity.statsFor([id])).get(id)).toMatchObject({ opens: 3, uniqueReaders: 2, saves: 2 });
	});

	it("returns zeroed stats for items with no activity and handles many ids", async () => {
		const ids = [];
		for (let i = 0; i < 95; i++) ids.push(await insertItem({ id: `lib_many_${i}` }));
		await activity.record(actors.other, ids[90], { kind: "open" });
		const stats = await activity.statsFor([...ids, "lib_unknown"]);
		expect(stats.size).toBe(96);
		expect(stats.get(ids[0])).toEqual({ saves: 0, opens: 0, uniqueReaders: 0, activeSeconds: 0, downloads: 0 });
		expect(stats.get(ids[90])?.opens).toBe(1);
		expect((await activity.statsFor([])).size).toBe(0);
	});

	it("total hours exclude confidential and unpublished items", async () => {
		const pub = await insertItem({});
		const conf = await insertItem({ confidentiality: "confidential" });
		const draft = await insertItem({ status: "draft", createdBy: "owner" });
		await activity.record(actors.moderator, pub, { kind: "active", seconds: 30 });
		await activity.record(actors.moderator, conf, { kind: "active", seconds: 30 });
		await activity.record(actors.owner, draft, { kind: "active", seconds: 30 });
		expect(await activity.totalActiveSeconds()).toBe(30);
	});

	it("total is zero for an empty library", async () => {
		expect(await activity.totalActiveSeconds()).toBe(0);
	});
});

describe("library activity: mostSavedSince", () => {
	const since = new Date("2026-10-10T00:00:00Z");
	const inside = new Date("2026-10-12T00:00:00Z");
	const before = new Date("2026-10-01T00:00:00Z");

	it("ranks by distinct savers inside the window, then by newest publish", async () => {
		const old = await insertItem({ title: "Old", publishedAt: new Date("2026-09-01T00:00:00Z") });
		const recent = await insertItem({ title: "Recent", publishedAt: new Date("2026-10-05T00:00:00Z") });
		const popular = await insertItem({ title: "Popular", publishedAt: new Date("2026-08-01T00:00:00Z") });
		await saveToList("other", popular, inside);
		await saveToList("owner", popular, inside);
		await saveToList("other", old, inside);
		await saveToList("other", recent, inside);
		const cards = await activity.mostSavedSince(actors.other, since, 10);
		expect(cards.map((card) => card.title)).toEqual(["Popular", "Recent", "Old"]);
		expect(cards[0].saves).toBe(2);
	});

	it("ignores saves added before the window", async () => {
		const fresh = await insertItem({ title: "Fresh" });
		const stale = await insertItem({ title: "Stale" });
		await saveToList("other", fresh, inside);
		await saveToList("other", stale, before);
		await saveToList("owner", stale, before);
		const cards = await activity.mostSavedSince(actors.other, since, 10);
		expect(cards.map((card) => card.title)).toEqual(["Fresh"]);
	});

	it("counts one member saving into two lists once", async () => {
		const id = await insertItem({ title: "Twice" });
		const other = await insertItem({ title: "Once" });
		await saveToList("other", id, inside);
		await db.insert(libraryLists).values({ id: "lst_second", memberId: "other", name: "Second" });
		await db.insert(libraryListItems).values({ listId: "lst_second", libraryItemId: id, addedBy: "other", createdAt: inside });
		await saveToList("owner", other, inside);
		await saveToList("third", other, inside);
		const cards = await activity.mostSavedSince(actors.other, since, 10);
		expect(cards.map((card) => card.title)).toEqual(["Once", "Twice"]);
	});

	it("hides confidential, draft and taken-down items, except confidential for managers", async () => {
		const pub = await insertItem({ title: "Public" });
		const conf = await insertItem({ title: "Confidential", confidentiality: "confidential" });
		const draft = await insertItem({ title: "Draft", status: "draft", createdBy: "owner" });
		const down = await insertItem({ title: "Down", status: "taken_down" });
		for (const id of [pub, conf, draft, down]) await saveToList("other", id, inside);
		const member = await activity.mostSavedSince(actors.other, since, 10);
		expect(member.map((card) => card.title)).toEqual(["Public"]);
		const manager = await activity.mostSavedSince(actors.moderator, since, 10);
		expect(manager.map((card) => card.title).sort()).toEqual(["Confidential", "Public"]);
	});

	it("respects the limit", async () => {
		for (let i = 0; i < 4; i++) await saveToList("other", await insertItem({ title: `Item ${i}` }), inside);
		expect(await activity.mostSavedSince(actors.other, since, 2)).toHaveLength(2);
		expect(await activity.mostSavedSince(actors.other, since, 0)).toEqual([]);
	});
});

describe("library activity: weeklyForOwner", () => {
	const now = new Date("2026-10-16T02:00:00Z"); // Friday, ISO 2026-W42

	it("returns the last 12 ISO weeks, oldest first, with zeros for quiet weeks", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await seedDay(id, "2026-10-16", 2, 60); // W42
		await seedDay(id, "2026-10-12", 1, 30); // W42 Monday
		await seedDay(id, "2026-10-11", 4, 100); // W41 Sunday
		await seedDay(id, "2026-07-27", 7, 700); // W31 is the first of the 12 weeks
		await seedDay(id, "2026-07-26", 9, 900); // W30 is outside the window
		const weeks = await activity.weeklyForOwner(actors.owner, id, now);
		expect(weeks.map((row) => row.week)).toEqual([
			"2026-W31", "2026-W32", "2026-W33", "2026-W34", "2026-W35", "2026-W36",
			"2026-W37", "2026-W38", "2026-W39", "2026-W40", "2026-W41", "2026-W42",
		]);
		expect(weeks.filter((row) => row.opens > 0 || row.activeSeconds > 0)).toEqual([
			{ week: "2026-W31", opens: 7, activeSeconds: 700 },
			{ week: "2026-W41", opens: 4, activeSeconds: 100 },
			{ week: "2026-W42", opens: 3, activeSeconds: 90 },
		]);
	});

	it("returns twelve zero weeks for an item nobody has read", async () => {
		const id = await insertItem({ createdBy: "owner" });
		const weeks = await activity.weeklyForOwner(actors.owner, id, now);
		expect(weeks).toHaveLength(12);
		expect(weeks.every((row) => row.opens === 0 && row.activeSeconds === 0)).toBe(true);
	});

	it("labels weeks that straddle the new year by their ISO year", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await seedDay(id, "2027-01-01", 1, 10); // Friday, still 2026-W53
		await seedDay(id, "2026-12-28", 1, 10); // Monday, 2026-W53
		await seedDay(id, "2027-01-04", 1, 10); // Monday, 2027-W01
		const weeks = await activity.weeklyForOwner(actors.owner, id, new Date("2027-01-05T02:00:00Z"));
		expect(weeks.map((row) => row.week)).toEqual([
			"2026-W43", "2026-W44", "2026-W45", "2026-W46", "2026-W47", "2026-W48",
			"2026-W49", "2026-W50", "2026-W51", "2026-W52", "2026-W53", "2027-W01",
		]);
		expect(weeks.filter((row) => row.opens > 0)).toEqual([
			{ week: "2026-W53", opens: 2, activeSeconds: 20 },
			{ week: "2027-W01", opens: 1, activeSeconds: 10 },
		]);
	});

	it("only counts the requested item", async () => {
		const mine = await insertItem({ createdBy: "owner" });
		const theirs = await insertItem({ createdBy: "owner" });
		await seedDay(mine, "2026-10-16", 1, 10);
		await seedDay(theirs, "2026-10-16", 5, 50);
		const weeks = await activity.weeklyForOwner(actors.owner, mine, now);
		expect(weeks.at(-1)).toEqual({ week: "2026-W42", opens: 1, activeSeconds: 10 });
		expect(weeks.reduce((sum, row) => sum + row.opens, 0)).toBe(1);
	});

	it("allows the owner and moderators and refuses everyone else", async () => {
		const id = await insertItem({ createdBy: "owner" });
		await seedDay(id, "2026-10-16", 1, 10);
		expect((await activity.weeklyForOwner(actors.owner, id, now)).at(-1)?.opens).toBe(1);
		expect((await activity.weeklyForOwner(actors.moderator, id, now)).at(-1)?.opens).toBe(1);
		await expect(activity.weeklyForOwner(actors.other, id, now)).rejects.toThrow("Library item not found.");
		await expect(activity.weeklyForOwner(actors.owner, "lib_missing", now)).rejects.toThrow("Library item not found.");
	});
});
