export type DaySlot = { date: string; day: number; inMonth: boolean };

const pad = (value: number) => String(value).padStart(2, "0");
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

/** "YYYY-MM-DDTHH:mm" in UTC+8 wall-clock time, matching CODE's event timezone. */
export function toLocalInput(date: Date): string {
	const shifted = new Date(date.getTime() + UTC8_OFFSET_MS);
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

export function toLocalDate(date: Date): string {
	return toLocalInput(date).slice(0, 10);
}

export function fromLocalInput(value: string): Date {
	const [datePart, timePart = "00:00"] = value.split("T");
	const [year, month, day] = datePart.split("-").map(Number);
	const [hour, minute] = timePart.split(":").map(Number);
	return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}

/**
 * Six weeks starting on the Monday on or before the 1st. Fixed 42 cells so the
 * calendar does not change height between months.
 */
export function buildMonthGrid(year: number, month: number): DaySlot[] {
	const first = new Date(Date.UTC(year, month, 1));
	// getDay() is 0=Sunday; shift so Monday is 0.
	const offset = (first.getUTCDay() + 6) % 7;
	const start = new Date(Date.UTC(year, month, 1 - offset));
	return Array.from({ length: 42 }, (_, index) => {
		const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index));
		const iso = date.toISOString().slice(0, 10);
		return { date: iso, day: date.getUTCDate(), inMonth: date.getUTCMonth() === month };
	});
}

export function timeSlots(stepMinutes: number): string[] {
	const slots: string[] = [];
	for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
		slots.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
	}
	return slots;
}

/**
 * Adds a duration to a local datetime string. Uses the Date constructor's local
 * component arithmetic, so it rolls over days, months, and DST correctly.
 */
export function deriveEnd(startLocal: string, durationMinutes: number): string {
	if (!startLocal) return "";
	return toLocalInput(new Date(fromLocalInput(startLocal).getTime() + durationMinutes * 60_000));
}

/**
 * All-day events are stored as the full UTC+8 span of their days, so every existing read path
 * (month overlap, inclusive end date, exports) keeps working without a special case.
 *
 * The end is the last millisecond of the day rather than the next midnight: midnight belongs to the
 * following day, and treating it as the end renders multi-day bars one day too long.
 */
export function startOfUtc8Day(date: Date): Date {
	return fromLocalInput(`${toLocalDate(date)}T00:00`);
}

export function endOfUtc8Day(date: Date): Date {
	return new Date(fromLocalInput(`${toLocalDate(date)}T00:00`).getTime() + 24 * 60 * 60 * 1000 - 1);
}

export function formatUtc8Time(date: Date): string {
	return new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatUtc8DateTime(date: Date): string {
	return new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * Human range for an event, covering the four cases multi-day introduced:
 *   timed single day   "Aug 12, 9:00 AM – 5:00 PM"
 *   timed multi-day    "Aug 12, 9:00 AM → Aug 14, 5:00 PM"
 *   all-day single     "Aug 12 · All day"
 *   all-day multi-day  "Aug 12 – Aug 14 · All day"
 */
export function formatEventRange(startsAt: Date, endsAt: Date | null, allDay: boolean): string {
	const dayOf = (date: Date) =>
		new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", dateStyle: "medium" }).format(date);
	// The inclusive last day: an end at exactly midnight belongs to the previous day.
	const lastDay = endsAt ? dayOf(new Date(endsAt.getTime() - 1)) : dayOf(startsAt);
	const firstDay = dayOf(startsAt);

	if (allDay) {
		return firstDay === lastDay ? `${firstDay} · All day` : `${firstDay} – ${lastDay} · All day`;
	}
	if (!endsAt) return formatUtc8DateTime(startsAt);
	if (firstDay === lastDay) return `${firstDay}, ${formatUtc8Time(startsAt)} – ${formatUtc8Time(endsAt)}`;
	return `${formatUtc8DateTime(startsAt)} → ${formatUtc8DateTime(endsAt)}`;
}

export function formatSlotLabel(slot: string): string {
	return formatUtc8Time(fromLocalInput(`2026-01-01T${slot}`));
}

export function utc8Parts(date: Date): { year: number; month: number } {
	const shifted = new Date(date.getTime() + UTC8_OFFSET_MS);
	return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}
