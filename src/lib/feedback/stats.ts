export type ScaleSummary = {
	n: number;
	counts: [number, number, number, number, number];
	mean: number | null;
	topTwoPct: number | null;
};

export const EXPECTED_RESPONSE_RATE = 0.6;
export const RESULTS_MIN_RESPONSES = 3;
export const COMPARE_MIN_RESPONSES = 5;
export const COMPARE_MIN_EVENTS = 3;

const HOUR_MS = 3_600_000;

/** Ignores anything that is not an integer from 1 to 5. */
export function scaleSummary(values: number[]): ScaleSummary {
	const counts: ScaleSummary["counts"] = [0, 0, 0, 0, 0];
	let n = 0;
	let sum = 0;
	for (const v of values) {
		if (!Number.isInteger(v) || v < 1 || v > 5) continue;
		counts[v - 1]++;
		n++;
		sum += v;
	}
	if (n === 0) return { n, counts, mean: null, topTwoPct: null };
	return {
		n,
		counts,
		mean: Math.round((sum / n) * 10) / 10,
		topTwoPct: Math.round(((counts[3] + counts[4]) / n) * 100),
	};
}

/** Finite-population sample size (margin 0.3, SD 1, z 1.96), inflated for the expected response rate. */
export function suggestInviteCount(eligible: number): number {
	if (eligible <= 0) return 0;
	const n0 = ((1.96 * 1.0) / 0.3) ** 2;
	const n = n0 / (1 + (n0 - 1) / eligible);
	return Math.min(eligible, Math.ceil(n / EXPECTED_RESPONSE_RATE));
}

const SECONDS_PER_QUESTION = { scale: 7, choice: 10, text: 45 } as const;

export function estimateSeconds(questions: Array<{ type: "scale" | "text" | "choice" }>): number {
	return questions.reduce((total, q) => total + SECONDS_PER_QUESTION[q.type], 0);
}

export function defaultClosesAt(startsAt: Date, endsAt: Date | null): Date {
	return new Date((endsAt ?? startsAt).getTime() + 72 * HOUR_MS);
}

export function reminderAtFor(closesAt: Date, sentAt: Date): Date | null {
	const at = new Date(closesAt.getTime() - 24 * HOUR_MS);
	return at.getTime() - sentAt.getTime() > HOUR_MS ? at : null;
}

type Status = "draft" | "running" | "closed";

export function effectiveStatus(
	survey: { status: Status; closesAt: Date | null },
	now: Date,
): Status {
	if (survey.status === "running" && survey.closesAt && survey.closesAt <= now) return "closed";
	return survey.status;
}
