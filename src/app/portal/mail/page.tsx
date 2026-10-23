import Link from "next/link";
import { Inbox, Settings2 } from "lucide-react";
import { getRepositories } from "@/db";
import { EmptyState } from "@/components/portal/empty-state";
import { PageHeader } from "@/components/portal/page-header";
import { Button } from "@/components/ui/button";
import { requireActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";
const DATE = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric" });

export default async function MailPage() {
	const actor = await requireActor();
	const { email } = await getRepositories();
	const items = await email.member.listArchive(actor);
	return (
		<div className="grid gap-5">
			<PageHeader
				title="Mail"
				description="Every CODE email sent to you, in one place."
				actions={
					<Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-9">
						<Link href="/portal/mail/preferences">
							<Settings2 aria-hidden />
							Email preferences
						</Link>
					</Button>
				}
			/>
			{items.length === 0 ? (
				<EmptyState icon={Inbox} title="No emails yet" description="When officers email members, a copy lands here too." />
			) : (
				<ul className="grid divide-y divide-border rounded-xl border border-border bg-card">
					{items.map((item, i) => (
						<li key={item.deliveryId} className="row-enter" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
							<Link href={`/portal/mail/${item.deliveryId}`} className="grid gap-1 px-4 py-3 transition-colors hover:bg-secondary/60">
								<span className="flex min-w-0 items-center gap-2">
									{item.readAt ? null : <span className="size-2 shrink-0 rounded-full bg-[#4986AC]" aria-hidden />}
									<span className={item.readAt ? "min-w-0 flex-1 truncate font-medium" : "min-w-0 flex-1 truncate font-semibold"}>{item.subject}{item.readAt ? null : <span className="sr-only"> (unread)</span>}</span>
									<span className="shrink-0 text-xs text-muted-foreground">{item.sentAt ? DATE.format(item.sentAt) : ""}</span>
								</span>
								<span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
									{item.categoryName ? <span className="min-w-0 max-w-[50%] shrink-0 truncate rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{item.categoryName}</span> : null}
									<span className="min-w-0 truncate">{item.preheader || item.senderName}</span>
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
