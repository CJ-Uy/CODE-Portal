import { Card, CardContent } from "@/components/ui/card";
import { describePoints } from "@/lib/leaderboard-stats";
import { formatPoints } from "@/lib/points";
import { cn } from "@/lib/utils";

const W = 320;
const H = 132;
const PLOT = 104; // bar area height; the rest holds the axis labels
const GAP = 2;

/** A bar with 4px rounded top corners, square at the baseline. */
function barPath(x: number, y: number, width: number, height: number) {
	const r = Math.min(4, width / 2, height);
	return `M${x},${PLOT} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${PLOT} Z`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
	return (
		<div className="min-w-0 bg-card px-3 py-2" title={hint}>
			<p className="font-heading text-lg tabular-nums">{value}</p>
			<p className="truncate text-[11px] text-muted-foreground">{label}</p>
		</div>
	);
}

/** Nerd stats under the leaderboard: how everyone's semester points are spread. */
export function PointsDistribution({ values, mine }: { values: number[]; mine: number | null }) {
	const stats = describePoints(values);
	if (!stats || stats.n < 3) return null;

	const top = stats.bins.at(-1)!.to;
	const tallest = Math.max(...stats.bins.map((bin) => bin.count));
	const slot = W / stats.bins.length;
	const xOf = (points: number) => (points / top) * W;
	const myBin = mine === null ? -1 : stats.bins.findIndex((bin, i) => mine >= bin.from && (mine < bin.to || i === stats.bins.length - 1));
	const withinOneSd = values.filter((value) => Math.abs(value - stats.mean) <= stats.sd).length;
	const peaks = stats.shape.peaks === 1 ? "One peak" : stats.shape.peaks === 2 ? "Two peaks (bimodal)" : `${stats.shape.peaks} peaks`;
	const tail =
		stats.shape.tail === "right"
			? "with a long tail of a few very active members"
			: stats.shape.tail === "left"
				? "with most members bunched near the top"
				: "and roughly symmetric";
	const ticks = [...new Set([0, Math.floor(stats.bins.length / 2), stats.bins.length])].map((i) => (i === stats.bins.length ? top : stats.bins[i].from));

	return (
		<Card>
			<CardContent className="grid gap-4 p-4">
				<div>
					<h2 className="font-heading text-lg">Nerd stats</h2>
					<p className="text-xs text-muted-foreground">How this semester&apos;s points are spread across the {stats.n} members on the board.</p>
				</div>

				<div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
					<Stat label="Std. deviation" value={stats.sd.toFixed(2)} hint="How far a typical member sits from the average." />
					<Stat label="Middle half (Q1 to Q3)" value={`${formatPoints(stats.q1)} to ${formatPoints(stats.q3)}`} hint="Half of everyone falls in this range." />
					<Stat label="Skewness" value={`${stats.skew > 0 ? "+" : ""}${stats.skew.toFixed(2)}`} hint="Positive: a few members are far ahead. Negative: most are near the top." />
					<Stat label="Range" value={`${formatPoints(stats.min)} to ${formatPoints(stats.max)}`} hint="Lowest and highest totals on the board." />
				</div>

				<figure className="grid gap-2">
					<svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label={`Histogram of points: ${peaks.toLowerCase()} ${tail}.`}>
						<line x1={0} y1={PLOT} x2={W} y2={PLOT} className="stroke-border" strokeWidth={1} />
						{stats.bins.map((bin, i) => {
							const height = bin.count === 0 ? 0 : Math.max(3, (bin.count / tallest) * (PLOT - 14));
							const x = i * slot + GAP / 2;
							const isMine = i === myBin;
							return (
								<g key={bin.from}>
									<title>{`${formatPoints(bin.from)} to ${formatPoints(bin.to)} points: ${bin.count} ${bin.count === 1 ? "member" : "members"}${isMine ? " (you)" : ""}`}</title>
									{/* Full-height hit area so thin or empty bins still show their tooltip. */}
									<rect x={i * slot} y={0} width={slot} height={PLOT} className="fill-transparent" />
									{height > 0 ? (
										<path d={barPath(x, PLOT - height, slot - GAP, height)} className={cn("transition-colors", isMine ? "fill-accent" : "fill-accent/45 hover:fill-accent/70")} />
									) : null}
									{isMine ? (
										<text x={x + (slot - GAP) / 2} y={PLOT - height - 4} textAnchor="middle" className="fill-foreground text-[9px] font-semibold">
											You
										</text>
									) : null}
								</g>
							);
						})}
						<line x1={xOf(stats.median)} y1={4} x2={xOf(stats.median)} y2={PLOT} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="3 3" />
						<text x={xOf(stats.median) + 3} y={10} className="fill-muted-foreground text-[9px]">
							median {formatPoints(stats.median)}
						</text>
						{ticks.map((tick) => (
							<text key={tick} x={xOf(tick)} y={PLOT + 14} textAnchor={tick === 0 ? "start" : tick === top ? "end" : "middle"} className="fill-muted-foreground text-[9px] tabular-nums">
								{formatPoints(tick)}
							</text>
						))}
					</svg>
					<figcaption className="text-sm">
						<span className="font-semibold">{peaks}</span> {tail}. {withinOneSd} of {stats.n} members ({Math.round((withinOneSd / stats.n) * 100)}%) are within one standard
						deviation of the average of {formatPoints(stats.mean)}.
					</figcaption>
					<table className="sr-only">
						<caption>Members per points range this semester</caption>
						<thead>
							<tr>
								<th scope="col">Points</th>
								<th scope="col">Members</th>
							</tr>
						</thead>
						<tbody>
							{stats.bins.map((bin) => (
								<tr key={bin.from}>
									<td>{`${formatPoints(bin.from)} to ${formatPoints(bin.to)}`}</td>
									<td>{bin.count}</td>
								</tr>
							))}
						</tbody>
					</table>
				</figure>
			</CardContent>
		</Card>
	);
}
