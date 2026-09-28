import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { createSurveyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminSurveysPage() {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("surveys")) notFound();

	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "survey:configure")) redirect("/portal");

	const repositories = await getRepositories();
	// surveys has no shared-dev internal proxy yet; degrade to an empty list instead of crashing.
	const surveys = await repositories.surveys.list(actor, { limit: 50 }).catch(() => []);

	return (
		<main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
			<div className="grid gap-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-3xl">Surveys</CardTitle>
						<CardDescription>Create a survey, then draw a random sample to start collecting responses.</CardDescription>
					</CardHeader>
					<CardContent>
						<form action={createSurveyAction} className="grid gap-4">
							<label className="grid gap-2 text-sm font-medium">
								Title
								<Input name="title" required />
							</label>
							<label className="grid gap-2 text-sm font-medium">
								Question type
								<Select name="type" defaultValue="text">
									<option value="text">Text</option>
									<option value="scale">Scale (1 to 5)</option>
									<option value="choice">Choice</option>
								</Select>
							</label>
							<label className="grid gap-2 text-sm font-medium">
								Questions (one per line)
								<Textarea name="prompts" required rows={4} />
							</label>
							<div>
								<Button type="submit">
									<Plus />
									Create survey
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Existing surveys</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-3">
						{surveys.length === 0 ? (
							<p className="text-sm text-muted-foreground">No surveys yet.</p>
						) : (
							surveys.map((survey) => (
								<Link
									key={survey.id}
									href={`/portal/admin/content/surveys/${survey.id}`}
									className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm hover:bg-accent"
								>
									<span className="font-medium">{survey.title}</span>
									<Badge variant="outline">{survey.status}</Badge>
								</Link>
							))
						)}
					</CardContent>
				</Card>
			</div>
		</main>
	);
}
