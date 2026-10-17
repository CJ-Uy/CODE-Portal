import type { ResultsQuestion, SurveyResults } from "@/db/types";
import { formatUtc8DateTime } from "@/lib/date-slots";
import { RESULTS_MIN_RESPONSES } from "@/lib/feedback/stats";
import type { SummaryTheme } from "@/lib/feedback/summary";
import { tokens } from "@/lib/feedback/words";

// Pure helpers behind the results view. Client-safe: nothing here reads the database or the environment.

export const BELOW_THRESHOLD_NOTE = `Results appear at ${RESULTS_MIN_RESPONSES} responses to protect anonymity.`;
export const LOW_RESPONSE_NOTE = "Low response rate. Read these as a rough signal.";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const responsesLabel = (count: number) => plural(count, "response");
export const walkInsLabel = (count: number) => plural(count, "walk-in");
export const commentsLabel = (count: number) => plural(count, "comment");

const formatDay = (date: Date) => new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", dateStyle: "medium" }).format(date);

/** "6 of 24 invited (25%)", or null when nobody was invited (every response is a walk-in). */
export function invitedLine(responded: number, invited: number): string | null {
	if (invited <= 0) return null;
	return `${responded} of ${invited} invited (${Math.round((responded / invited) * 100)}%)`;
}

/**
 * The invited-only view is offered only when it can't be used to pick out walk-ins. Comparing it with the full view
 * would otherwise isolate the answers of 1 or 2 walk-in respondents, so it needs none, or enough to hide among.
 */
export function canFilterInvited(walkInCount: number): boolean {
	return walkInCount === 0 || walkInCount >= RESULTS_MIN_RESPONSES;
}

/** Under 30%. Compared as whole numbers so 6 of 20 is exactly 30% and gets no caution. */
export function isLowResponseRate(responded: number, invited: number): boolean {
	return invited > 0 && responded * 10 < invited * 3;
}

/** "Open until ...", "Closed ...", or "Closed early" for a form closed by hand before its closing time. */
export function closingLine(results: Pick<SurveyResults, "status" | "closesAt">, now: Date): string | null {
	const { status, closesAt } = results;
	if (status === "draft") return null;
	if (status === "running") return closesAt ? `Open until ${formatUtc8DateTime(closesAt)}` : "Open";
	if (!closesAt) return "Closed";
	return closesAt <= now ? `Closed ${formatUtc8DateTime(closesAt)}` : "Closed early";
}

export function segmentLabel(value: number, count: number): string {
	return `${value}: ${responsesLabel(count)}`;
}

export function percentOf(count: number, total: number): number {
	return total > 0 ? Math.round((count / total) * 100) : 0;
}

/** Event types are admin-managed keys such as "official" or "alumni_night". */
export function baselineLine(eventType: string | null, baseline: { mean: number; events: number } | null): string | null {
	if (!eventType || !baseline) return null;
	const label = eventType.replace(/[_-]+/g, " ").trim();
	if (!label) return null;
	return `${label.charAt(0).toUpperCase()}${label.slice(1)} events average ${baseline.mean.toFixed(1)} (${baseline.events} past events)`;
}

/** Word chips come in this many sizes. */
export const CHIP_STEPS = 4;

/** Sizes each term from 0 to CHIP_STEPS - 1 by where its count falls between the smallest and largest. All equal counts share the second size. */
export function chipSteps(terms: Array<{ term: string; count: number }>): Array<{ term: string; count: number; step: number }> {
	if (terms.length === 0) return [];
	const counts = terms.map((entry) => entry.count);
	const min = Math.min(...counts);
	const max = Math.max(...counts);
	return terms.map((entry) => ({
		...entry,
		step: max === min ? 1 : Math.min(CHIP_STEPS - 1, Math.floor(((entry.count - min) / (max - min)) * CHIP_STEPS)),
	}));
}

/** Keeps the given order. `term` matches whole tokens (as the cloud counted them); `query` is a case-insensitive substring. */
export function filterAnswers<T extends { value: string }>(answers: T[], filter: { term: string | null; query: string }): T[] {
	const needle = filter.query.trim().toLowerCase();
	if (!filter.term && !needle) return answers;
	return answers.filter(
		(answer) => (!filter.term || tokens(answer.value).has(filter.term)) && (!needle || answer.value.toLowerCase().includes(needle)),
	);
}

export function countComments(questions: ResultsQuestion[]): number {
	let total = 0;
	for (const question of questions) {
		if (question.kind === "text") total += question.answers.filter((answer) => answer.value.trim()).length;
	}
	return total;
}

/**
 * Whether the model can be asked at all. Mirrors generateSummary, which returns null without calling the model under the
 * anonymity floor or with no comments; the panel decides here so a null result reads as "unreliable", never "not eligible".
 * Pass the unfiltered results: the summary covers every response.
 */
export function canDraftSummary(results: Pick<SurveyResults, "responseCount" | "questions">): boolean {
	return results.responseCount >= RESULTS_MIN_RESPONSES && countComments(results.questions) > 0;
}

export type SummaryView = {
	themes: SummaryTheme[];
	footnote: string;
	/** "Drafted from A of B comments", only when there are more comments now than when it was drafted. */
	staleNote: string | null;
	/** Responses have grown since the draft, so Regenerate is offered. */
	stale: boolean;
};

const SHARES: ReadonlySet<string> = new Set(["most", "several", "a few"]);
const wholeNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

/**
 * Turns the stored summary into what the panel prints. The stored JSON is parsed upstream and can be missing fields
 * or be from an older shape, so every field is checked here and a malformed theme is skipped rather than crashing the page.
 */
export function summaryView(raw: unknown, responseCount: number, commentCount: number): SummaryView | null {
	if (!raw || typeof raw !== "object") return null;
	const stored = raw as Record<string, unknown>;

	const themes: SummaryTheme[] = [];
	for (const entry of Array.isArray(stored.themes) ? stored.themes : []) {
		if (!entry || typeof entry !== "object") continue;
		const theme = entry as Record<string, unknown>;
		const label = typeof theme.label === "string" ? theme.label.trim() : "";
		if (!label) continue;
		const share = typeof theme.share === "string" ? theme.share.trim().toLowerCase() : "";
		themes.push({
			label,
			description: typeof theme.description === "string" ? theme.description.trim() : "",
			share: SHARES.has(share) ? (share as SummaryTheme["share"]) : "several",
			quotes: Array.isArray(theme.quotes) ? theme.quotes.filter((quote): quote is string => typeof quote === "string" && quote.trim() !== "") : [],
		});
	}
	if (themes.length === 0) return null;

	const used = wholeNumber(stored.usedComments);
	const total = Math.max(used, wholeNumber(stored.totalComments));
	const generatedAt = stored.generatedAt instanceof Date && !Number.isNaN(stored.generatedAt.getTime()) ? stored.generatedAt : null;
	const when = generatedAt ? ` on ${formatDay(generatedAt)}` : "";
	const sample = used < total ? ` Based on an even sample of ${used} of ${total} comments.` : "";
	const stale = responseCount > wholeNumber(stored.responseCountAtGeneration);

	return {
		themes,
		footnote: `Machine-drafted from ${commentsLabel(used)}${when}.${sample} Read the comments before acting on it.`,
		staleNote: stale && total < commentCount ? `Drafted from ${total} of ${commentCount} comments` : null,
		stale,
	};
}
