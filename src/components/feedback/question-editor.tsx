"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SurveyQuestionInput } from "@/db/types";
import { newDraft, toDraft, toInput, trackedKey, withType, type Draft, type QuestionType } from "@/lib/feedback/editor-draft";
import { formatEstimate, metricLabel } from "@/lib/feedback/editor-input";
import { estimateSeconds } from "@/lib/feedback/stats";

const MAX_QUESTIONS = 30;
const LONG_FORM_SECONDS = 180;

/**
 * Edits an ordered question list. State lives here and is mirrored into one hidden JSON field, which the
 * server re-validates with `parseQuestionsField`, so nothing the browser sends is trusted.
 */
export function QuestionEditor({ name, initial }: { name: string; initial: SurveyQuestionInput[] }) {
	const uid = useId();
	const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(toDraft));
	const nextKey = useRef(initial.length);
	const [added, setAdded] = useState<number | null>(null);
	const afterMove = useRef<{ key: number; dir: "up" | "down" } | null>(null);

	// Reordering re-inserts the card, which drops focus. Put it back on the button that was just used, or on
	// its sibling when that one is now disabled at the end of the list.
	useEffect(() => {
		const moved = afterMove.current;
		if (!moved) return;
		afterMove.current = null;
		const button = (dir: "up" | "down") => document.getElementById(`${uid}-${moved.key}-${dir}`) as HTMLButtonElement | null;
		const same = button(moved.dir);
		(same && !same.disabled ? same : button(moved.dir === "up" ? "down" : "up"))?.focus();
	}, [drafts, uid]);

	function update(key: number, patch: Partial<Draft>) {
		setDrafts((all) => all.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
	}

	function changeType(draft: Draft, type: QuestionType) {
		setDrafts((all) => all.map((item) => (item.key === draft.key ? withType(item, type) : item)));
	}

	function move(index: number, dir: "up" | "down") {
		const target = dir === "up" ? index - 1 : index + 1;
		setDrafts((all) => {
			if (target < 0 || target >= all.length) return all;
			const next = [...all];
			[next[index], next[target]] = [next[target]!, next[index]!];
			return next;
		});
		const moved = drafts[index];
		if (moved) afterMove.current = { key: moved.key, dir };
	}

	function add() {
		const key = nextKey.current++;
		setDrafts((all) => [...all, newDraft(key)]);
		setAdded(key);
	}

	const seconds = estimateSeconds(drafts);

	return (
		<div className="grid min-w-0 gap-4">
			<input type="hidden" name={name} value={JSON.stringify(drafts.map(toInput))} />
			<ol className="grid min-w-0 gap-4">
				{drafts.map((draft, index) => {
					const number = index + 1;
					const tracked = trackedKey(draft);
					return (
						<li key={draft.key} className="grid min-w-0 gap-4 rounded-xl border border-border/60 bg-card p-4">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<h3 className="text-sm font-semibold text-primary">Question {number}</h3>
								<div className="flex gap-1">
									<Button
										id={`${uid}-${draft.key}-up`}
										type="button"
										variant="outline"
										size="icon"
										aria-label={`Move question ${number} up`}
										disabled={index === 0}
										onClick={() => move(index, "up")}
									>
										<ArrowUp />
									</Button>
									<Button
										id={`${uid}-${draft.key}-down`}
										type="button"
										variant="outline"
										size="icon"
										aria-label={`Move question ${number} down`}
										disabled={index === drafts.length - 1}
										onClick={() => move(index, "down")}
									>
										<ArrowDown />
									</Button>
									<Button
										type="button"
										variant="outline"
										size="icon"
										aria-label={`Remove question ${number}`}
										disabled={drafts.length === 1}
										onClick={() => setDrafts((all) => all.filter((item) => item.key !== draft.key))}
									>
										<Trash2 />
									</Button>
								</div>
							</div>

							<label className="grid min-w-0 gap-2 text-sm font-medium">
								Question
								<Input
									value={draft.prompt}
									onChange={(event) => update(draft.key, { prompt: event.target.value })}
									maxLength={500}
									required
									autoFocus={draft.key === added}
								/>
							</label>
							<label className="grid min-w-0 gap-2 text-sm font-medium">
								Help text (optional)
								<Input value={draft.help} onChange={(event) => update(draft.key, { help: event.target.value })} maxLength={500} />
							</label>

							<div className="grid min-w-0 gap-4 sm:grid-cols-2 sm:items-end">
								<label className="grid min-w-0 gap-2 text-sm font-medium">
									Answer type
									<Select value={draft.type} onChange={(event) => changeType(draft, event.target.value as QuestionType)}>
										<option value="scale">Scale (1 to 5)</option>
										<option value="choice">Choice</option>
										<option value="text">Text</option>
									</Select>
								</label>
								<div className="flex h-10 items-center gap-3 text-sm">
									<Checkbox
										id={`${uid}-${draft.key}-required`}
										checked={draft.required}
										onCheckedChange={(checked) => update(draft.key, { required: checked === true })}
									/>
									<label htmlFor={`${uid}-${draft.key}-required`} className="font-medium">
										Required
									</label>
								</div>
							</div>

							{draft.type === "scale" ? (
								<div className="grid min-w-0 gap-4 sm:grid-cols-2">
									<label className="grid min-w-0 gap-2 text-sm font-medium">
										Low end label (1)
										<Input value={draft.low} onChange={(event) => update(draft.key, { low: event.target.value })} maxLength={200} required />
									</label>
									<label className="grid min-w-0 gap-2 text-sm font-medium">
										High end label (5)
										<Input value={draft.high} onChange={(event) => update(draft.key, { high: event.target.value })} maxLength={200} required />
									</label>
								</div>
							) : null}
							{draft.type === "choice" ? (
								<label className="grid min-w-0 gap-2 text-sm font-medium">
									Options (one per line, 2 to 20)
									<Textarea value={draft.choices} onChange={(event) => update(draft.key, { choices: event.target.value })} rows={4} required />
								</label>
							) : null}

							{tracked ? (
								<div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
									<Badge variant="info">Tracked: {metricLabel(tracked)}</Badge>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										aria-label={`Remove the ${metricLabel(tracked)} tag from question ${number}`}
										onClick={() => update(draft.key, { metricKey: undefined })}
									>
										Remove tag
									</Button>
									<p className="w-full min-w-0 text-xs text-muted-foreground">Untracked questions aren&apos;t compared across events.</p>
								</div>
							) : null}
						</li>
					);
				})}
			</ol>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<Button type="button" variant="outline" onClick={add} disabled={drafts.length >= MAX_QUESTIONS}>
					<Plus />
					Add question
				</Button>
				<p className="text-sm text-muted-foreground" aria-live="polite">
					{drafts.length} of {MAX_QUESTIONS} questions. {formatEstimate(seconds)}.
				</p>
			</div>
			{seconds > LONG_FORM_SECONDS ? (
				<p role="status" className="flex items-start gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm">
					<TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
					Long forms get fewer and rushed answers.
				</p>
			) : null}
		</div>
	);
}
