import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { getRepositories } from "@/db";
import type { ResultsFilter } from "@/db/repositories/survey-results";
import type { SurveyQuestion, SurveyQuestionInput } from "@/db/types";
import { Download } from "lucide-react";
import { FormStatusBadge, ResultsList } from "@/components/feedback/results";
import { Button } from "@/components/ui/button";
import { SummaryPanel } from "@/components/feedback/summary-panel";
import { toLocalInput } from "@/lib/date-slots";
import { formatEstimate } from "@/lib/feedback/editor-input";
import { parseOptions } from "@/lib/feedback/form";
import { canDraftSummary, canFilterInvited, countComments, summaryView } from "@/lib/feedback/results-view";
import { errorLabel } from "@/lib/feedback/safe-log";
import { sendDefaultClosesAt } from "@/lib/feedback/send-input";
import { effectiveStatus, estimateSeconds, suggestInviteCount } from "@/lib/feedback/stats";
import { FEEDBACK_POINT_TYPE_ID } from "@/lib/point-types";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { emailDbFromEnv } from "@/server/email/db";
import { isFeatureEnabled } from "@/server/features";
import { getSummarizer } from "@/server/feedback/ai";
import { feedbackEmailReady } from "@/server/feedback/email";
import { DraftWorkspace } from "./draft-workspace";
import { RunningControls } from "./running-controls";
import { ShareToggle } from "./share-toggle";

export const dynamic = "force-dynamic";

// Only these `?notice=` values print anything. The text says what already happened: the send itself went through.
const NOTICES: Record<string, string> = {
	no_sender: "Sent. Members have their notice in the portal, but no email went out because the Feedback requests category has no default sender.",
	email_failed: "Sent. Members have their notice in the portal, but the email invites could not be queued.",
};

function toEditorQuestion(question: SurveyQuestion): SurveyQuestionInput {
	return {
		type: question.type,
		prompt: question.prompt,
		required: question.required,
		help: question.help ?? undefined,
		metricKey: question.metricKey ?? undefined,
		options: question.type === "text" ? undefined : parseOptions(question.optionsJson),
	};
}

async function emailOption(): Promise<"off" | "no_sender" | "ready"> {
	if (!isFeatureEnabled("email")) return "off";
	try {
		return (await feedbackEmailReady(emailDbFromEnv())) ? "ready" : "no_sender";
	} catch (error) {
		console.error("Could not check the feedback email sender.", error);
		return "no_sender";
	}
}

// A pill in the filter row. The current one is marked for assistive tech as well as by colour.
function FilterLink({ href, current, children }: { href: string; current: boolean; children: string }) {
	return (
		<Link
			href={href}
			aria-current={current ? "page" : undefined}
			className={
				current
					? "rounded-full border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
					: "rounded-full border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/70"
			}
		>
			{children}
		</Link>
	);
}

