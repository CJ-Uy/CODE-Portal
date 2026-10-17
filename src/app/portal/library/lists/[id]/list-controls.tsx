"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, Copy, LogOut, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { actionErrorMessage } from "../../editor-input";
import { deleteListAction, removeEditorAction, setSharedAction, updateListAction } from "../../list-actions";
import { LIST_DESCRIPTION_MAX, LIST_NAME_MAX } from "../../list-input";

function Switch({ checked, disabled, onChange, labelledBy }: { checked: boolean; disabled?: boolean; onChange: (next: boolean) => void; labelledBy: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-labelledby={labelledBy}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={cn(
				"relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed",
				checked ? "bg-primary" : "bg-[#AAAFB5]",
				disabled && "opacity-60",
			)}
		>
			<span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none", checked ? "translate-x-5" : "translate-x-0.5")} />
		</button>
	);
}

/** Copies the list's address. If the browser will not let the page use the clipboard, the address is shown to copy by hand. */
export function CopyLinkButton({ listId }: { listId: string }) {
	const toast = useToast();
	const [copied, setCopied] = useState(false);
	const [manual, setManual] = useState("");

	const copy = async () => {
		const link = `${window.location.origin}/portal/library/lists/${listId}`;
		try {
			await navigator.clipboard.writeText(link);
			setManual("");
			setCopied(true);
			toast({ message: "Link copied." });
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			setManual(link);
		}
	};

	return (
		<div className="grid min-w-0 gap-2">
			<Button type="button" variant="outline" onClick={copy}>
				{copied ? <Check aria-hidden /> : <Copy aria-hidden />}
				{copied ? "Copied" : "Copy link"}
			</Button>
			{manual ? <Input readOnly value={manual} aria-label="List link" onFocus={(event) => event.currentTarget.select()} className="min-w-0 text-xs" /> : null}
		</div>
	);
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
				<Switch checked={optimistic} disabled={takenDown || pending} onChange={change} labelledBy={`share-${listId}`} />
				<div className="grid min-w-0 flex-1 gap-0.5">
					<p id={`share-${listId}`} className="font-medium">
						Share with members
					</p>
					<p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
						{takenDown
							? "A library moderator took this list down, so it cannot be shared until they restore it."
							: optimistic
								? "Any signed-in member with the link can view this list and comment on it."
								: "Only you and your editors can open this list."}
					</p>
				</div>
				{optimistic && !takenDown ? <CopyLinkButton listId={listId} /> : null}
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

	if (isDefault) return <p className="text-sm text-muted-foreground">The Saved list can be renamed, but it cannot be deleted.</p>;

	return (
		<div className="grid min-w-0 gap-2">
			{confirming ? (
				<div className="flex flex-wrap items-center gap-2">
					<span className="min-w-0 text-sm [overflow-wrap:anywhere]">Delete this list, its notes and its comments? The items stay in the library.</span>
					<Button
						type="button"
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
					<Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
						Keep it
					</Button>
				</div>
			) : (
				<div>
					<Button type="button" variant="outline" onClick={() => setConfirming(true)}>
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

	if (!confirming) {
		return (
			<Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
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
			<Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
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
