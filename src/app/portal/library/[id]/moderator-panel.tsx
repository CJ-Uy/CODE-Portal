"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/library/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { READINESS_LABELS, type LibraryPublicReadiness, type LibraryStatus } from "@/lib/library/taxonomy";
import { actionErrorMessage } from "../editor-input";
import { deleteItemAction, moderateItemAction, setConfidentialityAction, setPublicReadinessAction } from "../item-actions";

type Action = "approve" | "send_back" | "take_down" | "restore";

const BUTTONS: Record<LibraryStatus, { action: Action; label: string; needsReason: boolean }[]> = {
	draft: [],
	pending_review: [
		{ action: "approve", label: "Approve", needsReason: false },
		{ action: "send_back", label: "Send back", needsReason: true },
	],
	published: [{ action: "take_down", label: "Take down", needsReason: true }],
	taken_down: [{ action: "restore", label: "Restore", needsReason: false }],
};

const DONE: Record<Action, string> = {
	approve: "Approved. It is live.",
	send_back: "Sent back to its owner.",
	take_down: "Taken down.",
	restore: "Restored. It is live again.",
};

type Props = {
	itemId: string;
	title: string;
	status: LibraryStatus;
	publicReadiness: LibraryPublicReadiness | null;
	confidentiality: "public" | "members" | "confidential";
	/** library:manage: confidentiality and delete. */
	canManage: boolean;
	/** An item with no owner cannot be sent back, so that option is not offered. */
	hasOwner: boolean;
};

