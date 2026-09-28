import { DEFAULT_GRACE_MINUTES } from "./point-types";

export type AttendanceStatus = "on_time" | "late";

const graceMs = (graceMinutes: number | null) => (graceMinutes ?? DEFAULT_GRACE_MINUTES) * 60_000;

/**
 * Derived at read time, never stored. Correcting an event's start time or grace window
 * retroactively fixes every status rather than requiring a backfill.
 */
export function attendanceStatus(scannedAt: Date, startsAt: Date, graceMinutes: number | null): AttendanceStatus {
	return scannedAt.getTime() > startsAt.getTime() + graceMs(graceMinutes) ? "late" : "on_time";
}

/**
 * Whole minutes past the end of the grace window; 0 when on time. Measured from the end of
 * the window, so "+1 min" means one minute past the point where lateness began.
 */
export function minutesLate(scannedAt: Date, startsAt: Date, graceMinutes: number | null): number {
	const over = scannedAt.getTime() - startsAt.getTime() - graceMs(graceMinutes);
	return over > 0 ? Math.floor(over / 60_000) : 0;
}
