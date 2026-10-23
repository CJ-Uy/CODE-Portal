import Link from "next/link";
import { loadEventList } from "@/app/portal/calendar/load-events";
import { AdminIntro } from "@/components/portal/admin-intro";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { ChevronRight, ListChecks } from "lucide-react";
import { getRepositories } from "@/db";
import { FormStatusBadge } from "@/components/feedback/results";
import { Button } from "@/components/ui/button";
import type { EventFeedbackRow } from "@/db/types";
import { formatUtc8DateTime, toLocalDate } from "@/lib/date-slots";
import { formatEstimate } from "@/lib/feedback/editor-input";
import { effectiveStatus, estimateSeconds } from "@/lib/feedback/stats";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { NewForm } from "./new-form";

export const dynamic = "force-dynamic";

const FORM_GROUPS = [
	{ status: "draft", heading: "Drafts to send" },
	{ status: "running", heading: "Open now" },
	{ status: "closed", heading: "Closed" },
] as const;

export default async function AdminSurveysPage() {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("surveys")) notFound();

	const actor = await getActor();
	if (!actor) redirect(await signInPath());
	if (!can(actor, "survey:configure")) redirect("/portal");

	const repositories = await getRepositories();
	const now = new Date();
	// surveys has no shared-dev internal proxy yet; degrade to empty lists instead of crashing.
	const [surveys, templates, events, terms] = await Promise.all([
		repositories.surveys.list(actor, { limit: 50 }).catch(() => []),
		repositories.surveys.listTemplates(actor).catch(() => []),
		loadEventList(repositories, actor).catch(() => []),
		repositories.retention.listTermsAdmin(actor, now).catch(() => []),
	]);

	const eventTitles = new Map(events.map((event) => [event.id, event.title]));
	const formEventIds = surveys.flatMap((survey) => (survey.eventId ? [survey.eventId] : []));
	// Responses come from one grouped query for event forms. A general form has no event to group by, and a
	// draft has none to count, so only the sent general ones ask for their own results.
	const [eventFeedback, generalResponses] = await Promise.all([
		repositories.surveyResults.feedbackForEvents(actor, formEventIds).catch(() => new Map<string, EventFeedbackRow>()),
		Promise.all(
			surveys
				.filter((survey) => !survey.eventId && survey.status !== "draft")
				.map(async (survey) => {
					const results = await repositories.surveyResults.getResults(actor, survey.id, { filter: "all" }).catch(() => null);
					return [survey.id, results?.responseCount ?? null] as const;
				}),
		).then((rows) => new Map(rows)),
	]);

	// The current school year's events. With no current year set, the last six months, so the picker is never empty for want of a term.
	const term = terms.find((candidate) => candidate.isCurrent);
	const from = term?.startsAt ?? new Date(now.getTime() - 180 * 24 * 3_600_000);
	const until = term?.endsAt ?? now;
	// An event that already has a form cannot take another, so it is not offered.
	const taken = new Set(formEventIds);
	const eventChoices = events
		.filter((event) => event.startsAt >= from && event.startsAt <= until && !taken.has(event.id))
		.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

	return (
		<div>
			<div className="grid gap-6">
				<AdminIntro
					title="Surveys"
					whoFor="Start a feedback form from a template, adjust the questions, then send it to a sample of attendees"
					effect="Sending notifies the people invited and cannot be undone"
				/>
				<div>
					<Button asChild variant="outline">
						<Link href="/portal/admin/content/surveys/templates">
							<ListChecks />
							Feedback templates
						</Link>
					</Button>
				</div>

				<section aria-labelledby="new-form" className="grid min-w-0 gap-4 rounded-xl border border-border/60 bg-card p-5">
					<h2 id="new-form" className="text-xl font-semibold text-primary">
						New form
					</h2>
					<NewForm
						templates={templates.map((template) => ({
							id: template.id,
							label: `${template.name} (${template.questionsJson.length} ${template.questionsJson.length === 1 ? "question" : "questions"}, ${formatEstimate(estimateSeconds(template.questionsJson)).toLowerCase()})`,
						}))}
						events={eventChoices.map((event) => ({ id: event.id, label: `${event.title} (${toLocalDate(event.startsAt)})` }))}
					/>
				</section>

				<section aria-labelledby="existing-surveys" className="grid gap-4">
					<h2 id="existing-surveys" className="text-xl font-semibold text-primary">Existing forms</h2>
					{surveys.length === 0 ? (
						<p className="rounded-xl border border-border/60 bg-card px-4 py-5 text-sm text-muted-foreground">
							No forms yet. Start one above, or tick Attach a feedback form when you create an event.
						</p>
					) : null}
					{/* Grouped by what needs doing: drafts wait to be sent, open forms are collecting, closed ones are for reading. */}
					{FORM_GROUPS.map(({ status: groupStatus, heading }) => {
						const group = surveys.filter((survey) => effectiveStatus(survey, now) === groupStatus);
						if (group.length === 0) return null;
						return (
							<div key={groupStatus} className="grid min-w-0 gap-2">
								<h3 className="text-sm font-semibold text-muted-foreground">
									{heading} <span className="tabular-nums">({group.length})</span>
								</h3>
								<div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card">
									{group.map((survey) => {
										const status = groupStatus;
										const responses = survey.eventId ? (eventFeedback.get(survey.eventId)?.responses ?? 0) : generalResponses.get(survey.id);
										return (
											<Link
												key={survey.id}
												href={`/portal/admin/content/surveys/${survey.id}`}
												className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-4 text-sm first:rounded-t-xl last:rounded-b-xl hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-4"
											>
												<span className="grid min-w-0 gap-1">
													<span className="min-w-0 font-medium [overflow-wrap:anywhere]">{survey.title}</span>
													<span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
														{survey.eventId ? (eventTitles.get(survey.eventId) ?? "Event no longer listed") : "General form"}
													</span>
												</span>
												<ChevronRight
													aria-hidden="true"
													className="col-start-2 row-span-2 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:col-start-3 sm:row-span-1"
												/>
												<span className="col-start-1 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground sm:col-start-2 sm:row-start-1">
													<FormStatusBadge status={status} />
													{status === "draft" ? null : (
														<>
															<span>
																{responses ?? "-"} {responses === 1 ? "response" : "responses"}
															</span>
															{survey.closesAt ? (
																<span>
																	{status === "closed" ? "Closed" : "Closes"} {formatUtc8DateTime(survey.closesAt)}
																</span>
															) : null}
														</>
													)}
												</span>
											</Link>
										);
									})}
								</div>
							</div>
						);
					})}
				</section>
			</div>
		</div>
	);
}