export default async function AdminSurveyDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ notice?: string; filter?: string }>;
}) {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("surveys")) notFound();

	const actor = await getActor();
	if (!actor) redirect(await signInPath());
	if (!can(actor, "survey:configure")) redirect("/portal");

	const [{ id }, { notice, filter }] = await Promise.all([params, searchParams]);
	const repositories = await getRepositories();
	// Errors are logged by type only: the text of a failed query or parse can quote comments. A form that can't be read
	// degrades to not-found (surveys has no shared-dev internal proxy yet) rather than crashing the page.
	const detail = await repositories.surveys.getById(actor, id).catch((error: unknown) => {
		console.error("Could not load the survey.", { surveyId: id, error: errorLabel(error) });
		return null;
	});
	if (!detail) notFound();
	const isDraft = detail.survey.status === "draft";
	const event = detail.survey.eventId
		? await repositories.events.getById(actor, detail.survey.eventId).catch((error: unknown) => {
				console.error("Could not load the survey's event.", { surveyId: id, error: errorLabel(error) });
				return null;
			})
		: null;

	const loadResults = (which: ResultsFilter) =>
		repositories.surveyResults.getResults(actor, id, { filter: which }).catch((error: unknown) => {
			console.error("Could not load the survey results.", { surveyId: id, error: errorLabel(error) });
			return null;
		});
	// The unfiltered results feed the summary and the filter row; the filter only changes what the questions show.
	const allResults = isDraft ? null : await loadResults("all");
	// With 1 or 2 walk-ins, comparing the invited-only view with the full one would single out their answers, so the
	// filter is not offered and a hand-typed ?filter=invited shows everything.
	const filterOffered = allResults !== null && allResults.invitedCount > 0 && canFilterInvited(allResults.walkInCount);
	const invitedOnly = filter === "invited" && filterOffered;
	const results = invitedOnly ? await loadResults("invited") : allResults;

	const now = new Date();
	// Only a draft has a send panel, so only a draft pays for the head count, the email check and the point types.
	const [eligible, email, allPointTypes] = isDraft
		? await Promise.all([repositories.surveys.eligibleCount(actor, id), emailOption(), repositories.pointTypes.list()])
		: [0, "off" as const, []];
	const pointTypes = allPointTypes.filter((type) => type.active).map((type) => ({ id: type.id, label: type.label }));
	// The draft's own type while it is active, else Feedback, else the first active one.
	const pointTypeId = [detail.survey.pointTypeId, FEEDBACK_POINT_TYPE_ID].find((typeId) => pointTypes.some((type) => type.id === typeId)) ?? pointTypes[0]?.id ?? "";

	// A form closed by hand has nothing left to change; one that only ran past its closing time can still be reopened.
	const running = detail.survey.status === "running";
	const timeClosed = running && effectiveStatus(detail.survey, now) === "closed";
	const summarizerAvailable = getSummarizer() !== null;
	const base = `/portal/admin/content/surveys/${id}`;

	return (
		<div>
			<div className="grid gap-6">
				<header className="grid min-w-0 gap-2 border-b border-border/60 pb-5">
					<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
						<h1 className="min-w-0 text-3xl font-semibold text-primary [overflow-wrap:anywhere] sm:text-4xl">{detail.survey.title}</h1>
						<FormStatusBadge status={effectiveStatus(detail.survey, now)} />
					</div>
					{event ? (
						<p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
							For{" "}
							<Link href={`/portal/admin/data/events/${event.id}`} className="font-medium text-accent underline-offset-4 hover:underline">
								{event.title}
							</Link>
						</p>
					) : (
						<p className="text-sm text-muted-foreground">General form, sent to active members</p>
					)}
				</header>

				{notice && Object.hasOwn(NOTICES, notice) ? (
					<p role="status" className="min-w-0 rounded-lg border border-border bg-secondary p-3 text-sm text-secondary-foreground">
						{NOTICES[notice]}
					</p>
				) : null}

				{isDraft ? (
					<DraftWorkspace
						draft={{ surveyId: detail.survey.id, title: detail.survey.title, questions: detail.questions.map(toEditorQuestion) }}
						send={{
							surveyId: detail.survey.id,
							hasEvent: Boolean(detail.survey.eventId),
							eligible,
							suggested: suggestInviteCount(eligible),
							stillCheckingIn: event ? (event.endsAt ?? event.startsAt) > now : false,
							closesAt: toLocalInput(sendDefaultClosesAt(event, now)),
							email,
							questionCount: detail.questions.length,
							estimate: formatEstimate(estimateSeconds(detail.questions)),
							pointsAward: detail.survey.pointsAward,
							pointTypeId,
							pointTypes,
						}}
					/>
				) : (
					// Results lead; the controls sit beside them on wide screens and above them on narrow ones.
					<div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
						{running || detail.survey.eventId ? (
							<aside
								aria-labelledby="manage-heading"
								className="grid min-w-0 gap-5 rounded-xl border border-border/60 bg-card p-5 xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1"
							>
								<h2 id="manage-heading" className="text-xl font-semibold text-primary">
									Manage this form
								</h2>
								{running ? (
									<RunningControls
										surveyId={detail.survey.id}
										closesAt={toLocalInput(timeClosed || !detail.survey.closesAt ? sendDefaultClosesAt(null, now) : detail.survey.closesAt)}
										timeClosed={timeClosed}
										reminder={detail.survey.reminderSentAt ? "sent" : timeClosed ? "closed" : "ready"}
									/>
								) : null}
								{/* Works on a closed form too: an admin can stop sharing with organizers at any time after sending. */}
								{detail.survey.eventId ? <ShareToggle surveyId={detail.survey.id} shared={detail.survey.shareWithOrganizers} /> : null}
							</aside>
						) : null}

						<div className="grid min-w-0 gap-5 xl:col-start-1 xl:row-start-1">
							{!results || !allResults ? (
								<p className="min-w-0 rounded-lg border border-border bg-secondary p-3 text-sm text-secondary-foreground">
									The results couldn&apos;t be loaded. Try again in a moment.
								</p>
							) : (
								<>
									{filterOffered || allResults.responseCount > 0 ? (
										<div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
											{filterOffered ? (
												<nav aria-label="Which responses to show" className="flex flex-wrap gap-2">
													<FilterLink href={base} current={!invitedOnly}>
														All responses
													</FilterLink>
													<FilterLink href={`${base}?filter=invited`} current={invitedOnly}>
														Invited sample only
													</FilterLink>
												</nav>
											) : (
												<span />
											)}
											{allResults.responseCount > 0 ? (
												<Button asChild variant="outline" size="sm">
													{/* A plain link: the route streams the file, so the browser handles the download itself. */}
													<a href={`/api/surveys/${encodeURIComponent(id)}/export`} download>
														<Download />
														Download responses (.xlsx)
													</a>
												</Button>
											) : null}
										</div>
									) : null}

									<ResultsList results={results} mode="admin" />

									{summarizerAvailable && !allResults.belowThreshold ? (
										<SummaryPanel
											surveyId={detail.survey.id}
											view={summaryView(allResults.summary, allResults.responseCount, countComments(allResults.questions))}
											canDraft={canDraftSummary(allResults)}
										/>
									) : null}
								</>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
