import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArchiveRestore, Flag, Inbox, SearchCheck } from "lucide-react";
import { AdminIntro } from "@/components/portal/admin-intro";
import { EmptyState } from "@/components/portal/empty-state";
import { ToastProvider } from "@/components/ui/toast";
import { getRepositories } from "@/db";
import { cn } from "@/lib/utils";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { getLibraryBindings } from "@/server/library/ai";
import { noticeText, parseTab, TABS } from "./input";
import type { TabKey } from "./input";
import { PendingItemRow, ReportCard, TakenDownItemRow, TakenDownListRow } from "./queue";
import { RebuildIndexButton } from "./rebuild-index";
import { groupTags, toItemRow, toListRow, toReportRow } from "./rows";
import { TagManager } from "./tag-manager";

export const dynamic = "force-dynamic";

type SearchParams = { tab?: string | string[]; notice?: string | string[] };

const HINTS: Record<TabKey, string> = {
	waiting: "Items that include client data wait here, oldest first. Approve makes an item live. Send back returns it to its owner as a draft, with your reason.",
	reports: "Open reports from members, oldest first. Dismiss leaves the item or list up. Take down removes it from view and tells its owner why.",
	"taken-down": "Restore puts an item back up. A restored list stays unshared until its owner shares it again.",
	tags: "Rename, regroup, merge or delete tags. The number is every item that carries the tag, drafts and confidential items included.",
	"search-index": "Whether every published item has been read into the search index.",
};

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

export default async function AdminLibraryModerationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
	if (!isFeatureEnabled("library")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "library:moderate")) notFound();

	const params = await searchParams;
	const tab = parseTab(params.tab);
	const notice = noticeText(params.notice);

	const repositories = await getRepositories();
	// Not caught on purpose: a failed load must not read as "nothing is waiting".
	const [queue, tagGroups, unindexed] = await Promise.all([
		repositories.library.moderationQueue(actor),
		tab === "tags" ? repositories.libraryTags.listTagsForModeration(actor).then(groupTags) : null,
		tab === "search-index" ? repositories.library.unindexedCount(actor) : null,
	]);

	// The AI + VECTORIZE bindings, not the flag: the index is built before members are shown smart search.
	const indexReady = tab === "search-index" && getLibraryBindings() !== null;
	const membersSeeIt = isFeatureEnabled("librarySmartSearch");

	const counts: Partial<Record<TabKey, number>> = {
		waiting: queue.pending.length,
		reports: queue.reports.length,
		"taken-down": queue.takenDown.length + queue.takenDownLists.length,
	};

	return (
		<ToastProvider>
			<div className="grid min-w-0 gap-6">
				<AdminIntro title="Library moderation" whoFor="For library moderators" effect="Approve what members submit, act on reports, restore what was taken down and keep the tag list tidy" />

				{notice ? (
					<p role="status" className="min-w-0 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm [overflow-wrap:anywhere]">
						{notice}
					</p>
				) : null}

				{/* Scrolls sideways on a phone; the page itself never does. */}
				<nav aria-label="Library moderation sections" className="min-w-0 overflow-x-auto">
					<ul className="flex w-max min-w-full gap-1 border-b border-border">
						{TABS.map(({ key, label }) => {
							const count = counts[key];
							const active = key === tab;
							return (
								<li key={key}>
									<Link
										href={`/portal/admin/content/library?tab=${key}`}
										aria-current={active ? "page" : undefined}
										className={cn(
											"-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-[color,border-color]",
											active ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
										)}
									>
										{label}
										{count ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{count.toLocaleString("en-US")}</span> : null}
									</Link>
								</li>
							);
						})}
					</ul>
				</nav>

				<section aria-label={TABS.find((candidate) => candidate.key === tab)?.label} className="grid min-w-0 gap-4">
					<p className="min-w-0 max-w-2xl text-sm text-muted-foreground">{HINTS[tab]}</p>

					{tab === "waiting" ? (
						queue.pending.length === 0 ? (
							<EmptyState icon={Inbox} title="Nothing is waiting for approval" description="New submissions that need a look will show up here." />
						) : (
							<ul className="grid min-w-0 gap-3">
								{queue.pending.map((item) => (
									<PendingItemRow key={item.id} item={toItemRow(item)} />
								))}
							</ul>
						)
					) : null}

					{tab === "reports" ? (
						queue.reports.length === 0 ? (
							<EmptyState icon={Flag} title="No open reports" description="Reports from members show up here." />
						) : (
							<ul className="grid min-w-0 gap-3">
								{queue.reports.map((report) => (
									<ReportCard key={report.id} report={toReportRow(report)} />
								))}
							</ul>
						)
					) : null}

					{tab === "taken-down" ? (
						queue.takenDown.length === 0 && queue.takenDownLists.length === 0 ? (
							<EmptyState icon={ArchiveRestore} title="Nothing is taken down" description="Items and lists a moderator takes down show up here, ready to restore." />
						) : (
							<div className="grid min-w-0 gap-6">
								<div className="grid min-w-0 gap-2">
									<h2 className="font-heading text-xl">Items</h2>
									{queue.takenDown.length === 0 ? (
										<p className="text-sm text-muted-foreground">No items are taken down.</p>
									) : (
										<ul className="grid min-w-0 gap-3">
											{queue.takenDown.map((item) => (
												<TakenDownItemRow key={item.id} item={toItemRow(item)} />
											))}
										</ul>
									)}
								</div>
								<div className="grid min-w-0 gap-2">
									<h2 className="font-heading text-xl">Lists</h2>
									{queue.takenDownLists.length === 0 ? (
										<p className="text-sm text-muted-foreground">No lists are taken down.</p>
									) : (
										<ul className="grid min-w-0 gap-3">
											{queue.takenDownLists.map((list) => (
												<TakenDownListRow key={list.id} list={toListRow(list)} />
											))}
										</ul>
									)}
								</div>
							</div>
						)
					) : null}

					{tab === "tags" && tagGroups ? <TagManager groups={tagGroups} /> : null}

					{tab === "search-index" && unindexed !== null ? (
						<div className="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4">
							<div className="flex min-w-0 items-center gap-3">
								<SearchCheck className="size-5 shrink-0 text-accent" aria-hidden />
								<p className="min-w-0 font-medium">
									{unindexed === 0 ? "Every published item has been read into the search index." : `${plural(unindexed, "published item has", "published items have")} not been read into the search index yet.`}
								</p>
							</div>
							{!indexReady ? (
								<p className="text-sm text-muted-foreground">The search index is not set up here, so nothing is read into it.</p>
							) : (
								<>
									<p className="max-w-2xl text-sm text-muted-foreground">
										New and edited items are read on their own shortly after they change. Rebuild reads anything that was missed, such as items added by an import, 10 at a time until none are left.
										{membersSeeIt ? null : " Members do not see smart search yet. It is switched on by the admins' deploy setting (FEATURE_LIBRARY_SMART_SEARCH) once the rebuild reaches 0."}
									</p>
									{can(actor, "library:manage") ? (
										<RebuildIndexButton remaining={unindexed} />
									) : (
										<p className="text-sm text-muted-foreground">A library manager can run the rebuild.</p>
									)}
								</>
							)}
						</div>
					) : null}
				</section>
			</div>
		</ToastProvider>
	);
}
