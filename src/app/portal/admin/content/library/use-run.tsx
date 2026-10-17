"use client";

import { useState, useTransition } from "react";
import { actionErrorMessage } from "@/app/portal/library/editor-input";
import { useToast } from "@/components/ui/toast";

/**
 * Runs one server action at a time for a row or a dialog: `pending` while it is in flight, a toast on success, the
 * message on `error` otherwise. `after` runs only on success (closing a form, say).
 */
export function useRun() {
	const toast = useToast();
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();

	const run = (task: () => Promise<void>, done: string, after?: () => void, fallback = "Could not do that. Reload the page and try again.") => {
		setError("");
		startTransition(async () => {
			try {
				await task();
				after?.();
				toast({ message: done });
			} catch (e) {
				setError(actionErrorMessage(e, fallback));
			}
		});
	};

	return { pending, error, run, clearError: () => setError("") };
}

export function RowError({ message }: { message: string }) {
	return message ? (
		<p role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
			{message}
		</p>
	) : null;
}
