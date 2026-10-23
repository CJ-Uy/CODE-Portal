import Link from "next/link";
import { notFound } from "next/navigation";
import { Filter } from "lucide-react";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PointsLeaderboard } from "@/components/points-leaderboard";
import { RetentionHistory } from "@/components/retention-history";
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
	const [terms, history, pointTypeLoad, nextEvents] = await Promise.all([
		repositories.retention.listTerms(actor).catch(() => []),
		repositories.retention
			.myHistory(actor, { termId: params.termId })
			.catch(() => ({ summary: null, records: [], pendingShares: [], progress: null })),
		repositories.pointTypes
			.list()
			.then((rows) => ({ ok: true as const, rows }))
			.catch(() => ({ ok: false as const, rows: [] })),
		view === "history" ? repositories.retention.nextPartEvents(actor).catch(() => new Map()) : Promise.resolve(new Map()),
	]);
	const selectedTermId = history.summary?.termId ?? params.termId ?? terms.find((term) => term.isCurrent)?.id ?? "";

	const selectedPointTypeId = selectLeaderboardPointTypeId(params.pointTypeId, pointTypeLoad.rows);
	const leaderboard =
		view === "leaderboard" && pointTypeLoad.ok && selectedTermId && selectedPointTypeId
			? await repositories.retention
					.publicLeaderboard(actor, { termId: selectedTermId, pointTypeId: selectedPointTypeId, limit: 100 })
					.catch(() => [])
			: [];
	const selectedPointType = pointTypeLoad.rows.find((type) => type.id === selectedPointTypeId);

	const tabs = [
		{ id: "history", label: "My retention", href: "/portal/retention" },
		...(showLeaderboard
			? [{ id: "leaderboard", label: "Leaderboard", href: "/portal/retention?view=leaderboard" }]
			: []),
	];

	return (
		<div className="grid min-w-0 grid-cols-1 gap-5">
			<div>
				<h1 className="font-heading text-3xl">Retention</h1>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
					What you still need to stay a member this school year, and where your points came from.
				</p>
			</div>

			<div className="flex gap-2 border-b border-border">
				{tabs.map((tab) => (
					<Link
						key={tab.id}
						href={tab.href}
						aria-current={view === tab.id ? "page" : undefined}
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

			{view === "history" ? (
				<RetentionHistory
					summary={history.summary}
					records={history.records}
					pendingShares={history.pendingShares}
					progress={history.progress}
					terms={terms}
					selectedTermId={selectedTermId}
					pointTypes={pointTypeLoad.rows}
					nextEvents={nextEvents}
				/>
			) : !pointTypeLoad.ok ? (
				<p className="text-sm text-muted-foreground">Point types are unavailable right now.</p>
			) : (
				<>
					<form method="get" className="flex flex-wrap items-end gap-3">
						<input type="hidden" name="view" value={view} />
						<input type="hidden" name="termId" value={selectedTermId} />
						<label className="grid min-w-0 gap-1.5 text-sm">
							<span className="font-medium">Point type</span>
							<Select name="pointTypeId" defaultValue={selectedPointTypeId ?? ""} className="min-w-0">
								{pointTypeLoad.rows.map((type) => (
									<option key={type.id} value={type.id}>
										{type.label}
										{type.active ? "" : " (retired)"}
									</option>
								))}
							</Select>
						</label>
						<Button type="submit" variant="secondary">
							<Filter />
							View
						</Button>
					</form>
					<PointsLeaderboard rows={leaderboard} meId={actor.memberId} pointTypeLabel={selectedPointType?.label ?? "these"} />
				</>
			)}
		</div>
	);
}
