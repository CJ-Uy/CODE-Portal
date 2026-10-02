import Link from "next/link";
import { Inbox, Settings2 } from "lucide-react";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";

export const dynamic = "force-dynamic";
const DATE = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

export default async function MailPage() {
	const actor = await requireActor();
	const { email } = await getRepositories();
	const items = await email.member.listArchive(actor);
	return (
		<div className="grid gap-5">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="font-heading text-3xl">Mail</h1>
					<p className="text-sm text-muted-foreground">Every CODE email sent to you, in one place.</p>
				</div>
				<Link href="/portal/mail/preferences" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-accent">
					<Settings2 className="size-4" aria-hidden />
					Email preferences
				</Link>
			</header>
			{items.length === 0 ? (
				<div className="grid place-items-center gap-2 rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
					<Inbox className="size-6" aria-hidden />
					No CODE emails yet. They will appear here when officers send one.
				</div>
			) : (
				<ul className="grid divide-y divide-border rounded-xl border border-border bg-card">
					{items.map((item, i) => (
						<li key={item.deliveryId} className="row-enter" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
							<Link href={`/portal/mail/${item.deliveryId}`} className="grid gap-1 px-4 py-3 transition-colors hover:bg-secondary/60">
								<span className="flex min-w-0 items-center gap-2">
									{item.readAt ? null : <span className="size-2 shrink-0 rounded-full bg-[#4986AC]" aria-label="Unread" />}
									<span className={item.readAt ? "min-w-0 flex-1 truncate font-medium" : "min-w-0 flex-1 truncate font-semibold"}>{item.subject}</span>
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
