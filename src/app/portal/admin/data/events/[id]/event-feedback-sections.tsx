import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DebriefForm } from "@/components/feedback/debrief-form";
import { ResultsHeader, ScaleResult } from "@/components/feedback/results";
import { StartFormCards, type TemplateCard } from "@/components/feedback/start-form-cards";
import type { getRepositories } from "@/db";
import type { SurveyResults } from "@/db/types";
import { debriefView, type DebriefView } from "@/lib/feedback/debrief-input";
import { formatEstimate, metricLabel } from "@/lib/feedback/editor-input";
import { trackedScaleQuestions } from "@/lib/feedback/organizer-view";
import { BELOW_THRESHOLD_NOTE } from "@/lib/feedback/results-view";
import { errorLabel } from "@/lib/feedback/safe-log";
import { estimateSeconds } from "@/lib/feedback/stats";
import type { requireActor } from "@/server/auth/actor";
import { sectionTitle } from "../../shared";

const NOTE = "min-w-0 rounded-lg border border-border bg-secondary p-3 text-sm text-secondary-foreground [overflow-wrap:anywhere]";
const SURVEYS_PATH = "/portal/admin/content/surveys";

export type EventFeedbackLoad = {
	feedback:
		| { stage: "none"; templates: TemplateCard[] }
		| { stage: "draft"; surveyId: string }
		| { stage: "sent"; surveyId: string; results: SurveyResults }
		| { stage: "unavailable" };
	// null when the debrief could not be read: the form is not shown then, so blanks can't be saved over a real one.
	debrief: DebriefView | null;
};

/**
 * Everything the Feedback and Debrief sections need, read in one go. Each half degrades on its own: a failed read is
 * logged by error type only (the text of a failed query can quote comments) and shown as a notice.
 */
export async function loadEventFeedback(
	repositories: Awaited<ReturnType<typeof getRepositories>>,
	actor: Awaited<ReturnType<typeof requireActor>>,
	eventId: string,
): Promise<EventFeedbackLoad> {
	const failed = (what: string) => (error: unknown) => {
		console.error(`Could not load the event ${what}.`, { eventId, error: errorLabel(error) });
		return null;
	};

	const loadFeedback = async (): Promise<EventFeedbackLoad["feedback"]> => {
		try {
			const survey = await repositories.surveys.getForEvent(actor, eventId);
			if (!survey) {
				const templates = await repositories.surveys.listTemplates(actor);
				return {
					stage: "none",
					templates: templates.map((template) => ({
						id: template.id,
						name: template.name,
						questionCount: template.questionsJson.length,
						estimate: formatEstimate(estimateSeconds(template.questionsJson)),
					})),
				};
			}
			if (survey.status === "draft") return { stage: "draft", surveyId: survey.id };
			return { stage: "sent", surveyId: survey.id, results: await repositories.surveyResults.getResults(actor, survey.id, { filter: "all" }) };
		} catch (error) {
			failed("feedback")(error);
			return { stage: "unavailable" };
		}
	};

	const [feedback, debrief] = await Promise.all([
		loadFeedback(),
		repositories.eventDebriefs
			.get(actor, eventId)
			.then((row) => debriefView(row))
			.catch(failed("debrief")),
	]);
	return { feedback, debrief };
}

function FeedbackBody({ eventId, feedback }: { eventId: string; feedback: EventFeedbackLoad["feedback"] }) {
	switch (feedback.stage) {
		case "unavailable":
			return <p className={NOTE}>Feedback couldn&apos;t be loaded. Try again in a moment.</p>;

		case "none":
			return (
				<div className="grid min-w-0 gap-3">
					<p className="min-w-0 text-sm text-muted-foreground">No feedback form yet. Start one from a template.</p>
					<StartFormCards eventId={eventId} templates={feedback.templates} />
				</div>
			);

		case "draft":
			return (
				<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
					<p className="min-w-0 text-sm text-muted-foreground">A draft form is waiting to be sent.</p>
					<Button asChild size="sm">
						<Link href={`${SURVEYS_PATH}/${encodeURIComponent(feedback.surveyId)}`}>Finish and send</Link>
					</Button>
				</div>
			);

		case "sent": {
			const { results } = feedback;
			const tracked = trackedScaleQuestions(results.questions);
			return (
				<div className="grid min-w-0 gap-4">
					<div className="flex flex-wrap items-center gap-3">
						<Badge variant="outline">{results.status}</Badge>
						<Button asChild variant="outline" size="sm">
							<Link href={`${SURVEYS_PATH}/${encodeURIComponent(feedback.surveyId)}`}>Full results</Link>
						</Button>
					</div>
					<ResultsHeader results={results} />
					{results.belowThreshold ? (
						<p className={NOTE}>{BELOW_THRESHOLD_NOTE}</p>
					) : tracked.length === 0 ? (
						<p className="min-w-0 text-sm text-muted-foreground">This form has no tracked questions. Open the full results for the answers.</p>
					) : (
						<ul className="grid min-w-0 gap-4 lg:grid-cols-2">
							{tracked.map((question) => (
								<li key={question.questionId} className="grid min-w-0 content-start gap-3 rounded-xl border border-border/60 bg-background p-4">
									<div className="grid min-w-0 gap-0.5">
										<h3 className="text-base font-semibold text-primary">{metricLabel(question.metricKey)}</h3>
										<p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">{question.prompt}</p>
									</div>
									<ScaleResult question={question} eventType={results.eventType} />
								</li>
							))}
						</ul>
					)}
				</div>
			);
		}
	}
}

/** The Feedback and Debrief sections of the event archive detail. Only rendered for survey:configure holders. */
export function EventFeedbackSections({ eventId, load }: { eventId: string; load: EventFeedbackLoad }) {
	return (
		<>
			<section aria-label="Feedback" className="grid min-w-0 gap-3">
				{sectionTitle("Feedback")}
				<Card>
					<CardContent className="p-4">
						<FeedbackBody eventId={eventId} feedback={load.feedback} />
					</CardContent>
				</Card>
			</section>

			<section aria-label="Debrief" className="grid min-w-0 gap-3">
				{sectionTitle("Debrief")}
				<Card>
					<CardContent className="p-4">
						{load.debrief ? (
							<DebriefForm eventId={eventId} fields={load.debrief.fields} lastEdited={load.debrief.lastEdited} />
						) : (
							<p className={NOTE}>The debrief couldn&apos;t be loaded. Try again in a moment.</p>
						)}
					</CardContent>
				</Card>
			</section>
		</>
	);
}
