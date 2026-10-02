import type { EmailCampaignStatus, EmailDeliveryStatus } from "@/lib/email/types";
import { cn } from "@/lib/utils";

type Status = EmailCampaignStatus | EmailDeliveryStatus;

const LABELS: Record<Status, string> = {
	draft: "Draft",
	scheduled: "Scheduled",
	sending: "Sending",
	sent: "Sent",
	cancelled: "Cancelled",
	failed: "Failed",
	pending: "Queued",
	skipped_optout: "Opted out",
};

const TONES: Record<Status, string> = {
	draft: "border-border text-muted-foreground",
	scheduled: "border-[#90B4CC] bg-secondary text-secondary-foreground",
	sending: "border-transparent bg-[#4986AC] text-white",
	sent: "border-transparent bg-primary text-primary-foreground",
	cancelled: "border-border text-muted-foreground",
	failed: "border-transparent bg-[#343B41] text-white",
	pending: "border-[#90B4CC] text-secondary-foreground",
	skipped_optout: "border-border text-muted-foreground",
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
	return (
		<span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", TONES[status], className)}>
			{status === "sending" ? <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-hidden /> : null}
			{LABELS[status]}
		</span>
	);
}
