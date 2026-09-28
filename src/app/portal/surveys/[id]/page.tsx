import { notFound, redirect } from "next/navigation";
import { CheckCircle2, Lock, Send } from "lucide-react";
import { getRepositories } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import { submitResponseAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MemberSurveyPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ t?: string; done?: string }>;
}) {
	if (!isFeatureEnabled("surveys")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");

	const { id } = await params;
	const { t: token, done } = await searchParams;
	const repositories = await getRepositories();
	// surveys has no shared-dev internal proxy yet; degrade to not-found instead of crashing.
	const detail = await repositories.surveys.getForRespondent(id).catch(() => null);
	if (!detail) notFound();

	if (done) {
		return (
			<div className="mx-auto grid max-w-2xl gap-4 py-8 text-center">
				<CheckCircle2 className="mx-auto size-12 text-accent" />
				<h1 className="font-heading text-3xl">Thank you</h1>
				<p className="text-sm text-muted-foreground">Your response was recorded anonymously. It cannot be traced back to you.</p>
			</div>
		);
	}

	return (
		<div className="mx-auto grid max-w-2xl gap-6">
			<div>
				<p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					<Lock className="size-3" />
					Anonymous survey
				</p>
				<h1 className="mt-1 font-heading text-3xl">{detail.survey.title}</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Your answers cannot be traced back to you. Take your time.
				</p>
			</div>

			{!token ? (
				<Card>
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						This survey link is missing its access token. Open it again from your invitation.
					</CardContent>
				</Card>
			) : (
				<form action={submitResponseAction} className="grid gap-4">
					<input type="hidden" name="surveyId" value={detail.survey.id} />
					<input type="hidden" name="token" value={token} />
					{detail.questions.map((question, index) => (
						<Card key={question.id}>
							<CardHeader>
								<CardTitle className="flex items-start gap-3 text-base font-medium">
									<span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-accent">
										{index + 1}
									</span>
									{question.prompt}
								</CardTitle>
							</CardHeader>
							<CardContent>
								{question.type === "scale" ? (
									<fieldset className="grid gap-2">
										<div className="flex gap-2">
											{[1, 2, 3, 4, 5].map((value) => (
												<label
													key={value}
													className="flex-1 cursor-pointer rounded-lg border border-border py-2 text-center text-sm font-semibold transition-colors has-checked:border-accent has-checked:bg-secondary has-checked:text-foreground"
												>
													<input type="radio" name={`q:${question.id}`} value={value} className="sr-only" required />
													{value}
												</label>
											))}
										</div>
										<div className="flex justify-between text-xs text-muted-foreground">
											<span>Strongly disagree</span>
											<span>Strongly agree</span>
										</div>
									</fieldset>
								) : question.type === "text" ? (
									<Textarea name={`q:${question.id}`} rows={3} placeholder="Your answer" />
								) : (
									<Input name={`q:${question.id}`} placeholder="Your answer" />
								)}
							</CardContent>
						</Card>
					))}
					<div className="flex justify-end">
						<Button type="submit">
							<Send />
							Submit response
						</Button>
					</div>
				</form>
			)}
		</div>
	);
}
