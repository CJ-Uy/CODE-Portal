"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ExternalLink, FileText, Plus, X } from "lucide-react";
import { LibraryBlockEditor } from "@/components/library/library-block-editor";
import { LibraryCrumbs } from "@/components/library/library-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { isBlankBlock } from "@/lib/library/block-view";
import type { LibraryBlock } from "@/lib/library/blocks";
import {
	allowedFormats,
	defaultSource,
	ENGAGEMENT_TYPES,
	FORMAT_DETAILS,
	KIND_LABELS,
	LIBRARY_KINDS,
	SOURCE_LABELS,
	SUBTYPES,
	type LibraryAuthor,
	type LibraryFormat,
	type LibraryKind,
	type LibrarySource,
	type LibraryStatus,
} from "@/lib/library/taxonomy";
import { useAutosave } from "@/app/portal/admin/email/use-autosave";
import { attachFileAction, createTagAction, saveItemAction, searchAuthorsAction } from "../../editor-actions";
import {
	actionErrorMessage,
	LIBRARY_FILE_TYPES,
	MAX_FILE_BYTES,
	MAX_TAGS,
	publishProblems,
} from "../../editor-input";
import {
	allFieldErrors,
	buildPatch,
	describeErrors,
	fieldError,
	hasUnsaved,
	type FieldErrors,
	type FieldKey,
	type Fields,
	type PatchContext,
} from "../../editor-patch";
import { ClientDataDialog, PublishDialog } from "./publish-dialog";

export type EditorItem = {
	id: string;
	kind: LibraryKind;
	format: LibraryFormat;
	status: LibraryStatus;
	title: string;
	dek: string;
	source: LibrarySource;
	authors: LibraryAuthor[];
	subtype: string | null;
	formatDetail: string | null;
	engagementType: string | null;
	year: number | null;
	url: string | null;
	blocks: LibraryBlock[];
	tagIds: string[];
	file: { key: string; name: string; type: string; bytes: number } | null;
	moderationReason: string | null;
	containsClientData: boolean | null;
};
type TagOption = { id: string; name: string; groupName: string };
type ItemOption = { id: string; title: string };

const SELECT_CLASS = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const ENGAGEMENT_KINDS = new Set<LibraryKind>(["code_document", "template", "case_study"]);
const YEAR_KINDS = new Set<LibraryKind>(["code_document", "template", "case_study", "reading"]);
const FILE_LABELS: Record<string, string> = { pdf: "PDF", docx: "Word", pptx: "PowerPoint", xlsx: "Excel" };
const FILE_ACCEPT = ".pdf,.docx,.pptx,.xlsx";
const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
	return (
		<section className="grid min-w-0 gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
			<div>
				<h2 className="font-heading text-xl">{title}</h2>
				{hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
			</div>
			{children}
		</section>
	);
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
	return (
		<label className="grid min-w-0 gap-2 text-sm font-medium">
			{label}
			{children}
			{error ? (
				<span role="alert" className="text-xs font-normal text-destructive [overflow-wrap:anywhere]">
					{error}
				</span>
			) : hint ? (
				<span className="text-xs font-normal text-muted-foreground">{hint}</span>
			) : null}
		</label>
	);
}

