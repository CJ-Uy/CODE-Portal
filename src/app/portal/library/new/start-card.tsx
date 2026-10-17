"use client";

import { useFormStatus } from "react-dom";
import { Link2, PenLine, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KIND_LABELS, type LibraryFormat, type LibraryKind } from "@/lib/library/taxonomy";
import { createDraftAction } from "../editor-actions";

const COPY = {
	file: { icon: Upload, heading: "Upload a file", blurb: "A PDF or Office file you already have: a module, a template, a book or paper, or a case study." },
	page: { icon: PenLine, heading: "Write a page", blurb: "Write it here, with headings, images and lists: a guide, an article, a framework or a case study." },
	link: { icon: Link2, heading: "Add a link", blurb: "Point to a website, or to a book or paper that only exists online." },
} as const;

function Start() {
	// Disabled while the draft is being made, so a double tap cannot start two.
	const { pending } = useFormStatus();
	return (
		<Button type="submit" disabled={pending}>
			{pending ? "Starting..." : "Start draft"}
		</Button>
	);
}

export function StartCard({ format, kinds, listId, error }: { format: LibraryFormat; kinds: LibraryKind[]; listId: string; error: string | null }) {
	const { icon: Icon, heading, blurb } = COPY[format];
	return (
		<form action={createDraftAction} className="grid min-w-0 content-start gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
			<input type="hidden" name="format" value={format} />
			{listId ? <input type="hidden" name="listId" value={listId} /> : null}
			<div className="grid gap-2">
				<span className="grid size-10 place-items-center rounded-full bg-secondary text-accent">
					<Icon className="size-5" aria-hidden />
				</span>
				<h2 className="font-heading text-xl">{heading}</h2>
				<p className="text-sm text-muted-foreground">{blurb}</p>
			</div>
			<fieldset className="grid gap-2">
				<legend className="mb-1 text-sm font-medium">What is it?</legend>
				<div className="flex flex-wrap gap-2">
					{kinds.map((kind, index) => (
						<label
							key={kind}
							className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:border-accent has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
						>
							<input type="radio" name="kind" value={kind} defaultChecked={index === 0} required className="sr-only" />
							{KIND_LABELS[kind]}
						</label>
					))}
				</div>
			</fieldset>
			<label className="grid gap-2 text-sm font-medium">
				Title
				{/* The pattern needs a visible character, so a title of spaces is caught here too. */}
				<Input name="title" required maxLength={200} pattern={String.raw`.*\S.*`} title="Enter a title" placeholder="You can change this later" autoComplete="off" aria-invalid={Boolean(error)} />
				{error ? (
					<span role="alert" className="text-xs font-normal text-destructive">
						{error}
					</span>
				) : null}
			</label>
			<Start />
		</form>
	);
}
