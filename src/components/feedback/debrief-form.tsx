"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Save } from "lucide-react";
import { saveDebriefAction } from "@/app/portal/calendar/[eventId]/debrief-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DebriefView } from "@/lib/feedback/debrief-input";

// Type-only import above: debrief-input pulls in the db schema, which must not ship to the browser.
const MAX_LENGTH = 2000;

const fold = (text: string) => text.replace(/\r\n?/g, "\n").trim();

/**
 * Drops each field that still holds the text it loaded with, so a save from a stale tab leaves other organizers' edits
 * alone. A field emptied on purpose differs from what it loaded, so it is still posted, as "", and clears.
 */
export function keepChangedFields(data: FormData, fields: DebriefView["fields"]): FormData {
	for (const field of fields) {
		const value = data.get(field.name);
		if (typeof value === "string" && fold(value) === fold(field.value)) data.delete(field.name);
	}
	return data;
}

/**
 * The After Action Review: four plain questions and a Save. Submitted by hand rather than as a form action, because React
 * resets a form once its action settles, which would wipe what was typed on an error. After a save the page revalidates,
 * so "Last edited" reflects it; the text stays as typed.
 */
export function DebriefForm({ eventId, fields, lastEdited }: { eventId: string } & DebriefView) {
	const [message, setMessage] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
	const [pending, startTransition] = useTransition();

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = keepChangedFields(new FormData(event.currentTarget), fields);
		setMessage(null);
		startTransition(async () => {
			try {
				const result = await saveDebriefAction(data);
				setMessage("error" in result ? { kind: "error", text: result.error } : { kind: "saved", text: "Debrief saved." });
			} catch (error) {
				// A thrown action (network, expired session) would otherwise reach the error boundary and drop the typed text.
				unstable_rethrow(error);
				setMessage({ kind: "error", text: "Couldn't reach the server. Your changes are still here. Try again." });
			}
		});
	}

	return (
		<form onSubmit={onSubmit} onInput={() => setMessage(null)} className="grid min-w-0 gap-4">
			<input type="hidden" name="eventId" value={eventId} />
			{fields.map((field) => (
				<label key={field.name} className="grid min-w-0 gap-2 text-sm font-medium">
					<span className="min-w-0 [overflow-wrap:anywhere]">{field.label}</span>
					<Textarea name={field.name} defaultValue={field.value} maxLength={MAX_LENGTH} rows={3} />
				</label>
			))}
			<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
				<Button type="submit" disabled={pending}>
					<Save />
					{pending ? "Saving..." : "Save debrief"}
				</Button>
				{lastEdited ? <p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">{lastEdited}</p> : null}
			</div>
			{message ? (
				<p
					role={message.kind === "error" ? "alert" : "status"}
					className={`min-w-0 text-sm [overflow-wrap:anywhere] ${message.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
				>
					{message.text}
				</p>
			) : null}
		</form>
	);
}
