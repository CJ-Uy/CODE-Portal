import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { ResultsQuestion, ResultsRespondents, SurveyResults } from "@/db/types";
import {
	BELOW_THRESHOLD_NOTE,
	baselineLine,
	closingLine,
	invitedLine,
	isLowResponseRate,
	LOW_RESPONSE_NOTE,
	percentOf,
	respondentRow,
	responsesLabel,
	segmentLabel,
	walkInsLabel,
} from "@/lib/feedback/results-view";
import { CommentsPanel } from "./comments-panel";

type ScaleQuestion = Extract<ResultsQuestion, { kind: "scale" }>;
type ChoiceQuestion = Extract<ResultsQuestion, { kind: "choice" }>;

// Long words in prompts, comments and event titles wrap anywhere, so a pasted URL cannot widen the page.
const PROSE = "min-w-0 [overflow-wrap:anywhere]";

const ratingColor = (value: number) => `var(--rating-${value})`;

/** The strip above the questions. Rates are always printed next to the response count they come from. */
export function ResultsHeader({ results }: { results: SurveyResults }) {
	const invited = invitedLine(results.invitedResponded, results.invitedCount);
	const closing = closingLine(results, new Date());
	return (
		<section aria-label="Responses" className="grid min-w-0 gap-3 rounded-xl border border-border/60 bg-card p-4">
			<ul className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
				<li className="text-lg font-semibold tabular-nums text-primary">{responsesLabel(results.responseCount)}</li>
				{invited ? <li className="text-sm tabular-nums">{invited}</li> : null}
				<li className="text-sm tabular-nums">{walkInsLabel(results.walkInCount)}</li>
				{closing ? <li className="text-sm text-muted-foreground">{closing}</li> : null}
			</ul>
			{isLowResponseRate(results.invitedResponded, results.invitedCount) ? (
				<p className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
					<TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span className="min-w-0">{LOW_RESPONSE_NOTE}</span>
				</p>
			) : null}
		</section>
	);
}

/**
 * A 100% stacked bar of the 1-5 answers, left to right, warm to cool. Segments are separated by a 2px gap in the card colour
 * and carry no inline numbers: the legend under the bar has them, so nothing is ever clipped by its own mark.
 */
export function ScaleResult({ question, eventType }: { question: ScaleQuestion; eventType: string | null }) {
	const { summary, labels } = question;
	const baseline = baselineLine(eventType, question.baseline);
	if (summary.n === 0) return <p className="text-sm text-muted-foreground">No answers yet.</p>;

	return (
		<div className="grid min-w-0 gap-3">
			<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
				<p className="font-heading text-4xl leading-none tabular-nums text-primary">
					{summary.topTwoPct ?? 0}
					<span className="text-2xl">%</span>
				</p>
				<p className="text-sm text-muted-foreground">rated 4 or 5</p>
				<p className="text-sm tabular-nums text-muted-foreground">
					Mean {summary.mean?.toFixed(1) ?? "-"} &middot; n {summary.n}
				</p>
			</div>

			<div role="group" aria-label="Share of each rating" className="flex h-5 gap-0.5 overflow-hidden rounded">
				{summary.counts.map((count, index) =>
					count > 0 ? (
						<div
							key={index}
							role="img"
							aria-label={segmentLabel(index + 1, count)}
							title={segmentLabel(index + 1, count)}
							style={{ flex: `${count} 1 0%`, backgroundColor: ratingColor(index + 1) }}
						/>
					) : null,
				)}
			</div>

			{/* The same numbers as the segments, in text, so colour is never the only way to read the bar. */}
			<ul aria-hidden="true" className="grid grid-cols-5 gap-1 text-xs tabular-nums text-muted-foreground">
				{summary.counts.map((count, index) => (
					<li key={index} className="grid min-w-0 gap-0.5">
						<span className="flex items-center gap-1">
							<span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: ratingColor(index + 1) }} />
							<span className="font-medium text-foreground">{index + 1}</span>
						</span>
						<span>{count}</span>
						<span>{percentOf(count, summary.n)}%</span>
					</li>
				))}
			</ul>

			{labels[0] || labels[1] ? (
				<p className="flex min-w-0 justify-between gap-4 text-xs text-muted-foreground">
					<span className={PROSE}>1 = {labels[0]}</span>
					<span className={`${PROSE} text-right`}>5 = {labels[1]}</span>
				</p>
			) : null}

			{baseline ? <p className="text-sm text-muted-foreground tabular-nums">{baseline}</p> : null}
		</div>
	);
}

