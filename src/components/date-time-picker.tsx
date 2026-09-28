"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildMonthGrid, deriveEnd, formatSlotLabel, timeSlots, toLocalDate, utc8Parts } from "@/lib/date-slots";

const DURATIONS = [
	{ label: "30m", minutes: 30 },
	{ label: "1h", minutes: 60 },
	{ label: "2h", minutes: 120 },
	{ label: "3h", minutes: 180 },
];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const SLOTS = timeSlots(30);

const chip = "rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOn = "border-primary bg-primary text-primary-foreground";
const chipOff = "border-border hover:bg-muted";

export function DateTimePicker({
	startsAt,
	endsAt,
	onChange,
}: {
	startsAt: string;
	endsAt: string;
	onChange: (next: { startsAt: string; endsAt: string }) => void;
}) {
	const [day, time] = startsAt ? startsAt.split("T") : ["", ""];
	const [cursor, setCursor] = useState(() => {
		if (!day) {
			const now = utc8Parts(new Date());
			return { year: now.year, month: now.month - 1 };
		}
		const [year, month] = day.split("-").map(Number);
		return { year, month: month - 1 };
	});
	const [custom, setCustom] = useState(
		() => Boolean(startsAt && endsAt) && !DURATIONS.some(({ minutes }) => deriveEnd(startsAt, minutes) === endsAt),
	);

	const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
	const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(
		new Date(Date.UTC(cursor.year, cursor.month, 1)),
	);
	const today = toLocalDate(new Date());
	const activeDuration = DURATIONS.find(({ minutes }) => startsAt && endsAt && deriveEnd(startsAt, minutes) === endsAt);

	function pick(nextStart: string, minutes?: number) {
		const duration = minutes ?? activeDuration?.minutes ?? 60;
		onChange({ startsAt: nextStart, endsAt: custom && minutes === undefined ? endsAt : deriveEnd(nextStart, duration) });
	}

	function shiftMonth(delta: number) {
		setCursor(({ year, month }) => {
			const next = new Date(year, month + delta, 1);
			return { year: next.getFullYear(), month: next.getMonth() };
		});
	}

	return (
		<div className="grid gap-4">
			{/* Capped width so the 7 columns do not stretch across a wide panel, and centred so
			    the narrow block does not sit lopsided against full-width fields above it. */}
			<div className="mx-auto w-full max-w-sm rounded-xl border border-border p-3">
				<div className="mb-2 flex items-center justify-between">
					<button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded-md p-1 hover:bg-muted">
						<ChevronLeft className="size-4" />
					</button>
					<span className="text-sm font-medium">{monthLabel}</span>
					<button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="rounded-md p-1 hover:bg-muted">
						<ChevronRight className="size-4" />
					</button>
				</div>
				<div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
					{WEEKDAYS.map((label, index) => (
						<span key={`${label}-${index}`}>{label}</span>
					))}
				</div>
				<div className="mt-1 grid grid-cols-7 gap-1">
					{grid.map((slot) => (
						<button
							key={slot.date}
							type="button"
							onClick={() => pick(`${slot.date}T${time || "18:00"}`)}
							aria-current={slot.date === day ? "date" : undefined}
							className={cn(
								// Fixed height rather than aspect-square: a square cell grows with the
								// container width, which made the month grid roughly twice as tall as it
								// needed to be. 36px still clears the comfortable touch target.
								"h-9 rounded-lg text-sm transition-colors",
								slot.inMonth ? "" : "text-muted-foreground/40",
								slot.date === day ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted",
								slot.date === today && slot.date !== day ? "ring-1 ring-primary/40" : "",
							)}
						>
							{slot.day}
						</button>
					))}
				</div>
			</div>

			<div className="grid gap-2">
				<span className="text-sm font-medium">Starts</span>
				<div className="grid max-h-40 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
					{SLOTS.map((slot) => (
						<button
							key={slot}
							type="button"
							onClick={() => pick(`${day || today}T${slot}`)}
							className={cn(chip, "whitespace-nowrap", slot === time ? chipOn : chipOff)}
						>
							{formatSlotLabel(slot)}
						</button>
					))}
				</div>
				<span className="text-xs text-muted-foreground">UTC+8</span>
			</div>

			<div className="grid gap-2">
				<span className="text-sm font-medium">Duration</span>
				<div className="flex flex-wrap gap-2">
					{DURATIONS.map((duration) => (
						<button
							key={duration.label}
							type="button"
							onClick={() => {
								setCustom(false);
								pick(startsAt, duration.minutes);
							}}
							className={cn(chip, !custom && activeDuration?.minutes === duration.minutes ? chipOn : chipOff)}
						>
							{duration.label}
						</button>
					))}
					<button type="button" onClick={() => setCustom(true)} className={cn(chip, custom ? chipOn : chipOff)}>
						Custom
					</button>
				</div>
				{custom ? (
					<label className="grid gap-1.5 text-sm">
						<span className="font-medium">Ends</span>
						<input
							type="datetime-local"
							className="w-full rounded-lg border border-border bg-background p-2 text-sm"
							value={endsAt}
							min={startsAt || undefined}
							onChange={(event) => onChange({ startsAt, endsAt: event.target.value })}
						/>
					</label>
				) : (
					<p className="text-xs text-muted-foreground">
						{endsAt ? `Ends ${endsAt.replace("T", " ")}` : "Pick a day and start time."}
					</p>
				)}
			</div>
		</div>
	);
}
