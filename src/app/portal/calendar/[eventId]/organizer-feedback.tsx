import { DebriefForm } from "@/components/feedback/debrief-form";
import { ResultsList } from "@/components/feedback/results";
import type { OrganizerResults } from "@/db/repositories/survey-results";
import type { DebriefView } from "@/lib/feedback/debrief-input";
import { organizerNote } from "@/lib/feedback/organizer-view";

const NOTE = "min-w-0 rounded-lg border border-border bg-secondary p-3 text-sm text-secondary-foreground [overflow-wrap:anywhere]";

function FeedbackBody({ feedback }: { feedback: OrganizerResults | null }) {
	if (feedback && feedback.state !== "ready") return <p className={NOTE}>{organizerNote(feedback.state)}</p>;
	if (feedback?.results) return <ResultsList results={feedback.results} mode="organizer" />;
	return <p className={NOTE}>Feedback couldn&apos;t be loaded. Try again in a moment.</p>;
}

/**
 * What an event's owner and staff admins see on the member event page: how the event went (once CRS shares it) and the
 * debrief. `feedback` is null when it could not be loaded; `debrief` is null then too, and the form is not shown, so a
 * failed read can never lead to saving blanks over a debrief that exists.
 *
 * Organizers get the results without the invited-only filter, the AI summary and the hide controls. The repository has
 * already dropped hidden comments from what it returns, and `mode="organizer"` keeps the controls off.
 */
export function OrganizerFeedback({
	eventId,
	feedback,
	debrief,
}: {
	eventId: string;
	feedback: OrganizerResults | null;
	debrief: DebriefView | null;
}) {
	return (
		<div className="grid min-w-0 gap-6">
			<section aria-labelledby="organizer-feedback" className="grid min-w-0 gap-4">
				<h2 id="organizer-feedback" className="font-heading text-2xl font-semibold text-foreground">
					Feedback
				</h2>
				<FeedbackBody feedback={feedback} />
			</section>

			<section aria-labelledby="event-debrief" className="grid min-w-0 gap-4 rounded-xl border border-border/60 bg-card p-5">
				<h2 id="event-debrief" className="font-heading text-2xl font-semibold text-foreground">
					Debrief
				</h2>
				{debrief ? (
					<DebriefForm eventId={eventId} fields={debrief.fields} lastEdited={debrief.lastEdited} />
				) : (
					<p className={NOTE}>The debrief couldn&apos;t be loaded. Try again in a moment.</p>
				)}
			</section>
		</div>
	);
}
