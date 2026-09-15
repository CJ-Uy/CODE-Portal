import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { InferSelectModel } from "drizzle-orm";
import * as schema from "@/db/schema";
import { linkDailyStats, linkHourlyStats, members, reservedSlugs, shortLinks } from "@/db/schema";
import { createId } from "@/lib/ids";
import { isValidDestinationUrl, isValidSlugFormat, normalizeSlug, RESERVED_SLUG_DEFAULTS } from "@/lib/links";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { pageLimit } from "./types";

export type ShortLink = InferSelectModel<typeof shortLinks>;
export type LinkOwner = { id: string; name: string | null; image: string | null };
export type QrStyle = {
	foreground: string;
	background: string;
	pattern: "classic" | "rounded" | "dots" | "soft" | "classy" | "classy-rounded";
	cornerStyle: "square" | "rounded" | "dot";
	showLogo: boolean;
	logoUrl: string | null;
	logoSize: number;
	logoMargin: number;
	showLogoBacking: boolean;
	logoBackingShape: "circle" | "square";
	logoBackingColor: string;
	transparentBackground: boolean;
};
export type LinkListItem = Omit<ShortLink, "tags" | "qrStyle"> & { owner: LinkOwner | null; tags: string[]; qrStyle: QrStyle };

export const DEFAULT_QR_STYLE: QrStyle = {
	foreground: "#06192F",
	background: "#FFFFFF",
	pattern: "classic",
	cornerStyle: "square",
	showLogo: true,
	logoUrl: "/code-falcon-transparent.svg",
	logoSize: 0.24,
	logoMargin: 8,
	showLogoBacking: false,
	logoBackingShape: "circle",
	logoBackingColor: "#FFFFFF",
	transparentBackground: false,
};

export type CreateLinkInput = { slug: string; destinationUrl: string; title: string; tags?: string[]; qrStyle?: Partial<QrStyle> };
export type UpdateLinkInput = Partial<{
	destinationUrl: string;
	title: string;
	previewTitle: string | null;
	previewDescription: string | null;
	previewImageKey: string | null;
	tags: string[];
	qrStyle: Partial<QrStyle>;
}>;
export type ResolvedLink = {
	id: string;
	slug: string;
	destinationUrl: string;
	title: string;
	previewTitle: string | null;
	previewDescription: string | null;
	previewImageKey: string | null;
};
export type LinkStatsGranularity = "hour" | "day" | "week" | "month";
export type LinkStatsSource = "all" | "qr" | "link" | "unknown";
export type LinkStatsDevice = "all" | "mobile" | "desktop";
export type LinkStatsQueryInput = Partial<{
	from: string;
	to: string;
	timezone: string;
	granularity: LinkStatsGranularity;
	source: LinkStatsSource;
	device: LinkStatsDevice;
}>;
export type LinkStatsQuery = Required<LinkStatsQueryInput>;
export type LinkStats = {
	link: ShortLink;
	lifetimeClicks: number;
	filteredClicks: number;
	series: Array<{ date: string; count: number }>;
	hourly: Array<{ hour: string; count: number }>;
	referrers: Array<{ bucket: string; count: number }>;
	devices: Array<{ bucket: string; count: number }>;
	query: LinkStatsQuery;
	comparison: { from: string; to: string; filteredClicks: number };
	history: {
		basis: "hourly";
		earliestHour: string | null;
		latestHour: string | null;
		rowsRead: number;
		maxRows: number;
		complete: boolean;
		note: string | null;
	};
};

export type LinksRepository = {
	listVisible(actor: Actor, input?: { limit?: number; offset?: number }): Promise<LinkListItem[]>;
	listOwn(actor: Actor, input?: { limit?: number; offset?: number }): Promise<LinkListItem[]>;
	listAll(actor: Actor, input?: { limit?: number; offset?: number }): Promise<LinkListItem[]>;
	getById(actor: Actor, id: string): Promise<ShortLink | null>;
	canEditLink(actor: Actor, id: string): Promise<boolean>;
	create(actor: Actor, input: CreateLinkInput): Promise<LinkListItem>;
	update(actor: Actor, id: string, input: UpdateLinkInput): Promise<LinkListItem>;
	remove(actor: Actor, id: string): Promise<void>;
	getStats(actor: Actor, id: string, input?: LinkStatsQueryInput): Promise<LinkStats>;
	resolveForRedirect(slug: string): Promise<ResolvedLink | null>;
	recordClick(linkId: string, input: { date: string; hour?: string; referrerBucket: string; deviceBucket: string }): Promise<void>;
};

