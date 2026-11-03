import { describe, expect, it } from "vitest";
import { competitionRanks } from "./leaderboard";

describe("competitionRanks", () => {
	it("shares a rank between ties and skips past them", () => {
		expect(competitionRanks([10, 8, 8, 5])).toEqual([1, 2, 2, 4]);
	});
});
