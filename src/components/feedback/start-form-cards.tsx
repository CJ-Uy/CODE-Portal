"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { FilePlus2 } from "lucide-react";
import { createFromTemplateAction } from "@/app/portal/admin/content/surveys/actions";
import { Button } from "@/components/ui/button";

export type TemplateCard = { id: string; name: string; questionCount: number; estimate: string };

/**
 * One card per template, for an event that has no feedback form yet. Each posts to createFromTemplateAction with this
 * event, which redirects to the new draft on success. Submitted by hand so a failure shows here instead of throwing.
 */
export function StartFormCards({ eventId, templates }: { eventId: string; templates: TemplateCard[] }) {
	const [error, setError] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		setError(null);
		setPendingId(String(data.get("templateId")));
		startTransition(async () => {
			try {
				const result = await createFromTemplateAction(data);
				if (result) {
					setError(result.error);
					setPendingId(null);
				}
			} catch (error) {
				// Rethrows the success redirect; anything else (network, expired session) shows here.
				unstable_rethrow(error);
				setError("Couldn't reach the server. Try again.");
				setPendingId(null);
			}
		});
	}

	if (templates.length === 0) {
		return (
			<p className="min-w-0 text-sm text-muted-foreground">
				There are no templates to start from.{" "}
				<Link href="/portal/admin/content/surveys/templates/new" className="font-medium text-accent underline-offset-4 hover:underline">
					Make a template
				</Link>{" "}
				first.
			</p>
		);
	}

	return (
		<div className="grid min-w-0 gap-3">
			<ul className="grid min-w-0 gap-3 sm:grid-cols-2">
				{templates.map((template) => (
					<li key={template.id} className="min-w-0">
						<form onSubmit={onSubmit} className="grid h-full min-w-0 content-between gap-3 rounded-xl border border-border/60 bg-background p-4">
							<input type="hidden" name="templateId" value={template.id} />
							<input type="hidden" name="eventId" value={eventId} />
							<div className="grid min-w-0 gap-1">
								<p className="min-w-0 font-medium [overflow-wrap:anywhere]">{template.name}</p>
								<p className="text-sm tabular-nums text-muted-foreground">
									{template.questionCount} {template.questionCount === 1 ? "question" : "questions"} &middot; {template.estimate}
								</p>
							</div>
							<div>
								<Button type="submit" variant="outline" size="sm" disabled={pending}>
									<FilePlus2 />
									{pendingId === template.id ? "Creating..." : "Create draft"}
								</Button>
							</div>
						</form>
					</li>
				))}
			</ul>
			{error ? (
				<p role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</p>
			) : null}
		</div>
	);
}
