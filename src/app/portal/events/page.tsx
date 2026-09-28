import Link from "next/link";
import { notFound } from "next/navigation";
import { Filter, Trophy } from "lucide-react";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/portal/empty-state";
import { MemberAvatar } from "@/components/portal/member-avatar";
import { RetentionHistory } from "@/components/retention-history";
import { formatPoints } from "@/lib/points";
import { requireActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { selectLeaderboardPointTypeId } from "./point-type-selection";

export const dynamic = "force-dynamic";

function initialsFrom(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);
	return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "M";
}

export default async function RetentionHistoryPage({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string; view?: string; pointTypeId?: string }>;
}) {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("retention")) notFound();

	const actor = await requireActor();
	const params = await searchParams;
	const showLeaderboard = isFeatureEnabled("leaderboard");
	// Gated on the resolved view, not just the tab list, so a hand-typed ?view=leaderboard
	// falls back to the history tab instead of rendering a hidden surface.
	const view = showLeaderboard && params.view === "leaderboard" ? "leaderboard" : "history";

	const repositories = await getRepositories();
	const terms = await repositories.retention.listTerms(actor).catch(() => []);
	const { summary, records } = await repositories.retention
		.myHistory(actor, { termId: params.termId })
		.catch(() => ({ summary: null, records: [] }));
	const selectedTermId = summary?.termId ?? params.termId ?? terms.find((term) => term.isCurrent)?.id ?? "";

	const pointTypeLoad = await repositories.pointTypes
		.list()
		.then((rows) => ({ ok: true as const, rows }))
		.catch(() => ({ ok: false as const, rows: [] }));
	const selectedPointTypeId = selectLeaderboardPointTypeId(params.pointTypeId, pointTypeLoad.rows);
	const leaderboard =
		view === "leaderboard" && pointTypeLoad.ok && selectedTermId && selectedPointTypeId
			? await repositories.retention
					.publicLeaderboard(actor, { termId: selectedTermId, pointTypeId: selectedPointTypeId, limit: 25 })
					.catch(() => [])
			: [];

	const tabs = [
		{ id: "history", label: "My points", href: "/portal/events" },
		...(showLeaderboard
			? [{ id: "leaderboard", label: "Leaderboard", href: "/portal/events?view=leaderboard" }]
			: []),
	];

	return (
		<div className="grid gap-5">
			<div>
				<p className="text-xs font-semibold uppercase text-primary">Member workspace</p>
				<h1 className="font-heading text-3xl">Points</h1>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
					Your points and where you stand this term.
				</p>
			</div>

			<div className="flex gap-2 border-b border-border">
				{tabs.map((tab) => (
					<Link
						key={tab.id}
						href={tab.href}
						className={
							view === tab.id
								? "-mb-px border-b-2 border-accent px-3 py-2 text-sm font-semibold text-foreground"
								: "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
						}
					>
						{tab.label}
					</Link>
				))}
			</div>

			{pointTypeLoad.ok ? (
				<form method="get" className="flex flex-wrap items-end gap-3">
					<input type="hidden" name="view" value={view} />
					<input type="hidden" name="termId" value={selectedTermId} />
					<label className="grid min-w-0 gap-1.5 text-sm">
						<span className="font-medium">Point type</span>
						<Select name="pointTypeId" defaultValue={selectedPointTypeId ?? ""} className="min-w-0">
							{pointTypeLoad.rows.map((type) => (
								<option key={type.id} value={type.id}>
									{type.label}{type.active ? "" : " (retired)"}
								</option>
							))}
						</Select>
					</label>
					<Button type="submit" variant="secondary">
						<Filter />
						View
					</Button>
				</form>
			) : null}

			{view === "history" ? (
				<RetentionHistory
					summary={summary}
					records={records}
					terms={terms}
					selectedTermId={selectedTermId}
					selectedPointTypeId={selectedPointTypeId}
					pointTypes={pointTypeLoad.rows}
				/>
			) : !pointTypeLoad.ok ? (
				<p className="text-sm text-muted-foreground">Point types are unavailable right now.</p>
			) : leaderboard.length === 0 ? (
				<EmptyState
					icon={Trophy}
					title="No points yet this term"
					description="Attend events to climb the leaderboard."
				/>
			) : (
				<Card>
					<CardContent className="divide-y divide-border p-0">
						{leaderboard.map((row, rank) => {
							const name = row.fullName ?? row.name ?? "Member";
							const isMe = row.memberId === actor.memberId;
							return (
								<div
									key={row.memberId}
									className={`flex items-center gap-3 px-4 py-3 ${isMe ? "bg-secondary/40" : ""}`}
								>
									<span className="w-6 text-center font-heading text-lg text-muted-foreground">
										{rank + 1}
									</span>
									<MemberAvatar initials={initialsFrom(name)} className="size-8 text-xs" />
									<span className="flex-1 truncate text-sm font-medium">
										{name}
										{isMe ? <span className="ml-2 text-xs text-accent">You</span> : null}
									</span>
									<span className="tabular-nums font-heading text-lg">{formatPoints(row.totalPoints)}</span>
								</div>
							);
						})}
					</CardContent>
				</Card>
			)}
		</div>
	);
}
