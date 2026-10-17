"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
	ArrowDown, ArrowUp, BookMarked, Bold, Code, Copy, GripVertical, Heading, Image as ImageIcon, Info, Italic, Link2,
	List, ListOrdered, Minus, Quote, Redo2, Trash2, Type, Undo2,
} from "lucide-react";
import { libraryBlockSchema, newLibraryBlock, type LibraryBlock } from "@/lib/library/blocks";
import { itemsToText, textToItems, wrapSelection, type InlineMark } from "@/lib/library/inline-edit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { isBlankBlock, LibraryBlockView } from "./library-blocks";

type ItemOption = { id: string; title: string };
type Props = {
	/** The library item being written; image uploads are filed under it. */
	itemId: string;
	blocks: LibraryBlock[];
	onChange: (blocks: LibraryBlock[]) => void;
	/** Items a page may embed. */
	itemPicker: ItemOption[];
};

// Image, item and link blocks need a value that only exists after an upload, a pick
// or a valid address. They get a side-panel form and join the page once it is complete.
type Composer = "image" | "item" | "link";
type PaletteEntry = { key: string; label: string; icon: typeof Type } & ({ make: () => LibraryBlock } | { compose: Composer });

function numberedList(): LibraryBlock {
	const block = newLibraryBlock("list");
	return block.type === "list" ? { ...block, props: { ...block.props, ordered: true } } : block;
}

const PALETTE: PaletteEntry[] = [
	{ key: "heading", label: "Heading", icon: Heading, make: () => newLibraryBlock("heading") },
	{ key: "text", label: "Text", icon: Type, make: () => newLibraryBlock("text") },
	{ key: "bulleted", label: "Bulleted list", icon: List, make: () => newLibraryBlock("list") },
	{ key: "numbered", label: "Numbered list", icon: ListOrdered, make: numberedList },
	{ key: "quote", label: "Quote", icon: Quote, make: () => newLibraryBlock("quote") },
	{ key: "callout", label: "Callout", icon: Info, make: () => newLibraryBlock("callout") },
	{ key: "code", label: "Code", icon: Code, make: () => newLibraryBlock("code") },
	{ key: "image", label: "Image", icon: ImageIcon, compose: "image" },
	{ key: "divider", label: "Divider", icon: Minus, make: () => newLibraryBlock("divider") },
	{ key: "item", label: "Library item", icon: BookMarked, compose: "item" },
	{ key: "link", label: "Link card", icon: Link2, compose: "link" },
];

const TYPE_LABELS: Record<LibraryBlock["type"], string> = {
	heading: "heading", text: "text", list: "list", quote: "quote", callout: "callout", code: "code",
	image: "image", divider: "divider", item: "library item", link: "link card",
};

const MARKS: { mark: InlineMark; label: string; icon: typeof Bold }[] = [
	{ mark: "bold", label: "Bold", icon: Bold },
	{ mark: "italic", label: "Italic", icon: Italic },
	{ mark: "link", label: "Link", icon: Link2 },
];

const MAX_BLOCKS = 300; // matches libraryBlocksSchema
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // matches the library_image upload rule
const NO_EMBEDS = new Map<string, never>();
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const SELECT_CLASS = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";

/** Same test the saved block gets, so the editor and the schema never disagree. */
const isHttpsUrl = (value: string) => libraryBlockSchema.safeParse({ id: "check", type: "link", props: { url: value, title: "" } }).success;

