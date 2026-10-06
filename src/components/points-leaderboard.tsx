import type { ReactNode } from "react";
import { ArrowUp, Crown, Sparkles, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/portal/empty-state";
import { MemberAvatar } from "@/components/portal/member-avatar";
import type { LeaderboardRow } from "@/db/repositories/retention";
import { formatPoints } from "@/lib/points";
import { competitionRanks } from "@/lib/retention-stats";
import { cn } from "@/lib/utils";

function initialsFrom(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);
	return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "M";
}

const displayName = (row: LeaderboardRow) => row.fullName ?? row.name ?? "Member";

/**
 * Easter egg, on purpose: the portal's builder sits above the board at rank 0 with
 * infinite points. Rendered here only, never stored, so it cannot leak into exports,
 * rank maths, or anyone's real position.
 */
function RankZero() {
	return (
		<div
			title="Arrays start at 0. So does this leaderboard."
			className="relative overflow-hidden rounded-xl border border-amber-400/70 bg-gradient-to-r from-amber-100 via-yellow-50 to-amber-100 p-4 text-amber-950 dark:from-amber-400/25 dark:via-yellow-300/10 dark:to-amber-400/25 dark:text-amber-50"
		>
			<Sparkles className="absolute top-2 right-3 size-4 animate-pulse text-amber-500" aria-hidden />
			<Sparkles className="absolute bottom-2 left-1/2 size-3 animate-pulse text-amber-400 [animation-delay:700ms]" aria-hidden />
			<div className="flex items-center gap-3">
				<span className="w-8 text-center font-heading text-2xl">0</span>
				<span className="relative">
					<Crown className="absolute -top-3.5 left-1/2 size-4 -translate-x-1/2 -rotate-12 text-amber-500" aria-hidden />
					<MemberAvatar initials="CU" className="size-10 bg-amber-500 text-white ring-2 ring-amber-300" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate font-semibold">Charles Joshua T. Uy</p>
					<p className="text-xs opacity-80">Built the Portal. Currently running for S7.5</p>
				</div>
				<span className="font-heading text-3xl leading-none" aria-label="infinite points">
					∞
				</span>
			</div>
		</div>
	);
}

function PodiumSpot({
	row,
	rank,
	place,
	isMe,
	retained,
}: {
	row: LeaderboardRow;
	rank: number;
	place: 1 | 2 | 3;
	isMe: boolean;
	retained: boolean;
}) {
	const name = displayName(row);
	return (
		<div className={cn("flex min-w-0 flex-col items-center gap-1.5 text-center", place === 1 ? "order-2" : place === 2 ? "order-1" : "order-3")}>
			<span className="relative">
				{place === 1 ? <Crown className="absolute -top-4 left-1/2 size-5 -translate-x-1/2 text-amber-500" aria-hidden /> : null}
				<MemberAvatar
					initials={initialsFrom(name)}
					className={cn(
						place === 1 ? "size-16 text-lg ring-4 ring-amber-400" : "size-12 ring-2",
						place === 2 && "ring-slate-300",
						place === 3 && "ring-orange-300",
						isMe && "ring-accent",
					)}
				/>
			</span>
			<p className="w-full min-w-0 truncate text-sm font-semibold" title={name}>
				{name}
				{isMe ? <span className="ml-1 text-xs text-accent">You</span> : null}
			</p>
			<p className="font-heading text-lg tabular-nums leading-none">{formatPoints(row.totalPoints)}</p>
			{retained ? <p className="text-[11px] font-semibold text-accent">✓ Retained</p> : null}
			<div
				className={cn(
					"grid w-full place-items-start justify-center rounded-t-lg pt-2 font-heading text-xl",
					place === 1 ? "h-20 bg-accent text-accent-foreground" : place === 2 ? "h-14 bg-accent/60 text-accent-foreground" : "h-10 bg-accent/35",
				)}
			>
				{rank}
			</div>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0 bg-card px-3 py-2 text-center">
			<p className="font-heading text-xl tabular-nums">{value}</p>
			<p className="truncate text-[11px] text-muted-foreground">{label}</p>
		</div>
	);
}

