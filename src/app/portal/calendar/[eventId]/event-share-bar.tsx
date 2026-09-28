"use client";

import { useState } from "react";
import { CalendarPlus, Check, Download, Link2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrCanvas } from "@/components/qr-canvas";

/**
 * Share controls for an event: the short link and its QR, plus calendar handoff.
 *
 * The QR lives here as well as in the check-in card because the card disappears once a member
 * is marked present and never renders at all on an informational event — an organiser still
 * needs the code to project in those states.
 *
 * No participant emails travel anywhere here. The Google Calendar URL adds the event to the
 * clicking member's own calendar and nothing else — prefilling guests would put member addresses
 * into a URL, where they leak through history and referrers.
 */
export function EventShareBar({ shareUrl, googleUrl, icsUrl }: { shareUrl: string; googleUrl: string; icsUrl: string }) {
	const [copied, setCopied] = useState(false);
	const [qrOpen, setQrOpen] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(shareUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard can be blocked by permissions; the link stays selectable on screen.
			setCopied(false);
		}
	}

	return (
		<div className="grid min-w-0 gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<code className="min-w-0 break-all rounded-md border border-border bg-secondary/30 px-2 py-1 text-xs">{shareUrl}</code>
				<Button type="button" variant="outline" size="sm" onClick={copy}>
					{copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
					{copied ? "Copied" : "Copy link"}
				</Button>
				<Button type="button" variant="outline" size="sm" onClick={() => setQrOpen((open) => !open)} aria-expanded={qrOpen}>
					<QrCode className="size-4" />
					{qrOpen ? "Hide QR" : "Event QR"}
				</Button>
				<Button asChild variant="outline" size="sm">
					<a href={googleUrl} target="_blank" rel="noreferrer noopener">
						<CalendarPlus className="size-4" />
						Add to Google Calendar
					</a>
				</Button>
				<Button asChild variant="outline" size="sm">
					<a href={icsUrl}>
						<Download className="size-4" />
						.ics
					</a>
				</Button>
			</div>
			{qrOpen ? <QrCanvas payload={shareUrl} label="Event share link QR code" /> : null}
		</div>
	);
}
