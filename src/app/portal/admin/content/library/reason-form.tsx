"use client";

import { useState } from "react";
import { REASON_MAX } from "@/app/portal/library/list-input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Revealed when a moderator picks an action that tells the owner why (send back, take down). It cannot be confirmed empty. */
export function ReasonForm({
	label,
	confirmLabel,
	pending,
	onConfirm,
	onCancel,
}: {
	label: string;
	confirmLabel: string;
	pending: boolean;
	onConfirm: (reason: string) => void;
	onCancel: () => void;
}) {
	const [reason, setReason] = useState("");
	return (
		<div className="grid min-w-0 gap-2">
			<label className="grid gap-1 text-sm font-medium">
				{label}
				{/* It only exists because the moderator just chose an action that needs a reason, so the cursor goes straight to it. */}
				<Textarea autoFocus value={reason} rows={3} maxLength={REASON_MAX} disabled={pending} onChange={(event) => setReason(event.target.value)} className="font-normal" />
			</label>
			<div className="flex flex-wrap gap-2">
				<Button type="button" disabled={pending || !reason.trim()} onClick={() => onConfirm(reason)}>
					{pending ? "Working..." : confirmLabel}
				</Button>
				<Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}
