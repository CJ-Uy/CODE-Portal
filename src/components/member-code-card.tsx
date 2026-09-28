"use client";

import { useState } from "react";
import { QrCode } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabButton, TabsList } from "@/components/ui/tabs";
import { QrCanvas } from "@/components/qr-canvas";
import { encodeMemberCode } from "@/lib/member-code";

export function MemberCodeCard({
	memberId,
	title = "Event check-in",
	description = "Show this to an event host to be marked present. Your code never changes.",
	eventShareUrl,
	className,
}: {
	memberId: string;
	title?: string;
	description?: string;
	/**
	 * Only an event page has a share link to offer. Without it the toggle never renders and
	 * the card behaves exactly as it did before — the profile page and portal shell are untouched.
	 */
	eventShareUrl?: string;
	className?: string;
}) {
	const [mode, setMode] = useState<"member" | "event">("member");
	const onEvent = Boolean(eventShareUrl) && mode === "event";

	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<span className="grid size-7 place-items-center rounded-lg bg-secondary text-accent">
						<QrCode className="size-4" />
					</span>
					{title}
				</CardTitle>
				<CardDescription>{onEvent ? "Anyone who scans this opens the event page." : description}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col items-center gap-3">
				{eventShareUrl ? (
					<TabsList className="flex w-full">
						<TabButton type="button" active={!onEvent} onClick={() => setMode("member")} className="flex-1">
							Your code
						</TabButton>
						<TabButton type="button" active={onEvent} onClick={() => setMode("event")} className="flex-1">
							Event QR
						</TabButton>
					</TabsList>
				) : null}
				<QrCanvas
					payload={onEvent && eventShareUrl ? eventShareUrl : encodeMemberCode(memberId)}
					label={onEvent ? "Event share link QR code" : "Member attendance QR code"}
				/>
				{onEvent && eventShareUrl ? (
					// ponytail: no copy button here, the share bar above already owns that affordance.
					<p className="min-w-0 break-all text-center text-xs text-muted-foreground">{eventShareUrl}</p>
				) : (
					<p className="text-center text-xs text-muted-foreground">Check-in opens 30 minutes before each event starts.</p>
				)}
			</CardContent>
		</Card>
	);
}