function AuthorPicker({ disabled, onAdd }: { disabled: boolean; onAdd: (author: LibraryAuthor) => void }) {
	const [query, setQuery] = useState("");
	const [found, setFound] = useState<{ id: string; name: string }[]>([]);
	const term = query.trim();

	useEffect(() => {
		if (term.length < 2) return;
		let live = true;
		const timer = window.setTimeout(async () => {
			const results = await searchAuthorsAction(term).catch(() => []);
			if (live) setFound(results);
		}, 250);
		return () => {
			live = false;
			window.clearTimeout(timer);
		};
	}, [term]);

	const add = (author: LibraryAuthor) => {
		onAdd(author);
		setQuery("");
		setFound([]);
	};

	return (
		<div className="grid min-w-0 gap-2">
			<Field label="Add an author" hint="Type a name. Pick a CODE member to link their profile, or add the name as written.">
				<Input
					value={query}
					maxLength={120}
					disabled={disabled}
					autoComplete="off"
					placeholder="Name"
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						if (term) add({ name: term });
					}}
				/>
			</Field>
			{term ? (
				<ul className="grid min-w-0 gap-1 rounded-lg border border-border p-1">
					{(term.length >= 2 ? found : []).map((member) => (
						<li key={member.id} className="min-w-0">
							<button
								type="button"
								onClick={() => add({ name: member.name, memberId: member.id })}
								className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
							>
								<span className="min-w-0 [overflow-wrap:anywhere]">{member.name}</span>
								<span className="shrink-0 text-xs text-muted-foreground">CODE member</span>
							</button>
						</li>
					))}
					<li className="min-w-0">
						<button type="button" onClick={() => add({ name: term })} className="flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary">
							<Plus className="size-4 shrink-0" aria-hidden />
							<span className="min-w-0 [overflow-wrap:anywhere]">Add &ldquo;{term}&rdquo; as written</span>
						</button>
					</li>
				</ul>
			) : null}
		</div>
	);
}

function TagPicker({ options, selected, onChange, onCreated }: { options: TagOption[]; selected: string[]; onChange: (ids: string[]) => void; onCreated: (tag: TagOption) => void }) {
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [creating, setCreating] = useState(false);
	const inputId = useId();
	const chosen = new Set(selected);
	const full = selected.length >= MAX_TAGS;
	const groups = new Map<string, TagOption[]>();
	for (const tag of options) groups.set(tag.groupName, [...(groups.get(tag.groupName) ?? []), tag]);

	const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((value) => value !== id) : full ? selected : [...selected, id]);

	const create = async () => {
		const clean = name.trim();
		if (!clean || creating) return;
		setCreating(true);
		setError("");
		try {
			const result = await createTagAction(clean);
			if (!result.ok) {
				setError(result.error);
				return;
			}
			onCreated(result.tag);
			if (!chosen.has(result.tag.id) && !full) onChange([...selected, result.tag.id]);
			setName("");
		} catch {
			setError(NETWORK_ERROR);
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="grid min-w-0 gap-4">
			<p className="text-sm text-muted-foreground">
				{selected.length} of {MAX_TAGS} chosen
			</p>
			{[...groups].map(([group, tags]) => (
				<fieldset key={group} className="grid min-w-0 gap-2">
					<legend className="mb-1 text-sm font-medium text-muted-foreground">{group}</legend>
					<div className="flex flex-wrap gap-2">
						{tags.map((tag) => {
							const on = chosen.has(tag.id);
							return (
								<button
									key={tag.id}
									type="button"
									aria-pressed={on}
									disabled={!on && full}
									onClick={() => toggle(tag.id)}
									className="max-w-full [overflow-wrap:anywhere] rounded-full border border-border px-3 py-1.5 text-left text-sm transition-colors hover:border-accent disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
								>
									{tag.name}
								</button>
							);
						})}
					</div>
				</fieldset>
			))}
			<div className="grid min-w-0 gap-2">
				<label htmlFor={inputId} className="text-sm font-medium">
					Create a tag
				</label>
				<div className="flex min-w-0 gap-2">
					<Input
						id={inputId}
						value={name}
						maxLength={60}
						className="min-w-0"
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							void create();
						}}
					/>
					<Button type="button" variant="outline" disabled={!name.trim() || creating} onClick={() => void create()}>
						{creating ? "Creating..." : "Create"}
					</Button>
				</div>
				{error ? (
					<p role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">
						{error}
					</p>
				) : (
					<p className="text-xs text-muted-foreground">It goes live at once for everyone. Check the list first so it is not a duplicate.</p>
				)}
			</div>
		</div>
	);
}