function Segmented<T extends string | number | boolean>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
	return (
		<div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-lg border border-border bg-background p-0.5">
			{options.map((option) => (
				<button
					key={String(option.value)}
					type="button"
					role="radio"
					aria-checked={option.value === value}
					onClick={() => onChange(option.value)}
					className="rounded-md px-2.5 py-1 text-sm transition-colors aria-checked:bg-primary aria-checked:text-primary-foreground"
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

/** A text field with a Bold / Italic / Link toolbar that wraps the selection in the library markup. */
function InlineField({ label, value, onChange, multiline = false, rows = 4, maxLength, hint, toolbar = true }: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	multiline?: boolean;
	rows?: number;
	maxLength?: number;
	hint?: string;
	toolbar?: boolean;
}) {
	const id = useId();
	const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
	const apply = (mark: InlineMark) => {
		const el = ref.current;
		if (!el) return;
		const result = wrapSelection(value, el.selectionStart ?? value.length, el.selectionEnd ?? value.length, mark);
		if (maxLength && result.value.length > maxLength) return;
		onChange(result.value);
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(result.start, result.end);
		});
	};
	return (
		<div className="grid min-w-0 gap-2">
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={id} className="text-sm font-medium">{label}</label>
				{toolbar ? (
					<div role="group" aria-label={`${label} formatting`} className="flex gap-0.5">
						{MARKS.map(({ mark, label: markLabel, icon: Icon }) => (
							<button
								key={mark}
								type="button"
								aria-label={markLabel}
								title={markLabel}
								onMouseDown={(e) => e.preventDefault()} // keep the selection in the field
								onClick={() => apply(mark)}
								className="rounded-md p-1.5 transition-colors hover:bg-secondary"
							>
								<Icon className="size-4" aria-hidden />
							</button>
						))}
					</div>
				) : null}
			</div>
			{multiline ? (
				<Textarea id={id} ref={ref} rows={rows} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} />
			) : (
				<Input id={id} ref={ref} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} />
			)}
			{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
		</div>
	);
}

