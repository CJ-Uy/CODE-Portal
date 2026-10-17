"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
import { setAnswerHiddenAction } from "@/app/portal/admin/content/surveys/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chipSteps, commentsLabel, filterAnswers, NAME_NOT_RECORDED } from "@/lib/feedback/results-view";
import { cn } from "@/lib/utils";

type Answer = { id: string; value: string; hidden: boolean };

// One class per chip size, smallest first. CHIP_STEPS in results-view says how many there are.
const CHIP_SIZES = ["text-xs", "text-sm", "text-base", "text-lg font-semibold"] as const;

const PROSE = "min-w-0 [overflow-wrap:anywhere]";

/**
 * The comments for one text question: a word cloud of chips, a search box, and the list. A chip filters to the comments
 * that contain that word and a second click clears it. The list keeps the order it was given, which is deliberately
 * unrelated to when anyone answered, so this never sorts it. `names` (CRS only) puts the writer above each comment.
 */
export function CommentsPanel({
	answers,
	terms,
	canModerate,
	names,
}: {
	answers: Answer[];
	terms: Array<{ term: string; count: number }>;
	canModerate: boolean;
	names?: Record<string, string | null>;
}) {
	const [term, setTerm] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	if (answers.length === 0) return <p className="text-sm text-muted-foreground">No answers yet.</p>;

	const shown = filterAnswers(answers, { term, query });
	const filtered = term !== null || query.trim() !== "";

	function toggleHidden(answer: Answer) {
		if (pending) return;
		setError(null);
		setPendingId(answer.id);
		const data = new FormData();
		data.set("answerId", answer.id);
		data.set("hidden", answer.hidden ? "0" : "1");
		startTransition(async () => {
			try {
				const result = await setAnswerHiddenAction(data);
				if (result) setError(result.error);
			} catch (error) {
				unstable_rethrow(error);
				setError("Couldn't reach the server. Try again.");
			}
			setPendingId(null);
		});
	}

	return (
		<div className="grid min-w-0 gap-4">
			{terms.length > 0 ? (
				<ul aria-label="Common words. Choose one to filter the comments." className="flex min-w-0 flex-wrap gap-2">
					{chipSteps(terms).map((chip) => (
						<li key={chip.term} className="min-w-0 max-w-full">
							<button
								type="button"
								aria-pressed={term === chip.term}
								aria-label={`${chip.term}, ${commentsLabel(chip.count)}`}
								title={commentsLabel(chip.count)}
								onClick={() => setTerm(term === chip.term ? null : chip.term)}
								className={cn(
									"min-h-8 max-w-full rounded-full border px-3 py-1 text-left leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]",
									CHIP_SIZES[chip.step],
									term === chip.term
										? "border-primary bg-primary text-primary-foreground"
										: "border-border bg-secondary text-secondary-foreground hover:bg-secondary/70",
								)}
							>
								{chip.term}
							</button>
						</li>
					))}
				</ul>
			) : null}

			<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
				<Input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search comments"
					aria-label="Search comments"
					className="min-w-0 sm:max-w-xs"
				/>
				{filtered ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => {
							setTerm(null);
							setQuery("");
						}}
					>
						Clear filters
					</Button>
				) : null}
			</div>

			<p aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
				{filtered ? `Showing ${shown.length} of ${commentsLabel(answers.length)}` : commentsLabel(answers.length)}
				{term ? ` containing "${term}"` : ""}
			</p>

			{error ? (
				<p role="alert" className="min-w-0 text-sm text-destructive">
					{error}
				</p>
			) : null}

			{shown.length === 0 ? (
				<p className="text-sm text-muted-foreground">No comments match.</p>
			) : (
				<ul className="grid min-w-0 gap-2">
					{shown.map((answer) => (
						<li key={answer.id} className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-background p-3">
							<div className="grid min-w-0 basis-56 flex-1 gap-1">
								{names ? <p className={cn(PROSE, "text-xs font-medium text-muted-foreground")}>{names[answer.id] ?? NAME_NOT_RECORDED}</p> : null}
								<p className={cn(PROSE, "whitespace-pre-line text-sm", answer.hidden && "text-muted-foreground")}>{answer.value}</p>
							</div>
							{canModerate ? (
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									{answer.hidden ? <Badge variant="warn">Hidden from organizers</Badge> : null}
									<Button type="button" variant="quiet" size="sm" disabled={pending} onClick={() => toggleHidden(answer)}>
										{pendingId === answer.id ? "Saving..." : answer.hidden ? "Show to organizers" : "Hide from organizers"}
									</Button>
								</div>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
