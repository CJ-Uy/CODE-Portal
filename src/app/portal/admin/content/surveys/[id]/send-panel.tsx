"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Eye, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { sendSurveyAction } from "../actions";

type InviteMode = "suggested" | "all" | "count";

export type SendPanelProps = {
	surveyId: string;
	hasEvent: boolean;
	eligible: number;
	suggested: number;
	/** The event has not ended yet, so people are probably still checking in. */
	stillCheckingIn: boolean;
	/** A datetime-local value (UTC+8). */
	closesAt: string;
	/** `off` hides the option, `no_sender` hides it with the reason, `ready` shows it. */
	email: "off" | "no_sender" | "ready";
	questionCount: number;
	estimate: string;
	/** The draft's points for answering, and its point type picked out of the active ones (empty when none are active). */
	pointsAward: number;
	pointTypeId: string;
	pointTypes: Array<{ id: string; label: string }>;
};

const RADIO = "mt-1 size-4 shrink-0 accent-primary";

/** `unsaved`: the editor has changes that are not saved yet, so sending would send the old questions. */
export function SendPanel(props: SendPanelProps & { unsaved: boolean }) {
	const { unsaved, surveyId, hasEvent, eligible, suggested, stillCheckingIn, closesAt, email, questionCount, estimate, pointsAward, pointTypeId, pointTypes } =
		props;
	const [invite, setInvite] = useState<InviteMode>("suggested");
	const [count, setCount] = useState(String(suggested));
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const confirmRef = useRef<HTMLDivElement>(null);

	// The review button unmounts when the confirm step opens, which would drop focus; move it to the confirm text.
	useEffect(() => {
		if (confirming) confirmRef.current?.focus();
	}, [confirming]);

	const inviteCount = invite === "all" ? eligible : invite === "count" ? Math.min(Number(count) || 0, eligible) : suggested;
	const who = hasEvent ? "attendees (organizers and scanners excluded)" : "active members";

	// One handler for both steps, so pressing Enter in a field can never skip the confirm. The browser has already
	// checked required and min/max by the time submit fires.
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;
		if (!confirming) {
			setConfirming(true);
			return;
		}
		if (unsaved) return;
		const data = new FormData(event.currentTarget);
		setError(null);
		startTransition(async () => {
			try {
				const result = await sendSurveyAction(data);
				// Success redirects; only a failure comes back, and the admin goes back to the choices to fix it.
				if (result) {
					setError(result.error);
					setConfirming(false);
				}
			} catch (error) {
				// Rethrows the success redirect. On a dropped connection the send may or may not have landed.
				unstable_rethrow(error);
				setError("Couldn't reach the server. Reload the page to check whether the form went out before you try again.");
				setConfirming(false);
			}
		});
	}

	const preview = (
		<Button asChild variant="outline">
			<Link href={`/portal/surveys/${surveyId}?preview=1`} target="_blank" rel="noopener noreferrer">
				<Eye />
				Preview
				<span className="sr-only"> (opens in a new tab)</span>
			</Link>
		</Button>
	);

	return (
		<section aria-labelledby="send-heading" className="grid min-w-0 gap-5 rounded-xl border border-border/60 bg-card p-5">
			<div className="grid min-w-0 gap-1">
				<h2 id="send-heading" className="text-xl font-semibold text-primary">
					Send
				</h2>
				<p className="min-w-0 text-sm text-muted-foreground">
					Eligible: {eligible} {who}
				</p>
			</div>

			{stillCheckingIn ? (
				<p className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-secondary p-3 text-sm text-secondary-foreground">
					<TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span className="min-w-0">Some people may still be checking in. They won&apos;t be in the sample.</span>
				</p>
			) : null}

			{eligible === 0 ? (
				<div className="grid min-w-0 gap-3">
					<p className="text-sm font-medium">No one is eligible yet.</p>
					<div className="flex flex-wrap items-center gap-3">
						<Button type="button" disabled>
							<Send />
							Send
						</Button>
						{preview}
					</div>
				</div>
			) : (
				<form onSubmit={onSubmit} className="grid min-w-0 gap-5">
					<input type="hidden" name="surveyId" value={surveyId} />

					<fieldset className="grid min-w-0 gap-3 border-0 p-0">
						<legend className="mb-1 text-sm font-medium">Who to invite</legend>
						<label className="flex min-w-0 items-start gap-3 text-sm">
							<input type="radio" name="invite" value="suggested" checked={invite === "suggested"} onChange={() => setInvite("suggested")} className={RADIO} />
							<span className="min-w-0">
								Suggested: invite {suggested} of {eligible}. That&apos;s enough for averages accurate to about ±0.3.
							</span>
						</label>
						<label className="flex min-w-0 items-start gap-3 text-sm">
							<input type="radio" name="invite" value="all" checked={invite === "all"} onChange={() => setInvite("all")} className={RADIO} />
							<span className="min-w-0">Everyone ({eligible})</span>
						</label>
						<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm">
							<label className="flex min-w-0 items-start gap-3">
								<input type="radio" name="invite" value="count" checked={invite === "count"} onChange={() => setInvite("count")} className={RADIO} />
								<span className="min-w-0">A number</span>
							</label>
							<Input
								name="count"
								type="number"
								inputMode="numeric"
								min={1}
								max={eligible}
								step={1}
								value={count}
								onChange={(event) => setCount(event.target.value)}
								disabled={invite !== "count"}
								required
								aria-label="Number of people to invite"
								className="w-28"
							/>
						</div>
					</fieldset>

					<fieldset className="grid min-w-0 gap-3 border-0 p-0">
						<legend className="mb-1 text-sm font-medium">Options</legend>
						{hasEvent ? (
							<>
								<CheckOption name="allowWalkIn" label="Other attendees can answer from the event page" />
								<CheckOption name="shareWithOrganizers" label="Share results with organizers" />
							</>
						) : null}
						{email === "ready" ? <CheckOption name="emailInvitees" label="Also email invitees" /> : null}
						{email === "no_sender" ? (
							<p className="min-w-0 text-sm text-muted-foreground">Email invites are unavailable. Set a default sender for the Feedback requests email category.</p>
						) : null}
						<CheckOption name="remind" label="Remind people who haven't answered, 24 hours before closing" />
						<div className="grid min-w-0 gap-1.5 text-sm">
							<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
								<label htmlFor="send-pointsAward" className="min-w-0">
									Points for answering
								</label>
								<Input
									id="send-pointsAward"
									name="pointsAward"
									type="number"
									inputMode="decimal"
									min={0}
									max={100}
									step={0.01}
									defaultValue={pointsAward}
									className="w-24"
								/>
								<Select name="pointTypeId" defaultValue={pointTypeId} aria-label="Point type for answering" className="w-auto min-w-0 max-w-full">
									{pointTypes.length === 0 ? <option value="">No active point types</option> : null}
									{pointTypes.map((type) => (
										<option key={type.id} value={type.id}>
											{type.label}
										</option>
									))}
								</Select>
							</div>
							<p className="min-w-0 text-xs text-muted-foreground">Everyone who answers gets them, whatever they answer. 0 turns them off.</p>
						</div>
					</fieldset>

					<label className="grid min-w-0 gap-2 text-sm font-medium sm:max-w-xs">
						Closes at
						<Input name="closesAt" type="datetime-local" defaultValue={closesAt} required />
					</label>

					{error ? (
						<p role="alert" className="min-w-0 text-sm text-destructive">
							{error}
						</p>
					) : null}

					{confirming ? (
						<div
							ref={confirmRef}
							tabIndex={-1}
							role="group"
							aria-labelledby="send-confirm"
							className="grid min-w-0 gap-3 rounded-lg border border-border bg-secondary p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<p id="send-confirm" className="min-w-0 text-sm font-medium">
								Send this form to {inviteCount} {inviteCount === 1 ? "person" : "people"} now?
							</p>
							<p className="min-w-0 text-sm text-muted-foreground">
								They get a notice right away. Sending can&apos;t be undone, and the questions can&apos;t change afterward. The form has {questionCount}{" "}
								{questionCount === 1 ? "question" : "questions"}. {estimate}.
							</p>
							{unsaved ? (
								<p role="alert" className="min-w-0 text-sm font-medium text-destructive">
									You have unsaved changes. Save the draft first.
								</p>
							) : null}
							<div className="flex flex-wrap items-center gap-3">
								<Button type="submit" disabled={pending || unsaved}>
									<Send />
									{pending ? "Sending..." : "Send now"}
								</Button>
								<Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
									Go back
								</Button>
							</div>
						</div>
					) : null}

					<div className="flex flex-wrap items-center gap-3">
						{confirming ? null : (
							<Button type="submit">
								<Send />
								Review and send
							</Button>
						)}
						{preview}
					</div>
				</form>
			)}
		</section>
	);
}

function CheckOption({ name, label }: { name: string; label: ReactNode }) {
	const id = `send-${name}`;
	return (
		<div className="flex min-w-0 items-start gap-3 text-sm">
			<Checkbox id={id} name={name} defaultChecked className="mt-0.5" />
			<label htmlFor={id} className="min-w-0">
				{label}
			</label>
		</div>
	);
}
