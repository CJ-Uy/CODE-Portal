"use client";

import { useState, useTransition } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRouter } from "next/navigation";
import {
	ArrowLeftRight,
	Check,
	Coins,
	Crown,
	LoaderCircle,
	Pencil,
	ScanLine,
	Search,
	Shield,
	Trash2,
	UserPlus,
	Users,
	X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/date-time-picker";
import { EventScanOverlay } from "@/components/event-scan-overlay";
import type { EventTypeRow } from "@/db/repositories/eventTypeRules";
import { formatUtc8Time, fromLocalInput, toLocalInput } from "@/lib/date-slots";
import { answerLabel, type EventSignupAnswers, type EventSignupField } from "@/lib/event-signup-form";
import { parseEmailColumn } from "@/lib/roster-emails";
import { cn } from "@/lib/utils";
import {
	addStaffAction,
	deleteEventAction,
	inviteAction,
	markPresentAction,
	markPresentBulkAction,
	removeStaffAction,
	searchMembersAction,
	setEventReadOnlyAction,
	transferOwnershipAction,
	undoPresentAction,
	updateEventAction,
} from "./actions";
import type { BulkCheckinResult } from "./actions";
import type { AwardEditorRow } from "./award-editor-input";
import { EventAwardsEditor } from "./event-awards-editor";
import { EventSignupFormEditor } from "../event-signup-form-editor";

const FIELD = "w-full rounded-lg border border-border bg-background p-2 text-sm";
const CHECKIN_LEAD_MS = 30 * 60 * 1000;
// Matches the message markPresentAction() throws when no term is current, so the
// camera path and the search path never disagree about why scanning can't proceed.
const NO_ACTIVE_TERM_MESSAGE = "No active school year to record attendance against.";

export type StaffMember = {
	memberId: string;
	fullName: string | null;
	name: string | null;
	role: "owner" | "admin" | "scanner";
};
export type AttendanceRow = { memberId: string; fullName: string | null; name: string | null; scannedAt: Date };

export function isOptimisticallyRemoved(
	removedScans: ReadonlyMap<string, number>,
	attendance: AttendanceRow,
): boolean {
	return removedScans.get(attendance.memberId) === attendance.scannedAt.getTime();
}
export type InviteRow = { memberId: string; fullName: string | null; name: string | null; invitedAt: Date };
export type SignupResponseRow = {
	memberId: string;
	fullName: string | null;
	name: string | null;
	answers: EventSignupAnswers;
	updatedAt: Date;
	scannedAt: Date | null;
};

export type ManageEvent = {
	id: string;
	title: string;
	type: string;
	place: string;
	description: string;
	startsAt: Date;
	endsAt: Date | null;
	capacity: number | null;
	graceMinutes: number | null;
	rsvpForm: EventSignupField[];
	rsvpResponsesPublic: boolean;
	allDay: boolean;
	readOnly: boolean;
	myRole: "owner" | "admin" | "scanner" | null;
	canModerate: boolean;
	canSetPoints: boolean;
	/** Rows already collected; used to warn before hiding them from members. */
	attendingCount: number;
};

type Section = "checkins" | "people" | "details" | "points";

function displayName(m: { fullName?: string | null; name?: string | null }): string {
	return m.fullName ?? m.name ?? "Member";
}

export function EventManagePanel({
	event,
	staff,
	attendance,
	invites,
	signups,
	termId,
	allowedEventTypes,
	typeRows,
	typesUnavailable,
	awardRows,
	awardsUnavailable,
}: {
	event: ManageEvent;
	staff: StaffMember[];
	attendance: AttendanceRow[];
	invites: InviteRow[];
	signups: SignupResponseRow[];
	termId: string | null;
	allowedEventTypes: EventTypeRow[];
	typeRows: EventTypeRow[];
	typesUnavailable: boolean;
	awardRows: AwardEditorRow[];
	awardsUnavailable: boolean;
}) {
	const isOwner = event.myRole === "owner";
	const canManage = isOwner || event.myRole === "admin" || event.canModerate;
	const canScan = event.myRole !== null || event.canModerate;
	const canOverrideWindow = isOwner || event.myRole === "admin" || event.canModerate;
	const canBulkCheckIn = canManage;

	const allTabs: { id: Section; label: string; icon: typeof Users; show: boolean }[] = [
		{ id: "checkins", label: "Check-ins", icon: ScanLine, show: canScan },
		{ id: "people", label: "People", icon: Users, show: canManage },
		{ id: "details", label: "Details", icon: Pencil, show: canManage },
		{ id: "points", label: "Points", icon: Coins, show: event.canSetPoints },
	];
	const tabs = allTabs.filter((t) => t.show);

	const [section, setSection] = useState<Section>(tabs[0]?.id ?? "checkins");
	if (tabs.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Manage event</CardTitle>
				<CardDescription>You have {event.myRole ?? (event.canModerate ? "moderator" : "")} access here.</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				<div className="flex flex-wrap gap-1 rounded-lg border border-border p-0.5">
					{tabs.map((tab) => {
						const Icon = tab.icon;
						const active = section === tab.id;
						return (
							<button
								key={tab.id}
								type="button"
								onClick={() => setSection(tab.id)}
								className={cn(
									"inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
									active ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
								)}
							>
								<Icon className="size-4" />
								{tab.label}
							</button>
						);
					})}
				</div>

				{section === "checkins" ? (
					<CheckinsSection
						event={event}
						attendance={attendance}
						canOverrideWindow={canOverrideWindow}
						canBulkCheckIn={canBulkCheckIn}
						termId={termId}
					/>
				) : null}
				{section === "people" ? <PeopleSection event={event} staff={staff} invites={invites} signups={signups} isOwner={isOwner} /> : null}
				{section === "details" ? (
					<DetailsSection
						event={event}
						allowedEventTypes={allowedEventTypes}
						typeRows={typeRows}
						typesUnavailable={typesUnavailable}
					/>
				) : null}
				{section === "points" ? (
					<EventAwardsEditor eventId={event.id} rows={awardRows} unavailable={awardsUnavailable} />
				) : null}
			</CardContent>
		</Card>
	);
}

/* ---------- Member picker (shared by scanner + invites + staff) ---------- */

type FoundMember = { memberId: string; fullName: string | null; name: string | null; alreadyScanned: boolean };

function MemberPicker({
	eventId,
	placeholder,
	onPick,
	renderMeta,
}: {
	eventId: string;
	placeholder: string;
	onPick: (m: FoundMember) => void;
	renderMeta?: (m: FoundMember) => React.ReactNode;
}) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<FoundMember[]>([]);
	const [pending, startTransition] = useTransition();

	function run(q: string) {
		setQuery(q);
		if (q.trim().length < 2) {
			setResults([]);
			return;
		}
		startTransition(async () => {
			try {
				setResults(await searchMembersAction(eventId, q));
			} catch {
				setResults([]);
			}
		});
	}

	return (
		<div className="grid gap-2">
			<div className="relative">
				<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<input className={cn(FIELD, "pl-8")} value={query} placeholder={placeholder} onChange={(e) => run(e.target.value)} />
			</div>
			{query.trim().length >= 2 ? (
				<div className="max-h-60 overflow-y-auto rounded-lg border border-border">
					{pending && results.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
					) : results.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">No members found.</p>
					) : (
						results.map((m) => (
							<button
								key={m.memberId}
								type="button"
								onClick={() => onPick(m)}
								className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/50"
							>
								<span className="truncate">{displayName(m)}</span>
								{renderMeta?.(m)}
							</button>
						))
					)}
				</div>
			) : null}
		</div>
	);
}

