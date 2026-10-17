"use client";

import { useState, useTransition } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { actionErrorMessage } from "@/app/portal/library/editor-input";
import { reportAction } from "@/app/portal/library/item-actions";
import { REPORT_REASONS, REPORT_REASON_OPTIONS, type ReportReason } from "@/lib/library/taxonomy";
import { Modal } from "./modal";

/** Tells the library moderators about an item (or a shared list). A reason from a fixed list, plus optional words. */
export function ReportButton({ itemId, listId }: { itemId?: string; listId?: string }) {
	const toast = useToast();
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState<ReportReason | null>(null);
	const [details, setDetails] = useState("");
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();

	const send = () =>
		startTransition(async () => {
			if (!reason) return;
			setError("");
			try {
				await reportAction({ itemId, listId, reason, details });
				setOpen(false);
				setReason(null);
				setDetails("");
				toast({ message: "Report sent. A library moderator will take a look." });
			} catch (e) {
				setError(actionErrorMessage(e, "Could not send the report. Try again."));
			}
		});

	return (
		<>
			<Button type="button" variant="ghost" aria-haspopup="dialog" onClick={() => setOpen(true)}>
				<Flag aria-hidden />
				Report
			</Button>
			<Modal open={open} onOpenChange={setOpen} locked={pending} labelledBy="report-title">
				<div className="grid gap-4 p-5">
					<h2 id="report-title" className="font-heading text-2xl">
						Report this {listId ? "list" : "item"}
					</h2>
					<fieldset className="grid gap-2">
						<legend className="mb-1 text-sm font-medium">What is wrong?</legend>
						{REPORT_REASONS.map((value) => (
							<label
								key={value}
								className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary/50"
							>
								<input type="radio" name="report-reason" checked={reason === value} disabled={pending} onChange={() => setReason(value)} className="shrink-0 accent-[#06192F]" />
								{REPORT_REASON_OPTIONS[value]}
							</label>
						))}
					</fieldset>
					<label className="grid gap-1 text-sm font-medium">
						Details (optional)
						<Textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={1000} rows={3} disabled={pending} className="font-normal" />
					</label>
					{error ? (
						<p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
							{error}
						</p>
					) : null}
					<div className="flex flex-wrap justify-end gap-2">
						<Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="button" disabled={!reason || pending} onClick={send}>
							{pending ? "Sending..." : "Send report"}
						</Button>
					</div>
				</div>
			</Modal>
		</>
	);
}
