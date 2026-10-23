"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, GripVertical, MessageSquarePlus, Trash2 } from "lucide-react";
import { LibraryItemCard } from "@/components/library/library-card";
import type { LibraryCardFields } from "@/lib/library/card-fields";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { moveItem } from "@/lib/library/list-view";
import { actionErrorMessage } from "../../editor-input";
import { NOTE_MAX, REORDER_MAX } from "../../list-input";
import { removeListItemAction, reorderAction, setNoteAction } from "../../list-actions";

/** What the page hands over for one row. A placeholder carries only its id: nothing about the item leaks to a reader who cannot open it. */
export type ListRow =
	| { available: true; id: string; card: LibraryCardFields; note: string; addedBy: string | null; added: string }
	| { available: false; id: string };

/**
 * An editor's note: edited in place, saved when the field loses focus or with the Save button. A row with no note shows
 * only an "Add a note" button, so a list being edited is not a column of empty boxes.
 */
function NoteField({ listId, itemId, note }: { listId: string; itemId: string; note: string }) {
	const [open, setOpen] = useState(note.trim() !== "");
	const [value, setValue] = useState(note);
	const [seen, setSeen] = useState(note);
	const [status, setStatus] = useState<"idle" | "saved">("idle");
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();
	const busy = useRef(false);

	// A note that changed on the server (another editor, or our own save coming back) replaces the field unless there is unsaved typing.
	if (note !== seen) {
		setSeen(note);
		if (value === seen) setValue(note);
	}
	const dirty = value.trim() !== note.trim();

	const save = () => {
		if (!dirty || busy.current) return;
		busy.current = true;
		setError("");
		startTransition(async () => {
			try {
				await setNoteAction({ listId, itemId, note: value });
				setStatus("saved");
			} catch (e) {
				setError(actionErrorMessage(e, "Could not save the note. Try again."));
			} finally {
				busy.current = false;
			}
		});
	};

	if (!open) {
		return (
			<Button type="button" variant="ghost" size="sm" className="min-h-9 justify-self-start px-2 text-muted-foreground" onClick={() => setOpen(true)}>
				<MessageSquarePlus aria-hidden />
				Add a note
			</Button>
		);
	}

	return (
		<div className="grid min-w-0 gap-1.5">
			<Textarea
				// Opened by the button just now: the member is about to type.
				autoFocus={note.trim() === ""}
				value={value}
				rows={2}
				maxLength={NOTE_MAX}
				placeholder="Add a note for readers"
				aria-label="Note"
				onChange={(event) => {
					setValue(event.target.value);
					setStatus("idle");
				}}
				onBlur={save}
				className="min-h-0 resize-y text-sm"
			/>
			<div className="flex min-h-8 flex-wrap items-center gap-2 text-xs">
				{dirty ? (
					<Button type="button" size="sm" variant="secondary" disabled={pending} onClick={save}>
						{pending ? "Saving..." : "Save note"}
					</Button>
				) : null}
				{status === "saved" && !dirty && !error ? <span role="status" className="text-muted-foreground">Saved</span> : null}
				{error ? (
					<span role="alert" className="min-w-0 text-destructive [overflow-wrap:anywhere]">
						{error}
					</span>
				) : null}
				{value.length >= NOTE_MAX - 200 ? <span className="ml-auto text-muted-foreground">{value.length}/{NOTE_MAX}</span> : null}
			</div>
		</div>
	);
}

/**
 * The items of a list in order. Editors reorder with a drag handle (mouse and pen) or the Up and Down buttons (keyboard and touch):
 * each move sends the whole new order, shows that it is saving, and puts the old order back if the save fails.
 */
