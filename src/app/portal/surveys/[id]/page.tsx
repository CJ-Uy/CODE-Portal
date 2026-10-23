import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { ArrowLeft, CheckCircle2, Eye } from "lucide-react";
import { getRepositories } from "@/db";
import { RESPONDENT_STATE_MESSAGES, type RespondentView } from "@/db/repositories/surveys";
import type { SurveyQuestion } from "@/db/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatUtc8DateTime } from "@/lib/date-slots";
import { formatEstimate } from "@/lib/feedback/editor-input";
import { parseOptions, safeFeedbackError, scaleLabels } from "@/lib/feedback/form";
import { estimateSeconds } from "@/lib/feedback/stats";
import { pointsPhrase } from "@/lib/points";
import { getActor } from "@/server/auth/actor";
import { can, type Actor } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { submitResponseAction } from "./actions";
import { SubmitButton } from "./submit-button";

export const dynamic = "force-dynamic";

// A radio pill: the input fills the label so a tap anywhere lands on it and the browser's "pick one" prompt anchors to it.
const PILL =
	"relative flex min-w-0 cursor-pointer items-center justify-center border border-input bg-background text-sm font-semibold transition-colors has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring";
const PILL_INPUT = "absolute inset-0 m-0 size-full cursor-pointer opacity-0";

