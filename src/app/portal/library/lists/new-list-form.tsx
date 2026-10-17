"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionErrorMessage } from "../editor-input";
import { createListAction } from "../list-actions";
import { LIST_NAME_MAX } from "../list-input";

/** Names a new list and opens it. */
export function NewListForm() {
	const router = useRouter();
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();

	return (
		<form
			className="grid min-w-0 gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				if (!name.trim()) return;
				setError("");
				startTransition(async () => {
					try {
						const { listId } = await createListAction({ name });
						router.push(`/portal/library/lists/${listId}`);
					} catch (e) {
						setError(actionErrorMessage(e, "Could not create the list. Try again."));
					}
				});
			}}
		>
			<div className="flex min-w-0 gap-2">
				<Input value={name} maxLength={LIST_NAME_MAX} placeholder="New list, e.g. Onboarding reads" aria-label="New list name" disabled={pending} onChange={(event) => setName(event.target.value)} className="min-w-0" />
				<Button type="submit" disabled={pending || !name.trim()} className="shrink-0">
					<Plus aria-hidden />
					{pending ? "Creating..." : "Create"}
				</Button>
			</div>
			{error ? (
				<p role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</p>
			) : null}
		</form>
	);
}
