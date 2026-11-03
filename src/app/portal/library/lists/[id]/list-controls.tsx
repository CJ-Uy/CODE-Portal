"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { LogOut, Trash2 } from "lucide-react";
import { CopyLinkButton } from "@/components/library/copy-link-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { actionErrorMessage } from "../../editor-input";
import { deleteListAction, removeEditorAction, setSharedAction, updateListAction } from "../../list-actions";
import { LIST_DESCRIPTION_MAX, LIST_NAME_MAX } from "../../list-input";

/** For an inline confirm that replaces its trigger: Cancel hands focus back to the trigger once it is rendered again. */
function useReturnFocus(confirming: boolean) {
	const trigger = useRef<HTMLButtonElement>(null);
	const back = useRef(false);
	useEffect(() => {
		if (!confirming && back.current) {
			back.current = false;
			trigger.current?.focus();
		}
	}, [confirming]);
	return {
		trigger,
		returnFocus: () => {
			back.current = true;
		},
	};
}

/** The owner's "Share with members" switch. It cannot be turned on while a moderator has the list taken down. */
export function ShareControl({ listId, shared, takenDown }: { listId: string; shared: boolean; takenDown: boolean }) {
	const [optimistic, setOptimistic] = useOptimistic(shared);
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();

	const change = (next: boolean) => {
		setError("");
		startTransition(async () => {
			setOptimistic(next);
			try {
				await setSharedAction({ listId, shared: next });
			} catch (e) {
				setError(actionErrorMessage(e, "Could not change sharing. Try again."));
			}
		});
	};

	return (
		<div className="grid min-w-0 gap-2 rounded-xl border border-border bg-card p-4">
			<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
				<Switch checked={optimistic} disabled={takenDown || pending} onChange={change} labelledBy={`share-${listId}`} describedBy={`share-note-${listId}`} />
				{/* At least 14rem for the words, so on a phone the copy button drops below them instead of squeezing them. */}
				<div className="grid min-w-0 flex-1 basis-56 gap-0.5">
					<p id={`share-${listId}`} className="font-medium">
						Share with members
					</p>
					<p id={`share-note-${listId}`} className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
						{takenDown
							? "A library moderator took this list down, so it cannot be shared until they restore it."
							: optimistic
								? "Any signed-in member with the link can view this list and comment on it."
								: "Only you and your editors can open this list."}
					</p>
				</div>
				{optimistic && !takenDown ? <CopyLinkButton path={`/portal/library/lists/${listId}`} /> : null}
			</div>
			{error ? (
				<p role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</p>
			) : null}
		</div>
	);
}

/** Owner: name, description and color. */
export function DetailsForm({ listId, name, description, color }: { listId: string; name: string; description: string; color: string }) {
	const [values, setValues] = useState({ name, description, color });
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();
	const edit = (patch: Partial<typeof values>) => {
		setValues((current) => ({ ...current, ...patch }));
		setSaved(false);
	};

	return (
		<form
			className="grid min-w-0 gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				setError("");
				startTransition(async () => {
					try {
						await updateListAction({ listId, name: values.name, description: values.description, color: values.color });
						setSaved(true);
					} catch (e) {
						setError(actionErrorMessage(e, "Could not save the list. Try again."));
					}
				});
			}}
		>
			<label className="grid min-w-0 gap-1 text-sm font-medium">
				Name
				<Input value={values.name} maxLength={LIST_NAME_MAX} required onChange={(event) => edit({ name: event.target.value })} />
			</label>
			<label className="grid min-w-0 gap-1 text-sm font-medium">
				Description
				<Textarea value={values.description} rows={3} maxLength={LIST_DESCRIPTION_MAX} onChange={(event) => edit({ description: event.target.value })} className="font-normal" />
			</label>
			<label className="grid w-fit gap-1 text-sm font-medium">
				Color
				<Input type="color" value={values.color} onChange={(event) => edit({ color: event.target.value })} className="h-10 w-16 p-1" />
			</label>
			<div className="flex flex-wrap items-center gap-3">
				<Button type="submit" disabled={pending || !values.name.trim()}>
					{pending ? "Saving..." : "Save details"}
				</Button>
				{saved && !error ? (
					<span role="status" className="text-sm text-muted-foreground">
						Saved
					</span>
				) : null}
				{error ? (
					<span role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
						{error}
					</span>
				) : null}
			</div>
		</form>
	);
}

/** Owner. The Saved list can be renamed but never deleted, so it gets a note instead of the button. */
export function DeleteListButton({ listId, isDefault }: { listId: string; isDefault: boolean }) {
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();
	const { trigger, returnFocus } = useReturnFocus(confirming);

	if (isDefault) return <p className="text-sm text-muted-foreground">The Saved list can be renamed, but it cannot be deleted.</p>;

	return (
		<div className="grid min-w-0 gap-2">
			{confirming ? (
				<div className="flex flex-wrap items-center gap-2">
					<span className="min-w-0 text-sm [overflow-wrap:anywhere]">Delete this list, its notes and its comments? The items stay in the library.</span>
					<Button
						type="button"
						autoFocus
						disabled={pending}
						onClick={() => {
							setError("");
							startTransition(async () => {
								try {
									await deleteListAction({ listId });
								} catch (e) {
									setError(actionErrorMessage(e, "Could not delete the list. Try again."));
								}
							});
						}}
					>
						{pending ? "Deleting..." : "Delete list"}
					</Button>
					<Button
						type="button"
						variant="ghost"
						disabled={pending}
						onClick={() => {
							returnFocus();
							setConfirming(false);
						}}
					>
						Keep it
					</Button>
				</div>
			) : (
				<div>
					<Button ref={trigger} type="button" variant="outline" onClick={() => setConfirming(true)}>
						<Trash2 aria-hidden />
						Delete list
					</Button>
				</div>
			)}
			{error ? (
				<p role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</p>
			) : null}
		</div>
	);
}

/** An editor stepping down from a list someone else owns. */
export function LeaveListButton({ listId, memberId }: { listId: string; memberId: string }) {
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();
	const { trigger, returnFocus } = useReturnFocus(confirming);

	if (!confirming) {
		return (
			<Button ref={trigger} type="button" variant="ghost" onClick={() => setConfirming(true)}>
				<LogOut aria-hidden />
				Leave list
			</Button>
		);
	}
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-2">
			<span className="text-sm">Stop editing this list?</span>
			<Button
				type="button"
				size="sm"
				autoFocus
				disabled={pending}
				onClick={() => {
					setError("");
					startTransition(async () => {
						try {
							await removeEditorAction({ listId, memberId });
						} catch (e) {
							setError(actionErrorMessage(e, "Could not leave the list. Try again."));
						}
					});
				}}
			>
				{pending ? "Leaving..." : "Leave"}
			</Button>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				disabled={pending}
				onClick={() => {
					returnFocus();
					setConfirming(false);
				}}
			>
				Stay
			</Button>
			{error ? (
				<span role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</span>
			) : null}
		</div>
	);
}
