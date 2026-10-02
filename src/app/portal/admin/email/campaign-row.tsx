import Link from "next/link";
import { StatusPill } from "@/components/email/status-pill";
import type { CampaignListItem } from "@/db/repositories/email-campaigns";

const MANILA = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const formatManila = (date: Date) => MANILA.format(date);

export function CampaignRow({ campaign, meta, index = 0 }: { campaign: CampaignListItem; meta: string; index?: number }) {
	const href = campaign.status === "draft" ? `/portal/admin/email/sends/${campaign.id}/edit` : `/portal/admin/email/sends/${campaign.id}`;
	return (
		<li className="row-enter" style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
			<Link
				href={href}
				className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
			>
				<div className="grid min-w-0 flex-1 gap-0.5">
					<span className="min-w-0 truncate font-medium">{campaign.subject.trim() || "Untitled email"}</span>
					<span className="min-w-0 truncate text-sm text-muted-foreground">{meta}</span>
				</div>
				<StatusPill status={campaign.status} />
			</Link>
		</li>
	);
}
