"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, CornerUpLeft, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { assignThreadAction, replyThreadAction, setThreadStatusAction } from "../actions";

export function ThreadControls({
	threadId,
	status,
	assigneeId,
	assignees,
	backHref,
}: {
	threadId: string;
	status: "open" | "done";
	assigneeId: string | null;
	assignees: { id: string; name: string }[];
	backHref: string;
}) {
	const router = useRouter();
	const toast = useToast();
	const [pending, startTransition] = useTransition();
	const setStatus = (next: "open" | "done") =>
		startTransition(async () => {
			const result = await setThreadStatusAction(threadId, next);
			if (!result.ok) return toast({ message: result.error });
			toast({
				message: next === "done" ? "Marked done." : "Moved back to open.",
				action: {
					label: "Undo",
					onClick: () =>
						startTransition(async () => {
							const undone = await setThreadStatusAction(threadId, next === "done" ? "open" : "done");
							if (!undone.ok) toast({ message: undone.error });
							router.refresh();
						}),
				},
			});
			if (next === "done") router.push(backHref);
			else router.refresh();
		});

	return (
		<div className="flex min-w-0 flex-wrap items-center gap-2">
			<select
				aria-label="Assignee"
				defaultValue={assigneeId ?? ""}
				disabled={pending}
				onChange={(e) =>
					startTransition(async () => {
						const result = await assignThreadAction(threadId, e.target.value || null);
						toast({ message: result.ok ? "Assignment saved." : result.error });
						router.refresh();
					})
				}
				className="h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm"
			>
				<option value="">Unassigned</option>
				{assignees.map((a) => (
					<option key={a.id} value={a.id}>
						{a.name}
					</option>
				))}
			</select>
			{status === "open" ? (
				<Button size="sm" disabled={pending} onClick={() => setStatus("done")}>
					<Check />
					Done
				</Button>
			) : (
				<Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus("open")}>
					<RotateCcw />
					Reopen
				</Button>
			)}
		</div>
	);
}

export function ReplyBox({ threadId, to }: { threadId: string; to: string }) {
	const router = useRouter();
	const toast = useToast();
	const [body, setBody] = useState("");
	const [pending, startTransition] = useTransition();
	return (
		<form
			className="grid gap-2 rounded-xl border border-border bg-card p-3"
			onSubmit={(e) => {
				e.preventDefault();
				startTransition(async () => {
					const result = await replyThreadAction(threadId, body);
					if (!result.ok) return toast({ message: result.error });
					setBody("");
					toast({ message: `Reply sent to ${to}.` });
					router.refresh();
				});
			}}
		>
			<label htmlFor={`reply-${threadId}`} className="text-sm font-medium">
				Reply to <span className="min-w-0 break-all">{to}</span>
			</label>
			<Textarea id={`reply-${threadId}`} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={20_000} placeholder="Write a reply" />
			<Button type="submit" disabled={pending || !body.trim()} className="justify-self-end">
				<CornerUpLeft />
				{pending ? "Sending..." : "Send reply"}
			</Button>
		</form>
	);
}

/** Inbound HTML is sanitized on store and shown in a sandbox with no scripts; plain text is the default view. */
export function MessageBody({ text, html }: { text: string | null; html: string | null }) {
	const [formatted, setFormatted] = useState(!text && Boolean(html));
	return (
		<div className="grid gap-2">
			{formatted && html ? (
				<iframe title="Formatted message" sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">${html}`} className="h-80 w-full rounded-lg border border-border bg-white" />
			) : (
				<p className="min-w-0 whitespace-pre-wrap break-all text-sm leading-relaxed">{text?.trim() || "(empty message)"}</p>
			)}
			{text && html ? (
				<button type="button" onClick={() => setFormatted((f) => !f)} className="justify-self-start text-xs text-accent underline-offset-2 hover:underline">
					{formatted ? "Show plain text" : "Show formatted"}
				</button>
			) : null}
		</div>
	);
}
