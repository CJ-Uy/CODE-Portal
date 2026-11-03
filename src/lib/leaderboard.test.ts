import { describe, expect, it } from "vitest";
import { competitionRanks, shownThroughRank } from "./leaderboard";

describe("competitionRanks", () => {
	it("shares a rank between ties and skips past them", () => {
		expect(competitionRanks([10, 8, 8, 5])).toEqual([1, 2, 2, 4]);
	});
});

describe("shownThroughRank", () => {
	it("shows everyone when there are no more than ten", () => {
		expect(shownThroughRank(competitionRanks([5, 4, 3]), 10)).toBe(3);
	});

	it("stops at ten when the tenth place is not tied", () => {
		const ranks = competitionRanks([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
		expect(shownThroughRank(ranks, 10)).toBe(10);
	});

	it("finishes the rank shared at tenth place, then stops", () => {
		// Places 9 through 12 all tie on 3 points, so they are all shown; the 1-pointer is not.
		const ranks = competitionRanks([12, 11, 10, 9, 8, 7, 6, 5, 3, 3, 3, 3, 1]);
		expect(shownThroughRank(ranks, 10)).toBe(12);
	});
});