const STATUS_BADGE: Record<LibraryStatus, { label: string; variant: "secondary" | "info" | "success" | "warn" }> = {
	draft: { label: "Draft", variant: "secondary" },
	pending_review: { label: "Waiting for approval", variant: "info" },
	published: { label: "Published", variant: "success" },
	taken_down: { label: "Taken down", variant: "warn" },
};

function StatusNote({ item, isOwner }: { item: EditorItem; isOwner: boolean }) {
	const reason = item.moderationReason;
	let text: React.ReactNode;
	if (item.status === "pending_review") text = "Waiting for a library moderator to approve it. Other members cannot see it yet. You can keep editing.";
	else if (item.status === "published") text = "Live. What you change here is what readers see, right away.";
	else if (item.status === "taken_down") text = `A library moderator took this down${reason ? `: ${reason}` : "."} Edit it to fix the problem. Only a moderator can publish it again.`;
	else if (reason) text = `A library moderator sent this back: ${reason} Make the changes, then publish again.`;
	else text = isOwner ? "Only you and library moderators can see this until you publish it." : "A draft. Only its owner and library moderators can see it.";
	// A moderator's reason is free text: anywhere-wrapping keeps a long unbroken one inside the card without splitting ordinary words.
	return <p className="min-w-0 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm [overflow-wrap:anywhere]">{text}</p>;
}

