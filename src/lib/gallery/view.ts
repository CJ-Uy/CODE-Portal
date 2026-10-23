/** Display helpers shared by the member gallery, Recently deleted and the public gallery. */

export const GALLERY_TIME_ZONE = "Asia/Manila";

type Dated = { takenAt: Date | null; createdAt?: Date };

/** `/api/uploads/<key>`; `width` asks the proxy for a webp preview of a photo. */
export function galleryFileUrl(key: string, options: { width?: 480 | 1600; download?: string } = {}): string {
	const params = new URLSearchParams();
	if (options.width) params.set("w", String(options.width));
	if (options.download) {
		params.set("download", "1");
		params.set("name", options.download);
	}
	const query = params.toString();
	return `/api/uploads/${encodeURIComponent(key)}${query ? `?${query}` : ""}`;
}

/** The grid tile image: a photo's small preview, or a video's poster frame. Null for a video without one. */
export function galleryThumbUrl(item: { kind: "photo" | "video"; fileKey: string; posterKey: string | null }): string | null {
	if (item.kind === "photo") return galleryFileUrl(item.fileKey, { width: 480 });
	return item.posterKey ? galleryFileUrl(item.posterKey) : null;
}

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: GALLERY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("en", { timeZone: GALLERY_TIME_ZONE, weekday: "long", month: "long", day: "numeric" });
const dayLabelWithYear = new Intl.DateTimeFormat("en", { timeZone: GALLERY_TIME_ZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" });

/**
 * Items in runs of the same Manila calendar day, in the order given (the repository sorts newest first).
 * Photos with no date taken fall back to when they were uploaded, so nothing lands in an "unknown" bin.
 */
export function groupByDay<T extends Dated>(items: T[], now = new Date()): { key: string; label: string; items: T[] }[] {
	const groups: { key: string; label: string; items: T[] }[] = [];
	const thisYear = dayKey.format(now).slice(0, 4);
	for (const item of items) {
		const date = item.takenAt ?? item.createdAt ?? now;
		const key = dayKey.format(date);
		const last = groups.at(-1);
		if (last?.key === key) last.items.push(item);
		else groups.push({ key, label: (key.startsWith(thisYear) ? dayLabel : dayLabelWithYear).format(date), items: [item] });
	}
	return groups;
}

/** Recently deleted reads as a countdown: one group per number of days left, soonest to go first. */
export function groupByDaysLeft<T extends { daysLeft: number }>(items: T[]): { daysLeft: number; label: string; items: T[] }[] {
	const groups = new Map<number, T[]>();
	for (const item of [...items].sort((a, b) => a.daysLeft - b.daysLeft)) groups.set(item.daysLeft, [...(groups.get(item.daysLeft) ?? []), item]);
	return [...groups].map(([daysLeft, members]) => ({ daysLeft, label: daysLeftLabel(daysLeft), items: members }));
}

export function daysLeftLabel(daysLeft: number): string {
	if (daysLeft <= 0) return "Deleting today";
	return daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
}

/** 0:42, 12:05, 1:02:09 */
export function formatDuration(seconds: number): string {
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = String(total % 60).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Most items one move, delete or restore takes; bigger selections go in several calls. */
export const GALLERY_BATCH = 200;

/** Large files upload fine but take a while; past this the upload panel warns before it starts. */
export const LARGE_UPLOAD_BYTES = 1024 * 1024 * 1024;

/** "12 photos", "3 videos", "12 photos and 3 videos" */
export function countLabel(items: { kind: "photo" | "video" }[]): string {
	const videos = items.filter((item) => item.kind === "video").length;
	const photos = items.length - videos;
	const part = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
	if (!videos) return part(photos, "photo");
	if (!photos) return part(videos, "video");
	return `${part(photos, "photo")} and ${part(videos, "video")}`;
}

const inputParts = new Intl.DateTimeFormat("en-CA", { timeZone: GALLERY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** A `datetime-local` value showing Manila wall-clock time, whatever the browser's own zone. */
export function toManilaInput(date: Date | null): string {
	if (!date) return "";
	const part = (type: string) => inputParts.formatToParts(date).find((piece) => piece.type === type)?.value ?? "00";
	return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** The reverse: an ISO string with Manila's +08:00 offset (the Philippines has no daylight saving), or null when empty. */
export function fromManilaInput(value: string): string | null {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+08:00` : null;
}
