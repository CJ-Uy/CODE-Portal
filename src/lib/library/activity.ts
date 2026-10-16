import { toLocalDate } from "@/lib/date-slots";

export const ACTIVITY = {
	pingIntervalMs: 15_000,
	idleMs: 60_000,
	maxPingSeconds: 30,
	dailyCapSeconds: 7_200,
} as const;

/** "YYYY-MM-DD" on CODE's UTC+8 calendar. */
export function utc8Day(at: Date): string {
	return toLocalDate(at);
}

/** Seconds the server should credit for one ping: whole, at most one ping's worth, and within the daily cap. */
export function creditSeconds(requested: number, alreadyToday: number): number {
	if (!Number.isFinite(requested) || !Number.isFinite(alreadyToday) || requested < 0) return 0;
	const remaining = Math.max(0, ACTIVITY.dailyCapSeconds - alreadyToday);
	return Math.min(Math.floor(requested), ACTIVITY.maxPingSeconds, remaining);
}

export function formatHours(totalSeconds: number): string {
	if (!(totalSeconds >= 3600)) return "Less than an hour";
	const hours = Math.floor(totalSeconds / 3600);
	return hours === 1 ? "1 hour" : `${hours.toLocaleString("en-US")} hours`;
}

export function showSaveCount(saves: number): boolean {
	return saves >= 3;
}
