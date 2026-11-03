/** Competition ranking: ties share a rank, and the next distinct score skips past them. */
export function competitionRanks(totals: number[]): number[] {
	return totals.map((value) => 1 + totals.filter((other) => other > value).length);
}

/** How many rows to list: the top `limit`, plus anyone tied with the last of them. `ranks` must be ascending. */
export function shownThroughRank(ranks: number[], limit: number): number {
	if (ranks.length <= limit) return ranks.length;
	const cutoff = ranks[limit - 1];
	return ranks.filter((rank) => rank <= cutoff).length;
}
