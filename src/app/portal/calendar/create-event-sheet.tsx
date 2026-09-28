"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { DateTimePicker } from "@/components/date-time-picker";
import { deriveEnd, fromLocalInput, toLocalInput } from "@/lib/date-slots";
import type { EventSignupField } from "@/lib/event-signup-form";
import type { EventTypeRow } from "@/db/repositories/eventTypeRules";
import { colourClasses } from "@/lib/event-type-colours";
import { cn } from "@/lib/utils";
import { createEventAction } from "./actions";
import { EventSignupFormEditor } from "./event-signup-form-editor";

const FIELD = "w-full rounded-lg border border-border bg-background p-2 text-sm";

// datetime-local yields "YYYY-MM-DDTHH:mm" in local time; z.coerce.date() parses it.
function defaultStart(): string {
	const d = new Date(Date.now() + 60 * 60_000);
	d.setUTCMinutes(0, 0, 0);
	return toLocalInput(d);
}

export function CreateEventSheet({
	allowedTypes,
	typesUnavailable,
	canSetReadOnly = false,
}: {
	allowedTypes: EventTypeRow[];
	typesUnavailable: boolean;
	/** event:moderate. The repository re-checks this; the prop only hides the control. */
	canSetReadOnly?: boolean;
}) {
	const router = useRouter();
	// The mobile "+" quick action links to /portal/calendar?create=1 to open this directly.
	const openFromUrl = useSearchParams().get("create") === "1";
	const [open, setOpen] = useState(openFromUrl);
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);

	const [title, setTitle] = useState("");
	const [type, setType] = useState(allowedTypes[0]?.type ?? "");
	const [place, setPlace] = useState("");
	const [description, setDescription] = useState("");
	const [startsAt, setStartsAt] = useState(defaultStart);
	const [endsAt, setEndsAt] = useState(() => deriveEnd(defaultStart(), 60));
	const [capacity, setCapacity] = useState("");
	const [graceMinutes, setGraceMinutes] = useState("");
	const [rsvpForm, setRsvpForm] = useState<EventSignupField[]>([]);
	const [rsvpResponsesPublic, setRsvpResponsesPublic] = useState(false);
	const [allDay, setAllDay] = useState(false);
	const [startDay, setStartDay] = useState(() => defaultStart().slice(0, 10));
	const [endDay, setEndDay] = useState(() => defaultStart().slice(0, 10));
	const [readOnly, setReadOnly] = useState(false);

	function reset() {
		setTitle("");
		setType(allowedTypes[0]?.type ?? "");
		setPlace("");
		setDescription("");
		setStartsAt(defaultStart());
		setEndsAt(deriveEnd(defaultStart(), 60));
		setCapacity("");
		setGraceMinutes("");
		setRsvpForm([]);
		setRsvpResponsesPublic(false);
		setAllDay(false);
		setStartDay(defaultStart().slice(0, 10));
		setEndDay(defaultStart().slice(0, 10));
		setReadOnly(false);
		setError(null);
	}

	function submit() {
		setError(null);
		startTransition(async () => {
			try {
				const result = await createEventAction({
					title,
					type,
					place,
					description,
					// All-day sends bare days; the server snaps them to whole UTC+8 day boundaries
					// rather than trusting whatever time the client happened to attach.
					startsAt: fromLocalInput(allDay ? `${startDay}T00:00` : startsAt).toISOString(),
					endsAt: fromLocalInput(allDay ? `${endDay}T00:00` : endsAt).toISOString(),
					capacity: capacity ? Number(capacity) : null,
					graceMinutes: graceMinutes === "" ? null : Number(graceMinutes),
					rsvpForm,
					rsvpResponsesPublic,
					allDay,
					readOnly,
				});
				if (!result.ok) {
					setError(result.error);
					return;
				}
				setOpen(false);
				reset();
				router.push(`/portal/calendar/${result.id}`);
			} catch (e) {
				setError(e instanceof Error ? e.message : "Could not create the event.");
			}
		});
	}

	const noAllowedTypes = allowedTypes.length === 0;
	const endBeforeStart = allDay
		? Boolean(startDay && endDay && endDay < startDay)
		: Boolean(startsAt && endsAt && fromLocalInput(endsAt) <= fromLocalInput(startsAt));
	const datesFilled = allDay ? Boolean(startDay && endDay) : Boolean(startsAt && endsAt);
	const selectedType = allowedTypes.find((option) => option.type === type);
	const preview = colourClasses(selectedType?.colour ?? "slate");
	const canSubmit =
		title.trim() && place.trim() && description.trim() && datesFilled && !endBeforeStart && !noAllowedTypes && !typesUnavailable;

	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					reset();
					if (openFromUrl) router.replace("/portal/calendar");
				}
			}}
		>
			<SheetTrigger asChild>
				<Button size="sm" className="desktop-slide-in-from-right">
					<CalendarPlus className="size-4" />
					Create event
				</Button>
			</SheetTrigger>
			<SheetContent className="h-[100dvh] w-full max-w-none gap-0 overflow-y-auto overscroll-contain sm:h-full sm:max-w-md">
				<SheetHeader className="sticky top-0 z-10 border-b bg-background pr-12">
					<SheetTitle className="font-heading text-xl">Create event</SheetTitle>
					<SheetDescription>Anyone can host. Your event goes on the calendar right away.</SheetDescription>
					{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
				</SheetHeader>

				<div className="grid gap-4 px-4 pb-2">
					<label className="grid gap-1.5 text-sm">
						<span className="font-medium">Title</span>
						<input className={FIELD} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Study jam" />
					</label>

					<label className="grid gap-1.5 text-sm">
						<span className="font-medium">Type</span>
						{typesUnavailable ? (
							<p className="text-sm text-destructive">Event types are unavailable right now. Try again shortly.</p>
						) : noAllowedTypes ? (
							<p className="text-sm text-destructive">
								You do not have permission to create any event type.
							</p>
						) : (
							<select className={FIELD} value={type} onChange={(e) => setType(e.target.value)}>
								{allowedTypes.map((option) => (
									<option key={option.type} value={option.type}>
										{option.label}
									</option>
								))}
							</select>
						)}
					</label>

					{selectedType ? (
						<div className="-mt-2 grid gap-1.5">
							<span className="text-xs text-muted-foreground">How it will look on the calendar</span>
							<div className={cn("flex items-center gap-1 rounded px-1 py-0.5 text-xs", preview.chip)}>
								<span className={cn("size-1.5 shrink-0 rounded-full", preview.dot)} aria-hidden />
								<span className="min-w-0 truncate">{title.trim() || selectedType.label}</span>
							</div>
						</div>
					) : null}

					<label className="grid gap-1.5 text-sm">
						<span className="font-medium">Place</span>
						<input
							className={FIELD}
							maxLength={160}
							value={place}
							onChange={(e) => setPlace(e.target.value)}
							placeholder="Leong Hall"
						/>
					</label>

					<div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
						<Checkbox
							id="create-all-day"
							checked={allDay}
							onCheckedChange={(checked) => {
								const next = checked === true;
								setAllDay(next);
								// Carry the chosen day across so toggling does not lose the date.
								if (next) {
									const day = startsAt.slice(0, 10);
									setStartDay(day);
									setEndDay((current) => (current < day ? day : current));
								}
							}}
							className="mt-0.5"
						/>
						<label htmlFor="create-all-day" className="grid gap-1">
							<span className="font-medium">All day / multi-day</span>
							<span className="text-xs text-muted-foreground">
								Runs whole days instead of set times. Pick an end date later than the start for a multi-day event.
							</span>
						</label>
					</div>

					{allDay ? (
						<div className="grid gap-3 sm:grid-cols-2">
							<label className="grid gap-1.5 text-sm">
								<span className="font-medium">Starts</span>
								<input
									type="date"
									className={FIELD}
									value={startDay}
									onChange={(e) => {
										setStartDay(e.target.value);
										setEndDay((current) => (current < e.target.value ? e.target.value : current));
									}}
								/>
							</label>
							<label className="grid gap-1.5 text-sm">
								<span className="font-medium">Ends</span>
								<input type="date" className={FIELD} min={startDay} value={endDay} onChange={(e) => setEndDay(e.target.value)} />
							</label>
						</div>
					) : (
						<DateTimePicker
							startsAt={startsAt}
							endsAt={endsAt}
							onChange={(next) => {
								setStartsAt(next.startsAt);
								setEndsAt(next.endsAt);
							}}
						/>
					)}
					<p className="-mt-2 text-xs text-muted-foreground">
						{allDay ? "All-day events cover whole days in UTC+8." : "Times are saved and shown in UTC+8."}
					</p>
					{endBeforeStart ? (
						<p className="-mt-2 text-xs text-destructive">
							{allDay ? "End date cannot be before the start date." : "End must be after the start."}
						</p>
					) : null}

					{canSetReadOnly ? (
						<div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
							<Checkbox
								id="create-read-only"
								checked={readOnly}
								onCheckedChange={(checked) => setReadOnly(checked === true)}
								className="mt-0.5"
							/>
							<label htmlFor="create-read-only" className="grid gap-1">
								<span className="font-medium">Informational only (read-only)</span>
								<span className="text-xs text-muted-foreground">
									Shows on the calendar with no signup, check-in, attendance or points. For things like &ldquo;Finals week&rdquo;
									or &ldquo;Campus closed&rdquo;.
								</span>
							</label>
						</div>
					) : null}

					{/* Interaction settings are meaningless on an informational event, and the repository
					    clears them on write regardless — so hide rather than show dead controls. */}
					{readOnly ? null : (
						<>
							<div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
								<Checkbox
									id="create-rsvp-responses-public"
									checked={rsvpResponsesPublic}
									onCheckedChange={(checked) => setRsvpResponsesPublic(checked === true)}
									className="mt-0.5"
								/>
								<label htmlFor="create-rsvp-responses-public" className="grid gap-1">
									<span className="font-medium">Let members see signup answers</span>
									<span className="text-xs text-muted-foreground">
										When off, only organizers can see who is going and how they answered the form.
									</span>
								</label>
							</div>

							<EventSignupFormEditor value={rsvpForm} onChange={setRsvpForm} />
						</>
					)}

					<label className="grid gap-1.5 text-sm">
						<span className="font-medium">Description</span>
						<textarea
							className={FIELD}
							maxLength={4000}
							rows={4}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What's happening, who it's for."
						/>
					</label>

					{readOnly ? null : (
						<>
							<label className="grid gap-1.5 text-sm">
								<span className="font-medium">
									Capacity <span className="font-normal text-muted-foreground">· optional</span>
								</span>
								<input
									type="number"
									min={1}
									max={100000}
									className={FIELD}
									value={capacity}
									onChange={(e) => setCapacity(e.target.value)}
									placeholder="No limit"
								/>
							</label>

							<label className="grid gap-1.5 text-sm">
								<span className="font-medium">Grace period (minutes)</span>
								<input
									type="number"
									min={0}
									max={240}
									className={FIELD}
									value={graceMinutes}
									onChange={(e) => setGraceMinutes(e.target.value)}
									placeholder="15"
								/>
								<span className="text-xs text-muted-foreground">
									Members scanned after this many minutes are marked late. Blank uses 15.
								</span>
							</label>
						</>
					)}

				</div>

				<SheetFooter className="sticky bottom-0 z-10 mt-0 flex-row gap-2 border-t bg-background pb-[max(1rem,env(safe-area-inset-bottom))]">
					<Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => setOpen(false)} disabled={pending}>
						Cancel
					</Button>
					<Button type="button" className="flex-1 sm:flex-none" onClick={submit} disabled={pending || !canSubmit}>
						{pending ? "Creating…" : "Create event"}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