function PlainField({ label, value, onChange, maxLength, multiline = false, rows = 3, hint, mono = false }: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	maxLength: number;
	multiline?: boolean;
	rows?: number;
	hint?: string;
	mono?: boolean;
}) {
	return (
		<label className="grid min-w-0 gap-2 text-sm font-medium">
			{label}
			{multiline ? (
				<Textarea rows={rows} maxLength={maxLength} value={value} spellCheck={!mono} className={cn(mono && "font-mono")} onChange={(e) => onChange(e.target.value)} />
			) : (
				<Input maxLength={maxLength} value={value} spellCheck={!mono} onChange={(e) => onChange(e.target.value)} />
			)}
			{hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
		</label>
	);
}

/**
 * Address field that only passes a complete https:// address on. While the text is
 * not one yet the block keeps its last good address, so the page never holds a bad link.
 */
function UrlField({ value, onCommit }: { value: string; onCommit: (url: string) => void }) {
	const [draft, setDraft] = useState(value);
	const [seen, setSeen] = useState(value);
	if (value !== seen) {
		// The block changed underneath us (undo, redo, another block): show its address.
		setSeen(value);
		setDraft(value);
	}
	const valid = isHttpsUrl(draft);
	return (
		<label className="grid min-w-0 gap-2 text-sm font-medium">
			Link address
			<Input
				inputMode="url"
				maxLength={2000}
				placeholder="https://"
				value={draft}
				aria-invalid={!valid}
				onChange={(e) => {
					setDraft(e.target.value);
					if (isHttpsUrl(e.target.value)) onCommit(e.target.value.trim());
				}}
			/>
			{!valid ? <span role="alert" className="text-xs font-normal text-destructive">Use a link that starts with https://. The card keeps its last good address until then.</span> : null}
		</label>
	);
}

function ComposerPanel({ kind, itemPicker, uploading, uploadError, onUpload, onPickItem, onAddLink, onCancel }: {
	kind: Composer;
	itemPicker: ItemOption[];
	uploading: boolean;
	uploadError: string;
	onUpload: (file: File) => void;
	onPickItem: (itemId: string) => void;
	onAddLink: (url: string, title: string, description: string) => void;
	onCancel: () => void;
}) {
	const [filter, setFilter] = useState("");
	const [url, setUrl] = useState("");
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const matches = itemPicker.filter((item) => item.title.toLowerCase().includes(filter.trim().toLowerCase()));
	const linkReady = isHttpsUrl(url) && title.trim().length > 0;

	return (
		<div className="grid grid-cols-1 content-start gap-4 rounded-xl border border-border bg-card p-4">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">{kind === "image" ? "Add an image" : kind === "item" ? "Embed a library item" : "Add a link card"}</h3>
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
			</div>

			{kind === "image" ? (
				<>
					<label className="grid gap-2 text-sm font-medium">
						{uploading ? "Uploading image..." : "Choose an image"}
						<Input
							type="file"
							accept={IMAGE_ACCEPT}
							disabled={uploading}
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) onUpload(file);
								e.target.value = "";
							}}
						/>
						<span className="text-xs font-normal text-muted-foreground">PNG, JPG, WebP or GIF, up to 10 MB. It joins the page once it uploads.</span>
					</label>
					{uploadError ? <p role="alert" className="text-sm text-destructive">{uploadError}</p> : null}
				</>
			) : null}

			{kind === "item" ? (
				<>
					<label className="grid gap-2 text-sm font-medium">
						Search items
						<Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Title" />
					</label>
					{itemPicker.length === 0 ? <p className="text-sm text-muted-foreground">There are no other items to embed yet.</p> : null}
					{itemPicker.length > 0 && matches.length === 0 ? <p className="text-sm text-muted-foreground">Nothing matches that.</p> : null}
					<ul className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto">
						{matches.slice(0, 50).map((item) => (
							<li key={item.id} className="min-w-0">
								<button type="button" onClick={() => onPickItem(item.id)} className="block w-full min-w-0 break-all rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary">
									{item.title}
								</button>
							</li>
						))}
					</ul>
					{matches.length > 50 ? <p className="text-xs text-muted-foreground">Showing the first 50. Search to narrow the list.</p> : null}
				</>
			) : null}

			{kind === "link" ? (
				<form
					className="grid gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (linkReady) onAddLink(url.trim(), title.trim(), description.trim());
					}}
				>
					<label className="grid gap-2 text-sm font-medium">
						Link address
						<Input inputMode="url" maxLength={2000} placeholder="https://" value={url} aria-invalid={url !== "" && !isHttpsUrl(url)} onChange={(e) => setUrl(e.target.value)} />
						{url !== "" && !isHttpsUrl(url) ? <span role="alert" className="text-xs font-normal text-destructive">Use a link that starts with https://</span> : null}
					</label>
					<PlainField label="Title" maxLength={200} value={title} onChange={setTitle} />
					<PlainField label="Description (optional)" maxLength={2000} multiline value={description} onChange={setDescription} />
					<Button type="submit" disabled={!linkReady}>Add link card</Button>
				</form>
			) : null}
		</div>
	);
}