/** One bar per choice, with the count and its share of the people who answered. */
export function ChoiceResult({ question }: { question: ChoiceQuestion }) {
	if (question.n === 0) return <p className="text-sm text-muted-foreground">No answers yet.</p>;
	// An answer outside the listed options (the options were edited after sending) still counts.
	const labels = [...new Set([...question.options, ...Object.keys(question.counts)])];
	return (
		<ul className="grid min-w-0 gap-3">
			{labels.map((option) => {
				const count = question.counts[option] ?? 0;
				return (
					<li key={option} className="grid min-w-0 gap-1">
						<div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
							<span className={PROSE}>{option}</span>
							<span className="shrink-0 tabular-nums text-muted-foreground">
								{count} &middot; {percentOf(count, question.n)}%
							</span>
						</div>
						<div role="img" aria-label={`${option}: ${responsesLabel(count)}`} className="h-2.5 overflow-hidden rounded bg-muted">
							<div className="h-full rounded bg-accent" style={{ width: `${(count / question.n) * 100}%` }} />
						</div>
					</li>
				);
			})}
		</ul>
	);
}

function QuestionCard({ prompt, help, children }: { prompt: string; help?: string | null; children: ReactNode }) {
	return (
		<section className="grid min-w-0 gap-3 rounded-xl border border-border/60 bg-card p-5">
			<div className="grid min-w-0 gap-1">
				<h2 className={`${PROSE} text-lg font-semibold text-primary`}>{prompt}</h2>
				{help ? <p className={`${PROSE} text-sm text-muted-foreground`}>{help}</p> : null}
			</div>
			{children}
		</section>
	);
}

/** CRS only: who answered, newest first, folded away until asked for. */
export function RespondentList({ respondents }: { respondents: ResultsRespondents["respondents"] }) {
	if (respondents.length === 0) return null;
	return (
		<details className="min-w-0 rounded-xl border border-border/60 bg-card p-4">
			<summary className="cursor-pointer text-sm font-semibold text-primary">Who responded ({respondents.length})</summary>
			<ul className="mt-3 grid min-w-0 gap-1.5 text-sm">
				{respondents.map((respondent, index) => {
					const row = respondentRow(respondent);
					return (
						<li key={index} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
							<span className={`${PROSE} ${respondent.name ? "font-medium" : "text-muted-foreground"}`}>{row.name}</span>
							<span className="shrink-0 text-xs tabular-nums text-muted-foreground">{row.when}</span>
						</li>
					);
				})}
			</ul>
		</details>
	);
}

/**
 * The whole results view. `mode` is who is looking: admins (CRS) see who answered and can hide comments from organizers.
 * Organizers get results without names, and the repository has already dropped hidden comments from what they get.
 */
export function ResultsList(props: { results: SurveyResults & ResultsRespondents; mode: "admin" } | { results: SurveyResults; mode: "organizer" }) {
	const { results, mode } = props;
	const names = props.mode === "admin" ? props.results : null;
	return (
		<div className="grid min-w-0 gap-5">
			<ResultsHeader results={results} />
			{names ? <RespondentList respondents={names.respondents} /> : null}
			{results.belowThreshold ? (
				<p className="min-w-0 rounded-lg border border-border bg-secondary p-3 text-sm text-secondary-foreground">{BELOW_THRESHOLD_NOTE}</p>
			) : (
				results.questions.map((question) => (
					<QuestionCard key={question.questionId} prompt={question.prompt} help={question.kind === "scale" ? question.help : null}>
						{question.kind === "scale" ? (
							<ScaleResult question={question} eventType={results.eventType} />
						) : question.kind === "choice" ? (
							<ChoiceResult question={question} />
						) : (
							<CommentsPanel answers={question.answers} terms={question.terms} canModerate={mode === "admin"} names={names?.answerNames} />
						)}
					</QuestionCard>
				))
			)}
		</div>
	);
}
