"use client";

import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sendActivity } from "./activity-ping";

/** A file download. The route serves it as an attachment; the click also counts one download. */
export function DownloadLink({ itemId, href, className, children }: { itemId: string; href: string; className?: string; children?: React.ReactNode }) {
	return (
		<a href={href} download className={cn(buttonVariants({ variant: "outline" }), className)} onClick={() => sendActivity(itemId, { kind: "download" })}>
			<Download aria-hidden />
			{children ?? "Download"}
		</a>
	);
}