export type LinkDb = DrizzleD1Database<typeof schema>;
export type LinkErrorCode = "not_found" | "not_authorized" | "validation";

export class LinkRepositoryError extends Error {
	constructor(
		readonly code: LinkErrorCode,
		message: string,
	) {
		super(message);
		this.name = "LinkRepositoryError";
	}
}

export function linkErrorStatus(error: unknown): number {
	if (!(error instanceof LinkRepositoryError)) return 400;
	if (error.code === "not_authorized") return 403;
	if (error.code === "not_found") return 404;
	return 400;
}

function linkError(code: LinkErrorCode, message: string): LinkRepositoryError {
	return new LinkRepositoryError(code, message);
}

async function loadReadable(db: LinkDb, id: string): Promise<ShortLink> {
	const [link] = await db.select().from(shortLinks).where(eq(shortLinks.id, id)).limit(1);
	if (!link) throw linkError("not_found", "Link not found.");
	return link;
}

async function loadOwned(db: LinkDb, actor: Actor, id: string): Promise<ShortLink> {
	const link = await loadReadable(db, id);
	if (link.ownerMemberId !== actor.memberId && !can(actor, "link:moderate")) {
		throw linkError("not_authorized", "Not authorized to access this link.");
	}
	return link;
}

function ensurePage(input?: { limit?: number; offset?: number }) {
	return { limit: pageLimit(input?.limit), offset: input?.offset ?? 0 };
}

const MAX_STATS_ROWS = 5000;
const MAX_STATS_DAYS = 366;
const QR_PATTERNS: QrStyle["pattern"][] = ["classic", "rounded", "dots", "soft", "classy", "classy-rounded"];
const QR_CORNERS: QrStyle["cornerStyle"][] = ["square", "rounded", "dot"];
const QR_BACKING_SHAPES: QrStyle["logoBackingShape"][] = ["circle", "square"];

function sortedBuckets(map: Map<string, number>) {
	return Array.from(map.entries())
		.map(([key, count]) => ({ key, count }))
		.sort((a, b) => a.key.localeCompare(b.key));
}

