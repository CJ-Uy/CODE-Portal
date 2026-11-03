import type { RetentionPeriod } from "@/db/schema";
import { quantizePoints } from "@/lib/points";

/** Every retention part needs 1 point in each of its slots. Points past it are overflow and never count. */
export const RETENTION_SLOT_POINTS = 1;

export type PartType = { id: string; label: string; retentionPeriod: RetentionPeriod | null; position: number };
export type SchoolYear = { startsAt: Date; endsAt: Date; secondSemesterStartsAt: Date | null };
/** countsOn picks the semester: the event's date for an event record, else when it was recorded. */
export type PartRecord = { pointTypeId: string; points: number | null; countsOn: Date };
export type SlotState = "met" | "open" | "missed" | "upcoming";
export type RetentionSlot = {
	key: string;
	label: string;
	startsAt: Date;
	countsUntil: Date;
	earned: number;
	counted: number;
	overflow: number;
	/** Feedback shares the member can still earn here by answering open forms. Never counted. */
	pending: number;
	state: SlotState;
};
export type RetentionPart = { pointTypeId: string; label: string; period: RetentionPeriod; slots: RetentionSlot[] };
export type RetentionStatus = "retained" | "on_track" | "not_retained";
export type RetentionProgress = {
	status: RetentionStatus;
	met: number;
	required: number;
	missed: number;
	parts: RetentionPart[];
	nextDeadline: { at: Date; parts: string[] } | null;
};

/** When the 2nd semester starts: the school year's own date, else its midpoint. */
export function semesterBoundary(year: SchoolYear): Date {
	return year.secondSemesterStartsAt ?? new Date(Math.floor((year.startsAt.getTime() + year.endsAt.getTime()) / 2));
}

export function pointTotals(records: { pointTypeId: string; points: number | null }[]): Map<string, number> {
	const totals = new Map<string, number>();
	for (const record of records) totals.set(record.pointTypeId, quantizePoints((totals.get(record.pointTypeId) ?? 0) + (record.points ?? 0)));
	return totals;
}

function windows(period: RetentionPeriod, year: SchoolYear) {
	if (period === "year") return [{ suffix: "year", label: "School year", startsAt: year.startsAt, countsUntil: year.endsAt }];
	const boundary = semesterBoundary(year);
	return [
		{ suffix: "sem1", label: "1st semester", startsAt: year.startsAt, countsUntil: new Date(boundary.getTime() - 1) },
		{ suffix: "sem2", label: "2nd semester", startsAt: boundary, countsUntil: year.endsAt },
	];
}

/** Slots, status and the next deadline for one member's school year. Every retention screen goes through this. */
export function buildRetentionProgress(types: PartType[], year: SchoolYear, records: PartRecord[], pending: PartRecord[], now: Date): RetentionProgress {
	const boundary = semesterBoundary(year).getTime();
	const slotKey = (record: PartRecord, period: RetentionPeriod) =>
		`${record.pointTypeId}:${period === "year" ? "year" : record.countsOn.getTime() < boundary ? "sem1" : "sem2"}`;
	const parts = types
		.filter((type): type is PartType & { retentionPeriod: RetentionPeriod } => type.retentionPeriod !== null)
		.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label))
		.map((type) => {
			const sumFor = (rows: PartRecord[], key: string) =>
				quantizePoints(rows.reduce((sum, row) => (row.pointTypeId === type.id && slotKey(row, type.retentionPeriod) === key ? sum + (row.points ?? 0) : sum), 0));
			const slots = windows(type.retentionPeriod, year).map((window): RetentionSlot => {
				const key = `${type.id}:${window.suffix}`;
				const earned = sumFor(records, key);
				const counted = Math.min(RETENTION_SLOT_POINTS, Math.max(0, earned));
				const state: SlotState =
					earned >= RETENTION_SLOT_POINTS ? "met" : now > window.countsUntil ? "missed" : now < window.startsAt ? "upcoming" : "open";
				return {
					key,
					label: window.label,
					startsAt: window.startsAt,
					countsUntil: window.countsUntil,
					earned,
					counted,
					overflow: quantizePoints(Math.max(0, earned - RETENTION_SLOT_POINTS)),
					pending: sumFor(pending, key),
					state,
				};
			});
			return { pointTypeId: type.id, label: type.label, period: type.retentionPeriod, slots };
		});

	const all = parts.flatMap((part) => part.slots.map((slot) => ({ part, slot })));
	const met = all.filter(({ slot }) => slot.state === "met").length;
	const missed = all.filter(({ slot }) => slot.state === "missed").length;
	const due = all.filter(({ slot }) => slot.state === "open" || slot.state === "upcoming");
	const at = due.length > 0 ? Math.min(...due.map(({ slot }) => slot.countsUntil.getTime())) : null;
	return {
		status: missed > 0 ? "not_retained" : all.length > 0 && met === all.length ? "retained" : "on_track",
		met,
		required: all.length,
		missed,
		parts,
		nextDeadline:
			at === null ? null : { at: new Date(at), parts: due.filter(({ slot }) => slot.countsUntil.getTime() === at).map(({ part }) => part.label) },
	};
}