/* ---------- Bulk check-in ---------- */

// Same paste-a-column shape as admin member invites, so an officer who has used one
// recognizes the other. Results are per-email rather than a single count: "not found"
// is the answer people actually need after pasting a roster.
function BulkCheckin({ eventId }: { eventId: string }) {
	const router = useRouter();
	const [raw, setRaw] = useState("");
	const [result, setResult] = useState<BulkCheckinResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	// The size of the batch in flight, or null when idle. Held separately from `raw` because
	// raw is cleared on success: reading the count off the live preview made a finished run
	// report "Checking in 0...". Doubles as the busy flag.
	const [inFlight, setInFlight] = useState<number | null>(null);

	const preview = parseEmailColumn(raw);
	const overCap = preview.valid.length > 500;

	async function submit() {
		setResult(null);
		setError(null);
		setInFlight(preview.valid.length);
		try {
			const next = await markPresentBulkAction(eventId, raw);
			setResult(next);
			setRaw("");
			// Deliberately not inside a transition and deliberately not awaited. The result is
			// already in hand; refresh only reconciles the Present list above. Gating the button
			// on it left the spinner running for as long as the event page took to re-render.
			router.refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Bulk check-in failed.");
		} finally {
			setInFlight(null);
		}
	}

	return (
		<div className="grid gap-2">
			<label className="text-sm font-medium" htmlFor="bulk-checkin-emails">
				Paste a column of emails
			</label>
			<textarea
				id="bulk-checkin-emails"
				className={cn(FIELD, "min-h-24 font-mono text-xs")}
				value={raw}
				rows={5}
				disabled={inFlight !== null}
				placeholder={"member1@example.com\nmember2@example.com"}
				onChange={(e) => setRaw(e.target.value)}
			/>
			<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
				<span className="min-w-0 break-all">
					{preview.valid.length} valid, {preview.dedupedInput} duplicate, {preview.invalid.length} invalid
				</span>
				<Button
					type="button"
					size="sm"
					onClick={() => void submit()}
					disabled={inFlight !== null || preview.valid.length === 0 || overCap}
				>
					{inFlight !== null ? (
						<>
							<LoaderCircle className="size-4 animate-spin" />
							Checking in {inFlight}…
						</>
					) : (
						<>Check in {preview.valid.length}</>
					)}
				</Button>
				{overCap ? <span className="text-destructive">Max 500 emails per batch.</span> : null}
			</div>

			{error ? <p className="text-sm text-destructive">{error}</p> : null}

			{result ? (
				<div className="grid gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm">
					<p className="text-accent">
						Checked in {result.checkedIn.length}
						{result.alreadyPresent.length > 0 ? ` · ${result.alreadyPresent.length} already present` : ""}
					</p>
					{result.notFound.length > 0 ? (
						<EmailFailureList label={`Not found (${result.notFound.length})`} emails={result.notFound} />
					) : null}
					{result.invalid.length > 0 ? (
						<EmailFailureList label={`Not a valid email (${result.invalid.length})`} emails={result.invalid} />
					) : null}
					{result.failed.length > 0 ? (
						<EmailFailureList
							label={`Could not check in (${result.failed.length})`}
							emails={result.failed.map((f) => `${f.email} - ${f.reason}`)}
						/>
					) : null}
				</div>
			) : null}
		</div>
	);
}

