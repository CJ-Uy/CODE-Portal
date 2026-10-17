"use client";

import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveTemplateAction } from "../actions";

export function ArchiveTemplateButton({ id, name }: { id: string; name: string }) {
	return (
		<form
			action={archiveTemplateAction}
			onSubmit={(event) => {
				// preventDefault also stops React from running the form action.
				if (!window.confirm(`Archive "${name}"? It stops being offered for new forms. Forms already made from it keep their questions.`)) event.preventDefault();
			}}
		>
			<input type="hidden" name="id" value={id} />
			<Button type="submit" variant="outline">
				<Archive />
				Archive template
			</Button>
		</form>
	);
}