export function PointsLeaderboard({
	rows,
	meId,
	pointTypeLabel,
	retainedAt,
}: {
	rows: LeaderboardRow[];
	meId: string;
	pointTypeLabel: string;
	/** Set only for the retention point type, where a cut-off line means something. */
	retainedAt: number | null;
}) {
	if (rows.length === 0) {
		return (
			<div className="grid gap-4">
				<RankZero />
				<EmptyState icon={Trophy} title="No points yet this term" description="Attend events to climb the leaderboard." />
			</div>
		);
	}

	const ranks = competitionRanks(rows.map((row) => row.totalPoints));
	const leader = Math.max(1, rows[0].totalPoints);
	const myIndex = rows.findIndex((row) => row.memberId === meId);
	const sortedPoints = rows.map((row) => row.totalPoints).sort((a, b) => a - b);
	const middle = Math.floor(sortedPoints.length / 2);
	const median = sortedPoints.length % 2 ? sortedPoints[middle] : (sortedPoints[middle - 1] + sortedPoints[middle]) / 2;
	const average = sortedPoints.reduce((sum, value) => sum + value, 0) / sortedPoints.length;
	const retainedCount = retainedAt === null ? 0 : rows.filter((row) => row.totalPoints >= retainedAt).length;

	let position: ReactNode;
	if (myIndex === -1) {
		position = (
			<p className="text-sm text-muted-foreground">
				You&apos;re not on the board yet. Earn {pointTypeLabel} points this term to get ranked.
			</p>
		);
	} else {
		const me = rows[myIndex];
		const myRank = ranks[myIndex];
		const ahead = rows.filter((row) => row.totalPoints > me.totalPoints).at(-1);
		const behind = rows.find((row) => row.totalPoints < me.totalPoints);
		const percentile = Math.max(1, Math.round((myRank / rows.length) * 100));
		position = (
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				<div>
					<p className="text-xs text-muted-foreground">Your rank</p>
					<p className="font-heading text-4xl tabular-nums leading-none">
						#{myRank}
						<span className="ml-1 text-base text-muted-foreground">of {rows.length}</span>
					</p>
				</div>
				<div className="grid min-w-0 flex-1 gap-1 text-sm">
					<p>
						<span className="font-semibold tabular-nums">{formatPoints(me.totalPoints)}</span> points · Top {percentile}%
					</p>
					{ahead ? (
						<p className="flex min-w-0 items-center gap-1 text-muted-foreground">
							<ArrowUp className="size-3.5 shrink-0 text-accent" aria-hidden />
							<span className="min-w-0 truncate">
								<span className="font-semibold text-foreground">{formatPoints(ahead.totalPoints - me.totalPoints)}</span> to pass {displayName(ahead)}
							</span>
						</p>
					) : (
						<p className="text-muted-foreground">
							You&apos;re leading{behind ? ` by ${formatPoints(me.totalPoints - behind.totalPoints)}` : ""}. Keep it up.
						</p>
					)}
					{retainedAt !== null && me.totalPoints < retainedAt ? (
						<p className="text-muted-foreground">
							{formatPoints(retainedAt - me.totalPoints)} more to join the retained zone.
						</p>
					) : null}
				</div>
			</div>
		);
	}

	const podium = rows.slice(0, 3);
	const rest = rows.slice(3);

	return (
		<div className="grid gap-4">
			<RankZero />

			<Card>
				<CardContent className="grid gap-4 p-4">
					{position}
					<div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
						<Stat label="Members ranked" value={String(rows.length)} />
						<Stat label="Top score" value={formatPoints(rows[0].totalPoints)} />
						<Stat label="Median" value={formatPoints(median)} />
						{retainedAt !== null ? (
							<Stat label={`Retained (≥${formatPoints(retainedAt)})`} value={String(retainedCount)} />
						) : (
							<Stat label="Average" value={formatPoints(average)} />
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="grid grid-cols-3 items-end gap-2 px-4 pt-8 pb-0 sm:gap-6 sm:px-10">
					{podium.map((row, index) => (
						<PodiumSpot
							key={row.memberId}
							row={row}
							rank={ranks[index]}
							place={(index + 1) as 1 | 2 | 3}
							isMe={row.memberId === meId}
							retained={retainedAt !== null && row.totalPoints >= retainedAt}
						/>
					))}
				</CardContent>
			</Card>

			{rest.length > 0 ? (
				<Card>
					<CardContent className="p-0">
						<ol className="divide-y divide-border">
							{rest.map((row, offset) => {
								const index = offset + 3;
								const name = displayName(row);
								const isMe = row.memberId === meId;
								const crossesCutoff =
									retainedAt !== null && row.totalPoints < retainedAt && rows[index - 1].totalPoints >= retainedAt;
								return (
									<li key={row.memberId}>
										{crossesCutoff ? (
											<p className="flex items-center justify-center gap-2 bg-secondary/40 py-1.5 text-xs font-semibold text-accent">
												<ArrowUp className="size-3.5" aria-hidden />
												Retained zone · {formatPoints(retainedAt)}+ points
												<ArrowUp className="size-3.5" aria-hidden />
											</p>
										) : null}
										<div className={cn("flex min-w-0 items-center gap-3 px-4 py-3", isMe && "bg-secondary/50")}>
											<span className="w-7 shrink-0 text-center font-heading text-lg tabular-nums text-muted-foreground">
												{ranks[index]}
											</span>
											<MemberAvatar initials={initialsFrom(name)} className={cn("size-8 text-xs", isMe && "ring-2 ring-accent")} />
											<div className="grid min-w-0 flex-1 gap-1">
												<span className="min-w-0 truncate text-sm font-medium">
													{name}
													{isMe ? <span className="ml-2 text-xs text-accent">You</span> : null}
												</span>
												<span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
													<span
														className="block h-full rounded-full bg-accent/60"
														style={{ width: `${Math.max(2, (row.totalPoints / leader) * 100)}%` }}
													/>
												</span>
											</div>
											<span className="shrink-0 font-heading text-lg tabular-nums">{formatPoints(row.totalPoints)}</span>
										</div>
									</li>
								);
							})}
						</ol>
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}
