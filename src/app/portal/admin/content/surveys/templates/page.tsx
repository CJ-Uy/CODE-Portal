import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { AdminIntro } from "@/components/portal/admin-intro";
import { Button } from "@/components/ui/button";
import { getRepositories } from "@/db";
import { formatEstimate } from "@/lib/feedback/editor-input";
import { estimateSeconds } from "@/lib/feedback/stats";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

export default async function FeedbackTemplatesPage() {
	if (!isFeatureEnabled("surveys")) notFound();

	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "survey:configure")) redirect("/portal");

	const repositories = await getRepositories();
	// surveys has no shared-dev internal proxy yet; degrade to an empty list instead of crashing.
	const templates = await repositories.surveys.listTemplates(actor).catch(() => []);

	return (
		<div className="grid gap-6">
			<AdminIntro
				title="Feedback templates"
				whoFor="The question sets organizers start from when they ask for event feedback"
				effect="Editing a template never changes forms already made from it"
			/>
			<div>
				<Button asChild variant="outline">
					<Link href="/portal/admin/content/surveys/templates/new">
						<Plus />
						New template
					</Link>
				</Button>
			</div>
			<section aria-label="Templates" className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card">
				{templates.length === 0 ? (
					<p className="px-4 py-5 text-sm text-muted-foreground">No templates yet.</p>
				) : (
					templates.map((template) => (
						<Link
							key={template.id}
							href={`/portal/admin/content/surveys/templates/${template.id}`}
							className="flex items-center justify-between gap-3 rounded-xl px-4 py-4 text-sm hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						>
							<span className="grid min-w-0 gap-1">
								<span className="min-w-0 break-all font-medium">{template.name}</span>
								{template.description ? <span className="min-w-0 break-all text-muted-foreground">{template.description}</span> : null}
								<span className="text-muted-foreground">
									{template.questionsJson.length} {template.questionsJson.length === 1 ? "question" : "questions"}. {formatEstimate(estimateSeconds(template.questionsJson))}.
								</span>
							</span>
							<span className="shrink-0 text-accent">Edit</span>
						</Link>
					))
				)}
			</section>
		</div>
	);
}
