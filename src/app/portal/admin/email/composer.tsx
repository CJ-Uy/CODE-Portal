"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, Check, CircleAlert, FlaskConical, Send } from "lucide-react";
import { AudiencePicker, ruleLabel } from "@/components/email/audience-picker";
import { BlockEditor, type EventOption, type PreviewPerson } from "@/components/email/block-editor";
import { TaggedField } from "@/components/email/tagged-field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { AudienceOptions, AudiencePreview } from "@/db/repositories/email-campaigns";
import { toLocalInput } from "@/lib/date-slots";
import type { Audience, EmailBlock, EmailCampaignStatus } from "@/lib/email/types";
import { cn } from "@/lib/utils";
import { saveCampaignAction, scheduleCampaignAction, testSendAction } from "./actions";
import { useAutosave } from "./use-autosave";

export type ComposerProps = {
	initial: {
		id: string | null;
		templateId: string | null;
		categoryId: string | null;
		senderId: string | null;
		subject: string;
		preheader: string;
		blocks: EmailBlock[];
		audience: Audience;
		status: EmailCampaignStatus;
	};
	senders: { id: string; address: string; displayName: string }[];
	categories: { id: string; name: string; required: boolean; defaultSenderId: string | null }[];
	templates: { id: string; name: string; categoryId: string | null; subject: string; preheader: string; blocks: EmailBlock[] }[];
	options: AudienceOptions;
	memberLabels: Record<string, string>;
	events: EventOption[];
	people: PreviewPerson[];
	baseUrl: string;
};

const MANILA = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Step({ n, title, done, summary, children, open, onToggle }: { n: number; title: string; done: boolean; summary: string; children: React.ReactNode; open: boolean; onToggle: () => void }) {
	return (
		<section className="rounded-xl border border-border bg-card">
			<button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full min-w-0 items-center gap-3 p-4 text-left">
				<span
					className={cn(
						"grid size-7 shrink-0 place-items-center rounded-full border text-sm tabular-nums transition-colors duration-200",
						done ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
					)}
					aria-hidden
				>
					{done ? <Check className="check-pop size-4" /> : n}
				</span>
				<span className="grid min-w-0 flex-1">
					<span className="font-medium">{title}</span>
					{!open ? <span className="min-w-0 truncate text-sm text-muted-foreground">{summary}</span> : null}
				</span>
				<span className="shrink-0 text-sm text-accent">{open ? "Done" : "Edit"}</span>
			</button>
			{open ? <div className="row-enter border-t border-border p-4">{children}</div> : null}
		</section>
	);
}