export function ListEditor({ listId, rows, canEdit }: { listId: string; rows: ListRow[]; canEdit: boolean }) {
	const serverOrder = rows.map((row) => row.id);
	const serverKey = serverOrder.join("\n");
	const [order, setOrder] = useState<readonly string[]>(serverOrder);
	const [seenKey, setSeenKey] = useState(serverKey);
	const [drag, setDrag] = useState<{ id: string; overId: string | null; after: boolean } | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [done, setDone] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	const [error, setError] = useState("");
	const [saving, startSave] = useTransition();
	const [removing, startRemove] = useTransition();
	const root = useRef<HTMLOListElement>(null);
	const refocus = useRef<{ id: string; dir: "up" | "down" | "remove" } | null>(null);

	// The server's list is the truth: when it changes (a removal, another editor, our own save coming back) the editor follows it.
	if (serverKey !== seenKey) {
		setSeenKey(serverKey);
		setOrder(serverOrder);
		setConfirming(null);
	}

	const byId = new Map(rows.map((row) => [row.id, row]));
	const shown = order.map((id) => byId.get(id)).filter((row): row is ListRow => Boolean(row));
	const titleOf = (row: ListRow) => (row.available ? row.card.title : "that item");
	// One reorder rewrites every row in a single request, which the server caps; a longer list can still be edited, just not reordered here.
	const canReorder = canEdit && rows.length <= REORDER_MAX;

	// A moved row keeps keyboard focus on the button that moved it, or on the other one once it hits the end. Backing out of the
	// remove confirm puts focus back on the Remove button it replaced.
	useEffect(() => {
		const target = refocus.current;
		refocus.current = null;
		if (!target || !root.current) return;
		const find = (dir: string) => root.current?.querySelector<HTMLButtonElement>(`[data-move="${dir}"][data-row="${CSS.escape(target.id)}"]`);
		const wanted = find(target.dir);
		const other = target.dir === "up" ? "down" : target.dir === "down" ? "up" : null;
		(wanted && !wanted.disabled ? wanted : other ? find(other) : null)?.focus();
	}, [order, confirming]);

	const commit = (next: readonly string[], message: string) => {
		const previous = order;
		setOrder(next);
		setError("");
		setDone(false);
		setAnnouncement(message);
		startSave(async () => {
			try {
				await reorderAction({ listId, itemIds: [...next] });
				setDone(true);
			} catch (e) {
				setOrder(previous);
				setAnnouncement("");
				setError(actionErrorMessage(e, "Could not save the new order, so it was put back. Try again."));
			}
		});
	};

	const move = (row: ListRow, to: number, dir: "up" | "down") => {
		if (saving) return;
		const from = order.indexOf(row.id);
		const next = moveItem(order, from, to);
		if (next === order) return;
		refocus.current = { id: row.id, dir };
		commit(next, `Moved ${titleOf(row)} to position ${to + 1} of ${order.length}.`);
	};

	const drop = (row: ListRow, event: React.DragEvent<HTMLLIElement>) => {
		event.preventDefault();
		const dragged = drag ? byId.get(drag.id) : undefined;
		setDrag(null);
		if (!drag || !dragged || drag.id === row.id || saving) return;
		const box = event.currentTarget.getBoundingClientRect();
		const after = event.clientY > box.top + box.height / 2;
		const from = order.indexOf(drag.id);
		let to = order.indexOf(row.id) + (after ? 1 : 0);
		if (from < to) to -= 1;
		const next = moveItem(order, from, to);
		if (next !== order) commit(next, `Moved ${titleOf(dragged)} to position ${to + 1} of ${order.length}.`);
	};

	const remove = (row: ListRow) => {
		setError("");
		startRemove(async () => {
			try {
				await removeListItemAction({ listId, itemId: row.id });
				setConfirming(null);
			} catch (e) {
				setError(actionErrorMessage(e, "Could not remove that item. Try again."));
			}
		});
	};

	if (shown.length === 0) return null;

	return (
		<div className="grid min-w-0 gap-2">
			<div className="min-h-5 text-sm" aria-live="polite">
				{error ? (
					<p role="alert" className="min-w-0 text-destructive [overflow-wrap:anywhere]">
						{error}
					</p>
				) : saving ? (
					<p className="text-muted-foreground">Saving...</p>
				) : done ? (
					<p className="text-muted-foreground">Order saved</p>
				) : null}
			</div>
			{canEdit && !canReorder ? (
				<p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">This list has more than {REORDER_MAX} items, which is too many to reorder here. You can still add notes and remove items.</p>
			) : null}
			<p className="sr-only" role="status">
				{announcement}
			</p>
			<ol ref={root} className="grid min-w-0 gap-3">
				{shown.map((row, index) => {
					const dropAt = drag && drag.overId === row.id && drag.id !== row.id ? (drag.after ? "after" : "before") : null;
					return (
						<li
							key={row.id}
							onDragOver={(event) => {
								if (!drag) return;
								event.preventDefault();
								const box = event.currentTarget.getBoundingClientRect();
								const after = event.clientY > box.top + box.height / 2;
								if (drag.overId !== row.id || drag.after !== after) setDrag({ ...drag, overId: row.id, after });
							}}
							onDrop={(event) => drop(row, event)}
							className={cn(
								"min-w-0 rounded-xl border border-border bg-card p-3 transition-shadow sm:p-4",
								drag?.id === row.id && "opacity-50",
								dropAt === "before" && "shadow-[0_-3px_0_0_var(--color-ring)]",
								dropAt === "after" && "shadow-[0_3px_0_0_var(--color-ring)]",
							)}
						>
							<div className="flex min-w-0 gap-3">
								<div className="flex w-6 shrink-0 flex-col items-center gap-1 pt-1 text-muted-foreground">
									<span className="text-sm tabular-nums">{index + 1}</span>
									{canReorder ? (
										// A pointer-only handle: keyboard and touch use the Up and Down buttons below.
										<span
											draggable={!saving}
											onDragStart={(event) => {
												event.dataTransfer.effectAllowed = "move";
												event.dataTransfer.setData("text/plain", row.id);
												const box = event.currentTarget.closest("li");
												if (box) event.dataTransfer.setDragImage(box, 24, 24);
												setDrag({ id: row.id, overId: null, after: false });
											}}
											onDragEnd={() => setDrag(null)}
											title="Drag to reorder"
											className="hidden cursor-grab rounded p-0.5 hover:text-foreground active:cursor-grabbing [@media(pointer:fine)]:block"
										>
											<GripVertical className="size-5" aria-hidden />
										</span>
									) : null}
								</div>
								<div className="grid min-w-0 flex-1 gap-3">
									{row.available ? (
										<>
											{/* The row is already the box; the card inside it drops its own border so cards do not nest. */}
											<LibraryItemCard card={row.card} className="rounded-lg border-0 bg-transparent p-0" />
											{canEdit ? (
												<NoteField listId={listId} itemId={row.id} note={row.note} />
											) : row.note ? (
												<p className="min-w-0 whitespace-pre-line rounded-lg bg-secondary/50 px-3 py-2 text-sm [overflow-wrap:anywhere]">{row.note}</p>
											) : null}
											<p className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
												{row.addedBy ? (
													<>
														Added by <span className="[overflow-wrap:anywhere]">{row.addedBy}</span> · {row.added}
													</>
												) : (
													<>Added {row.added}</>
												)}
											</p>
										</>
									) : (
										<div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">Not available</div>
									)}

									{canEdit ? (
										<div className="flex flex-wrap items-center gap-2">
											{canReorder ? (
												<>
													<Button
														type="button"
														size="sm"
														variant="outline"
														className="h-9"
														data-move="up"
														data-row={row.id}
														disabled={index === 0}
														aria-disabled={saving || undefined}
														aria-label={`Move ${titleOf(row)} up`}
														onClick={() => move(row, index - 1, "up")}
													>
														<ArrowUp aria-hidden />
														Up
													</Button>
													<Button
														type="button"
														size="sm"
														variant="outline"
														className="h-9"
														data-move="down"
														data-row={row.id}
														disabled={index === shown.length - 1}
														aria-disabled={saving || undefined}
														aria-label={`Move ${titleOf(row)} down`}
														onClick={() => move(row, index + 1, "down")}
													>
														<ArrowDown aria-hidden />
														Down
													</Button>
												</>
											) : null}
											{confirming === row.id ? (
												<>
													<span className="text-sm">Remove from list?</span>
													<Button type="button" size="sm" variant="default" className="h-9" autoFocus disabled={removing} onClick={() => remove(row)}>
														{removing ? "Removing..." : "Remove"}
													</Button>
													<Button
														type="button"
														size="sm"
														variant="ghost"
														className="h-9"
														disabled={removing}
														onClick={() => {
															refocus.current = { id: row.id, dir: "remove" };
															setConfirming(null);
														}}
													>
														Keep
													</Button>
												</>
											) : (
												<Button
													type="button"
													size="sm"
													variant="ghost"
													className="ml-auto h-9"
													data-move="remove"
													data-row={row.id}
													aria-label={`Remove ${titleOf(row)} from this list`}
													onClick={() => setConfirming(row.id)}
												>
													<Trash2 aria-hidden />
													Remove
												</Button>
											)}
										</div>
									) : null}
								</div>
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