export default async function MemberSurveyPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ done?: string; error?: string; preview?: string }>;
}) {
	if (!isFeatureEnabled("surveys")) notFound();
	const actor = await getActor();
	if (!actor) redirect(await signInPath());

	const [{ id }, { done, error, preview }, repositories] = await Promise.all([params, searchParams, getRepositories()]);
	// Only someone who can configure surveys gets a preview; for anyone else the parameter does nothing.
	const isPreview = preview === "1" && can(actor, "survey:configure");
	// surveys has no shared-dev internal proxy yet; degrade to not-found instead of crashing.
	const detail = isPreview ? await previewView(repositories, actor, id) : await repositories.surveys.getForRespondent(actor, id).catch(() => null);
	if (!detail) notFound();

	const { survey, questions, eventTitle, state } = detail;
	const backHref = isPreview ? `/portal/admin/content/surveys/${survey.id}` : survey.eventId ? `/portal/calendar/${survey.eventId}` : "/portal";
	// Points are only promised while their point type is active, which is also when answering awards them.
	const pointType =
		survey.pointsAward > 0
			? (await repositories.pointTypes.list().catch(() => [])).find((type) => type.id === survey.pointTypeId && type.active)
			: undefined;
	const points = pointType ? pointsPhrase(survey.pointsAward, pointType.label) : null;

	return (
		<div className="mx-auto grid w-full min-w-0 max-w-2xl gap-6">
			<Link href={backHref} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeft className="size-4" />
				{isPreview ? "Back to the form" : backHref === "/portal" ? "Back to portal" : "Back to event"}
			</Link>
			<header className="grid min-w-0 gap-2">
				<h1 className="min-w-0 font-heading text-3xl leading-tight [overflow-wrap:anywhere]">
					{eventTitle ? `How was ${eventTitle}?` : survey.title}
				</h1>
				{state === "open" ? (
					<>
						<p className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
							<span>
								{questions.length} {questions.length === 1 ? "question" : "questions"}
							</span>
							<span aria-hidden="true">&middot;</span>
							<span>{formatEstimate(estimateSeconds(questions))}</span>
							{survey.closesAt ? (
								<>
									<span aria-hidden="true">&middot;</span>
									<span>Closes {formatUtc8DateTime(survey.closesAt)}</span>
								</>
							) : null}
						</p>
						{points ? <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">You&apos;ll get {points} for answering.</p> : null}
						<p className="flex min-w-0 items-start gap-2 rounded-lg bg-secondary/60 p-3 text-sm text-secondary-foreground">
							<Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
							<span className="grid min-w-0 gap-0.5">
								<span>CRS sees your name with your answers. Organizers see them without names.</span>
								<span className="text-xs text-muted-foreground">Used only for evaluation (RA 10173).</span>
							</span>
						</p>
					</>
				) : null}
			</header>

			{isPreview ? (
				<p role="status" className="min-w-0 rounded-lg border border-border bg-secondary p-3 text-sm font-medium text-secondary-foreground">
					Preview. This is how members see the form. Nothing here is saved or sent.
				</p>
			) : null}

			{isPreview ? (
				<fieldset disabled className="grid min-w-0 gap-4 border-0 p-0 [&_input]:cursor-default [&_label]:cursor-default">
					<QuestionCards questions={questions} />
				</fieldset>
			) : state === "open" ? (
				<form action={submitResponseAction} className="grid gap-4">
					<input type="hidden" name="surveyId" value={survey.id} />
					{error ? (
						<p role="alert" className="rounded-lg border border-border bg-secondary p-3 text-sm font-medium text-secondary-foreground">
							{safeFeedbackError(error)}
						</p>
					) : null}
					<QuestionCards questions={questions} />
					<SubmitButton />
				</form>
			) : (
				<StateCard
					message={
						done && state === "answered" ? `Thanks, feedback sent.${points ? ` You got ${points}.` : ""}` : RESPONDENT_STATE_MESSAGES[state]
					}
					hint={done && state === "answered" ? null : stateHint(state, survey.closesAt)}
					thanked={state === "answered"}
					backHref={backHref}
					previewHref={can(actor, "survey:configure") && state !== "answered" ? `/portal/surveys/${encodeURIComponent(survey.id)}?preview=1` : null}
				/>
			)}
		</div>
	);
}

// A signed-in configurer sees the saved questions of any form, drafts included, as if it were open to them.
async function previewView(repositories: Awaited<ReturnType<typeof getRepositories>>, actor: Actor, id: string): Promise<RespondentView | null> {
	const detail = await repositories.surveys.getById(actor, id).catch(() => null);
	if (!detail) return null;
	const event = detail.survey.eventId ? await repositories.events.getById(actor, detail.survey.eventId).catch(() => null) : null;
	return { survey: detail.survey, questions: detail.questions, eventTitle: event?.title ?? null, state: "open" };
}

function QuestionCards({ questions }: { questions: SurveyQuestion[] }) {
	return (
		<>
			{questions.some((question) => question.required) ? (
				<p className="text-xs text-muted-foreground">
					<span aria-hidden="true">* </span>Required
				</p>
			) : null}
			{questions.map((question, index) => (
				<Card key={question.id} className="p-4 sm:p-5">
					{question.type === "text" ? (
						<TextQuestion question={question} index={index} />
					) : (
						<fieldset className="grid min-w-0 gap-3 border-0 p-0" aria-describedby={question.help ? `help-${question.id}` : undefined}>
							<legend className="w-full min-w-0 text-base font-medium leading-snug [overflow-wrap:anywhere]">
								<Prompt question={question} index={index} />
							</legend>
							<Help question={question} />
							{question.type === "scale" ? <ScaleOptions question={question} /> : <ChoiceOptions question={question} />}
						</fieldset>
					)}
				</Card>
			))}
		</>
	);
}

// Why the form isn't there, so nobody is left guessing whether something broke.
function stateHint(state: Exclude<RespondentView["state"], "open">, closesAt: Date | null): string {
	switch (state) {
		case "closed":
			return closesAt && closesAt <= new Date()
				? `It closed ${formatUtc8DateTime(closesAt)}.`
				: "CRS closed it early.";
		case "staff":
			return "You're on this event's team. Add your notes to its debrief instead.";
		case "answered":
			return "Each person answers once.";
		case "ineligible":
			return "It's for invited members and checked-in attendees. Ask CRS if that's you.";
	}
}

function StateCard({
	message,
	hint,
	thanked,
	backHref,
	previewHref,
}: {
	message: string;
	hint: string | null;
	thanked: boolean;
	backHref: string;
	previewHref: string | null;
}) {
	return (
		<Card>
			<CardContent className="grid justify-items-start gap-4 p-5">
				<div className="grid min-w-0 gap-1">
					<p className="flex min-w-0 items-center gap-2 text-base font-medium">
						{thanked ? <CheckCircle2 className="size-5 shrink-0 text-accent" /> : null}
						<span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
					</p>
					{hint ? <p className="min-w-0 text-sm text-muted-foreground">{hint}</p> : null}
				</div>
				<div className="flex flex-wrap gap-3">
					<Button asChild variant="outline">
						<Link href={backHref}>{backHref === "/portal" ? "Back to portal" : "Back to event"}</Link>
					</Button>
					{previewHref ? (
						<Button asChild variant="ghost">
							<Link href={previewHref}>See the questions</Link>
						</Button>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}

function Prompt({ question, index }: { question: SurveyQuestion; index: number }) {
	return (
		<>
			<span className="tabular-nums text-muted-foreground">{index + 1}.</span> {question.prompt}
			{question.required ? (
				<>
					<span aria-hidden="true" className="text-destructive">
						{" "}
						*
					</span>
					<span className="sr-only"> (required)</span>
				</>
			) : null}
		</>
	);
}

function Help({ question }: { question: SurveyQuestion }) {
	if (!question.help) return null;
	return (
		<p id={`help-${question.id}`} className="-mt-1 min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
			{question.help}
		</p>
	);
}

function TextQuestion({ question, index }: { question: SurveyQuestion; index: number }) {
	return (
		<div className="grid min-w-0 gap-3">
			<label htmlFor={`q-${question.id}`} className="min-w-0 text-base font-medium leading-snug [overflow-wrap:anywhere]">
				<Prompt question={question} index={index} />
			</label>
			<Help question={question} />
			<Textarea
				id={`q-${question.id}`}
				name={`q:${question.id}`}
				rows={4}
				maxLength={2000}
				required={question.required}
				aria-describedby={question.help ? `help-${question.id}` : undefined}
			/>
		</div>
	);
}

function ScaleOptions({ question }: { question: SurveyQuestion }) {
	const [low, high] = scaleLabels(question.optionsJson);
	return (
		<div className="grid gap-2">
			<div className="grid grid-cols-5 gap-1.5">
				{[1, 2, 3, 4, 5].map((value) => (
					<label key={value} className={`${PILL} h-12 rounded-lg`}>
						<input type="radio" name={`q:${question.id}`} value={value} required={question.required} className={PILL_INPUT} />
						{value}
					</label>
				))}
			</div>
			<div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
				<span className="min-w-0 [overflow-wrap:anywhere]">{low}</span>
				<span className="min-w-0 text-right [overflow-wrap:anywhere]">{high}</span>
			</div>
		</div>
	);
}

function ChoiceOptions({ question }: { question: SurveyQuestion }) {
	return (
		<div className="flex min-w-0 flex-wrap gap-2">
			{parseOptions(question.optionsJson).map((option) => (
				<label key={option} className={`${PILL} min-h-11 max-w-full rounded-full px-4 py-2 text-left font-medium`}>
					<input type="radio" name={`q:${question.id}`} value={option} required={question.required} className={PILL_INPUT} />
					<span className="min-w-0 [overflow-wrap:anywhere]">{option}</span>
				</label>
			))}
		</div>
	);
}