/** Moderator controls for one item. Every control is checked again on the server; hiding the others is only for the eye. */
export function ModeratorPanel({ itemId, title, status, publicReadiness, confidentiality, canManage, hasOwner }: Props) {
	const toast = useToast();
	const [asking, setAsking] = useState<Action | null>(null);
	const [reason, setReason] = useState("");
	const [error, setError] = useState("");
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [typed, setTyped] = useState("");
	// The selects follow what was picked, not the page's last render, so they do not snap back while the save is in flight.
	const [readiness, setReadiness] = useState<LibraryPublicReadiness | "">(publicReadiness ?? "");
	const [visibleTo, setVisibleTo] = useState(confidentiality);
	const [pending, startTransition] = useTransition();
	const buttons = BUTTONS[status].filter(({ action }) => hasOwner || action !== "send_back");

	const run = (task: () => Promise<void>, done?: string, fallback = "Could not do that. Reload the page and try again.", undo?: () => void) =>
		startTransition(async () => {
			setError("");
			try {
				await task();
				if (done) toast({ message: done });
			} catch (e) {
				undo?.();
				setError(actionErrorMessage(e, fallback));
			}
		});

	const openDelete = () => {
		setError("");
		setDeleteOpen(true);
	};

	const moderate = (action: Action, why?: string) =>
		run(
			async () => {
				await moderateItemAction({ itemId, action, reason: why });
				setAsking(null);
				setReason("");
			},
			DONE[action],
		);

	return (
		<section aria-labelledby="moderator-title" className="grid min-w-0 gap-4 rounded-xl border border-border bg-secondary/40 p-4">
			<h2 id="moderator-title" className="font-heading text-xl">
				Moderator controls
			</h2>

			{buttons.length > 0 ? (
				<div className="grid gap-3">
					<div className="flex flex-wrap gap-2">
						{buttons.map(({ action, label, needsReason }) => (
							<Button
								key={action}
								type="button"
								variant={asking === action ? "default" : "outline"}
								disabled={pending}
								onClick={() => (needsReason ? setAsking(asking === action ? null : action) : moderate(action))}
							>
								{label}
							</Button>
						))}
					</div>
					{asking ? (
						<div className="grid gap-2">
							<label className="grid gap-1 text-sm font-medium">
								Why? The owner will read this.
								{/* It only exists because the moderator just chose an action that needs a reason, so the cursor goes straight to it. */}
								<Textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={3} disabled={pending} className="font-normal" />
							</label>
							<div className="flex flex-wrap gap-2">
								<Button type="button" disabled={pending || !reason.trim()} onClick={() => moderate(asking, reason)}>
									{pending ? "Working..." : `Confirm: ${buttons.find((button) => button.action === asking)?.label.toLowerCase()}`}
								</Button>
								<Button type="button" variant="ghost" disabled={pending} onClick={() => setAsking(null)}>
									Cancel
								</Button>
							</div>
						</div>
					) : null}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">A draft. Only its owner and moderators can see it.</p>
			)}

			<label className="grid gap-1 text-sm font-medium">
				Public readiness
				<Select
					value={readiness}
					disabled={pending}
					onChange={(event) => {
						const before = readiness;
						const value = event.target.value === "" ? null : (event.target.value as LibraryPublicReadiness);
						setReadiness(value ?? "");
						run(() => setPublicReadinessAction({ itemId, value }), "Public readiness updated.", undefined, () => setReadiness(before));
					}}
					className="font-normal sm:max-w-xs"
				>
					<option value="">Not reviewed yet</option>
					{(Object.keys(READINESS_LABELS) as LibraryPublicReadiness[]).map((value) => (
						<option key={value} value={value}>
							{READINESS_LABELS[value]}
						</option>
					))}
				</Select>
			</label>

			{canManage ? (
				<>
					<label className="grid gap-1 text-sm font-medium">
						Who can see it
						<Select
							value={visibleTo}
							disabled={pending}
							onChange={(event) => {
								const before = visibleTo;
								const value = event.target.value as "members" | "confidential";
								setVisibleTo(value);
								run(
									() => setConfidentialityAction({ itemId, value }),
									value === "confidential" ? "Now confidential: library admins and the owner." : "Now open to every member.",
									undefined,
									() => setVisibleTo(before),
								);
							}}
							className="font-normal sm:max-w-xs"
						>
							{visibleTo === "public" ? (
								<option value="public" disabled>
									Public (legacy)
								</option>
							) : null}
							<option value="members">Every CODE member</option>
							<option value="confidential">Confidential: library admins and the owner</option>
						</Select>
					</label>
					<div>
						<Button type="button" variant="outline" className="border-destructive/40 text-destructive" disabled={pending} onClick={openDelete}>
							<Trash2 aria-hidden />
							Delete this item
						</Button>
					</div>
				</>
			) : null}

			{/* While the delete dialog is open the page is inert behind it, so its error is shown inside the dialog instead. */}
			{error && !deleteOpen ? (
				<p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</p>
			) : null}

			<Modal
				open={deleteOpen}
				onOpenChange={(next) => {
					setDeleteOpen(next);
					setError("");
					if (!next) setTyped("");
				}}
				locked={pending}
				labelledBy="delete-title"
			>
				<div className="grid gap-4 p-5">
					<h2 id="delete-title" className="font-heading text-2xl">
						Delete this item for good?
					</h2>
					<p className="text-sm">
						This removes the item, its comments, its reading numbers and its place in every list, and deletes its files. It cannot be undone, and its owner is not told.
					</p>
					<label className="grid gap-1 text-sm font-medium">
						Type the title to confirm
						<span className="min-w-0 [overflow-wrap:anywhere] rounded-md bg-secondary px-2 py-1 font-normal">{title}</span>
						<Input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" disabled={pending} className="font-normal" />
					</label>
					{error && deleteOpen ? (
						<p role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
							{error}
						</p>
					) : null}
					<div className="flex flex-wrap justify-end gap-2">
						<Button type="button" variant="outline" disabled={pending} onClick={() => setDeleteOpen(false)}>
							Cancel
						</Button>
						<Button
							type="button"
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={pending || typed.trim() !== title.trim()}
							onClick={() => run(() => deleteItemAction({ itemId, confirmTitle: typed }), undefined, "Could not delete it. Reload the page and try again.")}
						>
							{pending ? "Deleting..." : "Delete for good"}
						</Button>
					</div>
				</div>
			</Modal>
		</section>
	);
}
