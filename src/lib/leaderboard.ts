/** Competition ranking: ties share a rank, and the next distinct score skips past them. */
export function competitionRanks(totals: number[]): number[] {
	return totals.map((value) => 1 + totals.filter((other) => other > value).length);
}
