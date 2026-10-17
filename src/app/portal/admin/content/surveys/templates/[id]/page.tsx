import { notFound, redirect } from "next/navigation";
import { AdminIntro } from "@/components/portal/admin-intro";
import { getRepositories } from "@/db";
import type { SurveyQuestionInput } from "@/db/types";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";
import { ArchiveTemplateButton } from "../archive-template-button";
import { TemplateForm, type TemplateFormValues } from "../template-form";

export const dynamic = "force-dynamic";

const STARTER_QUESTION: SurveyQuestionInput = {
	type: "scale",
	prompt: "",
	required: false,
	options: ["Strongly disagree", "Strongly agree"],
};

export default async function FeedbackTemplatePage({ params }: { params: Promise<{ id: string }> }) {
	if (!isFeatureEnabled("surveys")) notFound();

	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!can(actor, "survey:configure")) redirect("/portal");

	const { id } = await params;
	const isNew = id === "new";
	let values: TemplateFormValues = { id: null, name: "", description: "", questions: [STARTER_QUESTION] };
	if (!isNew) {
		const repositories = await getRepositories();
		// surveys has no shared-dev internal proxy yet; degrade to not-found instead of crashing.
		const template = await repositories.surveys.getTemplate(actor, id).catch(() => null);
		// An archived template still reads back, but it can no longer be edited.
		if (!template || template.archivedAt) notFound();
		values = { id: template.id, name: template.name, description: template.description, questions: template.questionsJson };
	}

	return (
		<div className="grid gap-6">
			<AdminIntro
				title={isNew ? "New template" : "Edit template"}
				whoFor="Organizers pick a template, then adjust the questions before they send"
				effect="Forms already made from this template keep their own copy of the questions"
			/>
			<TemplateForm template={values} />
			{values.id ? (
				<section aria-labelledby="archive-template" className="grid min-w-0 gap-3 rounded-xl border border-border/60 bg-card p-5">
					<h2 id="archive-template" className="text-xl font-semibold text-primary">
						Archive
					</h2>
					<p className="max-w-2xl text-sm text-muted-foreground">
						Archived templates stop being offered for new forms. Forms already made from this one are not affected.
					</p>
					<div>
						<ArchiveTemplateButton id={values.id} name={values.name} />
					</div>
				</section>
			) : null}
		</div>
	);
}
