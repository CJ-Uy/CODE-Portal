import Link from "next/link";
import { notFound } from "next/navigation";
import { Filter } from "lucide-react";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PointsLeaderboard } from "@/components/points-leaderboard";
import { RetentionHistory } from "@/components/retention-history";
import { RETENTION_POINT_TYPE_ID } from "@/lib/point-types";
import { competitionRanks } from "@/lib/retention-stats";
import { requireActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { selectLeaderboardPointTypeId } from "./point-type-selection";

export const dynamic = "force-dynamic";

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
	// Fetched on both tabs when the board is on: the history tab shows the viewer's rank.
	const leaderboard =
		showLeaderboard && pointTypeLoad.ok && selectedTermId && selectedPointTypeId
			? await repositories.retention
					.publicLeaderboard(actor, { termId: selectedTermId, pointTypeId: selectedPointTypeId, limit: 100 })
					.catch(() => [])
			: [];
	const myLeaderboardIndex = leaderboard.findIndex((row) => row.memberId === actor.memberId);
	const myRank =
		myLeaderboardIndex === -1
			? null
			: {
					rank: competitionRanks(leaderboard.map((row) => row.totalPoints))[myLeaderboardIndex],
					of: leaderboard.length,
				};
	const selectedPointType = pointTypeLoad.rows.find((type) => type.id === selectedPointTypeId);

	const tabs = [
		{ id: "history", label: "My points", href: "/portal/events" },
		...(showLeaderboard
			? [{ id: "leaderboard", label: "Leaderboard", href: "/portal/events?view=leaderboard" }]
			: []),
	];

	return (
		<div className="grid gap-5">
			<div>
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
					now={new Date()}
					rank={myRank}
				/>
			) : !pointTypeLoad.ok ? (
				<p className="text-sm text-muted-foreground">Point types are unavailable right now.</p>
			) : (
				<PointsLeaderboard
					rows={leaderboard}
					meId={actor.memberId}
					pointTypeLabel={selectedPointType?.label ?? "retention"}
					retainedAt={selectedPointTypeId === RETENTION_POINT_TYPE_ID && summary ? summary.retainedAt : null}
				/>
			)}
		</div>
	);
}