export function ItemEditor({ item, tags, itemPicker, isOwner }: { item: EditorItem; tags: TagOption[]; itemPicker: ItemOption[]; isOwner: boolean }) {
	const toast = useToast();
	const [kind, setKind] = useState(item.kind);
	const [title, setTitle] = useState(item.title);
	const [dek, setDek] = useState(item.dek);
	const [source, setSource] = useState(item.source);
	const [authors, setAuthors] = useState(item.authors);
	const [subtype, setSubtype] = useState(item.subtype);
	const [formatDetail, setFormatDetail] = useState(item.formatDetail);
	const [engagementType, setEngagementType] = useState(item.engagementType);
	const [year, setYear] = useState(item.year === null ? "" : String(item.year));
	const [url, setUrl] = useState(item.url ?? "");
	const [blocks, setBlocks] = useState(item.blocks);
	const [tagIds, setTagIds] = useState(item.tagIds);
	const [tagOptions, setTagOptions] = useState(tags);
	const [file, setFile] = useState(item.file);
	const [touched, setTouched] = useState<Set<FieldKey>>(new Set());
	const [saveError, setSaveError] = useState("");
	const [fileUploading, setFileUploading] = useState(false);
	const [fileError, setFileError] = useState("");
	const [publishOpen, setPublishOpen] = useState(false);
	const [flagOpen, setFlagOpen] = useState(false);

	const fileBusy = useRef(false);
	const imageBusy = useRef(false);
	const onImageUploading = useCallback((busy: boolean) => {
		imageBusy.current = busy;
	}, []);

	// What the editor needs to know about the item it saves into; a live item must keep its link or its page.
	const ctx: PatchContext = useMemo(
		() => ({ itemId: item.id, format: item.format, live: item.status !== "draft", had: { link: Boolean(item.url), content: !item.blocks.every(isBlankBlock) } }),
		[item.id, item.format, item.status, item.url, item.blocks],
	);

	const value: Fields = useMemo(
		() => ({ kind, title, dek, source, authors, subtype, formatDetail, engagementType, year, url, blocks, tagIds }),
		[kind, title, dek, source, authors, subtype, formatDetail, engagementType, year, url, blocks, tagIds],
	);
	const savedRef = useRef<Fields>(value);
	const valueRef = useRef(value);
	useEffect(() => {
		valueRef.current = value;
	});

	// Never save mid-upload: wait for it to settle (at most a minute) so the item is never written while its file or image is half-way in.
	const settle = async () => {
		for (let waited = 0; (fileBusy.current || imageBusy.current) && waited < 240; waited++) await sleep(250);
	};

	const save = async (now: Fields) => {
		await settle();
		const { patch, keys, errors } = buildPatch(ctx, now, savedRef.current);
		if (patch) {
			const result = await saveItemAction(patch).catch(() => ({ ok: false as const, error: NETWORK_ERROR }));
			if (!result.ok) {
				setSaveError(result.error);
				return false;
			}
			savedRef.current = { ...savedRef.current, ...Object.fromEntries(keys.map((key) => [key, now[key]])) } as Fields;
		}
		// A field that is not valid was left out of the save. That is not "Saved": say which one, and keep it unsaved.
		const rejected = describeErrors(errors);
		setSaveError(rejected.join(" "));
		return rejected.length === 0;
	};
	const { state, flush } = useAutosave(value, save, 2000);

	// Closing the tab inside the two-second window, or mid-upload, would lose work: ask first.
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (fileBusy.current || imageBusy.current || hasUnsaved(ctx, valueRef.current, savedRef.current)) event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [ctx]);

	// A big page is not cheap to check, so it is checked when the page changes, not on every keystroke elsewhere.
	const blocksError = useMemo(() => fieldError(ctx, "blocks", blocks), [ctx, blocks]);
	const errors: FieldErrors = useMemo(() => allFieldErrors(ctx, value, blocksError), [ctx, value, blocksError]);
	const touch = (key: FieldKey) => setTouched((current) => new Set(current).add(key));
	const shown = (key: "title" | "year" | "url") => (touched.has(key) ? (errors[key] ?? null) : null);

	const kinds = LIBRARY_KINDS.filter((candidate) => candidate === kind || allowedFormats(candidate).includes(item.format));
	const subtypes: readonly string[] | null = kind === "code_document" ? SUBTYPES.code_document : kind === "reading" ? SUBTYPES.reading : null;
	const showFormatDetail = kind === "code_document" && subtype === "Module";

	const changeKind = (next: LibraryKind) => {
		// Facets belong to a type: carry over the ones the new type has and drop the rest.
		const nextSubtypes: readonly string[] | null = next === "code_document" ? SUBTYPES.code_document : next === "reading" ? SUBTYPES.reading : null;
		const keepSubtype = subtype !== null && (nextSubtypes?.includes(subtype) ?? false);
		setSource((current) => (current === defaultSource(kind) ? defaultSource(next) : current));
		setSubtype(keepSubtype ? subtype : null);
		if (!(next === "code_document" && keepSubtype && subtype === "Module")) setFormatDetail(null);
		if (!ENGAGEMENT_KINDS.has(next)) setEngagementType(null);
		if (!YEAR_KINDS.has(next)) setYear("");
		setKind(next);
	};

	const uploadFile = async (picked: File) => {
		setFileError("");
		const extension = picked.name.split(".").pop()?.toLowerCase() ?? "";
		const type = LIBRARY_FILE_TYPES[extension] ?? picked.type;
		if (!Object.values(LIBRARY_FILE_TYPES).includes(type)) return setFileError("Upload a PDF, Word, PowerPoint or Excel file.");
		if (picked.size === 0) return setFileError("That file is empty.");
		if (picked.size > MAX_FILE_BYTES) return setFileError("Files can be up to 50 MB.");
		fileBusy.current = true;
		setFileUploading(true);
		try {
			const body = new FormData();
			body.set("purpose", "library_file");
			body.set("itemId", item.id);
			body.set("file", new File([picked], picked.name, { type }));
			let response: Response;
			try {
				response = await fetch("/api/uploads", { method: "POST", credentials: "same-origin", body });
			} catch {
				return setFileError(NETWORK_ERROR);
			}
			const result = (await response.json().catch(() => ({}))) as { key?: string; error?: string };
			if (!response.ok || !result.key) return setFileError(result.error || "Could not upload the file. Try again.");
			try {
				await attachFileAction({ itemId: item.id, key: result.key, name: picked.name, type, bytes: picked.size });
			} catch (error) {
				return setFileError(actionErrorMessage(error, "The file uploaded but could not be attached. Try again."));
			}
			setFile({ key: result.key, name: picked.name, type, bytes: picked.size });
			toast({ message: "File uploaded." });
		} finally {
			fileBusy.current = false;
			setFileUploading(false);
		}
	};

	// Publishing waits for every field to be valid, and says which one is not. Missing content is reported once, not again as a field error.
	const problems = [
		...publishProblems({ format: item.format, title, fileKey: file?.key ?? null, url: url.trim() || null, blocks }).filter(
			(problem) => !(errors.title && problem === "Add a title.") && !(errors.url && problem === "Add the link."),
		),
		...describeErrors(errors),
	];
	const canPublish = isOwner && item.status === "draft";
	const status = STATUS_BADGE[item.status];
	const saveLabel = state === "saving" ? "Saving..." : state === "saved" ? "Saved" : state === "error" ? "Not saved" : "Saves as you go";
	const fileExtension = file ? (file.key.split(".").pop()?.toLowerCase() ?? "") : "";

	return (
		<div className="mx-auto grid max-w-6xl gap-5">
			<LibraryCrumbs
				trail={[
					{ label: "My items", href: "/portal/library/mine" },
					...(item.status === "draft" ? [] : [{ label: title.trim() || "Untitled", href: `/portal/library/${item.id}` }]),
					{ label: "Edit" },
				]}
			/>

			<h1 className="font-heading text-3xl">Edit {KIND_LABELS[kind]}</h1>
			{/* Stays under the app bar (64px, 68px on wide screens) through the long form, so whether the work is saved, and the way to publish, never scroll out of sight. */}
			<div className="sticky top-16 z-20 -mx-4 flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2 sm:-mx-6 sm:px-6 lg:top-[68px] lg:-mx-8 lg:px-8">
				<Badge variant={status.variant}>{status.label}</Badge>
				<span role="status" aria-live="polite" className="min-w-16 text-sm text-muted-foreground">
					{saveLabel}
				</span>
				<span className="flex-1" />
				{item.status !== "draft" ? (
					<Button asChild variant="outline" size="sm" className="min-h-9">
						<Link href={`/portal/library/${item.id}`}>View</Link>
					</Button>
				) : null}
				{canPublish ? (
					<Button type="button" className="min-h-9" onClick={() => setPublishOpen(true)}>
						Publish
					</Button>
				) : null}
			</div>

			<StatusNote item={item} isOwner={isOwner} />
			{saveError ? (
				<p role="alert" className="min-w-0 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive [overflow-wrap:anywhere]">
					Not saved: {saveError}
				</p>
			) : null}

			<div className="grid max-w-3xl min-w-0 gap-5">
				<Section title="The basics">
					<Field label="Title" error={shown("title")}>
						<Input value={title} maxLength={200} aria-invalid={Boolean(shown("title"))} onChange={(event) => setTitle(event.target.value)} onBlur={() => touch("title")} />
					</Field>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Type">
							<select value={kind} onChange={(event) => changeKind(event.target.value as LibraryKind)} className={SELECT_CLASS}>
								{kinds.map((candidate) => (
									<option key={candidate} value={candidate}>
										{KIND_LABELS[candidate]}
									</option>
								))}
							</select>
						</Field>
						<Field label="Source">
							<select value={source} onChange={(event) => setSource(event.target.value as LibrarySource)} className={SELECT_CLASS}>
								{(Object.keys(SOURCE_LABELS) as LibrarySource[]).map((candidate) => (
									<option key={candidate} value={candidate}>
										{SOURCE_LABELS[candidate]}
									</option>
								))}
							</select>
						</Field>
					</div>
					<Field label="Summary" hint="One or two sentences that tell a reader what they get. Shown on the card.">
						<Textarea value={dek} maxLength={500} rows={3} onChange={(event) => setDek(event.target.value)} />
					</Field>
				</Section>
			</div>

			{item.format === "file" ? (
				<Section title="The file" hint="PDF, Word, PowerPoint or Excel, up to 50 MB. PDFs open in the page; Office files download.">
					<div className="grid max-w-3xl min-w-0 gap-4">
						{file ? (
							<div className="flex min-w-0 items-center gap-3 rounded-lg border border-border p-3">
								<FileText className="size-8 shrink-0 text-accent" aria-hidden />
								<div className="min-w-0 flex-1">
									<p className="min-w-0 break-all text-sm font-medium">{file.name}</p>
									<p className="text-xs text-muted-foreground">
										{FILE_LABELS[fileExtension] ?? "File"} &middot; {formatBytes(file.bytes)}
									</p>
								</div>
								<Button asChild variant="outline" size="sm">
									<a href={`/api/uploads/${encodeURIComponent(file.key)}?name=${encodeURIComponent(file.name)}`} target="_blank" rel="noreferrer">
										Open
										<ExternalLink aria-hidden />
									</a>
								</Button>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">No file yet.</p>
						)}
						<Field label={fileUploading ? "Uploading... keep this page open" : file ? "Replace the file" : "Choose a file"} error={fileError}>
							<Input
								type="file"
								accept={FILE_ACCEPT}
								disabled={fileUploading}
								onChange={(event) => {
									const picked = event.target.files?.[0];
									if (picked) void uploadFile(picked);
									event.target.value = "";
								}}
							/>
						</Field>
					</div>
				</Section>
			) : null}

			{item.format === "link" ? (
				<Section title="The link" hint="Readers get a card that opens this address in a new tab.">
					<div className="grid max-w-3xl min-w-0 gap-4">
						<Field label="Address" error={shown("url")} hint="Starts with https://">
							<Input
								inputMode="url"
								maxLength={2000}
								placeholder="https://"
								value={url}
								aria-invalid={Boolean(shown("url"))}
								onChange={(event) => setUrl(event.target.value)}
								onBlur={() => touch("url")}
							/>
						</Field>
						{url.trim() && !errors.url ? (
							<a href={url.trim()} target="_blank" rel="noreferrer noopener" className="inline-flex w-fit max-w-full items-center gap-1 text-sm text-accent underline">
								<span className="min-w-0 [overflow-wrap:anywhere]">Check the link</span>
								<ExternalLink className="size-3.5 shrink-0" aria-hidden />
							</a>
						) : null}
					</div>
				</Section>
			) : null}

			{item.format === "page" ? (
				<Section title="The page" hint="Add blocks from the list, then select one to edit it. Changes save by themselves.">
					<LibraryBlockEditor itemId={item.id} blocks={blocks} onChange={setBlocks} itemPicker={itemPicker} onUploadingChange={onImageUploading} />
				</Section>
			) : null}

			<div className="grid max-w-3xl min-w-0 gap-5">
				<Section title="Authors" hint="Credit everyone who wrote it. This is a credit only; the owner is who can edit.">
					{authors.length > 0 ? (
						<ul className="grid min-w-0 gap-2">
							{authors.map((author, index) => (
								<li key={index} className="flex min-w-0 items-center gap-2">
									<Input
										aria-label={`Author ${index + 1}`}
										value={author.name}
										maxLength={120}
										className="min-w-0"
										onChange={(event) => setAuthors((current) => current.map((candidate, at) => (at === index ? { ...candidate, name: event.target.value } : candidate)))}
									/>
									{author.memberId ? <Badge variant="info" className="shrink-0">Linked</Badge> : null}
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label={`Remove ${author.name || `author ${index + 1}`}`}
										onClick={() => setAuthors((current) => current.filter((_, at) => at !== index))}
									>
										<X />
									</Button>
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm text-muted-foreground">No authors yet.</p>
					)}
					{authors.some((author) => !author.name.trim()) ? <p className="text-xs text-muted-foreground">A row with no name is not saved.</p> : null}
					<AuthorPicker disabled={authors.length >= 20} onAdd={(author) => setAuthors((current) => (current.length >= 20 ? current : [...current, author]))} />
				</Section>

				{(subtypes || ENGAGEMENT_KINDS.has(kind) || YEAR_KINDS.has(kind)) ? (
					<Section title="Details" hint="These are the filters people use to find it.">
						<div className="grid gap-4 sm:grid-cols-2">
							{subtypes ? (
								<Field label="Kind of document">
									<select
										value={subtype ?? ""}
										onChange={(event) => {
											const next = event.target.value || null;
											setSubtype(next);
											if (next !== "Module") setFormatDetail(null);
										}}
										className={SELECT_CLASS}
									>
										<option value="">Not set</option>
										{subtypes.map((option) => (
											<option key={option} value={option}>
												{option}
											</option>
										))}
									</select>
								</Field>
							) : null}
							{showFormatDetail ? (
								<Field label="Module format">
									<select value={formatDetail ?? ""} onChange={(event) => setFormatDetail(event.target.value || null)} className={SELECT_CLASS}>
										<option value="">Not set</option>
										{FORMAT_DETAILS.map((option) => (
											<option key={option} value={option}>
												{option}
											</option>
										))}
									</select>
								</Field>
							) : null}
							{ENGAGEMENT_KINDS.has(kind) ? (
								<Field label="Engagement type">
									<select value={engagementType ?? ""} onChange={(event) => setEngagementType(event.target.value || null)} className={SELECT_CLASS}>
										<option value="">Not set</option>
										{ENGAGEMENT_TYPES.map((option) => (
											<option key={option} value={option}>
												{option}
											</option>
										))}
									</select>
								</Field>
							) : null}
							{YEAR_KINDS.has(kind) ? (
								<Field label="Year" error={shown("year")} hint="The year it was written.">
									<Input
										inputMode="numeric"
										maxLength={4}
										value={year}
										aria-invalid={Boolean(shown("year"))}
										onChange={(event) => setYear(event.target.value.replace(/\D/g, ""))}
										onBlur={() => touch("year")}
									/>
								</Field>
							) : null}
						</div>
					</Section>
				) : null}

				<Section title="Tags" hint="Pick the topics it covers. Tags are how people find it.">
					<TagPicker options={tagOptions} selected={tagIds} onChange={setTagIds} onCreated={(tag) => setTagOptions((current) => (current.some((candidate) => candidate.id === tag.id) ? current : [...current, tag]))} />
				</Section>

				{canPublish ? (
					<Section title="Ready to share?" hint="Publishing asks one question about client data, then tells you what happens next. Members cannot delete or unpublish later, so check it first.">
						<div>
							<Button type="button" onClick={() => setPublishOpen(true)}>
								Publish
							</Button>
						</div>
					</Section>
				) : null}

				{item.status === "published" && item.containsClientData !== true ? (
					<Section title="Client data" hint="If you notice this item now includes a client's name or data, tell the moderators. It is hidden until they approve it.">
						<div>
							<Button type="button" variant="outline" onClick={() => setFlagOpen(true)}>
								This now includes client names or client data
							</Button>
						</div>
					</Section>
				) : null}
			</div>

			<PublishDialog
				open={publishOpen}
				onOpenChange={setPublishOpen}
				itemId={item.id}
				problems={problems}
				beforePublish={() => flush(valueRef.current)}
			/>
			<ClientDataDialog open={flagOpen} onOpenChange={setFlagOpen} itemId={item.id} />
		</div>
	);
}

