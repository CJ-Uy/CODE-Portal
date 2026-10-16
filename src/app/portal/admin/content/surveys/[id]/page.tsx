import { notFound, redirect } from "next/navigation";
import { Shuffle } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { sendSurveyAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminSurveyDetailPage({ params }: { params: Promise<{ id: string }> }) {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("surveys")) notFound();

	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "survey:configure")) redirect("/portal");

	const { id } = await params;
	const repositories = await getRepositories();
	// surveys has no shared-dev internal proxy yet; degrade to not-found instead of crashing.
	const detail = await repositories.surveys.getById(actor, id).catch(() => null);
	if (!detail) notFound();
	const results = await repositories.surveyResults.getResults(actor, id, { filter: "all" }).catch(() => null);

	return (
		<div>
			<div className="grid gap-6">
					<header className="grid gap-2 border-b border-border/60 pb-5">
						<h1 className="text-3xl font-semibold text-primary sm:text-4xl">{detail.survey.title}</h1>
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
					{detail.survey.status === "draft" ? (
						<section aria-label="Survey sampling" className="rounded-xl border border-border/60 bg-card p-5">
							<form action={sendSurveyAction} className="flex flex-wrap items-end gap-3">
								<input type="hidden" name="surveyId" value={detail.survey.id} />
								<label className="grid gap-2 text-sm font-medium">
									Sample size
									<Input name="sampleSize" type="number" min={1} defaultValue={10} className="w-32" />
								</label>
								<label className="grid gap-2 text-sm font-medium">
									Seed (optional)
									<Input name="seed" className="w-48" />
								</label>
								<Button type="submit">
									<Shuffle />
									Draw sample and start
								</Button>
							</form>
						</section>
					) : null}

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
			</div>
		</div>
	);
}