// min-w-0 + break-all: these are user-supplied strings and a long one otherwise widens
// the whole manage panel on a phone.
function EmailFailureList({ label, emails }: { label: string; emails: string[] }) {
	return (
		<details className="min-w-0">
			<summary className="cursor-pointer text-destructive">{label}</summary>
			<ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
				{emails.map((email) => (
					<li key={email} className="min-w-0 break-all">
						{email}
					</li>
				))}
			</ul>
		</details>
	);
}

/* ---------- Check-ins ---------- */

function CheckinsSection({
	event,
	attendance,
	canOverrideWindow,
	canBulkCheckIn,
	termId,
}: {
	event: ManageEvent;
	attendance: AttendanceRow[];
	canOverrideWindow: boolean;
	canBulkCheckIn: boolean;
	termId: string | null;
}) {
	const router = useRouter();
	const [flash, setFlash] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [overlayOpen, setOverlayOpen] = useState(false);
	// A plain flag, not useTransition: router.refresh() below would extend a transition's
	// pending state until the whole event page re-rendered, leaving the busy line up long
	// after the write landed. This tracks the write and nothing else.
	const [busy, setBusy] = useState(false);
	// Held rather than confirmed inline, so the removal warning is a real dialog.
	const [pendingRemoval, setPendingRemoval] = useState<{
		memberId: string;
		label: string;
		scannedAt: number;
	} | null>(null);
	// Scans the server has confirmed removed. Matching the scan timestamp hides the stale
	// server prop immediately without hiding a later check-in for the same member.
	const [removedScans, setRemovedScans] = useState<Map<string, number>>(new Map());

	// ponytail: snapshot "now" at mount. This banner is advisory; recordScan enforces the
	// window server-side. A member who lingers past the boundary just refreshes.
	const [now] = useState(() => Date.now());
	// What the officer should see right now: the server list minus anything just removed.
	const visibleAttendance = attendance.filter((row) => !isOptimisticallyRemoved(removedScans, row));
	const opensAt = event.startsAt.getTime() - CHECKIN_LEAD_MS;
	const closesAt = event.endsAt?.getTime() ?? event.startsAt.getTime();
	const windowOpen = now >= opensAt && now <= closesAt;

	async function markById(memberId: string, label?: string) {
		setError(null);
		setFlash(null);
		setBusy(true);
		try {
			const res = await markPresentAction(event.id, memberId);
			const who = label ?? "Member";
			setFlash(res.alreadyPresent ? `${who} was already checked in.` : `Checked in ${who}.`);
			// Checked in again after a removal: stop hiding the row the refresh will bring back.
			setRemovedScans((prev) => {
				if (!prev.has(memberId)) return prev;
				const next = new Map(prev);
				next.delete(memberId);
				return next;
			});
			// Not awaited: the outcome is already reported, refresh only reconciles the list.
			router.refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not mark present.");
		} finally {
			setBusy(false);
		}
	}

	function mark(m: FoundMember) {
		void markById(m.memberId, displayName(m));
	}

	// undoScan lets a scanner reverse their own scan and a manager reverse anyone's, so the
	// button is shown to everyone who can see this section and the server decides. A refused
	// removal surfaces in the same error line as a refused check-in.
	async function confirmRemoval() {
		const target = pendingRemoval;
		if (!target) return;
		setPendingRemoval(null);
		setError(null);
		setFlash(null);
		setBusy(true);
		try {
			const res = await undoPresentAction(event.id, target.memberId);
			setFlash(
				res.removed ? `Removed ${target.label} from attendance.` : `${target.label} was not checked in.`,
			);
			// Only on a confirmed removal - never hide a row the server still stands behind.
			if (res.removed) {
				setRemovedScans((prev) => new Map(prev).set(target.memberId, target.scannedAt));
			}
			router.refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not remove that check-in.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="grid gap-3">
			<div
				className={cn(
					"rounded-lg border px-3 py-2 text-sm",
					windowOpen
						? "border-accent/40 bg-accent/10 text-foreground"
						: "border-border bg-secondary/40 text-muted-foreground",
				)}
			>
				{windowOpen
					? "Check-in is open. Scan a member's code or search by name to mark them present."
					: canOverrideWindow
						? "Check-in is closed, but your role can mark members present anytime."
						: "Check-in opens 30 minutes before the start and closes when the event ends."}
			</div>

			{windowOpen || canOverrideWindow ? (
				<div className="grid gap-3">
					{termId ? (
						<Button type="button" onClick={() => setOverlayOpen(true)}>
							<ScanLine className="size-4" />
							Scan attendance
						</Button>
					) : (
						<p className="rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
							{NO_ACTIVE_TERM_MESSAGE}
						</p>
					)}
					{overlayOpen && termId ? (
						<EventScanOverlay
							eventId={event.id}
							termId={termId}
							canUndo={canOverrideWindow}
							onClose={() => {
								setOverlayOpen(false);
								router.refresh();
							}}
						/>
					) : null}
					<div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						<span className="h-px flex-1 bg-border" /> or search <span className="h-px flex-1 bg-border" />
					</div>
					<MemberPicker
						eventId={event.id}
						placeholder="Search a member to check in…"
						onPick={mark}
						renderMeta={(m) =>
							m.alreadyScanned ? (
								<Badge variant="secondary" className="text-[10px]">
									Present
								</Badge>
							) : (
								<span className="text-xs text-accent">Mark present</span>
							)
						}
					/>
					{canBulkCheckIn ? (
						<>
							<div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
								<span className="h-px flex-1 bg-border" /> or paste a list <span className="h-px flex-1 bg-border" />
							</div>
							<BulkCheckin eventId={event.id} />
						</>
					) : null}
				</div>
			) : null}

			{/* The search and the Present list both write through this section, so one busy line
			    covers every path rather than each row growing its own spinner. */}
			{busy ? (
				<p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
					<LoaderCircle className="size-4 animate-spin" />
					Working…
				</p>
			) : null}
			{!busy && flash ? <p className="text-sm text-accent">{flash}</p> : null}
			{error ? <p className="text-sm text-destructive">{error}</p> : null}

			<div className="grid gap-1">
				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Present · {visibleAttendance.length}
				</p>
				{visibleAttendance.length === 0 ? (
					<p className="text-sm text-muted-foreground">No one checked in yet.</p>
				) : (
					<ul className="divide-y divide-border rounded-lg border border-border">
						{visibleAttendance.map((a) => (
							<li key={a.memberId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
								<span className="min-w-0 flex-1 truncate">{displayName(a)}</span>
								<span className="shrink-0 text-xs text-muted-foreground">
									{formatUtc8Time(a.scannedAt)}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={busy}
									// Muted until hovered, then the destructive surface takes over so the icon
									// reads as white. The explicit hover:bg beats the ghost variant's accent wash,
									// which would otherwise tint the button on hover and mute the icon with it.
									className="size-8 shrink-0 p-0 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
									onClick={() =>
										setPendingRemoval({
											memberId: a.memberId,
											label: displayName(a),
											scannedAt: a.scannedAt.getTime(),
										})
									}
								>
									<X className="size-4" />
									<span className="sr-only">Remove {displayName(a)} from attendance</span>
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>

			{/* A real dialog, not window.confirm: this removes points as well as attendance, and the
			    warning has to be readable on a phone where the native prompt truncates. Mirrors the
			    delete-confirmation in links-workspace. */}
			<DialogPrimitive.Root
				open={Boolean(pendingRemoval)}
				onOpenChange={(open) => !open && setPendingRemoval(null)}
			>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45" />
					<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(100%-1.5rem,420px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
						<DialogPrimitive.Title className="font-heading text-xl">Remove from attendance?</DialogPrimitive.Title>
						<DialogPrimitive.Description className="mt-1 min-w-0 break-words text-sm text-muted-foreground">
							{pendingRemoval?.label} will no longer be marked present, and any points this
							check-in awarded are removed with it. You can check them in again afterwards.
						</DialogPrimitive.Description>
						<div className="mt-5 flex justify-end gap-2">
							<DialogPrimitive.Close asChild>
								<Button variant="outline">Cancel</Button>
							</DialogPrimitive.Close>
							<Button
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
								onClick={() => void confirmRemoval()}
							>
								<X className="size-4" />
								Remove
							</Button>
						</div>
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		</div>
	);
}

/* ---------- People ---------- */

const ROLE_ICON = { owner: Crown, admin: Shield, scanner: ScanLine } as const;
const ROLE_LABEL = { owner: "Owner", admin: "Admin", scanner: "Scanner" } as const;

function PeopleSection({
	event,
	staff,
	invites,
	signups,
	isOwner,
}: {
	event: ManageEvent;
	staff: StaffMember[];
	invites: InviteRow[];
	signups: SignupResponseRow[];
	isOwner: boolean;
}) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [addRole, setAddRole] = useState<"admin" | "scanner">("scanner");
	const [invited, setInvited] = useState<string | null>(null);
	const [, startTransition] = useTransition();

	function act(fn: () => Promise<unknown>, onOk?: () => void) {
		setError(null);
		startTransition(async () => {
			try {
				await fn();
				onOk?.();
				router.refresh();
			} catch (e) {
				setError(e instanceof Error ? e.message : "Something went wrong.");
			}
		});
	}

	const staffIds = new Set(staff.map((s) => s.memberId));

	return (
		<div className="grid gap-5">
			{/* Staff roster */}
			<div className="grid gap-2">
				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team</p>
				<ul className="divide-y divide-border rounded-lg border border-border">
					{staff.map((s) => {
						const Icon = ROLE_ICON[s.role];
						return (
							<li key={s.memberId} className="flex items-center gap-2 px-3 py-2 text-sm">
								<Icon className="size-4 text-muted-foreground" />
								<span className="flex-1 truncate">{displayName(s)}</span>
								<Badge variant="secondary" className="text-[10px]">
									{ROLE_LABEL[s.role]}
								</Badge>
								{s.role !== "owner" ? (
									<button
										type="button"
										aria-label={`Remove ${displayName(s)}`}
										className="text-muted-foreground hover:text-destructive"
										onClick={() => act(() => removeStaffAction(event.id, s.memberId))}
									>
										<X className="size-4" />
									</button>
								) : null}
							</li>
						);
					})}
					{staff.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">Just you so far.</li> : null}
				</ul>

				<div className="grid gap-2 rounded-lg border border-dashed border-border p-3">
					<div className="flex items-center gap-2">
						<UserPlus className="size-4 text-accent" />
						<span className="text-sm font-medium">Add to the team</span>
						<select
							value={addRole}
							onChange={(e) => setAddRole(e.target.value as "admin" | "scanner")}
							className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-xs"
						>
							<option value="scanner">as Scanner</option>
							<option value="admin">as Admin</option>
						</select>
					</div>
					<MemberPicker
						eventId={event.id}
						placeholder="Search a member to add…"
						onPick={(m) => act(() => addStaffAction(event.id, m.memberId, addRole))}
						renderMeta={(m) =>
							staffIds.has(m.memberId) ? <span className="text-[10px] text-muted-foreground">On team</span> : null
						}
					/>
				</div>
			</div>

			{/* Invites */}
			<div className="grid gap-2">
				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invited · {invites.length}</p>
				{invites.length > 0 ? (
					<ul className="flex flex-wrap gap-1.5">
						{invites.map((i) => (
							<Badge key={i.memberId} variant="outline" className="font-normal">
								{displayName(i)}
							</Badge>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">No invites sent. Inviting just notifies members. The event stays public.</p>
				)}
				<MemberPicker
					eventId={event.id}
					placeholder="Invite a member…"
					onPick={(m) => act(() => inviteAction(event.id, [m.memberId]), () => setInvited(displayName(m)))}
				/>
				{invited ? <p className="text-sm text-accent">Invited {invited}.</p> : null}
			</div>

			<div className="grid gap-2">
				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Signed up · {signups.length}</p>
				{signups.length === 0 ? (
					<p className="text-sm text-muted-foreground">No one has signed up yet.</p>
				) : (
					<ul className="divide-y divide-border rounded-lg border border-border">
						{signups.map((row) => {
							const answers = Object.entries(row.answers);
							return (
								<li key={row.memberId} className="grid gap-2 px-3 py-2 text-sm">
									<div className="flex items-center justify-between gap-3">
										<span className="truncate font-medium">{displayName(row)}</span>
										<Badge variant={row.scannedAt ? "success" : "secondary"} className="text-[10px]">
											{row.scannedAt ? "Present" : "No scan"}
										</Badge>
									</div>
									{answers.length > 0 ? (
										<dl className="grid gap-1 text-xs text-muted-foreground">
											{answers.map(([fieldId, value]) => (
												<div key={fieldId} className="grid gap-0.5 sm:grid-cols-[160px_1fr]">
													<dt className="font-medium text-foreground">{answerLabel(event.rsvpForm, fieldId)}</dt>
													<dd className="min-w-0 break-words">{value}</dd>
												</div>
											))}
										</dl>
									) : null}
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{/* Transfer ownership (owner only) */}
			{isOwner ? (
				<div className="grid gap-2 rounded-lg border border-dashed border-border p-3">
					<div className="flex items-center gap-2">
						<ArrowLeftRight className="size-4 text-muted-foreground" />
						<span className="text-sm font-medium">Transfer ownership</span>
					</div>
					<p className="text-xs text-muted-foreground">
						The new owner takes over. You stay on as an admin. This cannot be undone by you.
					</p>
					<MemberPicker
						eventId={event.id}
						placeholder="Hand off to…"
						onPick={(m) => {
							if (window.confirm(`Make ${displayName(m)} the owner? You'll become an admin.`)) {
								act(() => transferOwnershipAction(event.id, m.memberId));
							}
						}}
					/>
				</div>
			) : null}

			{error ? <p className="text-sm text-destructive">{error}</p> : null}
		</div>
	);
}

/* ---------- Details (edit + delete) ---------- */

function DetailsSection({
	event,
	allowedEventTypes,
	typeRows,
	typesUnavailable,
}: {
	event: ManageEvent;
	allowedEventTypes: EventTypeRow[];
	typeRows: EventTypeRow[];
	typesUnavailable: boolean;
}) {
	const router = useRouter();
	// A plain flag, not useTransition: router.refresh() inside a transition keeps isPending
	// true until the whole page re-renders, which left "Saving…" on screen well after the
	// save had landed. This tracks the write only.
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const [title, setTitle] = useState(event.title);
	const [type, setType] = useState(event.type);
	const [place, setPlace] = useState(event.place);
	const [description, setDescription] = useState(event.description);
	const [startsAt, setStartsAt] = useState(toLocalInput(event.startsAt));
	const [endsAt, setEndsAt] = useState(event.endsAt ? toLocalInput(event.endsAt) : "");
	const [capacity, setCapacity] = useState(event.capacity?.toString() ?? "");
	const [graceMinutes, setGraceMinutes] = useState(event.graceMinutes?.toString() ?? "");
	const [rsvpForm, setRsvpForm] = useState(event.rsvpForm);
	const [rsvpResponsesPublic, setRsvpResponsesPublic] = useState(event.rsvpResponsesPublic);
	// Seeded from the event, because updateEventAction defaults allDay to false. Before this
	// existed the panel never sent the field, so saving any edit to an all-day or multi-day
	// event silently converted it to a timed one.
	const [allDay, setAllDay] = useState(event.allDay);
	const [startDay, setStartDay] = useState(toLocalInput(event.startsAt).slice(0, 10));
	const [endDay, setEndDay] = useState((event.endsAt ? toLocalInput(event.endsAt) : toLocalInput(event.startsAt)).slice(0, 10));

	const endBeforeStart = allDay
		? Boolean(startDay && endDay && endDay < startDay)
		: Boolean(startsAt && endsAt && fromLocalInput(endsAt) <= fromLocalInput(startsAt));
	// The event's own current type must always be selectable, even if it fell outside the
	// actor's allowed types after the rules changed - leaving it unchanged is always legal,
	// and dropping it from the options would make an unrelated save silently change the type.
	const currentType = typeRows.find((row) => row.type === event.type) ?? {
		type: event.type,
		label: event.type,
		colour: "slate",
		requiredPermission: null,
		active: false,
		position: 0,
	};
	const typeOptions = allowedEventTypes.some((row) => row.type === event.type)
		? allowedEventTypes
		: [...allowedEventTypes, currentType];

	async function save() {
		setError(null);
		setSaved(false);
		setBusy(true);
		try {
			await updateEventAction({
				eventId: event.id,
				title,
				type: typesUnavailable ? event.type : type,
				place,
				description,
				// The action snaps an all-day range to the whole UTC+8 days, so send midnight
				// and let it widen; sending the previous timed values would narrow the event.
				startsAt: fromLocalInput(allDay ? `${startDay}T00:00` : startsAt).toISOString(),
				endsAt: fromLocalInput(allDay ? `${endDay}T00:00` : endsAt).toISOString(),
				allDay,
				capacity: capacity ? Number(capacity) : null,
				graceMinutes: graceMinutes === "" ? null : Number(graceMinutes),
				rsvpForm,
				rsvpResponsesPublic,
			});
			setSaved(true);
			// Not awaited: the save is already confirmed, refresh only reconciles the page.
			router.refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not save.");
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		if (!window.confirm("Delete this event? Attendance and points already earned are kept.")) return;
		setBusy(true);
		try {
			await deleteEventAction(event.id);
			// Left busy on purpose: the navigation away is the end state, so re-enabling the
			// buttons here would just offer a second delete on a page that is leaving.
			router.push("/portal/calendar");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not delete.");
			setBusy(false);
		}
	}

	async function toggleReadOnly() {
		const next = !event.readOnly;
		if (next) {
			const collected = event.attendingCount;
			const warning = collected
				? `Make this informational? Signup and check-in disappear for members. ${
						collected === 1 ? "1 person who is going" : `${collected} people who are going`
					} will be kept and stay visible to organizers, not deleted.`
				: "Make this informational? Signup, check-in, attendance and points are turned off for members.";
			if (!window.confirm(warning)) return;
		}
		setBusy(true);
		try {
			await setEventReadOnlyAction({ eventId: event.id, readOnly: next });
			router.refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not change the event type.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="grid gap-4">
			{/* event:moderate only. The repository re-checks this independently of ownership, so a
			    plain owner cannot strip their own event's signup surface. */}
			{event.canModerate ? (
				<div className="grid gap-2 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="font-medium">{event.readOnly ? "Informational event" : "Normal event"}</span>
						<Button type="button" variant="outline" size="sm" onClick={() => void toggleReadOnly()} disabled={busy}>
							{event.readOnly ? "Allow signups again" : "Make informational"}
						</Button>
					</div>
					<span className="text-xs text-muted-foreground">
						{event.readOnly
							? "Members see this on the calendar only. Anything already collected is kept and reappears if you turn signups back on."
							: "Turns off signup, check-in, attendance and points. Use it for notices like “Finals week”, or to correct a mistake."}
					</span>
				</div>
			) : null}

			<label className="grid gap-1.5 text-sm">
				<span className="font-medium">Title</span>
				<input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} />
			</label>
			<div className="grid gap-3 sm:grid-cols-2">
				<label className="grid gap-1.5 text-sm">
					<span className="font-medium">Type</span>
					<select className={FIELD} value={type} onChange={(e) => setType(e.target.value)} disabled={typesUnavailable}>
						{typeOptions.map((option) => (
							<option key={option.type} value={option.type}>
								{option.label}
							</option>
						))}
					</select>
					{typesUnavailable ? <p className="text-sm text-destructive">Event types are unavailable right now. Try again shortly.</p> : null}
				</label>
				<label className="grid gap-1.5 text-sm">
					<span className="font-medium">Capacity</span>
					<input
						type="number"
						min={1}
						className={FIELD}
						value={capacity}
						placeholder="No limit"
						onChange={(e) => setCapacity(e.target.value)}
					/>
				</label>
				<label className="grid gap-1.5 text-sm">
					<span className="font-medium">Grace period</span>
					<input
						type="number"
						min={0}
						max={240}
						className={FIELD}
						value={graceMinutes}
						placeholder="15"
						onChange={(e) => setGraceMinutes(e.target.value)}
					/>
				</label>
			</div>
			<label className="grid gap-1.5 text-sm">
				<span className="font-medium">Place</span>
				<input className={FIELD} value={place} onChange={(e) => setPlace(e.target.value)} />
			</label>
			<div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
				<Checkbox
					id="edit-all-day"
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
				<label htmlFor="edit-all-day" className="grid gap-1">
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
			<div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
				<Checkbox
					id="rsvp-responses-public"
					checked={rsvpResponsesPublic}
					onCheckedChange={(checked) => setRsvpResponsesPublic(checked === true)}
					className="mt-0.5"
				/>
				<label htmlFor="rsvp-responses-public" className="grid gap-1">
					<span className="font-medium">Let members see signup answers</span>
					<span className="text-xs text-muted-foreground">
						When off, only organizers can see who is going and how they answered the form.
					</span>
				</label>
			</div>
			<EventSignupFormEditor value={rsvpForm} onChange={setRsvpForm} />
			<label className="grid gap-1.5 text-sm">
				<span className="font-medium">Description</span>
				<textarea className={FIELD} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
			</label>

			{error ? <p className="text-sm text-destructive">{error}</p> : null}

			<div className="flex items-center gap-3">
				<Button type="button" onClick={() => void save()} disabled={busy || endBeforeStart}>
					{busy ? "Saving…" : "Save changes"}
				</Button>
				{saved ? (
					<span className="inline-flex items-center gap-1 text-sm text-accent">
						<Check className="size-4" /> Saved
					</span>
				) : null}
			</div>

			<div className="mt-2 flex flex-col items-stretch gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="text-sm font-medium">Delete event</p>
					<p className="text-xs text-muted-foreground">Removes it from the calendar. Earned points stay.</p>
				</div>
				<Button type="button" variant="outline" className="text-destructive" onClick={() => void remove()} disabled={busy}>
					<Trash2 className="size-4" />
					Delete
				</Button>
			</div>
		</div>
	);
}
