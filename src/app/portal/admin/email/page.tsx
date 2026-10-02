import Link from "next/link";
import { Inbox, LayoutTemplate, PenLine } from "lucide-react";
import { getRepositories } from "@/db";
import { SendProgress } from "@/components/email/send-progress";
import { Button } from "@/components/ui/button";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { emailConfigFromEnv } from "@/server/email/db";
import { CampaignRow, formatManila } from "./campaign-row";

export const dynamic = "force-dynamic";
const MONTHLY_INCLUDED = 3000;

function Section({ title, empty, children, count }: { title: string; empty: string; children: React.ReactNode; count: number }) {
	return (
		<section className="grid gap-2">
			<h2 className="px-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
			{count === 0 ? <p className="px-3 text-sm text-muted-foreground">{empty}</p> : <ul className="grid">{children}</ul>}
		</section>
	);
}

export default async function EmailHomePage() {
	const actor = await requireActor();
	const { email } = await getRepositories();
	const [summary, unread, templates] = await Promise.all([
		email.campaigns.home(actor),
		email.inbox.openUnreadCount(actor),
		can(actor, "email:configure") ? email.templates.list(actor) : Promise.resolve([]),
	]);
	const config = emailConfigFromEnv();
	const monthPct = Math.min((summary.sentThisMonth / MONTHLY_INCLUDED) * 100, 100);
	const now = new Date();
	const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

	return (
		<div className="grid gap-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<h1 className="font-heading text-3xl">Email</h1>
					<p className="text-sm text-muted-foreground">Send CODE emails to members and read their replies.</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button asChild variant="outline">
						<Link href="/portal/admin/email/inbox">
							<Inbox />
							Replies{unread > 0 ? <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">{unread}<span className="sr-only"> unread</span></span> : null}
						</Link>
					</Button>
					<Button asChild>
						<Link href="/portal/admin/email/new">
							<PenLine />
							New email
						</Link>
					</Button>
				</div>
			</header>

			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
				<div className="grid content-start gap-6">
					{summary.sending.length > 0 ? (
						<section className="grid gap-3 rounded-xl border border-[#4986AC] bg-card p-4">
							<h2 className="text-sm font-semibold">Sending now</h2>
							{summary.sending.map((c) => (
								<Link key={c.id} href={`/portal/admin/email/sends/${c.id}`} className="grid gap-2 rounded-lg p-2 transition-colors hover:bg-secondary/60">
									<span className="min-w-0 truncate font-medium">{c.subject.trim() || "Untitled email"}</span>
									<SendProgress status={c.status} total={c.recipientCount} sent={c.sentCount} failed={c.failedCount} skipped={c.skippedCount} scheduledAt={c.scheduledAt} />
								</Link>
							))}
						</section>
					) : null}
					<Section title="Scheduled" empty="Nothing scheduled." count={summary.scheduled.length}>
						{summary.scheduled.map((c, i) => (
							<CampaignRow key={c.id} index={i} campaign={c} meta={`${c.scheduledAt ? formatManila(c.scheduledAt) : ""} · ${c.categoryName ?? "No category"}`} />
						))}
					</Section>
					<Section title="Recent sends" empty="No emails sent yet." count={summary.recent.length}>
						{summary.recent.map((c, i) => (
							<CampaignRow
								key={c.id}
								index={i}
								campaign={c}
								meta={`${c.finishedAt ? formatManila(c.finishedAt) : ""} · ${c.sentCount} sent${c.failedCount ? ` · ${c.failedCount} failed` : ""}`}
							/>
						))}
					</Section>
					<Section title="Drafts" empty="No drafts." count={summary.drafts.length}>
						{summary.drafts.map((c, i) => (
							<CampaignRow key={c.id} index={i} campaign={c} meta={`Edited ${formatManila(c.updatedAt)}`} />
						))}
					</Section>
				</div>

				<aside className="grid content-start gap-4">
					<div className="grid gap-2 rounded-xl border border-border bg-card p-4">
						<p className="text-sm">
							<span className="font-semibold tabular-nums">{summary.sentThisMonth.toLocaleString()}</span> of {MONTHLY_INCLUDED.toLocaleString()} included emails
							this month
						</p>
						<div className="h-1.5 overflow-hidden rounded-full bg-secondary">
							<div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${monthPct}%` }} />
						</div>
						<p className="text-xs text-muted-foreground">
							Resets {formatManila(nextMonth).split(",")[0]}. Today: {summary.sentToday} of {config.dailyCap} allowed.
						</p>
					</div>
					{templates.length > 0 ? (
						<div className="grid gap-2 rounded-xl border border-border bg-card p-4">
							<div className="flex items-center justify-between">
								<h2 className="text-sm font-semibold">Start from a template</h2>
								<Link href="/portal/admin/email/templates" className="text-sm text-accent underline-offset-2 hover:underline">
									All
								</Link>
							</div>
							<ul className="grid gap-1">
								{templates.slice(0, 4).map((t) => (
									<li key={t.id}>
										<Link
											href={`/portal/admin/email/new?template=${t.id}`}
											className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary/60"
										>
											<LayoutTemplate className="size-4 shrink-0 text-muted-foreground" aria-hidden />
											<span className="min-w-0 truncate">{t.name}</span>
										</Link>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</aside>
			</div>
		</div>
	);
}
