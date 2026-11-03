import { and, asc, desc, eq, gt, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { libraryItemMemberDays, libraryItems, libraryListItems, terms } from "@/db/schema";
import { ACTIVITY, creditSeconds, utc8Day } from "@/lib/library/activity";
import type { Actor } from "@/server/auth/permissions";
import { cardsByIds } from "./library";
import type { Db, LibraryCard } from "./library";
import { canEditItem, canSeeItem, publishedVisibleWhere } from "./library-access";

export type LibraryPing = { kind: "open" | "active" | "download"; seconds?: number };
export type LibraryItemStats = { saves: number; opens: number; uniqueReaders: number; activeSeconds: number; downloads: number };
export type LibraryWeek = { week: string; opens: number; activeSeconds: number };

export type LibraryActivityRepository = {
	/** Silently ignores items the actor cannot see. Active seconds are credited through `creditSeconds`, so the daily cap holds. */
	record(actor: Actor, itemId: string, ping: LibraryPing, now?: Date): Promise<void>;
	/** An entry for every id asked for, zeroed when there is no activity. Does not check who may see the items. */
	statsFor(itemIds: string[]): Promise<Map<string, LibraryItemStats>>;
	/** Published, non-confidential items only. */
	totalActiveSeconds(): Promise<number>;
	/** Items saved by at least 3 distinct members since `since`, most first; only items this actor can browse. */
	mostSavedSince(actor: Actor, since: Date, limit: number): Promise<LibraryCard[]>;
	/** Items this member opened, most recent day first, at most `limit`; only items they can still browse. */
	recentlyOpened(actor: Actor, limit: number): Promise<LibraryCard[]>;
	/** When the current term started (`startsAt <= now < endsAt`), or 120 days before `now` while no term covers it. */
	termStart(now?: Date): Promise<Date>;
	/** The item's owner or a moderator who can see it; anyone else gets "Library item not found.". Always the last 12 ISO weeks, oldest first, with zeros for quiet weeks. */
	weeklyForOwner(actor: Actor, itemId: string, now?: Date): Promise<LibraryWeek[]>;
};

// Each id is one bind; D1 allows 100 per statement.
const ID_CHUNK = 40;
const WEEKS_SHOWN = 12;
const DAY_MS = 86_400_000;
const NO_TERM_DAYS = 120;
// Opens and downloads a member can add to one item per UTC+8 day: a script re-opening an item cannot inflate its stats.
const DAILY_COUNT_CAP = 10;
// The same floor as showSaveCount: a shelf of items saved by one or two members would point at who saved them.
const MOST_SAVED_FLOOR = 3;

const zeroStats = (): LibraryItemStats => ({ saves: 0, opens: 0, uniqueReaders: 0, activeSeconds: 0, downloads: 0 });

/** "2026-W42" for a "YYYY-MM-DD" day: the ISO week, labelled with the ISO year (which can differ from the calendar year). */
function isoWeekLabel(day: string): string {
	const date = new Date(`${day}T00:00:00Z`);
	const mondayBased = (date.getUTCDay() + 6) % 7;
	date.setUTCDate(date.getUTCDate() - mondayBased + 3); // the Thursday of this week decides the ISO year
	const jan4 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
	const week = 1 + Math.round(((date.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
	return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** First day of the oldest of the last `WEEKS_SHOWN` ISO weeks, counting the week that contains `today`. */
function windowStart(today: string): string {
	const date = new Date(`${today}T00:00:00Z`);
	const mondayBased = (date.getUTCDay() + 6) % 7;
	return new Date(date.getTime() - (mondayBased + 7 * (WEEKS_SHOWN - 1)) * DAY_MS).toISOString().slice(0, 10);
}

export function createLibraryActivityRepository(db: Db): LibraryActivityRepository {
	return {
		async record(actor, itemId, ping, now = new Date()) {
			const [item] = await db
				.select({ status: libraryItems.status, confidentiality: libraryItems.confidentiality, createdBy: libraryItems.createdBy })
				.from(libraryItems)
				.where(eq(libraryItems.id, itemId))
				.limit(1);
			if (!item || !canSeeItem(actor, item)) return;

			const day = utc8Day(now);
			const where = and(
				eq(libraryItemMemberDays.itemId, itemId),
				eq(libraryItemMemberDays.memberId, actor.memberId),
				eq(libraryItemMemberDays.day, day),
			);
			let seconds = 0;
			if (ping.kind === "active") {
				const [today] = await db.select({ activeSeconds: libraryItemMemberDays.activeSeconds }).from(libraryItemMemberDays).where(where).limit(1);
				seconds = creditSeconds(ping.seconds ?? 0, today?.activeSeconds ?? 0);
				if (seconds === 0) return;
			}

			const delta = { opens: ping.kind === "open" ? 1 : 0, activeSeconds: seconds, downloads: ping.kind === "download" ? 1 : 0 };
			// The read above only sizes this ping's credit. The daily cap is enforced in SQL: the update clamps at the cap, so parallel pings that all read the same total still cannot push it over. A fresh insert is at most one ping's credit.
			await db
				.insert(libraryItemMemberDays)
				.values({ itemId, memberId: actor.memberId, day, ...delta })
				.onConflictDoUpdate({
					target: [libraryItemMemberDays.itemId, libraryItemMemberDays.memberId, libraryItemMemberDays.day],
					set: {
						opens: sql`MIN(${DAILY_COUNT_CAP}, ${libraryItemMemberDays.opens} + ${delta.opens})`,
						activeSeconds: sql`MIN(${ACTIVITY.dailyCapSeconds}, ${libraryItemMemberDays.activeSeconds} + ${delta.activeSeconds})`,
						downloads: sql`MIN(${DAILY_COUNT_CAP}, ${libraryItemMemberDays.downloads} + ${delta.downloads})`,
					},
				});
		},

		async statsFor(itemIds) {
			const ids = [...new Set(itemIds)];
			const stats = new Map(ids.map((id) => [id, zeroStats()]));
			for (let start = 0; start < ids.length; start += ID_CHUNK) {
				const chunk = ids.slice(start, start + ID_CHUNK);
				const [usage, saved] = await Promise.all([
					db
						.select({
							itemId: libraryItemMemberDays.itemId,
							opens: sql<number>`COALESCE(SUM(${libraryItemMemberDays.opens}), 0)`.mapWith(Number),
							uniqueReaders: sql<number>`COUNT(DISTINCT CASE WHEN ${libraryItemMemberDays.opens} > 0 THEN ${libraryItemMemberDays.memberId} END)`.mapWith(Number),
							activeSeconds: sql<number>`COALESCE(SUM(${libraryItemMemberDays.activeSeconds}), 0)`.mapWith(Number),
							downloads: sql<number>`COALESCE(SUM(${libraryItemMemberDays.downloads}), 0)`.mapWith(Number),
						})
						.from(libraryItemMemberDays)
						.where(inArray(libraryItemMemberDays.itemId, chunk))
						.groupBy(libraryItemMemberDays.itemId),
					db
						.select({
							itemId: libraryListItems.libraryItemId,
							saves: sql<number>`COUNT(DISTINCT ${libraryListItems.addedBy})`.mapWith(Number),
						})
						.from(libraryListItems)
						.where(inArray(libraryListItems.libraryItemId, chunk))
						.groupBy(libraryListItems.libraryItemId),
				]);
				for (const { itemId, ...row } of usage) Object.assign(stats.get(itemId)!, row);
				for (const { itemId, saves } of saved) stats.get(itemId)!.saves = saves;
			}
			return stats;
		},

		async totalActiveSeconds() {
			const [row] = await db
				.select({ total: sql<number>`COALESCE(SUM(${libraryItemMemberDays.activeSeconds}), 0)`.mapWith(Number) })
				.from(libraryItemMemberDays)
				.innerJoin(libraryItems, eq(libraryItems.id, libraryItemMemberDays.itemId))
				.where(and(eq(libraryItems.status, "published"), ne(libraryItems.confidentiality, "confidential")));
			return row?.total ?? 0;
		},

		async mostSavedSince(actor, since, limit) {
			if (limit < 1) return [];
			const savers = sql<number>`COUNT(DISTINCT ${libraryListItems.addedBy})`;
			const ranked = await db
				.select({ id: libraryListItems.libraryItemId })
				.from(libraryListItems)
				.innerJoin(libraryItems, eq(libraryItems.id, libraryListItems.libraryItemId))
				.where(and(gte(libraryListItems.createdAt, since), publishedVisibleWhere(actor)))
				.groupBy(libraryListItems.libraryItemId)
				.having(gte(savers, MOST_SAVED_FLOOR))
				.orderBy(desc(savers), desc(libraryItems.publishedAt), asc(libraryItems.id))
				.limit(limit);
			const order = ranked.map((row) => row.id);
			const cards = new Map((await cardsByIds(db, order)).map((card) => [card.id, card]));
			return order.flatMap((id) => cards.get(id) ?? []);
		},

		async recentlyOpened(actor, limit) {
			if (limit < 1) return [];
			// Days have no time of day, so items opened on the same day fall back to the most read, then the title.
			// ponytail: the key leads with item_id, so this reads the member's rows by scan; add a (member_id, day) index if the table grows large.
			const lastDay = sql<string>`MAX(${libraryItemMemberDays.day})`;
			const ranked = await db
				.select({ id: libraryItemMemberDays.itemId })
				.from(libraryItemMemberDays)
				.innerJoin(libraryItems, eq(libraryItems.id, libraryItemMemberDays.itemId))
				.where(and(eq(libraryItemMemberDays.memberId, actor.memberId), gt(libraryItemMemberDays.opens, 0), publishedVisibleWhere(actor)))
				.groupBy(libraryItemMemberDays.itemId)
				.orderBy(desc(lastDay), desc(sql`SUM(${libraryItemMemberDays.activeSeconds})`), asc(libraryItems.title))
				.limit(limit);
			const order = ranked.map((row) => row.id);
			const cards = new Map((await cardsByIds(db, order)).map((card) => [card.id, card]));
			return order.flatMap((id) => cards.get(id) ?? []);
		},

		async termStart(now = new Date()) {
			const [term] = await db
				.select({ startsAt: terms.startsAt })
				.from(terms)
				.where(and(lte(terms.startsAt, now), gt(terms.endsAt, now)))
				.orderBy(desc(terms.startsAt))
				.limit(1);
			return term?.startsAt ?? new Date(now.getTime() - NO_TERM_DAYS * DAY_MS);
		},

		async weeklyForOwner(actor, itemId, now = new Date()) {
			const [item] = await db
				.select({ status: libraryItems.status, confidentiality: libraryItems.confidentiality, createdBy: libraryItems.createdBy })
				.from(libraryItems)
				.where(eq(libraryItems.id, itemId))
				.limit(1);
			if (!item || !canEditItem(actor, item)) throw new Error("Library item not found.");

			const days = await db
				.select({
					day: libraryItemMemberDays.day,
					opens: sql<number>`SUM(${libraryItemMemberDays.opens})`.mapWith(Number),
					activeSeconds: sql<number>`SUM(${libraryItemMemberDays.activeSeconds})`.mapWith(Number),
				})
				.from(libraryItemMemberDays)
				.where(and(eq(libraryItemMemberDays.itemId, itemId), gte(libraryItemMemberDays.day, windowStart(utc8Day(now)))))
				.groupBy(libraryItemMemberDays.day)
				.orderBy(asc(libraryItemMemberDays.day));
			const start = Date.parse(`${windowStart(utc8Day(now))}T00:00:00Z`);
			const weeks = new Map<string, LibraryWeek>();
			for (let i = 0; i < WEEKS_SHOWN; i++) {
				const week = isoWeekLabel(new Date(start + i * 7 * DAY_MS).toISOString().slice(0, 10));
				weeks.set(week, { week, opens: 0, activeSeconds: 0 });
			}
			for (const { day, opens, activeSeconds } of days) {
				const total = weeks.get(isoWeekLabel(day));
				if (!total) continue; // a day after this week, from a skewed clock
				total.opens += opens;
				total.activeSeconds += activeSeconds;
			}
			return [...weeks.values()];
		},
	};
}

export function createUnavailableLibraryActivityRepository(): LibraryActivityRepository {
	const unavailable = () => {
		throw new Error("Library activity is unavailable through this repository adapter.");
	};
	return {
		record: unavailable,
		statsFor: unavailable,
		totalActiveSeconds: unavailable,
		mostSavedSince: unavailable,
		recentlyOpened: unavailable,
		termStart: unavailable,
		weeklyForOwner: unavailable,
	};
}
