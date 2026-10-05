import Link from "next/link";
import { AdminIntro } from "@/components/portal/admin-intro";
import { notFound, redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
		<div>
			<div className="grid gap-6">
				<AdminIntro title="Surveys" whoFor="Create a survey, then draw a random sample to collect responses" />
				<details className="rounded-xl border border-border/60 bg-card">
					<summary className="cursor-pointer rounded-xl px-5 py-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">New survey</summary>
					<div className="border-t border-border/50 p-5">
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
					</div>
				</details>

				<section aria-labelledby="existing-surveys" className="grid gap-3">
					<h2 id="existing-surveys" className="text-xl font-semibold text-primary">Existing surveys</h2>
					<div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card">
						{surveys.length === 0 ? (
							<p className="px-4 py-5 text-sm text-muted-foreground">No surveys yet.</p>
						) : (
							surveys.map((survey) => (
								<Link
									key={survey.id}
									href={`/portal/admin/content/surveys/${survey.id}`}
									className="flex items-center justify-between gap-3 rounded-xl px-4 py-4 text-sm hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
								>
									<span className="font-medium">{survey.title}</span>
									<Badge variant="outline">{survey.status}</Badge>
								</Link>
							))
						)}
					</div>
				</section>
			</div>
		</div>
	);
}
