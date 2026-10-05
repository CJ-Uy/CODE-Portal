"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { EmailCampaignStatus } from "@/lib/email/types";

const UNDO_WINDOW_MS = 5 * 60_000;

/** Stacked bar plus a live sentence. Refreshes the server page every 3 s while a send is running or about to start. */
export function SendProgress({
	status,
	total,
	sent,
	failed,
	skipped,
	scheduledAt,
}: {
	status: EmailCampaignStatus;
	total: number;
	sent: number;
	failed: number;
	skipped: number;
	scheduledAt: Date | null;
}) {
	const router = useRouter();
	const scheduledMs = scheduledAt?.getTime() ?? null;
	useEffect(() => {
		// Read the clock inside the effect: render must stay pure.
		const soon = status === "scheduled" && scheduledMs !== null && scheduledMs - Date.now() < UNDO_WINDOW_MS;
		if (status !== "sending" && !soon) return;
		const timer = window.setInterval(() => router.refresh(), 3000);
		return () => window.clearInterval(timer);
	}, [status, scheduledMs, router]);

	const deliverable = Math.max(total - skipped, 0);
	const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0%");
	const sentence =
		status === "sending"
			? total === 0
				? "Preparing the recipient list."
				: `Sending ${sent} of ${deliverable}.`
			: status === "scheduled"
				? "Waiting for the scheduled time."
				: status === "draft"
					? "Not sent yet."
					: `${sent} sent${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} opted out` : ""}.`;

	return (
		<div className="grid gap-2">
			<div className="flex h-2 overflow-hidden rounded-full bg-secondary" role="presentation">
				<div className="bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: pct(sent) }} />
				<div className="bg-[#343B41] transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: pct(failed) }} />
				<div className="bg-[#90B4CC] transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: pct(skipped) }} />
			</div>
			<p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
				{sentence}
			</p>
		</div>
	);
}
