"use client";

import { useState, useTransition } from "react";
import { actionErrorMessage } from "@/app/portal/library/editor-input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { rebuildLibraryIndexAction } from "./actions";
import { RowError } from "./use-run";

/** Calls the rebuild 10 items at a time until nothing is left, or a call reads nothing (those items keep failing). */
export function RebuildIndexButton({ remaining }: { remaining: number }) {
	const toast = useToast();
	const [left, setLeft] = useState<number | null>(null);
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();

	const rebuild = () => {
		setError("");
		startTransition(async () => {
			try {
				let result = await rebuildLibraryIndexAction();
				setLeft(result.remaining);
				while (result.indexed > 0 && result.remaining > 0) {
					result = await rebuildLibraryIndexAction();
					setLeft(result.remaining);
				}
				toast({
					message:
						result.remaining === 0
							? "Every published item is in the search index."
							: `${result.remaining.toLocaleString("en-US")} ${result.remaining === 1 ? "item" : "items"} could not be read. Try again later.`,
				});
			} catch (e) {
				setError(actionErrorMessage(e, "Could not rebuild the index. Reload the page and try again."));
			}
		});
	};

	return (
		<div className="grid min-w-0 gap-2">
			<div className="flex min-w-0 flex-wrap items-center gap-3">
				<Button type="button" onClick={rebuild} disabled={pending || remaining === 0}>
					{pending ? "Rebuilding…" : "Rebuild search index"}
				</Button>
				{pending && left !== null ? (
					<span className="text-sm text-muted-foreground" aria-live="polite">
						{left.toLocaleString("en-US")} left
					</span>
				) : null}
			</div>
			<RowError message={error} />
		</div>
	);
}
