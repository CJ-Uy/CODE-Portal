"use client";

import { useState, useTransition } from "react";
import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { actionErrorMessage } from "../../editor-input";
import { restoreListAction, setPinnedAction, takeDownListAction } from "../../list-actions";
import { REASON_MAX } from "../../list-input";

type Props = { listId: string; shared: boolean; pinned: boolean; pinOrder: number; takenDown: boolean; canTakeDown: boolean };

/** Library moderators: pin a shared list as a collection, set where it sits, take it down with a reason, or restore it. Every control is checked again on the server. */
export function ListModeration({ listId, shared, pinned, pinOrder, takenDown, canTakeDown }: Props) {
	const toast = useToast();
	const [asking, setAsking] = useState(false);
	const [reason, setReason] = useState("");
	const [order, setOrder] = useState(pinned ? String(pinOrder) : "");
	const [seen, setSeen] = useState(`${pinned}:${pinOrder}`);
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();

	// A pin or an order that just landed (a new pin goes last) fills the field, so it shows the real position.
	if (seen !== `${pinned}:${pinOrder}`) {
		setSeen(`${pinned}:${pinOrder}`);
		setOrder(pinned ? String(pinOrder) : "");
	}

	const run = (task: () => Promise<void>, done: string, fallback: string, after?: () => void) => {
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

	const parsedOrder = order.trim() === "" ? undefined : Number(order);
	const orderInvalid = parsedOrder !== undefined && !Number.isInteger(parsedOrder);
	const pin = (next: boolean, withOrder?: number) =>
		run(
			() => setPinnedAction({ listId, pinned: next, pinOrder: withOrder }),
			next ? (pinned ? "Order saved." : "Pinned to the collections.") : "Unpinned.",
			"Could not change the pin. Try again.",
		);

	return (
		<section aria-labelledby={`list-mod-${listId}`} className="grid min-w-0 gap-4 rounded-xl border border-border bg-secondary/40 p-4">
			<h2 id={`list-mod-${listId}`} className="font-heading text-xl">
				Moderator controls
			</h2>

			{!takenDown ? (
				<div className="grid min-w-0 gap-2">
					{shared ? (
						<div className="flex flex-wrap items-end gap-2">
							<label className="grid gap-1 text-sm font-medium">
								Pin order
								<Input
									type="number"
									inputMode="numeric"
									step={1}
									value={order}
									aria-invalid={orderInvalid || undefined}
									placeholder={pinned ? undefined : "Last"}
									onChange={(event) => setOrder(event.target.value)}
									className="w-28"
								/>
							</label>
							{pinned ? (
								<>
									<Button type="button" variant="outline" disabled={pending || orderInvalid || parsedOrder === undefined} onClick={() => pin(true, parsedOrder)}>
										Set order
									</Button>
									<Button type="button" variant="outline" disabled={pending} onClick={() => pin(false)}>
										<PinOff aria-hidden />
										Unpin
									</Button>
								</>
							) : (
								<Button type="button" disabled={pending || orderInvalid} onClick={() => pin(true, parsedOrder)}>
									<Pin aria-hidden />
									Pin as a collection
								</Button>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">Only a shared list can be pinned as a collection.</p>
					)}
					{pinned ? <p className="text-xs text-muted-foreground">Collections show lowest order first.</p> : null}
				</div>
			) : null}

			{takenDown ? (
				<div className="flex flex-wrap items-center gap-3">
					<Button
						type="button"
						disabled={pending}
						onClick={() => run(() => restoreListAction({ listId }), "Restored. The owner can share it again.", "Could not restore the list. Try again.")}
					>
						{pending ? "Restoring..." : "Restore list"}
					</Button>
					<p className="min-w-0 text-sm text-muted-foreground">The list stays unshared until its owner shares it again.</p>
				</div>
			) : canTakeDown ? (
				<div className="grid min-w-0 gap-3">
					<div>
						<Button type="button" variant={asking ? "default" : "outline"} disabled={pending} onClick={() => setAsking(!asking)}>
							Take down
						</Button>
					</div>
					{asking ? (
						<div className="grid min-w-0 gap-2">
							<label className="grid gap-1 text-sm font-medium">
								Reason (the owner and editors will see it)
								<Textarea value={reason} rows={3} maxLength={REASON_MAX} autoFocus disabled={pending} onChange={(event) => setReason(event.target.value)} className="font-normal" />
							</label>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									disabled={pending || !reason.trim()}
									onClick={() =>
										run(
											() => takeDownListAction({ listId, reason }),
											"Taken down. It is no longer shared.",
											"Could not take the list down. Reload the page and try again.",
											() => {
												setAsking(false);
												setReason("");
											},
										)
									}
								>
									{pending ? "Taking down..." : "Confirm take down"}
								</Button>
								<Button type="button" variant="ghost" disabled={pending} onClick={() => setAsking(false)}>
									Cancel
								</Button>
							</div>
						</div>
					) : null}
				</div>
			) : null}

			{error ? (
				<p role="alert" className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">
					{error}
				</p>
			) : null}
		</section>
	);
}
