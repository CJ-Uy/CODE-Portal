import Link from "next/link";
import { redirect } from "next/navigation";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/portal/empty-state";
import { ScrollText } from "lucide-react";
import { getActor } from "@/server/auth/actor";
import { hasAnyAdminScope } from "@/server/auth/admin";
import type { AuditCategory } from "@/db/repositories/audit";
import { actorDisplay, describeAudit, type AuditPhraseInput } from "@/lib/audit-phrasing";

export const dynamic = "force-dynamic";

const CATEGORIES: AuditCategory[] = [
	"role",
	"event",
	"retention",
	"survey",
	"link",
	"member",
	"announcement",
	"library",
];

function formatWhen(value: Date): string {
	return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function formatRelativeTime(value: Date): string {
	const seconds = Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 60 * 60) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 60 * 60 * 24) return `${Math.floor(seconds / (60 * 60))}h ago`;
	return `${Math.floor(seconds / (60 * 60 * 24))}d ago`;
}

function auditFilterHref(category?: AuditCategory, actorMemberId?: string): string {
	const params = new URLSearchParams();
	if (category) params.set("category", category);
	if (actorMemberId) params.set("actor", actorMemberId);
	const query = params.toString();
	return `/portal/admin/system/audit${query ? `?${query}` : ""}`;
}

export default async function AdminAuditPage({
	searchParams,
}: {
	searchParams: Promise<{ actor?: string; category?: string }>;
}) {
	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!hasAnyAdminScope(actor)) redirect("/portal");

	const params = await searchParams;
	const category = CATEGORIES.includes(params.category as AuditCategory) ? (params.category as AuditCategory) : undefined;
	const actorMemberId = params.actor || undefined;
	const repositories = await getRepositories();
	const entries = await repositories.audit.list(actor, { actorMemberId, category, limit: 100 }).catch(() => []);

	return (
		<div className="grid gap-5">
			<div>
				<h2 className="font-heading text-xl">Audit log</h2>
				<p className="text-sm text-muted-foreground">The most recent 100 recorded actions.</p>
			</div>

			<div className="flex flex-wrap gap-2">
				<FilterChip label="All" href="/portal/admin/system/audit" active={!category} />
				{CATEGORIES.map((cat) => (
					<FilterChip key={cat} label={cat} href={`/portal/admin/system/audit?category=${cat}`} active={category === cat} />
				))}
				{actorMemberId ? <FilterChip label="Clear" href={auditFilterHref(category)} active /> : null}
			</div>

			{entries.length === 0 ? (
				<EmptyState icon={ScrollText} title="No audit entries" description="Recorded actions will appear here." />
			) : (
				<Card>
					<CardContent className="divide-y divide-border p-0">
						{entries.map((entry) => {
							const phraseInput: AuditPhraseInput = {
								action: entry.action,
								actorName: entry.actorName,
								actorContext: entry.actorContext,
								sharedTokenLabel: entry.sharedTokenLabel,
								targetLabel: entry.targetLabel,
								targetMemberName: entry.targetMemberName,
								detail: entry.detail,
							};
							const sentence = describeAudit(phraseInput);
							const phraseEnd = entry.detail ? sentence.length - entry.detail.length - 3 : sentence.length;
							const targetIndex = entry.targetLabel ? sentence.lastIndexOf(entry.targetLabel, phraseEnd) : -1;
							const targetHref = entry.targetType === "event" ? `/portal/calendar/${encodeURIComponent(entry.targetId)}` : null;
							// Shared-token rows are never linked to a person: the label already says the write
							// was automated, and a link to that member's history would re-imply they did it.
							const actorHref =
								entry.actorMemberId && entry.actorContext !== "shared_dev_token"
									? auditFilterHref(category, entry.actorMemberId)
									: null;

							return (
								<div key={entry.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
									<Badge variant="secondary" className="capitalize">
										{entry.category}
									</Badge>
									<span className="min-w-0 break-all font-bold">
										{actorHref ? (
											<Link href={actorHref} className="underline-offset-4 hover:underline">
												{actorDisplay(phraseInput)}
											</Link>
										) : (
											actorDisplay(phraseInput)
										)}
									</span>
									<span className="min-w-0 flex-1">
										{targetIndex >= 0 && entry.targetLabel ? (
											<>
												{sentence.slice(0, targetIndex)}
												{targetHref ? (
													<Link href={targetHref} className="underline-offset-4 hover:underline">
														<span className="min-w-0 break-all">{entry.targetLabel}</span>
													</Link>
												) : (
													<span className="min-w-0 break-all">{entry.targetLabel}</span>
												)}
												{sentence.slice(targetIndex + entry.targetLabel.length)}
											</>
										) : (
											sentence
										)}
									</span>
									<time
										dateTime={entry.createdAt.toISOString()}
										title={formatWhen(entry.createdAt)}
										className="ml-auto shrink-0 text-xs text-muted-foreground"
									>
										{formatRelativeTime(entry.createdAt)}
									</time>
								</div>
							);
						})}
					</CardContent>
				</Card>
			)}
		</div>
	);
}

function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
	return (
		<Link
			href={href}
			className={
				active
					? "rounded-full border border-accent bg-secondary px-3 py-1 text-xs font-medium capitalize text-foreground"
					: "rounded-full border border-border px-3 py-1 text-xs font-medium capitalize text-muted-foreground hover:text-foreground"
			}
		>
			{label}
		</Link>
	);
}
