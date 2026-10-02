"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Copy, PenLine, RotateCcw, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { EmailCampaignStatus } from "@/lib/email/types";
import { cancelCampaignAction, duplicateCampaignAction, retryFailedAction, unscheduleCampaignAction } from "../../actions";

// Counts down only inside the final 5 minutes before a scheduled send (the undo window).
function useCountdown(target: Date | null) {
	// null until mounted so server and first client render agree.
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		if (!target) return;
		const tick = () => setNow(Date.now());
		const first = window.setTimeout(tick, 0);
		const timer = window.setInterval(tick, 1000);
		return () => {
			window.clearTimeout(first);
			window.clearInterval(timer);
		};
	}, [target]);
	if (!target || now === null || target.getTime() - now >= 5 * 60_000) return null;
	const left = Math.max(0, Math.round((target.getTime() - now) / 1000));
	return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

export function ReportActions({ id, status, failed, scheduledAt }: { id: string; status: EmailCampaignStatus; failed: number; scheduledAt: Date | null }) {
	const router = useRouter();
	const toast = useToast();
	const [pending, startTransition] = useTransition();
	const countdown = useCountdown(status === "scheduled" ? scheduledAt : null);

	const run = (task: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, message: string, then?: (data: unknown) => void) =>
		startTransition(async () => {
			const result = await task();
			if (!result.ok) {
				toast({ message: result.error });
				router.refresh();
				return;
			}
			toast({ message });
			if (then) then(result.data);
			else router.refresh();
		});

	return (
		<div className="flex flex-wrap items-center gap-2">
			{status === "scheduled" ? (
				<>
					{countdown ? (
						<span className="rounded-full bg-secondary px-3 py-1 text-sm tabular-nums" aria-live="polite">
							Sending in {countdown}
						</span>
					) : null}
					<Button variant={countdown ? "default" : "outline"} disabled={pending} onClick={() => run(() => unscheduleCampaignAction(id), "Moved back to drafts.", () => router.push(`/portal/admin/email/sends/${id}/edit`))}>
						<Undo2 />
						{countdown ? "Undo" : "Unschedule"}
					</Button>
					<Button asChild variant="ghost">
						<Link href={`/portal/admin/email/sends/${id}/edit`}>
							<PenLine />
							Edit
						</Link>
					</Button>
				</>
			) : null}
			{status === "sending" ? (
				<Button
					variant="outline"
					disabled={pending}
					onClick={() => {
						if (window.confirm("Stop sending? Members who already got it keep it.")) run(() => cancelCampaignAction(id), "Sending stopped.");
					}}
				>
					<X />
					Stop sending
				</Button>
			) : null}
			{(status === "sent" || status === "failed") && failed > 0 ? (
				<Button variant="outline" disabled={pending} onClick={() => run(() => retryFailedAction(id), "Retrying failed recipients.")}>
					<RotateCcw />
					Retry {failed} failed
				</Button>
			) : null}
			<Button
				variant="ghost"
				disabled={pending}
				onClick={() => run(() => duplicateCampaignAction(id), "Copied to a new draft.", (newId) => router.push(`/portal/admin/email/sends/${String(newId)}/edit`))}
			>
				<Copy />
				Duplicate
			</Button>
		</div>
	);
}
