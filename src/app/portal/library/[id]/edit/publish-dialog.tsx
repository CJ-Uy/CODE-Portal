"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { actionErrorMessage } from "../../editor-input";
import { flagClientDataAction, publishAction } from "../../editor-actions";

/** A native modal dialog driven by `open`. Esc and a tap on the backdrop close it unless `locked`. */
function Modal({ open, onOpenChange, locked, labelledBy, children }: { open: boolean; onOpenChange: (open: boolean) => void; locked: boolean; labelledBy: string; children: React.ReactNode }) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);
	return (
		<dialog
			ref={ref}
			aria-labelledby={labelledBy}
			onClose={() => onOpenChange(false)}
			onCancel={(event) => {
				if (locked) event.preventDefault();
			}}
			// A tap on the backdrop lands on the dialog element itself, not on its content.
			onClick={(event) => {
				if (!locked && event.target === event.currentTarget) onOpenChange(false);
			}}
			className="email-dialog m-auto w-[min(92vw,30rem)] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl"
		>
			{children}
		</dialog>
	);
}

type PublishProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	itemId: string;
	/** What the draft still lacks; while there is anything, the dialog lists it instead of asking. */
	problems: string[];
	/** Saves pending edits first. False means they could not be saved. */
	beforePublish: () => Promise<boolean>;
};

const OUTCOME = {
	no: { label: "Publish now", text: "Goes live now. Every CODE member can open it." },
	yes: { label: "Send for approval", text: "Goes to a library moderator for approval. Only you and the moderators can see it until then." },
} as const;

export function PublishDialog({ open, onOpenChange, itemId, problems, beforePublish }: PublishProps) {
	const router = useRouter();
	const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
	const [error, setError] = useState("");
	const [done, setDone] = useState(false);
	const [pending, startTransition] = useTransition();

	const confirm = () =>
		startTransition(async () => {
			if (!answer) return;
			setError("");
			if (!(await beforePublish())) {
				setError("Your latest changes could not be saved. Fix that, then publish.");
				return;
			}
			try {
				const { status } = await publishAction({ itemId, containsClientData: answer === "yes" });
				setDone(true);
				router.push(status === "published" ? `/portal/library/${itemId}` : "/portal/library/mine");
			} catch (e) {
				setError(actionErrorMessage(e, "Could not publish. Reload the page and try again."));
			}
		});

	return (
		<Modal open={open} onOpenChange={onOpenChange} locked={pending || done} labelledBy="publish-title">
			<div className="grid gap-4 p-5">
				<h2 id="publish-title" className="font-heading text-2xl">
					{problems.length > 0 ? "Not ready yet" : "Publish this item"}
				</h2>
				{problems.length > 0 ? (
					<>
						<ul className="list-disc space-y-1 pl-5 text-sm">
							{problems.map((problem) => (
								<li key={problem}>{problem}</li>
							))}
						</ul>
						<div className="flex justify-end">
							<Button type="button" onClick={() => onOpenChange(false)}>
								Keep editing
							</Button>
						</div>
					</>
				) : (
					<>
						<fieldset className="grid gap-2">
							<legend className="mb-1 text-sm font-medium">Does this include client names or client data?</legend>
							{(["no", "yes"] as const).map((value) => (
								<label
									key={value}
									className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/50"
								>
									<input
										type="radio"
										name="client-data"
										value={value}
										checked={answer === value}
										disabled={pending || done}
										onChange={() => setAnswer(value)}
										className="mt-0.5 accent-[#06192F]"
									/>
									<span className="min-w-0">
										<span className="font-medium">{value === "yes" ? "Yes" : "No"}</span>
										<span className="block text-muted-foreground">
											{value === "yes" ? "A client is named, or someone could tell who the client is." : "Nothing in it identifies a client."}
										</span>
									</span>
								</label>
							))}
						</fieldset>
						<p aria-live="polite" className="rounded-lg bg-secondary/60 px-3 py-2 text-sm">
							{done ? (answer === "yes" ? "Sent for approval." : "Published.") : answer ? OUTCOME[answer].text : "Choose an answer to see what happens next."}
						</p>
						{error ? (
							<p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
								{error}
							</p>
						) : null}
						<div className="flex flex-wrap justify-end gap-2">
							<Button type="button" variant="outline" disabled={pending || done} onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button type="button" disabled={!answer || pending || done} onClick={confirm}>
								{pending ? "Working..." : answer ? OUTCOME[answer].label : "Publish"}
							</Button>
						</div>
					</>
				)}
			</div>
		</Modal>
	);
}

type FlagProps = { open: boolean; onOpenChange: (open: boolean) => void; itemId: string };

/** For a published item: it now includes client data, so it goes back to a moderator and is hidden until they approve it. */
export function ClientDataDialog({ open, onOpenChange, itemId }: FlagProps) {
	const router = useRouter();
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();

	const confirm = () =>
		startTransition(async () => {
			setError("");
			try {
				await flagClientDataAction({ itemId });
				onOpenChange(false);
				router.refresh();
			} catch (e) {
				setError(actionErrorMessage(e, "Could not send it for review. Reload the page and try again."));
			}
		});

	return (
		<Modal open={open} onOpenChange={onOpenChange} locked={pending} labelledBy="flag-title">
			<div className="grid gap-4 p-5">
				<h2 id="flag-title" className="font-heading text-2xl">
					Hide this and send it for review?
				</h2>
				<p className="text-sm">
					If this item now includes client names or client data, it goes back to a library moderator for approval. It is hidden from other members until a moderator approves it. You can keep editing it meanwhile.
				</p>
				{error ? (
					<p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
						{error}
					</p>
				) : null}
				<div className="flex flex-wrap justify-end gap-2">
					<Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button type="button" disabled={pending} onClick={confirm}>
						{pending ? "Working..." : "Hide and send for review"}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
