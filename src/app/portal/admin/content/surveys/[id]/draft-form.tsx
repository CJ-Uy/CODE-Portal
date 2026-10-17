"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Save } from "lucide-react";
import { QuestionEditor } from "@/components/feedback/question-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SurveyQuestionInput } from "@/db/types";
import { saveDraftAction } from "../actions";

export function DraftForm({ surveyId, title, questions }: { surveyId: string; title: string; questions: SurveyQuestionInput[] }) {
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [pending, startTransition] = useTransition();

	// Submitted by hand rather than as a form action: React resets a form once its action settles, which would
	// wipe the admin's edits on a validation error.
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await saveDraftAction(data);
			if ("error" in result) setError(result.error);
			else setSaved(true);
		});
	}

	// "Saved." must not outlive an edit: typing, or any button in the editor (add, remove, reorder, required).
	const clearSaved = () => setSaved(false);

	return (
		<form
			onSubmit={onSubmit}
			onInput={clearSaved}
			onClick={(event) => {
				if ((event.target as HTMLElement).closest("button")) clearSaved();
			}}
			className="grid min-w-0 gap-6"
		>
			<input type="hidden" name="surveyId" value={surveyId} />
			<section aria-label="Form details" className="grid min-w-0 gap-4 rounded-xl border border-border/60 bg-card p-5">
				<label className="grid min-w-0 gap-2 text-sm font-medium">
					Title
					<Input name="title" defaultValue={title} maxLength={200} required />
				</label>
			</section>

			<section aria-labelledby="draft-questions" className="grid min-w-0 gap-3">
				<h2 id="draft-questions" className="text-xl font-semibold text-primary">
					Questions
				</h2>
				<QuestionEditor name="questions" initial={questions} />
			</section>

			<div className="grid min-w-0 gap-3">
				{error ? (
					<p role="alert" className="min-w-0 text-sm text-destructive">
						{error}
					</p>
				) : null}
				{saved ? (
					<p role="status" className="min-w-0 text-sm font-medium text-accent">
						Saved.
					</p>
				) : null}
				<div className="flex flex-wrap items-center gap-3">
					<Button type="submit" disabled={pending}>
						<Save />
						{pending ? "Saving..." : "Save draft"}
					</Button>
					<p className="min-w-0 text-sm text-muted-foreground">Preview and sending use the last saved questions.</p>
				</div>
			</div>
		</form>
	);
}
