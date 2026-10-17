"use client";

import { useActionState } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveTemplateAction, type ActionError } from "../actions";

export function ArchiveTemplateButton({ id, name }: { id: string; name: string }) {
	// Success redirects to the list; a failure comes back as text and shows under the button.
	const [state, formAction, pending] = useActionState<ActionError | null, FormData>(archiveTemplateAction, null);
	return (
		<form
			action={formAction}
			onSubmit={(event) => {
				// preventDefault also stops React from running the form action.
				if (!window.confirm(`Archive "${name}"? It stops being offered for new forms. Forms already made from it keep their questions.`)) event.preventDefault();
			}}
			className="grid min-w-0 gap-2"
		>
			<input type="hidden" name="id" value={id} />
			<Button type="submit" variant="outline" disabled={pending} className="w-fit">
				<Archive />
				{pending ? "Archiving..." : "Archive template"}
			</Button>
			{state ? (
				<p role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
					{state.error}
				</p>
			) : null}
		</form>
	);
}
