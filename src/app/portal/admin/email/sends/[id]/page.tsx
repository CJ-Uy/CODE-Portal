import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { getRepositories } from "@/db";
import { EmailPreview } from "@/components/email/email-preview";
import { SendProgress } from "@/components/email/send-progress";
import { StatusPill } from "@/components/email/status-pill";
import { Input } from "@/components/ui/input";
import { SAMPLE_MERGE_VALUES } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
import type { EmailDeliveryStatus } from "@/lib/email/types";
import { cn } from "@/lib/utils";
import { requireActor } from "@/server/auth/actor";
import { emailConfigFromEnv } from "@/server/email/db";
import { formatManila } from "../../campaign-row";
import { ReportActions } from "./report-actions";

export const dynamic = "force-dynamic";

const STRIP: { status: EmailDeliveryStatus; label: string }[] = [
	{ status: "pending", label: "Queued" },
	{ status: "sent", label: "Sent" },
	{ status: "failed", label: "Failed" },
	{ status: "skipped_optout", label: "Opted out" },
];
const STATUSES = new Set<string>(["pending", "sent", "failed", "skipped_optout", "cancelled"]);

export default async function SendReportPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const actor = await requireActor();
	const { id } = await params;
	const raw = await searchParams;
	const rawStatus = typeof raw.status === "string" ? raw.status : undefined;
	const q = typeof raw.q === "string" ? raw.q : "";
	const tab = typeof raw.tab === "string" ? raw.tab : "recipients";
	const status = rawStatus && STATUSES.has(rawStatus) ? (rawStatus as EmailDeliveryStatus) : undefined;
	const { email } = await getRepositories();
	const report = await email.campaigns.report(actor, id, { status, q });
	if (!report) notFound();
	const { campaign, counts, deliveries } = report;
	const total = Object.values(counts).reduce((a, b) => a + b, 0);
	const href = (params: Record<string, string | undefined>) => {
		const search = new URLSearchParams(Object.entries({ status, q, tab, ...params }).filter((e): e is [string, string] => Boolean(e[1])));
		return `/portal/admin/email/sends/${id}${search.size ? `?${search}` : ""}`;
	};
	const { publicBaseUrl } = emailConfigFromEnv();
	const preview =
		tab === "content"
			? renderEmail({
					subject: campaign.subject,
					preheader: campaign.preheader,
					blocks: campaign.blocks,
					resolve: valueResolver(SAMPLE_MERGE_VALUES),
					values: SAMPLE_MERGE_VALUES,
					baseUrl: publicBaseUrl,
					footer: { categoryName: campaign.categoryName ?? "CODE", required: true, archiveUrl: null, preferencesUrl: "#", unsubscribeUrl: null },
				})
			: null;

	return (
		<div className="grid gap-6">
			<Link href="/portal/admin/email" className="inline-flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft className="size-4" aria-hidden />
				Email
			</Link>

			<header className="grid gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-3">
					<h1 className="min-w-0 break-all font-heading text-3xl">{campaign.subject || "Untitled email"}</h1>
					<StatusPill status={campaign.status} />
				</div>
				<p className="min-w-0 break-all text-sm text-muted-foreground">
					From {campaign.senderName ?? "no sender"} · {campaign.categoryName ?? "no category"}
					{campaign.scheduledAt ? ` · ${campaign.status === "scheduled" ? "Sends" : "Started"} ${formatManila(campaign.startedAt ?? campaign.scheduledAt)}` : ""}
					{campaign.finishedAt ? ` · Finished ${formatManila(campaign.finishedAt)}` : ""}
				</p>
				<ReportActions id={campaign.id} status={campaign.status} failed={counts.failed} scheduledAt={campaign.scheduledAt} />
			</header>

			<section className="grid gap-4 rounded-xl border border-border bg-card p-4">
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{STRIP.map((item) => (
						<Link
							key={item.status}
							href={href({ status: status === item.status ? undefined : item.status, tab: "recipients" })}
							aria-current={status === item.status ? "true" : undefined}
							className={cn(
								"grid gap-0.5 rounded-lg border border-border p-3 transition-colors hover:border-accent",
								status === item.status && "border-primary bg-secondary/60",
							)}
						>
							<span className="text-sm text-muted-foreground">{item.label}</span>
							<span className="font-heading text-2xl tabular-nums">{counts[item.status]}</span>
						</Link>
					))}
				</div>
				<SendProgress
					status={campaign.status}
					total={total}
					sent={counts.sent}
					failed={counts.failed}
					skipped={counts.skipped_optout}
					scheduledAt={campaign.scheduledAt}
				/>
			</section>

			<nav className="flex gap-1 border-b border-border" aria-label="Report sections">
				{[
					["recipients", "Recipients"],
					["content", "Content"],
				].map(([value, label]) => (
					<Link
						key={value}
						href={href({ tab: value })}
						aria-current={tab === value ? "page" : undefined}
						className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground"
					>
						{label}
					</Link>
				))}
			</nav>

			{tab === "content" && preview ? (
				<EmailPreview bodyHtml={preview.bodyHtml} />
			) : (
				<section className="grid gap-3">
					<form className="relative w-full sm:w-72">
						<Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
						{status ? <input type="hidden" name="status" value={status} /> : null}
						<Input name="q" defaultValue={q} placeholder="Search recipients" aria-label="Search recipients" className="pl-8" />
					</form>
					{deliveries.length === 0 ? (
						<p className="text-sm text-muted-foreground">{campaign.status === "draft" || campaign.status === "scheduled" ? "Recipients are listed once sending starts." : "No recipients match."}</p>
					) : (
						<ul className="grid divide-y divide-border rounded-xl border border-border bg-card">
							{deliveries.map((d) => (
								<li key={d.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
									<div className="grid min-w-0 flex-1">
										<span className="flex min-w-0 items-center gap-2">
											<span className="min-w-0 break-all font-medium">{d.name}</span>
											{d.external ? <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Outside</span> : null}
										</span>
										<span className="min-w-0 break-all text-sm text-muted-foreground">{d.email}</span>
										{d.error ? <span className="min-w-0 break-all text-sm text-[#343B41] dark:text-[#D7DFE9]">{d.error}</span> : null}
									</div>
									<span className="text-sm tabular-nums text-muted-foreground">{d.sentAt ? formatManila(d.sentAt) : d.attempts ? `${d.attempts} tries` : ""}</span>
									<StatusPill status={d.status} />
								</li>
							))}
						</ul>
					)}
				</section>
			)}
		</div>
	);
}
