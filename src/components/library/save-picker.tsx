"use client";

import { useState, useTransition } from "react";
import { Bookmark, Plus } from "lucide-react";
import type { LibraryListSummary } from "@/db/repositories/library-lists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionErrorMessage } from "@/app/portal/library/editor-input";
import { saveToNewListAction, toggleSaveAction } from "@/app/portal/library/item-actions";
import { Modal } from "./modal";

type Entry = { id: string; name: string };

/** The member's default list is always the entry "saved", whether or not it exists yet: the action creates it on first use. */
const SAVED = "saved";

/** Saved first, then the member's other lists and the lists they edit. A list a moderator took down cannot take new items. */
function entriesFor(lists: LibraryListSummary[]): Entry[] {
	return [{ id: SAVED, name: "Saved" }, ...lists.filter((list) => !list.isDefault && !list.takenDownAt).map((list) => ({ id: list.id, name: list.name }))];
}

/** The Save button and its list picker: one tap per list, "New list" at the bottom. An item can sit in several lists. */
export function SavePicker({ itemId, lists, savedIn }: { itemId: string; lists: LibraryListSummary[]; savedIn: string[] }) {
	const [open, setOpen] = useState(false);
	const [saved, setSaved] = useState(() => {
		const defaultId = lists.find((list) => list.isDefault)?.id;
		return new Set(savedIn.map((id) => (id === defaultId ? SAVED : id)));
	});
	const [added, setAdded] = useState<Entry[]>([]);
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [, startTransition] = useTransition();

	const base = entriesFor(lists);
	// A list made here shows at once; once the page re-renders it arrives in `lists` too, so it is listed only once.
	const entries = [...base, ...added.filter((entry) => !base.some((known) => known.id === entry.id))];
	const anySaved = saved.size > 0;

	const mark = (id: string, on: boolean) =>
		setSaved((current) => {
			const next = new Set(current);
			if (on) next.add(id);
			else next.delete(id);
			return next;
		});

	const toggle = (entry: Entry) => {
		const next = !saved.has(entry.id);
		setError("");
		setBusy(entry.id);
		mark(entry.id, next);
		startTransition(async () => {
			try {
				await toggleSaveAction({ itemId, listId: entry.id, saved: next });
			} catch (e) {
				mark(entry.id, !next);
				setError(actionErrorMessage(e, "Could not update that list. Try again."));
			} finally {
				setBusy(null);
			}
		});
	};

	const create = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		setError("");
		setBusy("new");
		startTransition(async () => {
			try {
				const { listId } = await saveToNewListAction({ itemId, name: trimmed });
				setAdded((current) => [...current, { id: listId, name: trimmed }]);
				mark(listId, true);
				setName("");
			} catch (e) {
				setError(actionErrorMessage(e, "Could not create the list. Try again."));
			} finally {
				setBusy(null);
			}
		});
	};

	return (
		<>
			<Button type="button" variant={anySaved ? "default" : "outline"} aria-haspopup="dialog" onClick={() => setOpen(true)}>
				<Bookmark className={anySaved ? "fill-current" : undefined} aria-hidden />
				{anySaved ? "Saved" : "Save"}
			</Button>
			<Modal open={open} onOpenChange={setOpen} labelledBy="save-picker-title">
				<div className="grid gap-4 p-5">
					<h2 id="save-picker-title" className="font-heading text-2xl">
						Save to a list
					</h2>
					<ul className="grid gap-2">
						{entries.map((entry) => (
							<li key={entry.id}>
								<label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary/50">
									<input
										type="checkbox"
										checked={saved.has(entry.id)}
										disabled={busy === entry.id}
										onChange={() => toggle(entry)}
										className="size-4 shrink-0 accent-[#06192F]"
									/>
									<span className="min-w-0 break-all">{entry.name}</span>
								</label>
							</li>
						))}
					</ul>
					<form
						className="flex gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							create();
						}}
					>
						<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="New list" aria-label="New list name" className="min-w-0" />
						<Button type="submit" variant="secondary" disabled={!name.trim() || busy === "new"}>
							<Plus aria-hidden />
							Add
						</Button>
					</form>
					<p aria-live="polite" className="min-h-5 text-sm text-destructive [overflow-wrap:anywhere]">
						{error}
					</p>
					<div className="flex justify-end">
						<Button type="button" onClick={() => setOpen(false)}>
							Done
						</Button>
					</div>
				</div>
			</Modal>
		</>
	);
}