export function Composer(props: ComposerProps) {
	const { initial, senders, categories, templates, options, memberLabels, events, people, baseUrl } = props;
	const router = useRouter();
	const toast = useToast();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const mounted = useRef(true);
	const idRef = useRef(initial.id); // set synchronously so a trailing save never inserts a second row
	const [templateId, setTemplateId] = useState(initial.templateId);
	const [categoryId, setCategoryId] = useState(initial.categoryId);
	const [senderId, setSenderId] = useState(initial.senderId);
	const [subject, setSubject] = useState(initial.subject);
	const [preheader, setPreheader] = useState(initial.preheader);
	const [blocks, setBlocks] = useState(initial.blocks);
	const [audience, setAudience] = useState(initial.audience);
	const [preview, setPreview] = useState<AudiencePreview | null>(null);
	const [timing, setTiming] = useState<"now" | "at">("now");
	const [at, setAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * 60 * 60_000)).slice(0, 11) + "09:00");
	const [open, setOpen] = useState<number | null>(initial.id ? null : 1);
	const [sent, setSent] = useState(false);
	const [pending, startTransition] = useTransition();
	const category = categories.find((c) => c.id === categoryId) ?? null;
	const sender = senders.find((s) => s.id === senderId) ?? null;

	const value = useMemo(
		() => ({ templateId, categoryId, senderId, subject, preheader, blocks, audience }),
		[templateId, categoryId, senderId, subject, preheader, blocks, audience],
	);
	const save = async (v: typeof value) => {
		const result = await saveCampaignAction({ id: idRef.current ?? undefined, ...v });
		if (!result.ok) {
			toast({ message: result.error });
			return false;
		}
		if (!idRef.current) {
			idRef.current = result.data.id;
			// An unmount flush can finish the first insert after the user left; don't rewrite their new URL.
			if (mounted.current && window.location.pathname.endsWith("/email/new")) window.history.replaceState(null, "", `/portal/admin/email/sends/${result.data.id}/edit`);
		}
		return true;
	};
	const { state, flush } = useAutosave(value, save);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	// Adjust state during render (not in an effect) so the category's default sender is applied without a cascading render.
	if (category?.defaultSenderId && !senderId) setSenderId(category.defaultSenderId);

	const checks = {
		sender: Boolean(sender && category),
		audience: audience.include.length > 0 && (preview?.willReceive ?? 0) > 0,
		subject: subject.trim().length > 0,
		content: blocks.length > 0,
	};
	const ready = checks.sender && checks.audience && checks.subject && checks.content;
	const audienceSummary = audience.include.length ? audience.include.map((r) => ruleLabel(r, options, memberLabels)).join(", ") : "No one yet";
	const whenLabel = timing === "now" ? "Now (you have 2 minutes to undo)" : `${MANILA.format(new Date(`${at}:00+08:00`))} Manila time`;
	const primaryLabel = timing === "now" ? `Send to ${preview?.willReceive ?? 0} members` : `Schedule for ${MANILA.format(new Date(`${at}:00+08:00`))}`;

	const footer = useMemo(
		() => ({
			categoryName: category?.name ?? "CODE",
			required: category?.required ?? true,
			archiveUrl: `${baseUrl}/portal/mail`,
			preferencesUrl: `${baseUrl}/portal/mail/preferences`,
			unsubscribeUrl: category && !category.required ? `${baseUrl}/unsubscribe` : null,
		}),
		[category, baseUrl],
	);

	const applyTemplate = (t: ComposerProps["templates"][number]) => {
		setTemplateId(t.id);
		setSubject(t.subject);
		setPreheader(t.preheader);
		setBlocks(t.blocks);
		if (t.categoryId) setCategoryId(t.categoryId);
		toast({ message: `Started from ${t.name}.` });
	};

	const testSend = () =>
		startTransition(async () => {
			const result = await testSendAction({ subject, preheader, blocks, categoryId, senderId });
			toast({ message: result.ok ? `Test sent to ${result.data.to}.` : result.error });
		});

	const confirm = () =>
		startTransition(async () => {
			// Opened from a template and sent untouched: autosave never fired, so the first save happens here.
			let ok = await flush(value);
			if (ok && !idRef.current) ok = await save(value);
			const campaignId = idRef.current;
			if (!ok || !campaignId) return;
			const result = await scheduleCampaignAction(campaignId, timing === "now" ? { mode: "now" } : { mode: "at", local: at });
			if (!result.ok) return toast({ message: result.error });
			setSent(true);
			window.setTimeout(() => router.push(`/portal/admin/email/sends/${campaignId}`), 650);
		});

	const toggle = (n: number) => setOpen((o) => (o === n ? null : n));
	const saveLabel = state === "saving" ? "Saving..." : state === "saved" ? "Draft saved" : state === "error" ? "Not saved" : "";

	return (
		<div className="grid gap-5 pb-24 lg:pb-0">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link href="/portal/admin/email" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
					<ArrowLeft className="size-4" aria-hidden />
					Email
				</Link>
				<span aria-live="polite" className="text-sm text-muted-foreground">
					{saveLabel}
				</span>
			</div>
			{initial.status === "scheduled" ? (
				<p className="flex items-start gap-2 rounded-lg border border-[#90B4CC] bg-secondary/50 p-3 text-sm">
					<CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
					Editing moves this email back to drafts. Schedule it again when you are done.
				</p>
			) : null}

			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
				<div className="grid min-w-0 content-start gap-3">
					{!initial.id && templates.length > 0 && blocks.length === 0 ? (
						<div className="row-enter grid gap-2">
							<span className="text-sm text-muted-foreground">Start from a template</span>
							<div className="flex flex-wrap gap-2">
								{templates.slice(0, 6).map((t) => (
									<button key={t.id} type="button" onClick={() => applyTemplate(t)} className="rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:border-accent">
										{t.name}
									</button>
								))}
							</div>
						</div>
					) : null}

					<Step n={1} title="Sender and category" done={checks.sender} open={open === 1} onToggle={() => toggle(1)} summary={sender && category ? `${sender.displayName} · ${category.name}` : "Not set"}>
						<div className="grid gap-4 sm:grid-cols-2">
							<label className="grid gap-2 text-sm font-medium">
								Category
								<select value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value || null)} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm">
									<option value="">Choose</option>
									{categories.map((c) => (
										<option key={c.id} value={c.id}>
											{c.name}
											{c.required ? " (required)" : ""}
										</option>
									))}
								</select>
								<span className="text-xs font-normal text-muted-foreground">
									{category ? (category.required ? "Every member in the audience gets this." : "Members who turned this off are skipped.") : "Every email needs a category."}
								</span>
							</label>
							<label className="grid gap-2 text-sm font-medium">
								From
								<select value={senderId ?? ""} onChange={(e) => setSenderId(e.target.value || null)} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm">
									<option value="">Choose</option>
									{senders.map((s) => (
										<option key={s.id} value={s.id}>
											{s.displayName} ({s.address})
										</option>
									))}
								</select>
							</label>
						</div>
						{senders.length === 0 || categories.length === 0 ? (
							<p className="mt-3 text-sm text-muted-foreground">
								Add a sender and a category in{" "}
								<Link href="/portal/admin/email/settings" className="text-accent underline">
									Senders & categories
								</Link>{" "}
								first.
							</p>
						) : null}
					</Step>

					<Step n={2} title="Audience" done={checks.audience} open={open === 2} onToggle={() => toggle(2)} summary={`${audienceSummary}${preview ? ` · ${preview.willReceive} will receive` : ""}`}>
						<AudiencePicker value={audience} onChange={setAudience} options={options} memberLabels={memberLabels} categoryId={categoryId} categoryName={category?.name ?? null} onPreview={setPreview} />
					</Step>

					<Step n={3} title="Subject and preview text" done={checks.subject} open={open === 3} onToggle={() => toggle(3)} summary={subject || "No subject"}>
						<div className="grid gap-4">
							<TaggedField label="Subject" value={subject} onChange={setSubject} maxLength={200} placeholder="This week at CODE" />
							<TaggedField label="Preview text" value={preheader} onChange={setPreheader} maxLength={200} hint="Shown after the subject in most inboxes." />
						</div>
					</Step>

					<Step n={4} title="Content" done={checks.content} open={open === 4} onToggle={() => toggle(4)} summary={blocks.length ? `${blocks.length} blocks` : "Empty"}>
						<BlockEditor blocks={blocks} onChange={setBlocks} baseUrl={baseUrl} footer={footer} people={people} events={events} layout="compact" />
					</Step>

					<Step n={5} title="When" done open={open === 5} onToggle={() => toggle(5)} summary={whenLabel}>
						<fieldset className="grid gap-2">
							<legend className="sr-only">When to send</legend>
							{(["now", "at"] as const).map((mode) => (
								<label key={mode} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/50">
									<input type="radio" name="timing" checked={timing === mode} onChange={() => setTiming(mode)} className="mt-1 accent-[#06192F]" />
									<span className="grid gap-2">
										<span className="font-medium">{mode === "now" ? "Send now" : "Schedule"}</span>
										{mode === "now" ? (
											<span className="text-sm text-muted-foreground">Starts in 2 minutes. You can undo until then.</span>
										) : (
											<input
												type="datetime-local"
												value={at}
												min={toLocalInput(new Date())}
												onChange={(e) => setAt(e.target.value)}
												disabled={timing !== "at"}
												className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
												aria-label="Send date and time, Manila time"
											/>
										)}
									</span>
								</label>
							))}
						</fieldset>
					</Step>
				</div>

				<aside className="hidden content-start gap-3 lg:sticky lg:top-6 lg:grid lg:self-start">
					<div className="grid gap-3 rounded-xl border border-border bg-card p-4">
						<dl className="grid gap-2 text-sm">
							{[
								["From", sender ? sender.displayName : "Not set"],
								["To", preview ? `${preview.willReceive} members` : "No one yet"],
								["Category", category ? `${category.name}${category.required ? " (required)" : ""}` : "Not set"],
								["When", timing === "now" ? "Now" : MANILA.format(new Date(`${at}:00+08:00`))],
							].map(([term, detail]) => (
								<div key={term} className="flex min-w-0 justify-between gap-3">
									<dt className="text-muted-foreground">{term}</dt>
									<dd className="min-w-0 truncate text-right font-medium">{detail}</dd>
								</div>
							))}
						</dl>
						<Button variant="outline" onClick={testSend} disabled={pending || !checks.content}>
							<FlaskConical />
							Send me a test
						</Button>
						<Button onClick={() => dialogRef.current?.showModal()} disabled={!ready || pending}>
							<Send />
							Review and send
						</Button>
						{!ready ? <p className="text-xs text-muted-foreground">Finish the steps with an empty circle to send.</p> : null}
					</div>
				</aside>
			</div>

			<div className="fixed inset-x-0 bottom-20 z-30 flex items-center gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
				<span className="min-w-0 flex-1 truncate text-sm">
					<span className="font-semibold tabular-nums">{preview?.willReceive ?? 0}</span> will receive
				</span>
				<Button variant="outline" size="sm" onClick={testSend} disabled={pending || !checks.content}>
					Test
				</Button>
				<Button size="sm" onClick={() => dialogRef.current?.showModal()} disabled={!ready || pending}>
					Review
				</Button>
			</div>

			<dialog ref={dialogRef} className="email-dialog m-auto w-[min(92vw,30rem)] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl">
				<div className="grid gap-4 p-5">
					<h2 className="font-heading text-2xl">Send this email?</h2>
					<dl className="grid gap-2 text-sm">
						{[
							["From", sender ? `${sender.displayName} <${sender.address}>` : ""],
							["Category", category ? `${category.name} (${category.required ? "required, reaches everyone" : "optional"})` : ""],
							["To", audienceSummary],
							["Recipients", `${preview?.willReceive ?? 0}${preview?.optedOut.length ? ` (${preview.optedOut.length} opted out are skipped)` : ""}`],
							["Subject", subject],
							["When", whenLabel],
						].map(([term, detail]) => (
							<div key={term} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
								<dt className="text-muted-foreground">{term}</dt>
								<dd className="min-w-0 break-all sm:break-words">{detail}</dd>
							</div>
						))}
					</dl>
					<div className="flex flex-wrap justify-end gap-2">
						<Button variant="ghost" onClick={() => dialogRef.current?.close()} disabled={pending || sent}>
							Keep editing
						</Button>
						<Button onClick={confirm} disabled={pending || sent} className="min-w-44 transition-[background-color,min-width] duration-200">
							{sent ? <Check className="check-pop" /> : <Send />}
							{sent ? (timing === "now" ? "Queued" : "Scheduled") : primaryLabel}
						</Button>
					</div>
				</div>
			</dialog>
		</div>
	);
}
