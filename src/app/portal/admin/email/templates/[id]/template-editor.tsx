"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Archive, Copy, Save, Send } from "lucide-react";
import { AdminIntro } from "@/components/portal/admin-intro";
import { BlockEditor, type EventOption, type PreviewPerson } from "@/components/email/block-editor";
import { TaggedField } from "@/components/email/tagged-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { EmailBlock } from "@/lib/email/types";
import { duplicateTemplateAction, saveTemplateAction, setTemplateArchivedAction } from "../../actions";
import { useAutosave } from "../../use-autosave";

type Initial = { id: string | null; name: string; categoryId: string | null; subject: string; preheader: string; blocks: EmailBlock[] };

export function TemplateEditor({
	initial,
	categories,
	events,
	people,
	baseUrl,
}: {
	initial: Initial;
	categories: { id: string; name: string; required: boolean }[];
	events: EventOption[];
	people: PreviewPerson[];
	baseUrl: string;
}) {
	const router = useRouter();
	const toast = useToast();
	const [id, setId] = useState(initial.id);
	const mounted = useRef(true);
	const idRef = useRef(initial.id); // set synchronously so a trailing save never inserts a second row
	const [name, setName] = useState(initial.name);
	const [categoryId, setCategoryId] = useState(initial.categoryId);
	const [subject, setSubject] = useState(initial.subject);
	const [preheader, setPreheader] = useState(initial.preheader);
	const [blocks, setBlocks] = useState(initial.blocks);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const category = categories.find((c) => c.id === categoryId);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const value = useMemo(() => ({ name, categoryId, subject, preheader, blocks }), [name, categoryId, subject, preheader, blocks]);
	const save = async (v: typeof value) => {
		if (!v.name.trim()) {
			setError("Name the template to save it.");
			return false;
		}
		const result = await saveTemplateAction({ id: idRef.current ?? undefined, ...v });
		if (!result.ok) {
			setError(result.error);
			return false;
		}
		setError(null);
		if (!idRef.current) {
			idRef.current = result.data;
			setId(result.data);
			// An unmount flush can finish the first insert after the user left; don't rewrite their new URL.
			if (mounted.current && window.location.pathname.endsWith("/templates/new")) window.history.replaceState(null, "", `/portal/admin/email/templates/${result.data}`);
		}
		return true;
	};
	const { state, flush } = useAutosave(value, save);

	const flushed = async () => {
		if (await flush(value)) return true;
		toast({ message: "Couldn't save your changes. Fix the problem shown at the top first." });
		return false;
	};

	const footer = useMemo(
		() => ({ categoryName: category?.name ?? "CODE", required: category?.required ?? true, archiveUrl: `${baseUrl}/portal/mail`, preferencesUrl: `${baseUrl}/portal/mail/preferences`, unsubscribeUrl: category && !category.required ? `${baseUrl}/unsubscribe` : null }),
		[category, baseUrl],
	);

	return (
		<div className="grid gap-5">
			<AdminIntro title={initial.id ? "Edit email template" : "New email template"} whoFor="Create reusable CODE emails" effect="Changes save automatically once the template has a name" />
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<span aria-live="polite" className="text-sm text-muted-foreground">
						{state === "saving" ? "Saving..." : state === "saved" ? "Saved" : state === "error" ? (error ?? "Not saved") : ""}
					</span>
					{!id ? <Button disabled={pending || !name.trim()} onClick={() => startTransition(async () => { if (await flushed() && !idRef.current) await save(value); })}><Save />Save template</Button> : null}
					{id ? (
						<>
							<Button
								variant="ghost"
								disabled={pending}
								onClick={() =>
									startTransition(async () => {
										if (!(await flushed())) return;
										const result = await duplicateTemplateAction(id);
										if (result.ok) router.push(`/portal/admin/email/templates/${result.data}`);
										else toast({ message: result.error });
									})
								}
							>
								<Copy />
								Duplicate
							</Button>
							<Button
								variant="ghost"
								disabled={pending}
								onClick={() =>
									startTransition(async () => {
										if (!(await flushed())) return;
										const result = await setTemplateArchivedAction(id, true);
										if (!result.ok) return toast({ message: result.error });
										router.push("/portal/admin/email/templates");
									})
								}
							>
								<Archive />Archive
							</Button>
							<Button
								disabled={pending}
								onClick={() =>
									startTransition(async () => {
										if (!(await flushed())) return;
										router.push(`/portal/admin/email/new?template=${id}`);
									})
								}
							>
								<Send />
								Use in new email
							</Button>
						</>
					) : null}
				</div>
			</div>
			{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

			<div className="grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-2">
				<label className="grid gap-2 text-sm font-medium">
					Template name
					<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly update" maxLength={80} autoFocus={!initial.id} />
				</label>
				<label className="grid gap-2 text-sm font-medium">
					Default category
					<select value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value || null)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
						<option value="">None</option>
						{categories.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
								{c.required ? " (required)" : ""}
							</option>
						))}
					</select>
				</label>
				<TaggedField label="Subject" value={subject} onChange={setSubject} maxLength={200} placeholder="This week at CODE" />
				<TaggedField label="Preview text" value={preheader} onChange={setPreheader} maxLength={200} hint="Shown after the subject in most inboxes." />
			</div>

			<BlockEditor blocks={blocks} onChange={setBlocks} baseUrl={baseUrl} footer={footer} people={people} events={events} layout="wide" />
		</div>
	);
}