function validDate(value: string): boolean {
	const date = new Date(`${value}T00:00:00Z`);
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value: string, days: number): string {
	const date = new Date(`${value}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function localDate(value: Date, timezone: string): string {
	const parts = new Intl.DateTimeFormat("en", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(value);
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

function resolveStatsQuery(input: LinkStatsQueryInput = {}): LinkStatsQuery {
	const timezone = input.timezone ?? "UTC";
	try {
		new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
	} catch {
		throw linkError("validation", "Timezone must be a valid IANA timezone.");
	}
	const to = input.to ?? localDate(new Date(), timezone);
	if (!validDate(to)) throw linkError("validation", "Analytics dates must use YYYY-MM-DD.");
	const from = input.from ?? addDays(to, -29);
	if (!validDate(from)) throw linkError("validation", "Analytics dates must use YYYY-MM-DD.");
	if (from > to) throw linkError("validation", "Analytics start date must be on or before the end date.");
	const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
	if (days > MAX_STATS_DAYS) throw linkError("validation", `Analytics ranges are limited to ${MAX_STATS_DAYS} days. Choose a narrower date range.`);

	const granularity = input.granularity ?? "day";
	const source = input.source ?? "all";
	const device = input.device ?? "all";
	if (!["hour", "day", "week", "month"].includes(granularity)) throw linkError("validation", "Invalid analytics granularity.");
	if (granularity === "hour" && days > 14) throw linkError("validation", "Hourly analytics are limited to 14 days. Choose a narrower date range or a broader grouping.");
	if (!["all", "qr", "link", "unknown"].includes(source)) throw linkError("validation", "Invalid analytics source filter.");
	if (!["all", "mobile", "desktop"].includes(device)) throw linkError("validation", "Invalid analytics device filter.");
	return { from, to, timezone, granularity, source, device };
}

function localHour(hour: string, formatter: Intl.DateTimeFormat): { date: string; hour: string } {
	const value = new Date(`${hour}:00Z`);
	const parts = formatter.formatToParts(value);
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
	const year = part("year");
	const month = part("month");
	const day = part("day");
	const hourPart = part("hour");
	const minute = part("minute");
	const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hourPart), Number(minute));
	const offsetMinutes = Math.round((localAsUtc - value.getTime()) / 60_000);
	const offsetSign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteOffset = Math.abs(offsetMinutes);
	const offset = `${offsetSign}${String(Math.floor(absoluteOffset / 60)).padStart(2, "0")}:${String(absoluteOffset % 60).padStart(2, "0")}`;
	const date = `${year}-${month}-${day}`;
	return { date, hour: `${date}T${hourPart}:${minute}${offset}` };
}

function seriesBucket(local: { date: string; hour: string }, granularity: LinkStatsGranularity): string {
	if (granularity === "hour") return local.hour;
	if (granularity === "day") return local.date;
	if (granularity === "month") return local.date.slice(0, 7);
	const day = new Date(`${local.date}T00:00:00Z`);
	day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
	return day.toISOString().slice(0, 10);
}

function sourceBucket(bucket: string): Exclude<LinkStatsSource, "all"> {
	if (bucket === "qr scan") return "qr";
	if (bucket === "direct") return "link";
	return "unknown";
}

function displaySourceBucket(bucket: string): string {
	const source = sourceBucket(bucket);
	return source === "qr" ? "qr scan" : source === "link" ? "direct" : "unknown";
}

function filledSeries(counts: Map<string, number>, query: LinkStatsQuery, formatter: Intl.DateTimeFormat): Array<{ date: string; count: number }> {
	const keys = new Set<string>();
	if (query.granularity === "hour") {
		const start = Date.parse(`${addDays(query.from, -1)}T00:00:00Z`);
		const end = Date.parse(`${addDays(query.to, 1)}T23:00:00Z`);
		for (let time = start; time <= end; time += 60 * 60 * 1000) {
			const utcHour = new Date(time).toISOString().slice(0, 13) + ":00";
			const local = localHour(utcHour, formatter);
			if (local.date >= query.from && local.date <= query.to) keys.add(local.hour);
		}
	} else {
		for (let date = query.from; date <= query.to;) {
			keys.add(seriesBucket({ date, hour: `${date}T00:00` }, query.granularity));
			if (date === query.to) break;
			date = addDays(date, 1);
		}
	}
	return [...keys].map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

function parseTags(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? validateTags(parsed.filter((tag): tag is string => typeof tag === "string")) : [];
	} catch {
		return [];
	}
}

function validateTags(input: string[] = []): string[] {
	const tags = Array.from(new Set(input.map((tag) => tag.trim()).filter(Boolean)));
	if (tags.length > 10 || tags.some((tag) => tag.length > 24)) throw linkError("validation", "Tags must be 1 to 24 characters, max 10 tags.");
	return tags;
}

function validHex(value: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(value);
}

function validateQrStyle(input?: Partial<QrStyle>): QrStyle {
	const style = { ...DEFAULT_QR_STYLE, ...(input ?? {}) };
	if (typeof style.foreground !== "string" || typeof style.background !== "string" || typeof style.logoBackingColor !== "string") {
		throw linkError("validation", "QR colors must be hex values.");
	}
	if (!validHex(style.foreground) || !validHex(style.background) || !validHex(style.logoBackingColor)) throw linkError("validation", "QR colors must be hex values.");
	if (!QR_PATTERNS.includes(style.pattern)) throw linkError("validation", "QR pattern is invalid.");
	if (!QR_CORNERS.includes(style.cornerStyle)) throw linkError("validation", "QR corner style is invalid.");
	if (!QR_BACKING_SHAPES.includes(style.logoBackingShape)) throw linkError("validation", "QR logo backing shape is invalid.");
	if (typeof style.showLogo !== "boolean" || typeof style.showLogoBacking !== "boolean" || typeof style.transparentBackground !== "boolean") {
		throw linkError("validation", "QR visibility settings are invalid.");
	}
	if (!Number.isFinite(style.logoSize) || style.logoSize < 0.1 || style.logoSize > 0.35) throw linkError("validation", "QR logo size is out of range.");
	if (!Number.isFinite(style.logoMargin) || style.logoMargin < 0 || style.logoMargin > 24) throw linkError("validation", "QR logo margin is out of range.");
	if (style.logoUrl !== null && typeof style.logoUrl !== "string") throw linkError("validation", "QR logo URL is invalid.");
	if (style.logoUrl && !style.logoUrl.startsWith("/") && !/^https?:\/\//i.test(style.logoUrl)) throw linkError("validation", "QR logo URL is invalid.");
	return style;
}

function parseQrStyle(value: string | null): QrStyle {
	if (!value) return { ...DEFAULT_QR_STYLE };
	try {
		const parsed = JSON.parse(value) as Partial<QrStyle>;
		return validateQrStyle({
			...parsed,
			showLogo: typeof parsed.showLogo === "boolean" ? parsed.showLogo : parsed.logoUrl !== null,
		});
	} catch {
		return { ...DEFAULT_QR_STYLE };
	}
}

function rowToListItem(row: { link: ShortLink; owner: LinkOwner | null }): LinkListItem {
	return { ...row.link, owner: row.owner, tags: parseTags(row.link.tags), qrStyle: parseQrStyle(row.link.qrStyle) };
}

async function enrichLink(db: LinkDb, link: ShortLink): Promise<LinkListItem> {
	const [row] = await db
		.select({ link: shortLinks, owner: { id: members.id, name: members.name, image: members.image } })
		.from(shortLinks)
		.leftJoin(members, eq(members.id, shortLinks.ownerMemberId))
		.where(eq(shortLinks.id, link.id))
		.limit(1);
	return rowToListItem(row ?? { link, owner: null });
}

function listQuery(db: LinkDb) {
	return db.select({ link: shortLinks, owner: { id: members.id, name: members.name, image: members.image } }).from(shortLinks).leftJoin(members, eq(members.id, shortLinks.ownerMemberId));
}

async function runAtomic(db: LinkDb, queries: unknown[]): Promise<void> {
	const atomicDb = db as unknown as {
		batch?: (items: unknown[]) => Promise<unknown>;
		transaction?: (callback: () => void) => unknown;
	};
	if (atomicDb.batch) {
		await atomicDb.batch(queries);
		return;
	}
	if (!atomicDb.transaction) throw new Error("Atomic link analytics updates are unavailable.");
	atomicDb.transaction(() => {
		for (const query of queries) (query as { run: () => unknown }).run();
	});
}

export function createLinksRepository(db: LinkDb, audit: AuditRepository): LinksRepository {
	return {
		async listVisible(actor, input) {
			void actor;
			const page = ensurePage(input);
			const rows = await listQuery(db).orderBy(desc(shortLinks.createdAt)).limit(page.limit).offset(page.offset);
			return rows.map(rowToListItem);
		},

		async listOwn(actor, input) {
			const page = ensurePage(input);
			const rows = await listQuery(db)
				.where(eq(shortLinks.ownerMemberId, actor.memberId))
				.orderBy(desc(shortLinks.createdAt))
				.limit(page.limit)
				.offset(page.offset);
			return rows.map(rowToListItem);
		},

		async listAll(actor, input) {
			if (!can(actor, "link:moderate")) throw linkError("not_authorized", "Not authorized to list all links.");
			const page = ensurePage(input);
			const rows = await listQuery(db).orderBy(desc(shortLinks.createdAt)).limit(page.limit).offset(page.offset);
			return rows.map(rowToListItem);
		},

		async getById(actor, id) {
			void actor;
			const [link] = await db.select().from(shortLinks).where(eq(shortLinks.id, id)).limit(1);
			return link ?? null;
		},

		async canEditLink(actor, id) {
			const [link] = await db
				.select({ ownerMemberId: shortLinks.ownerMemberId })
				.from(shortLinks)
				.where(eq(shortLinks.id, id))
				.limit(1);
			return Boolean(link && (link.ownerMemberId === actor.memberId || can(actor, "link:moderate")));
		},

		async create(actor, input) {
			const slug = normalizeSlug(input.slug);
			if (!isValidSlugFormat(slug)) throw linkError("validation", "Invalid slug format.");
			if (!isValidDestinationUrl(input.destinationUrl)) throw linkError("validation", "Invalid destination URL.");
			const title = input.title.trim();
			if (!title) throw linkError("validation", "A link title is required.");

			const defaultReserved: readonly string[] = RESERVED_SLUG_DEFAULTS;
			const [reserved] = await db.select().from(reservedSlugs).where(eq(reservedSlugs.slug, slug)).limit(1);
			if (defaultReserved.includes(slug) || reserved) throw linkError("validation", "That slug is reserved.");
			const [existing] = await db.select().from(shortLinks).where(eq(shortLinks.slug, slug)).limit(1);
			if (existing) throw linkError("validation", "That slug is already taken.");

			const tags = validateTags(input.tags);
			const qrStyle = validateQrStyle(input.qrStyle);
			const [link] = await db
				.insert(shortLinks)
				.values({ id: createId("lnk"), slug, destinationUrl: input.destinationUrl, title, ownerMemberId: actor.memberId, tags: JSON.stringify(tags), qrStyle: JSON.stringify(qrStyle) })
				.returning();
			await audit.record(actor, { action: "link:create", targetType: "link", targetId: link.id, category: "link" });
			return enrichLink(db, link);
		},

		async update(actor, id, input) {
			const current = await loadOwned(db, actor, id);
			const patch: Partial<ShortLink> & { updatedAt: Date } = { updatedAt: new Date() };
			if (input.destinationUrl !== undefined) {
				if (!isValidDestinationUrl(input.destinationUrl)) throw linkError("validation", "Invalid destination URL.");
				patch.destinationUrl = input.destinationUrl;
			}
			if (input.title !== undefined) {
				const title = input.title.trim();
				if (!title) throw linkError("validation", "A link title is required.");
				patch.title = title;
			}
			if (input.previewTitle !== undefined) patch.previewTitle = input.previewTitle;
			if (input.previewDescription !== undefined) patch.previewDescription = input.previewDescription;
			if (input.previewImageKey !== undefined) patch.previewImageKey = input.previewImageKey;
			if (input.tags !== undefined) patch.tags = JSON.stringify(validateTags(input.tags));
			if (input.qrStyle !== undefined) patch.qrStyle = JSON.stringify(validateQrStyle({ ...parseQrStyle(current.qrStyle), ...input.qrStyle }));

			const [link] = await db.update(shortLinks).set(patch).where(eq(shortLinks.id, current.id)).returning();
			const moderated = current.ownerMemberId !== actor.memberId;
			await audit.record(actor, {
				action: moderated ? "link:moderate_update" : "link:update",
				targetType: "link",
				targetId: link.id,
				category: "link",
			});
			return enrichLink(db, link);
		},

		async remove(actor, id) {
			const current = await loadOwned(db, actor, id);
			await db.delete(shortLinks).where(eq(shortLinks.id, current.id));
			const moderated = current.ownerMemberId !== actor.memberId;
			await audit.record(actor, {
				action: moderated ? "link:moderate_delete" : "link:delete",
				targetType: "link",
				targetId: current.id,
				category: "link",
			});
		},

		async getStats(actor, id, input) {
			void actor;
			const link = await loadReadable(db, id);
			const query = resolveStatsQuery(input);
			const rangeDays = Math.round((Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000) + 1;
			const comparisonTo = addDays(query.from, -1);
			const comparisonFrom = addDays(comparisonTo, -rangeDays + 1);
			const hourFormatter = new Intl.DateTimeFormat("en", {
				timeZone: query.timezone,
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			});
			const hourlyRows = await db
				.select()
				.from(linkHourlyStats)
				.where(and(
					eq(linkHourlyStats.linkId, link.id),
					gte(linkHourlyStats.hour, `${addDays(comparisonFrom, -1)}T00:00`),
					lte(linkHourlyStats.hour, `${addDays(query.to, 1)}T23:00`),
				))
				.orderBy(asc(linkHourlyStats.hour))
				.limit(MAX_STATS_ROWS + 1);
			if (hourlyRows.length > MAX_STATS_ROWS) {
				throw linkError("validation", `This range contains more than ${MAX_STATS_ROWS} analytics rows. Choose a narrower date range.`);
			}

			const analyzed = hourlyRows.map((row) => ({ row, local: localHour(row.hour, hourFormatter) }));
			const inRange = analyzed
				.filter(({ local }) => local.date >= query.from && local.date <= query.to);
			const matchesFilters = ({ row }: (typeof analyzed)[number]) =>
				(query.source === "all" || sourceBucket(row.referrerBucket) === query.source)
				&& (query.device === "all" || row.deviceBucket === query.device);
			const filtered = inRange.filter(matchesFilters);
			const comparisonClicks = analyzed
				.filter(({ local }) => local.date >= comparisonFrom && local.date <= comparisonTo)
				.filter(matchesFilters)
				.reduce((total, { row }) => total + row.count, 0);
			const byDate = new Map<string, number>();
			const byHour = new Map<string, number>();
			const byReferrer = new Map<string, number>();
			const byDevice = new Map<string, number>();
			let filteredClicks = 0;
			for (const { row, local } of filtered) {
				filteredClicks += row.count;
				const bucket = seriesBucket(local, query.granularity);
				byDate.set(bucket, (byDate.get(bucket) ?? 0) + row.count);
				byHour.set(local.hour, (byHour.get(local.hour) ?? 0) + row.count);
				const referrer = displaySourceBucket(row.referrerBucket);
				byReferrer.set(referrer, (byReferrer.get(referrer) ?? 0) + row.count);
				byDevice.set(row.deviceBucket, (byDevice.get(row.deviceBucket) ?? 0) + row.count);
			}
			const clicksInRange = inRange.reduce((total, { row }) => total + row.count, 0);
			return {
				link,
				lifetimeClicks: link.clickCount,
				filteredClicks,
				series: filledSeries(byDate, query, hourFormatter),
				hourly: [...byHour].map(([hour, count]) => ({ hour, count })),
				referrers: sortedBuckets(byReferrer).map(({ key, count }) => ({ bucket: key, count })),
				devices: sortedBuckets(byDevice).map(({ key, count }) => ({ bucket: key, count })),
				query,
				comparison: { from: comparisonFrom, to: comparisonTo, filteredClicks: comparisonClicks },
				history: {
					basis: "hourly",
					earliestHour: analyzed[0]?.row.hour ?? null,
					latestHour: analyzed.at(-1)?.row.hour ?? null,
					rowsRead: hourlyRows.length,
					maxRows: MAX_STATS_ROWS,
					complete: true,
					note: clicksInRange < link.clickCount
						? "Lifetime clicks can include activity outside this range or before hourly analytics were retained."
						: null,
				},
			};
		},

		async resolveForRedirect(slug) {
			const [link] = await db
				.select({
					id: shortLinks.id,
					slug: shortLinks.slug,
					destinationUrl: shortLinks.destinationUrl,
					title: shortLinks.title,
					previewTitle: shortLinks.previewTitle,
					previewDescription: shortLinks.previewDescription,
					previewImageKey: shortLinks.previewImageKey,
				})
				.from(shortLinks)
				.where(eq(shortLinks.slug, normalizeSlug(slug)))
				.limit(1);
			return link ?? null;
		},

		async recordClick(linkId, input) {
			const hour = input.hour ?? `${input.date}T00:00`;
			const daily = db
				.insert(linkDailyStats)
				.values({ linkId, date: input.date, referrerBucket: input.referrerBucket, deviceBucket: input.deviceBucket, count: 1 })
				.onConflictDoUpdate({
					target: [linkDailyStats.linkId, linkDailyStats.date, linkDailyStats.referrerBucket, linkDailyStats.deviceBucket],
					set: { count: sql`${linkDailyStats.count} + 1` },
				});
			const hourly = db
				.insert(linkHourlyStats)
				.values({ linkId, hour, referrerBucket: input.referrerBucket, deviceBucket: input.deviceBucket, count: 1 })
				.onConflictDoUpdate({
					target: [linkHourlyStats.linkId, linkHourlyStats.hour, linkHourlyStats.referrerBucket, linkHourlyStats.deviceBucket],
					set: { count: sql`${linkHourlyStats.count} + 1` },
				});
			const lifetime = db.update(shortLinks).set({ clickCount: sql`${shortLinks.clickCount} + 1` }).where(eq(shortLinks.id, linkId));
			await runAtomic(db, [daily, hourly, lifetime]);
		},
	};
}

export function createUnavailableLinksRepository(): LinksRepository {
	const unavailable = async () => {
		throw new Error("Links are unavailable through this repository adapter.");
	};
	return {
		listVisible: unavailable,
		listOwn: unavailable,
		listAll: unavailable,
		getById: unavailable,
		canEditLink: unavailable,
		create: unavailable,
		update: unavailable,
		remove: unavailable,
		getStats: unavailable,
		resolveForRedirect: unavailable,
		recordClick: unavailable,
	};
}
