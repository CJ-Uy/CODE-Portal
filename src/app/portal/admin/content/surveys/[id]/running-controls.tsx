"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type RunningResult, updateRunningAction } from "../actions";

export type RunningControlsProps = {
	surveyId: string;
	/** A datetime-local value (UTC+8): the current closing time, or a fresh 72 hour window when that time has passed. */
	closesAt: string;
	/** The closing time has passed, so people can't answer even though the form was never closed by hand. */
	timeClosed: boolean;
	/** `closed` means a reminder would have no one to remind. */
	reminder: "ready" | "sent" | "closed";
	/** Only forms for an event have organizers to share with. */
	hasEvent: boolean;
	shared: boolean;
};

type Confirming = "close" | "remind";

/**
 * Everything an admin can change on a running form. Each control is its own small form that names its `intent`, so one
 * press changes one thing. The two that can't be taken back, closing and reminding, ask once first.
 */
export function RunningControls({ surveyId, closesAt, timeClosed, reminder, hasEvent, shared }: RunningControlsProps) {
	const [result, formAction, pending] = useActionState<RunningResult, FormData>(updateRunningAction, null);
	// Remembers which result the question was opened under, so it closes by itself when the next result arrives.
	const [asking, setAsking] = useState<{ kind: Confirming; under: RunningResult } | null>(null);
	const confirming = asking && asking.under === result ? asking.kind : null;

	const ask = (kind: Confirming) => setAsking({ kind, under: result });
	const hidden = (intent: string) => (
		<>
			<input type="hidden" name="surveyId" value={surveyId} />
			<input type="hidden" name="intent" value={intent} />
		</>
	);

	return (
		<section aria-labelledby="manage-heading" className="grid min-w-0 gap-5 rounded-xl border border-border/60 bg-card p-5">
			<h2 id="manage-heading" className="text-xl font-semibold text-primary">
				Manage this form
			</h2>

			{timeClosed ? (
				<p className="min-w-0 rounded-lg border border-border bg-secondary p-3 text-sm text-secondary-foreground">
					The closing time has passed, so no one can answer. Pick a later time to open it again.
				</p>
			) : null}

			<form action={formAction} className="flex min-w-0 flex-wrap items-end gap-3">
				{hidden("closesAt")}
				<label className="grid min-w-0 gap-2 text-sm font-medium sm:max-w-xs">
					Closes at
					<Input key={closesAt} name="closesAt" type="datetime-local" defaultValue={closesAt} required />
				</label>
				<Button type="submit" variant="outline" disabled={pending}>
					Update closing time
				</Button>
			</form>

			{hasEvent ? (
				<form action={formAction} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
					{hidden("share")}
					<input type="hidden" name="shareWithOrganizers" value={shared ? "0" : "1"} />
					<p className="min-w-0 text-sm">{shared ? "Organizers can see these results." : "Organizers can't see these results."}</p>
					<Button type="submit" variant="outline" size="sm" disabled={pending}>
						{shared ? "Stop sharing" : "Share with organizers"}
					</Button>
				</form>
			) : null}

			<div className="flex min-w-0 flex-wrap items-center gap-3">
				{reminder === "ready" ? (
					<Button type="button" variant="outline" disabled={pending} onClick={() => ask("remind")}>
						Send reminder now
					</Button>
				) : reminder === "sent" ? (
					<p className="text-sm text-muted-foreground">The reminder was already sent.</p>
				) : null}
				<Button type="button" variant="outline" disabled={pending} onClick={() => ask("close")}>
					Close now
				</Button>
			</div>

			{confirming ? (
				<form
					action={formAction}
					role="group"
					aria-labelledby="manage-confirm"
					className="grid min-w-0 gap-3 rounded-lg border border-border bg-secondary p-4"
				>
					{hidden(confirming)}
					<p id="manage-confirm" className="min-w-0 text-sm font-medium">
						{confirming === "close" ? "Close this form now?" : "Remind everyone who hasn't answered?"}
					</p>
					<p className="min-w-0 text-sm text-muted-foreground">
						{confirming === "close"
							? "No one can answer after this, and it can't be opened again."
							: "They get one notice, and it can only be sent once."}
					</p>
					<div className="flex flex-wrap items-center gap-3">
						<Button type="submit" disabled={pending}>
							{pending ? "Working..." : confirming === "close" ? "Close now" : "Send reminder now"}
						</Button>
						<Button type="button" variant="ghost" disabled={pending} onClick={() => setAsking(null)}>
							Go back
						</Button>
					</div>
				</form>
			) : null}

			{result && "error" in result ? (
				<p role="alert" className="min-w-0 text-sm text-destructive">
					{result.error}
				</p>
			) : null}
			{result && "ok" in result ? (
				<p role="status" className="min-w-0 text-sm text-muted-foreground">
					{result.ok}
				</p>
			) : null}
		</section>
	);
}
