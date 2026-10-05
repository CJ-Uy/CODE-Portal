"use client";

import { Tooltip } from "radix-ui";
import { Info } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function EmailPricing({ quote }: { quote: { rate: number; updatedAt: number } | null }) {
	const [open, setOpen] = useState(false);
	const php = quote ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(0.35 * quote.rate) : null;
	return <Tooltip.Provider delayDuration={150}><Tooltip.Root open={open} onOpenChange={setOpen}>
		<Tooltip.Trigger asChild><Button variant="ghost" size="icon" aria-label="Email allowance and extra cost" onClick={() => setOpen(true)}><Info className="size-4" /></Button></Tooltip.Trigger>
		<Tooltip.Portal><Tooltip.Content side="bottom" sideOffset={6} className="z-50 max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md">
			<p>Workers Paid includes 3,000 outbound emails per account and billing cycle, shared across beta, staged and live. You can send beyond that for US$0.35 per additional 1,000 emails{php ? `, approximately ${php}` : ""}.</p>
			<p className="mt-2">This page counts this workspace’s sends in the calendar month. Your daily sending cap still applies. Workers fees, taxes and currency conversion charges are separate.</p>
			<p className="mt-2 text-xs">{quote ? `PHP estimate: US$1 = ₱${quote.rate.toFixed(2)}, quoted ${new Date(quote.updatedAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}. Rates refresh automatically. ` : "PHP conversion is temporarily unavailable. "}Sources: Cloudflare Email Service pricing and ExchangeRate-API.</p>
			<Tooltip.Arrow className="fill-popover" />
		</Tooltip.Content></Tooltip.Portal>
	</Tooltip.Root></Tooltip.Provider>;
}
