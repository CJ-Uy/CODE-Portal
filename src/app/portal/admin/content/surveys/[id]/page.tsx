import { notFound, redirect } from "next/navigation";
import { getRepositories } from "@/db";
import type { SurveyQuestion, SurveyQuestionInput } from "@/db/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { toLocalInput } from "@/lib/date-slots";
import { formatEstimate } from "@/lib/feedback/editor-input";
import { parseOptions } from "@/lib/feedback/form";
import { sendDefaultClosesAt } from "@/lib/feedback/send-input";
import { estimateSeconds, suggestInviteCount } from "@/lib/feedback/stats";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { emailDbFromEnv } from "@/server/email/db";
import { isFeatureEnabled } from "@/server/features";
import { feedbackEmailReady } from "@/server/feedback/email";
import { DraftWorkspace } from "./draft-workspace";

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

export default async function AdminSurveyDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ notice?: string }>;
}) {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("surveys")) notFound();

	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "survey:configure")) redirect("/portal");

	const [{ id }, { notice }] = await Promise.all([params, searchParams]);
	const repositories = await getRepositories();
	// surveys has no shared-dev internal proxy yet; degrade to not-found instead of crashing.
	const detail = await repositories.surveys.getById(actor, id).catch(() => null);
	if (!detail) notFound();
	const isDraft = detail.survey.status === "draft";
	const event = detail.survey.eventId ? await repositories.events.getById(actor, detail.survey.eventId).catch(() => null) : null;
	const results = isDraft ? null : await repositories.surveyResults.getResults(actor, id, { filter: "all" }).catch(() => null);

	const now = new Date();
	// Only a draft has a send panel, so only a draft pays for the head count and the email check.
	const [eligible, email] = isDraft ? await Promise.all([repositories.surveys.eligibleCount(actor, id), emailOption()]) : [0, "off" as const];

	return (
		<div>
			<div className="grid gap-6">
				<header className="grid min-w-0 gap-2 border-b border-border/60 pb-5">
					<h1 className="min-w-0 break-all text-3xl font-semibold text-primary sm:text-4xl">{detail.survey.title}</h1>
					{event ? <p className="min-w-0 break-all text-sm text-muted-foreground">For the event {event.title}</p> : null}
					<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<Badge variant="outline">{results?.status ?? detail.survey.status}</Badge>
						{results ? (
							<span>
								{results.responseCount} responses. {results.invitedResponded} of {results.invitedCount} invited, {results.walkInCount}{" "}
								walk-ins.
							</span>
						) : null}
					</div>
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
						}}
					/>
				) : (
					<Card>
						<CardHeader>
							<h2 className="text-xl font-semibold text-primary">Results</h2>
							<CardDescription>Aggregated. Names aren&apos;t attached to answers.</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-5">
							{!results ? (
								<p className="text-sm text-muted-foreground">Results are unavailable here.</p>
							) : results.belowThreshold ? (
								<p className="text-sm text-muted-foreground">Results appear at 3 responses to protect anonymity.</p>
							) : null}
							{results?.questions.map((question) => (
								<div key={question.questionId} className="grid gap-2">
									<p className="min-w-0 break-all font-medium">{question.prompt}</p>
									<ul className="grid gap-1 text-sm text-muted-foreground">
										{question.kind === "scale" ? (
											<>
												<li>
													{question.summary.topTwoPct ?? 0}% top two, mean {question.summary.mean ?? "-"}, n {question.summary.n}
												</li>
												{question.summary.counts.map((count, index) => (
													<li key={index}>
														{index + 1}: {count}
													</li>
												))}
											</>
										) : question.kind === "choice" ? (
											Object.entries(question.counts).map(([option, count]) => (
												<li key={option} className="min-w-0 break-all">
													{option}: {count}
												</li>
											))
										) : question.answers.length === 0 ? (
											<li>No answers yet.</li>
										) : (
											question.answers.map((answer) => (
												<li key={answer.id} className="min-w-0 break-all">
													{answer.value}
													{answer.hidden ? " (hidden from organizers)" : ""}
												</li>
											))
										)}
									</ul>
								</div>
							))}
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}
