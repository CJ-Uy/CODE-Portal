"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Save } from "lucide-react";
import { QuestionEditor } from "@/components/feedback/question-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SurveyQuestionInput } from "@/db/types";
import { saveTemplateAction } from "../actions";

export type TemplateFormValues = { id: string | null; name: string; description: string; questions: SurveyQuestionInput[] };

export function TemplateForm({ template }: { template: TemplateFormValues }) {
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	// Submitted by hand rather than as a form action: React resets a form once its action settles, which
	// would wipe the admin's edits on a validation error. Success redirects, so only failures come back.
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		setError(null);
		startTransition(async () => {
			try {
				const result = await saveTemplateAction(data);
				if (result) setError(result.error);
			} catch (error) {
				// Rethrows the success redirect; anything else (network, expired session) keeps the edits on screen.
				unstable_rethrow(error);
				setError("Couldn't reach the server. Your changes are still here. Try again.");
			}
		});
	}

	return (
		<form onSubmit={onSubmit} className="grid min-w-0 gap-6">
			{template.id ? <input type="hidden" name="id" value={template.id} /> : null}
			<section aria-label="Template details" className="grid min-w-0 gap-4 rounded-xl border border-border/60 bg-card p-5">
				<label className="grid min-w-0 gap-2 text-sm font-medium">
					Name
					<Input name="name" defaultValue={template.name} maxLength={120} required />
				</label>
				<label className="grid min-w-0 gap-2 text-sm font-medium">
					Description (optional)
					<Textarea name="description" defaultValue={template.description} maxLength={300} rows={2} className="min-h-0" />
				</label>
			</section>

			<section aria-labelledby="template-questions" className="grid min-w-0 gap-3">
				<h2 id="template-questions" className="text-xl font-semibold text-primary">
					Questions
				</h2>
				<QuestionEditor name="questions" initial={template.questions} />
			</section>

			{error ? (
				<p role="alert" className="min-w-0 text-sm text-destructive">
					{error}
				</p>
			) : null}
			<div className="flex flex-wrap items-center gap-3">
				<Button type="submit" disabled={pending}>
					<Save />
					{pending ? "Saving..." : "Save template"}
				</Button>
				<Button asChild variant="ghost">
					<Link href="/portal/admin/content/surveys/templates">Cancel</Link>
				</Button>
			</div>
		</form>
	);
}
