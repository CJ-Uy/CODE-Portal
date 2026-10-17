"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionErrorMessage } from "../../editor-input";
import { searchAuthorsAction } from "../../editor-actions";
import { addEditorAction, removeEditorAction } from "../../list-actions";

type Editor = { memberId: string; name: string };

/** The owner's editors: who they are, remove, and a name search to add more. Editors can add and reorder items and write notes. */
export function ListEditors({ listId, ownerId, editors }: { listId: string; ownerId: string; editors: Editor[] }) {
	const [query, setQuery] = useState("");
	// Active members by name (Task 12's member search, which never returns an email address).
	const [found, setFound] = useState<{ id: string; name: string }[]>([]);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [, startTransition] = useTransition();
	const term = query.trim();

	useEffect(() => {
		if (term.length < 2) return;
		let live = true;
		const timer = window.setTimeout(async () => {
			const results = await searchAuthorsAction(term).catch(() => []);
			if (live) setFound(results);
		}, 250);
		return () => {
			live = false;
			window.clearTimeout(timer);
		};
	}, [term]);

	const taken = new Set([ownerId, ...editors.map((editor) => editor.memberId)]);
	const matches = term.length >= 2 ? found.filter((member) => !taken.has(member.id)) : [];

	const run = (id: string, task: () => Promise<void>, fallback: string, after?: () => void) => {
		setError("");
		setBusy(id);
		startTransition(async () => {
			try {
				await task();
				after?.();
			} catch (e) {
				setError(actionErrorMessage(e, fallback));
			} finally {
				setBusy(null);
			}
		});
	};

	return (
		<div className="grid min-w-0 gap-3">
			{editors.length === 0 ? (
				<p className="text-sm text-muted-foreground">No editors yet. Editors can add and reorder items and write notes.</p>
			) : (
				<ul className="grid gap-2">
					{editors.map((editor) => (
						<li key={editor.memberId} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
							<span className="min-w-0 break-all text-sm font-medium">{editor.name}</span>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="h-9 shrink-0"
								disabled={busy === editor.memberId}
								aria-label={`Remove ${editor.name} as an editor`}
								onClick={() => run(editor.memberId, () => removeEditorAction({ listId, memberId: editor.memberId }), "Could not remove that editor. Try again.")}
							>
								<X aria-hidden />
								Remove
							</Button>
						</li>
					))}
				</ul>
			)}

			<label className="grid min-w-0 gap-1 text-sm font-medium">
				Add an editor
				<Input value={query} maxLength={60} autoComplete="off" placeholder="Search members by name" onChange={(event) => setQuery(event.target.value)} />
			</label>
			{term.length >= 2 ? (
				matches.length > 0 ? (
					<ul className="grid min-w-0 gap-1 rounded-lg border border-border p-1">
						{matches.map((member) => (
							<li key={member.id} className="min-w-0">
								<button
									type="button"
									disabled={busy === member.id}
									onClick={() =>
										run(
											member.id,
											() => addEditorAction({ listId, memberId: member.id }),
											"Could not add that editor. Try again.",
											() => {
												setQuery("");
												setFound([]);
											},
										)
									}
									className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
								>
									<span className="min-w-0 break-all">{member.name}</span>
									<span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
										<Plus className="size-3.5" aria-hidden />
										Add
									</span>
								</button>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">No other member matches that name.</p>
				)
			) : null}
			{error ? (
				<p role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</p>
			) : null}
		</div>
	);
}
