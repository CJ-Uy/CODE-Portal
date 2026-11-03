import { quantizePoints } from "./points";

export type PointsBin = { from: number; to: number; count: number };
export type PointsStats = {
	n: number;
	mean: number;
	median: number;
	/** Sample standard deviation (n - 1). */
	sd: number;
	min: number;
	max: number;
	q1: number;
	q3: number;
	/** Adjusted Fisher-Pearson skewness; positive means a long tail of high scorers. */
	skew: number;
	bins: PointsBin[];
	shape: { peaks: number; tail: "right" | "left" | "none" };
};

/** Linear-interpolated quantile of a sorted list (the same rule spreadsheets use). */
function quantile(sorted: number[], p: number): number {
	const at = (sorted.length - 1) * p;
	const low = Math.floor(at);
	const high = Math.ceil(at);
	return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

// Points come in quarter steps, so bin widths stay on friendly values.
const NICE_WIDTHS = [0.25, 0.5, 1, 2, 5, 10, 20, 50];

/** The fun-stats summary under the leaderboard: spread, shape and a histogram of everyone's semester points. */
export function describePoints(values: number[]): PointsStats | null {
	const n = values.length;
	if (n === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
	const squares = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0);
	const sd = n > 1 ? Math.sqrt(squares / (n - 1)) : 0;
	const m2 = squares / n;
	const m3 = sorted.reduce((sum, value) => sum + (value - mean) ** 3, 0) / n;
	const skew = n > 2 && m2 > 0 ? (Math.sqrt(n * (n - 1)) / (n - 2)) * (m3 / m2 ** 1.5) : 0;

	// Sturges' rule for the bin count, then the nearest friendly width at or above it.
	const max = sorted[n - 1];
	const target = Math.max(max, 0.25) / (Math.ceil(Math.log2(n)) + 1);
	const width = NICE_WIDTHS.find((step) => step >= target) ?? NICE_WIDTHS.at(-1)!;
	const count = Math.floor(max / width) + 1;
	const bins: PointsBin[] = Array.from({ length: count }, (_, i) => ({ from: quantizePoints(i * width), to: quantizePoints((i + 1) * width), count: 0 }));
	for (const value of sorted) bins[Math.min(count - 1, Math.floor(value / width))].count += 1;

	// A peak is a bin taller than both neighbours (plateaus count once) and at least a fifth of the tallest bin.
	const tallest = Math.max(...bins.map((bin) => bin.count));
	let peaks = 0;
	for (let i = 0; i < bins.length; i++) {
		const here = bins[i].count;
		if (here < Math.max(2, tallest / 5)) continue;
		let j = i;
		while (j + 1 < bins.length && bins[j + 1].count === here) j++;
		const left = i === 0 ? -1 : bins[i - 1].count;
		const right = j === bins.length - 1 ? -1 : bins[j + 1].count;
		if (here > left && here > right) peaks++;
		i = j;
	}

	return {
		n,
		mean: quantizePoints(mean),
		median: quantizePoints(quantile(sorted, 0.5)),
		sd: Math.round(sd * 1000) / 1000,
		min: sorted[0],
		max,
		q1: quantizePoints(quantile(sorted, 0.25)),
		q3: quantizePoints(quantile(sorted, 0.75)),
		skew: Math.round(skew * 100) / 100,
		bins,
		shape: { peaks: Math.max(1, peaks), tail: skew > 0.5 ? "right" : skew < -0.5 ? "left" : "none" },
	};
}
