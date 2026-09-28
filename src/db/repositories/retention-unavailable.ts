import type { RetentionRepository } from "./retention";

export function createUnavailableRetentionRepository(): RetentionRepository {
	const unavailable = () => {
		throw new Error("Retention records are not available through this repository adapter.");
	};
	return {
		listForMember: unavailable,
		getMemberTermSummary: unavailable,
		leaderboard: unavailable,
		publicLeaderboard: unavailable,
		listForTerm: unavailable,
		listMemberTermHistory: unavailable,
		listForEvent: unavailable,
		myHistory: unavailable,
		myPointsByDay: unavailable,
		listTerms: unavailable,
		listTermsAdmin: unavailable,
		upsertTerm: unavailable,
		async createManual() {
			throw new Error("Manual retention records are not available in shared mode.");
		},
	};
}
