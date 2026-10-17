"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { createFromTemplateAction } from "./actions";

export type TemplateChoice = { id: string; label: string };
export type EventChoice = { id: string; label: string };

export function NewForm({ templates, events }: { templates: TemplateChoice[]; events: EventChoice[] }) {
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	// Submitted by hand rather than as a form action, so a failure keeps the admin's choices. Success redirects.
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		setError(null);
		startTransition(async () => {
			try {
				const result = await createFromTemplateAction(data);
				if (result) setError(result.error);
			} catch (error) {
				// A thrown action (network, expired session) would otherwise reach the error boundary and drop the choices.
				unstable_rethrow(error);
				setError("Couldn't reach the server. Your changes are still here. Try again.");
			}
		});
	}

	if (templates.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				There are no templates to start from.{" "}
				<Link href="/portal/admin/content/surveys/templates/new" className="font-medium text-accent underline-offset-4 hover:underline">
					Make a template
				</Link>{" "}
				first.
			</p>
		);
	}

	return (
		<form onSubmit={onSubmit} className="grid min-w-0 gap-4">
			<div className="grid min-w-0 gap-4 sm:grid-cols-2">
				<label className="grid min-w-0 gap-2 text-sm font-medium">
					Template
					<Select name="templateId" defaultValue={templates[0]?.id} required>
						{templates.map((template) => (
							<option key={template.id} value={template.id}>
								{template.label}
							</option>
						))}
					</Select>
				</label>
				<label className="grid min-w-0 gap-2 text-sm font-medium">
					Event (optional)
					<Select name="eventId" defaultValue="">
						<option value="">No event (general form)</option>
						{events.map((event) => (
							<option key={event.id} value={event.id}>
								{event.label}
							</option>
						))}
					</Select>
				</label>
			</div>
			{error ? (
				<p role="alert" className="min-w-0 text-sm text-destructive">
					{error}
				</p>
			) : null}
			<div>
				<Button type="submit" disabled={pending}>
					<FilePlus2 />
					{pending ? "Creating..." : "Create draft"}
				</Button>
			</div>
		</form>
	);
}