export function LibraryBlockEditor({ itemId, blocks, onChange, itemPicker }: Props) {
	const [selectedId, setSelectedId] = useState<string | null>(blocks[0]?.id ?? null);
	const [past, setPast] = useState<LibraryBlock[][]>([]);
	const [future, setFuture] = useState<LibraryBlock[][]>([]);
	const [dragId, setDragId] = useState<string | null>(null);
	const [drop, setDrop] = useState<{ index: number } | null>(null);
	const [composer, setComposer] = useState<Composer | null>(null);
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState("");
	// What async work (an upload finishing) should see, not what the render that started it saw.
	const latest = useRef({ blocks, selectedId });
	useEffect(() => { latest.current = { blocks, selectedId }; });
	const lastCommit = useRef(0);
	const canvasRef = useRef<HTMLDivElement>(null);

	const selected = blocks.find((b) => b.id === selectedId) ?? null;
	const titles = new Map(itemPicker.map((item) => [item.id, item.title]));
	const full = blocks.length >= MAX_BLOCKS;

	const commit = useCallback(
		(next: LibraryBlock[], coalesce = false) => {
			const now = Date.now();
			if (!coalesce || now - lastCommit.current > 800) setPast((p) => [...p.slice(-49), latest.current.blocks]);
			lastCommit.current = now;
			setFuture([]);
			onChange(next);
		},
		[onChange],
	);
	const undo = () => {
		const previous = past.at(-1);
		if (!previous) return;
		lastCommit.current = 0;
		setPast((p) => p.slice(0, -1));
		setFuture((f) => [blocks, ...f]);
		onChange(previous);
	};
	const redo = () => {
		const next = future[0];
		if (!next) return;
		lastCommit.current = 0;
		setFuture((f) => f.slice(1));
		setPast((p) => [...p, blocks]);
		onChange(next);
	};

	/** Adds a block after the selected one. A block that does not validate yet never gets in. */
	const insert = (block: LibraryBlock): boolean => {
		const { blocks: current, selectedId: at } = latest.current;
		if (current.length >= MAX_BLOCKS || !libraryBlockSchema.safeParse(block).success) return false;
		const after = at ? current.findIndex((b) => b.id === at) : -1;
		const index = after < 0 ? current.length : after + 1;
		commit([...current.slice(0, index), block, ...current.slice(index)]);
		setSelectedId(block.id);
		requestAnimationFrame(() => canvasRef.current?.querySelector(`[data-block-id="${block.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
		return true;
	};
	const update = (id: string, props: object) =>
		commit(latest.current.blocks.map((b) => (b.id === id ? ({ ...b, props: { ...b.props, ...props } } as LibraryBlock) : b)), true);

	async function uploadImage(file: File): Promise<string | null> {
		setUploadError("");
		if (file.size > MAX_IMAGE_BYTES) {
			setUploadError("Images can be up to 10 MB.");
			return null;
		}
		setUploading(true);
		try {
			const body = new FormData();
			body.set("purpose", "library_image");
			body.set("itemId", itemId);
			body.set("file", file);
			const response = await fetch("/api/uploads", { method: "POST", credentials: "same-origin", body });
			const result = (await response.json().catch(() => ({}))) as { key?: string; error?: string };
			if (!response.ok || !result.key) throw new Error(result.error || "Could not upload the image. Try again.");
			return result.key;
		} catch (error) {
			setUploadError(error instanceof Error ? error.message : "Could not upload the image. Try again.");
			return null;
		} finally {
			setUploading(false);
		}
	}
	async function addImage(file: File) {
		const key = await uploadImage(file);
		if (!key) return;
		const block = newLibraryBlock("image");
		if (block.type === "image" && insert({ ...block, props: { ...block.props, key } })) setComposer(null);
		else setUploadError("The image uploaded but could not be added to the page.");
	}
	async function replaceImage(id: string, file: File) {
		const key = await uploadImage(file);
		if (key) update(id, { key });
	}
	const addItem = (pickedId: string) => {
		const block = newLibraryBlock("item");
		if (block.type === "item" && insert({ ...block, props: { itemId: pickedId } })) setComposer(null);
	};
	const addLink = (url: string, title: string, description: string) => {
		const block = newLibraryBlock("link");
		if (block.type === "link" && insert({ ...block, props: { url, title, ...(description ? { description } : {}) } })) setComposer(null);
	};

	const move = (id: string, delta: -1 | 1) => {
		const i = blocks.findIndex((b) => b.id === id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= blocks.length) return;
		const next = [...blocks];
		[next[i], next[j]] = [next[j], next[i]];
		commit(next);
		requestAnimationFrame(() => canvasRef.current?.querySelector<HTMLElement>(`[data-block-id="${id}"]`)?.focus());
	};
	const remove = (id: string) => {
		const i = blocks.findIndex((b) => b.id === id);
		commit(blocks.filter((b) => b.id !== id));
		setSelectedId(blocks[i + 1]?.id ?? blocks[i - 1]?.id ?? null);
	};
	const duplicate = (id: string) => {
		const source = blocks.find((b) => b.id === id);
		if (!source || full) return;
		const copy = { ...structuredClone(source), id: `blk_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}` };
		const i = blocks.findIndex((b) => b.id === id);
		commit([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)]);
		setSelectedId(copy.id);
	};
	const moveTo = (id: string, index: number) => {
		const from = blocks.findIndex((b) => b.id === id);
		if (from < 0) return;
		const next = blocks.filter((b) => b.id !== id);
		next.splice(index > from ? index - 1 : index, 0, blocks[from]);
		commit(next);
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) redo();
				else undo();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const palette = (
		<div className="flex gap-1.5 overflow-x-auto pb-1 md:grid md:content-start md:overflow-visible md:pb-0">
			{PALETTE.map((entry) => {
				const Icon = entry.icon;
				return (
					<button
						key={entry.key}
						type="button"
						disabled={full}
						aria-pressed={"compose" in entry ? composer === entry.compose : undefined}
						onClick={() => {
							if ("compose" in entry) {
								setUploadError("");
								setComposer((open) => (open === entry.compose ? null : entry.compose));
							} else {
								setComposer(null);
								insert(entry.make());
							}
						}}
						className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-[transform,border-color] hover:border-accent active:scale-[0.97] disabled:opacity-50 aria-pressed:border-accent"
					>
						<Icon className="size-4 text-muted-foreground" aria-hidden />
						{entry.label}
					</button>
				);
			})}
		</div>
	);

	const toolbar = (
		<div className="flex flex-wrap items-center justify-between gap-2">
			<div className="flex items-center gap-1">
				<button type="button" onClick={undo} disabled={past.length === 0} aria-label="Undo" className="rounded-md p-1.5 transition-colors hover:bg-secondary disabled:opacity-40">
					<Undo2 className="size-4" />
				</button>
				<button type="button" onClick={redo} disabled={future.length === 0} aria-label="Redo" className="rounded-md p-1.5 transition-colors hover:bg-secondary disabled:opacity-40">
					<Redo2 className="size-4" />
				</button>
			</div>
			<p className="text-xs text-muted-foreground">{blocks.length} of {MAX_BLOCKS} blocks</p>
		</div>
	);

	const canvas = (
		<div className="grid min-w-0 grid-cols-1 gap-3">
			{toolbar}
			<div ref={canvasRef} className="rounded-xl border border-border bg-card p-3 sm:px-14 sm:py-6">
				{blocks.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Add a block from the list to start writing.</p> : null}
				{blocks.map((block, index) => {
					const isSelected = block.id === selectedId;
					return (
						<div
							key={block.id}
							data-block-id={block.id}
							tabIndex={0}
							role="group"
							aria-roledescription="block"
							aria-label={`Block ${index + 1}: ${TYPE_LABELS[block.type]}`}
							aria-current={isSelected ? "true" : undefined}
							onClick={() => { setSelectedId(block.id); setComposer(null); }}
							onKeyDown={(e) => {
								if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
								e.preventDefault();
								setSelectedId(block.id);
								setComposer(null);
							}}
							onDragOver={(e) => {
								if (!dragId) return;
								e.preventDefault();
								const rect = e.currentTarget.getBoundingClientRect();
								setDrop({ index: e.clientY < rect.top + rect.height / 2 ? index : index + 1 });
							}}
							onDrop={(e) => {
								e.preventDefault();
								if (dragId && drop) moveTo(dragId, drop.index);
								setDragId(null);
								setDrop(null);
							}}
							className={cn(
								"group relative min-w-0 cursor-pointer rounded-md px-2 py-2 transition-[transform,box-shadow,opacity] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
								isSelected ? "outline outline-2 -outline-offset-2 outline-ring" : "hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-border",
								dragId === block.id && "scale-[1.02] opacity-60 shadow-lg",
							)}
						>
							{drop?.index === index ? <div className="absolute inset-x-2 -top-px z-10 h-0.5 rounded bg-primary" aria-hidden /> : null}
							{drop?.index === index + 1 && index === blocks.length - 1 ? <div className="absolute inset-x-2 -bottom-px z-10 h-0.5 rounded bg-primary" aria-hidden /> : null}
							<button
								type="button"
								draggable
								onDragStart={(e) => {
									setDragId(block.id);
									e.dataTransfer.effectAllowed = "move";
								}}
								onDragEnd={() => {
									setDragId(null);
									setDrop(null);
								}}
								aria-label="Drag to reorder"
								className="absolute -left-10 top-2 hidden cursor-grab rounded p-1 text-muted-foreground hover:bg-secondary sm:group-hover:block"
							>
								<GripVertical className="size-4" />
							</button>
							<div inert className="min-w-0">
								{block.type === "item" ? (
									<div className="min-w-0 rounded-xl border border-border p-4 text-sm">
										<span className="text-xs text-muted-foreground">Library item</span>
										<div className="min-w-0 break-all font-medium">{titles.get(block.props.itemId) ?? "This item is not in your list"}</div>
									</div>
								) : isBlankBlock(block) ? (
									<p className="text-sm italic text-muted-foreground">Empty {TYPE_LABELS[block.type]}</p>
								) : (
									<LibraryBlockView block={block} embeds={NO_EMBEDS} />
								)}
							</div>
							{isSelected ? (
								<div className="absolute -top-3 right-1 z-10 flex gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-md sm:-right-12 sm:top-1 sm:flex-col">
									<button type="button" aria-label="Move up" onClick={(e) => { e.stopPropagation(); move(block.id, -1); }} className="rounded p-1 hover:bg-secondary">
										<ArrowUp className="size-4" />
									</button>
									<button type="button" aria-label="Move down" onClick={(e) => { e.stopPropagation(); move(block.id, 1); }} className="rounded p-1 hover:bg-secondary">
										<ArrowDown className="size-4" />
									</button>
									<button type="button" aria-label="Duplicate" disabled={full} onClick={(e) => { e.stopPropagation(); duplicate(block.id); }} className="rounded p-1 hover:bg-secondary disabled:opacity-40">
										<Copy className="size-4" />
									</button>
									<button type="button" aria-label="Delete" onClick={(e) => { e.stopPropagation(); remove(block.id); }} className="rounded p-1 hover:bg-secondary">
										<Trash2 className="size-4" />
									</button>
								</div>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);

	const inspector = (
		// Keyed so a field's own draft state never carries over to a different block.
		<div key={selected?.id ?? "none"} className="grid grid-cols-1 content-start gap-4 rounded-xl border border-border bg-card p-4">
			{!selected ? <p className="text-sm text-muted-foreground">Select a block to edit it.</p> : null}
			{selected?.type === "heading" ? (
				<>
					<InlineField label="Heading" value={selected.props.text} maxLength={200} onChange={(text) => update(selected.id, { text })} />
					<Segmented label="Heading size" value={selected.props.level} onChange={(level) => update(selected.id, { level })} options={[{ value: 2, label: "Section" }, { value: 3, label: "Subsection" }]} />
				</>
			) : null}
			{selected?.type === "text" ? (
				<InlineField
					label="Text"
					multiline
					rows={8}
					maxLength={10_000}
					value={selected.props.text}
					onChange={(text) => update(selected.id, { text })}
					hint="Select words, then use Bold, Italic or Link. A blank line starts a new paragraph."
				/>
			) : null}
			{selected?.type === "list" ? (
				<>
					<Segmented label="List style" value={selected.props.ordered} onChange={(ordered) => update(selected.id, { ordered })} options={[{ value: false, label: "Bulleted" }, { value: true, label: "Numbered" }]} />
					<InlineField
						label="Items"
						multiline
						rows={8}
						value={itemsToText(selected.props.items)}
						onChange={(text) => update(selected.id, { items: textToItems(text) })}
						hint="One item per line, up to 100."
					/>
				</>
			) : null}
			{selected?.type === "quote" ? (
				<>
					<InlineField label="Quote" multiline rows={5} maxLength={10_000} value={selected.props.text} onChange={(text) => update(selected.id, { text })} />
					<InlineField label="Source (optional)" maxLength={200} value={selected.props.cite ?? ""} onChange={(cite) => update(selected.id, { cite: cite || undefined })} />
				</>
			) : null}
			{selected?.type === "callout" ? (
				<>
					<Segmented label="Callout kind" value={selected.props.tone} onChange={(tone) => update(selected.id, { tone })} options={[{ value: "note", label: "Note" }, { value: "tip", label: "Tip" }]} />
					<InlineField label="Callout" multiline rows={5} maxLength={10_000} value={selected.props.text} onChange={(text) => update(selected.id, { text })} />
				</>
			) : null}
			{selected?.type === "code" ? (
				<>
					<PlainField label="Code" multiline mono rows={10} maxLength={20_000} value={selected.props.code} onChange={(code) => update(selected.id, { code })} />
					<PlainField label="Language label (optional)" mono maxLength={40} value={selected.props.language ?? ""} onChange={(language) => update(selected.id, { language: language || undefined })} hint="Shown above the code. There is no syntax colouring." />
				</>
			) : null}
			{selected?.type === "image" ? (
				<>
					<PlainField label="Description for screen readers" maxLength={200} value={selected.props.alt} onChange={(alt) => update(selected.id, { alt })} hint="Say what the image shows." />
					<PlainField label="Caption (optional)" maxLength={300} value={selected.props.caption ?? ""} onChange={(caption) => update(selected.id, { caption: caption || undefined })} />
					<label className="grid gap-2 text-sm font-medium">
						{uploading ? "Uploading image..." : "Replace image"}
						<Input
							type="file"
							accept={IMAGE_ACCEPT}
							disabled={uploading}
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) void replaceImage(selected.id, file);
								e.target.value = "";
							}}
						/>
						<span className="text-xs font-normal text-muted-foreground">PNG, JPG, WebP or GIF, up to 10 MB.</span>
					</label>
					{uploadError ? <p role="alert" className="text-sm text-destructive">{uploadError}</p> : null}
				</>
			) : null}
			{selected?.type === "divider" ? <p className="text-sm text-muted-foreground">A thin line between sections. No settings.</p> : null}
			{selected?.type === "item" ? (
				<label className="grid min-w-0 gap-2 text-sm font-medium">
					Library item
					<select value={selected.props.itemId} onChange={(e) => update(selected.id, { itemId: e.target.value })} className={SELECT_CLASS}>
						{titles.has(selected.props.itemId) ? null : <option value={selected.props.itemId}>This item is not in your list</option>}
						{itemPicker.map((item) => (
							<option key={item.id} value={item.id}>{item.title}</option>
						))}
					</select>
					<span className="text-xs font-normal text-muted-foreground">Readers see a card, or &ldquo;Not available&rdquo; if they cannot open the item.</span>
				</label>
			) : null}
			{selected?.type === "link" ? (
				<>
					<UrlField value={selected.props.url} onCommit={(url) => update(selected.id, { url })} />
					<PlainField label="Title" maxLength={200} value={selected.props.title} onChange={(title) => update(selected.id, { title })} />
					<PlainField label="Description (optional)" multiline maxLength={2000} value={selected.props.description ?? ""} onChange={(description) => update(selected.id, { description: description || undefined })} />
				</>
			) : null}
		</div>
	);

	const side = composer ? (
		<ComposerPanel
			key={composer}
			kind={composer}
			itemPicker={itemPicker}
			uploading={uploading}
			uploadError={uploadError}
			onUpload={(file) => void addImage(file)}
			onPickItem={addItem}
			onAddLink={addLink}
			onCancel={() => setComposer(null)}
		/>
	) : (
		inspector
	);

	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_300px]">
			<div className="min-w-0">{palette}</div>
			{canvas}
			<div className="min-w-0 md:col-span-2 xl:col-span-1">{side}</div>
		</div>
	);
}
