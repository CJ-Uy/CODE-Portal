"use client";

import { useActionState } from "react";
import { generateSummaryAction, type SummaryActionState } from "@/app/portal/admin/content/surveys/actions";
import { Button } from "@/components/ui/button";
import type { SummaryView } from "@/lib/feedback/results-view";
import { RESULTS_MIN_RESPONSES } from "@/lib/feedback/stats";

const PROSE = "min-w-0 [overflow-wrap:anywhere]";

/**
 * A quiet, collapsed list of machine-drafted themes. Nothing here runs the model until an admin presses the button, and
 * the panel is not rendered at all where there is no AI binding. `canDraft` is decided by the page (3 responses and a
 * comment), so a "couldn't draft" result below always means the model gave nothing reliable, never "not enough input".
 */
export function SummaryPanel({ surveyId, view, canDraft }: { surveyId: string; view: SummaryView | null; canDraft: boolean }) {
	const [state, formAction, pending] = useActionState<SummaryActionState, FormData>(generateSummaryAction, null);
	// A first draft, or a refresh once more people have answered.
	const offerButton = canDraft && (!view || view.stale);

	return (
		<details className="min-w-0 rounded-xl border border-border/60 bg-card p-5">
			<summary className="cursor-pointer text-base font-semibold text-primary">Summary of comments</summary>
			<div className="mt-4 grid min-w-0 gap-4">
				{view ? (
					<ul className="grid min-w-0 gap-4">
						{view.themes.map((theme, index) => (
							<li key={`${theme.label}-${index}`} className="grid min-w-0 gap-1.5 text-sm">
								<p className={`${PROSE} font-medium`}>{theme.label}</p>
								{theme.description ? <p className={PROSE}>{theme.description}</p> : null}
								<p className="text-xs text-muted-foreground">Raised in {theme.share} comments</p>
								{theme.quotes.map((quote, quoteIndex) => (
									<blockquote key={quoteIndex} className={`${PROSE} border-l-2 border-border pl-3 text-muted-foreground`}>
										&ldquo;{quote}&rdquo;
									</blockquote>
								))}
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						{canDraft ? "No summary yet." : `A summary needs at least ${RESULTS_MIN_RESPONSES} responses and some comments.`}
					</p>
				)}

				{view ? <p className="min-w-0 text-xs text-muted-foreground">{view.footnote}</p> : null}
				{view?.staleNote ? <p className="min-w-0 text-xs text-muted-foreground">{view.staleNote}</p> : null}

				{state?.status === "none" ? (
					<p role="status" className="min-w-0 text-sm text-muted-foreground">
						Couldn&apos;t draft a reliable summary.
					</p>
				) : null}
				{state?.status === "error" ? (
					<p role="alert" className="min-w-0 text-sm text-destructive">
						{state.message}
					</p>
				) : null}

				{offerButton ? (
					<form action={formAction}>
						<input type="hidden" name="surveyId" value={surveyId} />
						<Button type="submit" variant="outline" size="sm" disabled={pending}>
							{pending ? "Drafting..." : view ? "Regenerate" : "Draft a summary"}
						</Button>
					</form>
				) : null}
			</div>
		</details>
	);
}
