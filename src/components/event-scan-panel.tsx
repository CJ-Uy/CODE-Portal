"use client";

import { useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventScanOverlay } from "@/components/event-scan-overlay";
import { formatUtc8Time } from "@/lib/date-slots";

export function EventScanPanel({
	eventId,
	eventTitle,
	termId,
	closesAt,
	scannedCount,
	canUndo,
}: {
	eventId: string;
	eventTitle: string;
	termId: string;
	closesAt: Date;
	scannedCount: number;
	canUndo: boolean;
}) {
	const [overlayOpen, setOverlayOpen] = useState(false);
	const closesLabel = formatUtc8Time(closesAt);
	const countLabel = `${scannedCount} ${scannedCount === 1 ? "member" : "members"} checked in.`;

	return (
		<div className="w-full rounded-lg bg-accent p-4 text-accent-foreground">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-start gap-3">
					<ScanLine className="mt-0.5 size-5 shrink-0" />
					<div className="min-w-0">
						<p className="font-medium">You are the scanner for {eventTitle} right now.</p>
						<p className="text-sm text-accent-foreground/80">Check-in is open until {closesLabel}. {countLabel}</p>
					</div>
				</div>
				<Button type="button" className="min-h-11 bg-background text-foreground hover:bg-background/90" onClick={() => setOverlayOpen(true)}>
					<ScanLine className="size-4" />
					Open scanner
				</Button>
				{overlayOpen ? (
					<EventScanOverlay eventId={eventId} termId={termId} canUndo={canUndo} onClose={() => setOverlayOpen(false)} />
				) : null}
			</div>
		</div>
	);
}
