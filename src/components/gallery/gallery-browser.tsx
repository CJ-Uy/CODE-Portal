"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, CheckSquare, Download, Eye, FolderInput, FolderPlus, Globe, Heart, ImagePlus, LayoutGrid, Link2, Pencil, Plus, Settings2, Trash2, Upload, X } from "lucide-react";
import type { GalleryEventOption, GalleryFolderCard, GalleryFolderOption, GalleryFolderView, GalleryItemView, GalleryMemberOption } from "@/db/repositories/gallery";
import { Breadcrumb } from "@/components/portal/breadcrumb";
import { EmptyState } from "@/components/portal/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { countLabel, formatBytes, fromManilaInput, GALLERY_BATCH, galleryFileUrl, groupByDay, toManilaInput } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";
import {
	createFolderAction,
	deleteFolderAction,
	deleteItemsAction,
	moveFolderAction,
	moveItemsAction,
	addTagAction,
	recordViewAction,
	removeTagAction,
	restoreAction,
	setHeartAction,
	updateFolderAction,
	updateItemAction,
	type GalleryActionResult,
} from "@/app/portal/gallery/actions";
import { FolderCards } from "./folder-cards";
import { GalleryTimeline } from "./gallery-timeline";
import { Lightbox } from "./lightbox";
import { Scrapbook } from "./scrapbook";
import { UploadPanel, useUploadQueue } from "./upload-panel";

const ACCEPT = "image/*,video/*,.heic,.heif,.mov,.m4v";
const uploadedOn = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", dateStyle: "medium" });
const takenOn = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
const lightboxButton = "grid size-10 place-items-center rounded-full text-white/85 transition-colors hover:bg-white/12 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#90b4cc]";

export type GalleryBrowserProps = {
	title: string;
	crumbs: { label: string; href?: string }[];
	meta?: ReactNode;
	folder: GalleryFolderView["folder"];
	subfolders: GalleryFolderCard[];
	items: GalleryItemView[];
	folderOptions: GalleryFolderOption[];
	eventOptions: GalleryEventOption[];
	canManage: boolean;
	/** Where uploads and new folders go. Undefined on views that are not a folder (an event's photos). */
	uploadFolderId?: string | null;
	/** The event an untagged photo here belongs to: the folder's own or nearest tag, or the event a page is about. */
	inheritedEvent?: { id: string; title: string } | null;
	/** Members who can be tagged in a photo. */
	memberOptions: GalleryMemberOption[];
	/** "day" groups photos under the day they were taken; "none" keeps the order given (a "Most loved" list). */
	grouping?: "day" | "none";
	/** Shown when there are no photos and no albums, instead of the upload prompt. Null shows nothing. */
	empty?: ReactNode;
	/** Extra content between the header and the photos (search results' albums, browse controls). */
	children?: ReactNode;
};

type View = "scrapbook" | "grid";

type OpenSheet = { kind: "newFolder" } | { kind: "folder" } | { kind: "move"; itemIds: string[] } | { kind: "moveFolder" } | null;

async function inBatches(ids: string[], run: (chunk: string[]) => Promise<GalleryActionResult<unknown>>): Promise<GalleryActionResult<unknown>> {
	for (let start = 0; start < ids.length; start += GALLERY_BATCH) {
		const result = await run(ids.slice(start, start + GALLERY_BATCH));
		if (!result.ok) return result;
	}
	return { ok: true, value: undefined };
}

export function GalleryBrowser({
	title,
	crumbs,
	meta,
	folder,
	subfolders,
	items,
	folderOptions,
	eventOptions,
	canManage,
	uploadFolderId,
	inheritedEvent = null,
	memberOptions,
	grouping = "day",
	empty,
	children,
}: GalleryBrowserProps) {
	const router = useRouter();
	const toast = useToast();
	const queue = useUploadQueue();
	const fileInput = useRef<HTMLInputElement>(null);
	const searchParams = useSearchParams();
	const [selecting, setSelecting] = useState(false);
	const [picked, setSelected] = useState<Set<string>>(new Set());
	// A shared link can open straight onto one photo: /portal/gallery/<folder>?photo=<id>.
	const [openId, setOpenId] = useState<string | null>(() => searchParams.get("photo"));
	// Albums open as a scrapbook; the grid is for scanning and selecting. ?view=grid keeps the choice in the link.
	const [view, setViewState] = useState<View>(() => (searchParams.get("view") === "grid" ? "grid" : "scrapbook"));
	function setView(next: View) {
		setViewState(next);
		const url = new URL(window.location.href);
		if (next === "grid") url.searchParams.set("view", "grid");
		else url.searchParams.delete("view");
		window.history.replaceState(window.history.state, "", url);
	}
	// Hearts change on tap; the server's count replaces the guess when it answers.
	const [heartOverrides, setHeartOverrides] = useState<Map<string, { hearted: boolean; count: number }>>(new Map());
	const viewed = useRef(new Set<string>());
	const [sheet, setSheet] = useState<OpenSheet>(null);
	const [dragging, setDragging] = useState(false);
	const [busy, setBusy] = useState(false);
	const canUpload = uploadFolderId !== undefined;
	const shownItems = useMemo(
		() =>
			items.map((item) => {
				const override = heartOverrides.get(item.id);
				return override ? { ...item, hearted: override.hearted, heartCount: override.count } : item;
			}),
		[items, heartOverrides],
	);
	const groups = useMemo(
		() => (grouping === "none" ? [{ key: "all", label: "", items: shownItems }] : groupByDay(shownItems).map((group) => ({ ...group, detail: countLabel(group.items) }))),
		[shownItems, grouping],
	);
	const folderName = useMemo(() => new Map(folderOptions.map((option) => [option.id, option.name])), [folderOptions]);
	// A selection only holds what is still on screen after a refresh (someone else may have moved a photo away).
	const selected = useMemo(() => new Set([...picked].filter((id) => items.some((item) => item.id === id))), [picked, items]);

	// The lightbox is a modal layer over the page's toasts, so while it is open, results show inside it instead.
	const openRef = useRef(openId);
	const [notice, setNotice] = useState<{ message: string; action?: { label: string; onClick(): void } } | null>(null);
	const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	function announce(message: string, action?: { label: string; onClick(): void }) {
		if (!openRef.current) return toast({ message, action });
		if (noticeTimer.current) clearTimeout(noticeTimer.current);
		setNotice({ message, action });
		noticeTimer.current = setTimeout(() => setNotice(null), action ? 6000 : 4000);
	}

	// On phones the toolbar scrolls away with the roll; a floating Upload takes over once it is out of view.
	const uploadButton = useRef<HTMLButtonElement>(null);
	const [toolbarHidden, setToolbarHidden] = useState(false);
	useEffect(() => {
		const button = uploadButton.current;
		if (!button) return;
		const observer = new IntersectionObserver(([entry]) => setToolbarHidden(!entry.isIntersecting));
		observer.observe(button);
		return () => observer.disconnect();
	}, []);

	function openPhoto(id: string | null) {
		// One view per photo per visit, so flicking back and forth does not inflate "Most viewed".
		if (id && !viewed.current.has(id)) {
			viewed.current.add(id);
			void recordViewAction(id);
		}
		openRef.current = id;
		if (!id) setNotice(null);
		setOpenId(id);
		const url = new URL(window.location.href);
		if (id) url.searchParams.set("photo", id);
		else url.searchParams.delete("photo");
		window.history.replaceState(window.history.state, "", url);
	}

	useEffect(() => {
		if (!selecting) return;
		const onKey = (event: KeyboardEvent) => event.key === "Escape" && stopSelecting();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selecting]);

	function stopSelecting() {
		setSelecting(false);
		setSelected(new Set());
	}

	function addFiles(files: FileList | File[] | null) {
		if (!canUpload || !files) return;
		const list = [...files].filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/") || /\.(heic|heif|mov|m4v)$/i.test(file.name));
		if (list.length) queue.add(list, uploadFolderId ?? null);
		else if (files.length) toast({ message: "Only photos and videos go in the gallery." });
	}

	async function act(work: () => Promise<GalleryActionResult<unknown>>, success?: { message: string; undo?: () => Promise<GalleryActionResult<unknown>> }) {
		setBusy(true);
		const result = await work();
		setBusy(false);
		if (!result.ok) {
			announce(result.error);
			return false;
		}
		if (success) {
			const undo = success.undo;
			announce(
				success.message,
				undo
					? {
							label: "Restore",
							onClick: () => {
								void undo().then((restored) => announce(restored.ok ? "Restored." : restored.error));
							},
						}
					: undefined,
			);
		}
		return true;
	}

	/** Moving or deleting the photo on screen steps the viewer to its neighbour first, so the result has somewhere to show. */
	function stepAwayFrom(ids: string[]) {
		if (!openRef.current || !ids.includes(openRef.current)) return;
		const index = items.findIndex((item) => item.id === openRef.current);
		const rest = (from: number, step: number) => {
			for (let at = from; at >= 0 && at < items.length; at += step) if (!ids.includes(items[at].id)) return items[at].id;
			return null;
		};
		openPhoto(rest(index + 1, 1) ?? rest(index - 1, -1));
	}

	async function deleteItems(ids: string[]) {
		const what = countLabel(items.filter((item) => ids.includes(item.id)));
		const done = await act(() => inBatches(ids, (chunk) => deleteItemsAction({ itemIds: chunk })), {
			message: `Deleted ${what}. ${ids.length === 1 ? "It stays" : "They stay"} in Recently deleted for 30 days.`,
			undo: () => inBatches(ids, (chunk) => restoreAction({ itemIds: chunk, folderIds: [] })),
		});
		if (done) stopSelecting();
	}

	async function toggleHeart(item: GalleryItemView) {
		const current = heartOverrides.get(item.id) ?? { hearted: item.hearted, count: item.heartCount };
		const next = { hearted: !current.hearted, count: Math.max(0, current.count + (current.hearted ? -1 : 1)) };
		setHeartOverrides((map) => new Map(map).set(item.id, next));
		const result = await setHeartAction({ itemId: item.id, on: next.hearted });
		if (result.ok) setHeartOverrides((map) => new Map(map).set(item.id, { hearted: next.hearted, count: result.value.heartCount }));
		else {
			setHeartOverrides((map) => new Map(map).set(item.id, current));
			announce(result.error);
		}
	}

	async function copyLink(item: GalleryItemView) {
		const url = new URL(window.location.href);
		url.searchParams.set("photo", item.id);
		url.searchParams.delete("view");
		try {
			await navigator.clipboard.writeText(url.toString());
			announce("Link copied. Only signed-in members can open it.");
		} catch {
			announce("Could not copy the link.");
		}
	}

	async function moveItems(ids: string[], target: string | null) {
		stepAwayFrom(ids);
		const done = await act(() => inBatches(ids, (chunk) => moveItemsAction({ itemIds: chunk, folderId: target })), {
			message: `Moved ${countLabel(items.filter((item) => ids.includes(item.id)))} to ${target ? folderName.get(target) : "the top level"}.`,
		});
		if (done) {
			setSheet(null);
			stopSelecting();
		}
	}

	return (
		<div
			className="relative grid gap-6 [--gallery-sticky-top:3.5rem] lg:[--gallery-sticky-top:4.25rem]"
			onDragOver={(event) => {
				if (!canUpload || !event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				setDragging(true);
			}}
			onDragLeave={(event) => {
				if (event.currentTarget === event.target) setDragging(false);
			}}
			onDrop={(event) => {
				if (!canUpload) return;
				event.preventDefault();
				setDragging(false);
				addFiles(event.dataTransfer.files);
			}}
		>
			<header className="grid gap-3">
				{crumbs.length ? <Breadcrumb items={crumbs} /> : null}
				<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
					<div className="grid min-w-0 gap-1">
						<h1 className="[overflow-wrap:anywhere] font-heading text-3xl leading-tight sm:text-4xl">{title}</h1>
						{meta ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">{meta}</div> : null}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{canUpload ? (
							<>
								<Button ref={uploadButton} onClick={() => fileInput.current?.click()}>
									<Upload />
									Add photos
								</Button>
								<input ref={fileInput} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => {
									addFiles(event.target.files);
									event.target.value = "";
								}} />
								<Button variant="outline" onClick={() => setSheet({ kind: "newFolder" })} aria-label="New album" className="max-sm:w-10 max-sm:px-0">
									<FolderPlus />
									<span className="max-sm:sr-only">New album</span>
								</Button>
							</>
						) : null}
						{items.length && !selecting ? (
							<div role="group" aria-label="Layout" className="inline-flex rounded-md border border-border bg-card p-0.5">
								{(["scrapbook", "grid"] as const).map((option) => (
									<button
										key={option}
										type="button"
										aria-pressed={view === option}
										aria-label={option === "scrapbook" ? "Scrapbook" : "Grid"}
										title={option === "scrapbook" ? "Scrapbook" : "Grid"}
										onClick={() => setView(option)}
										className={cn(
											"grid size-8 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
											view === option && "bg-secondary text-secondary-foreground",
										)}
									>
										{option === "scrapbook" ? <BookOpen className="size-4" /> : <LayoutGrid className="size-4" />}
									</button>
								))}
							</div>
						) : null}
						{items.length ? (
							<Button
								variant={selecting ? "secondary" : "ghost"}
								aria-pressed={selecting}
								aria-label={selecting ? "Done selecting" : "Select"}
								className="max-sm:w-10 max-sm:px-0"
								onClick={() => {
									if (selecting) return stopSelecting();
									// Selecting is a grid job: tiles line up and the check discs sit in the same corner.
									setView("grid");
									setSelecting(true);
								}}
							>
								<CheckSquare />
								<span className="max-sm:sr-only">{selecting ? "Done" : "Select"}</span>
							</Button>
						) : null}
						{folder ? (
							<Button variant="ghost" size="icon" aria-label="Album settings" title="Album settings" onClick={() => setSheet({ kind: "folder" })}>
								<Settings2 />
							</Button>
						) : null}
					</div>
				</div>
			</header>

			{children}

			{subfolders.length ? <FolderCards folders={subfolders} hrefFor={(id) => `/portal/gallery/${id}`} layout={items.length ? "strip" : "grid"} /> : null}

			{items.length && view === "scrapbook" && !selecting ? (
				<Scrapbook groups={groups} onOpen={(item) => openPhoto(item.id)} />
			) : items.length ? (
				<GalleryTimeline
					groups={groups}
					selecting={selecting}
					selected={selected}
					onTile={(item) => {
						if (!selecting) return openPhoto(item.id);
						setSelected((current) => {
							const next = new Set(current);
							if (next.has(item.id)) next.delete(item.id);
							else next.add(item.id);
							return next;
						});
					}}
				/>
			) : subfolders.length === 0 ? (
				(empty !== undefined ? empty : (
					<EmptyState
						icon={ImagePlus}
						title={canUpload ? "No photos here yet" : "No photos yet"}
						description={canUpload ? "Add photos and videos, or drop them anywhere on this page." : "Photos from this event show up here."}
						action={canUpload ? <Button onClick={() => fileInput.current?.click()}><Upload />Add photos</Button> : undefined}
					/>
				))
			) : null}

			{selecting ? (
				<div role="toolbar" aria-label="Selected photos" className="fixed inset-x-3 bottom-24 z-40 mx-auto lg:left-[15.75rem] flex max-w-xl flex-wrap items-center gap-1 rounded-lg bg-primary px-3 py-2 text-primary-foreground shadow-[0_12px_32px_-8px_rgba(6,25,47,0.45)] md:bottom-6">
					<p className="mr-auto px-1 text-sm font-semibold tabular-nums" aria-live="polite">
						{selected.size ? `${selected.size} selected` : "Select photos"}
					</p>
					<Button size="sm" variant="ghost" className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}>
						{selected.size === items.length ? "Clear" : "Select all"}
					</Button>
					<Button size="sm" variant="ghost" className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground" disabled={!selected.size || busy} onClick={() => setSheet({ kind: "move", itemIds: [...selected] })}>
						<FolderInput />
						Move
					</Button>
					<Button size="sm" variant="ghost" className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground" disabled={!selected.size || busy} onClick={() => void deleteItems([...selected])}>
						<Trash2 />
						Delete
					</Button>
					<Button size="icon" variant="ghost" className="size-8 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground" aria-label="Stop selecting" onClick={stopSelecting}>
						<X />
					</Button>
				</div>
			) : null}

			<Lightbox
				items={shownItems}
				openId={openId}
				onOpenChange={openPhoto}
				toolbar={(item) => (
					<>
						<button
							type="button"
							className={cn(lightboxButton, "inline-flex w-auto items-center gap-1.5 px-3")}
							aria-pressed={item.hearted}
							aria-label={item.hearted ? "Remove your heart" : "Heart this photo"}
							title={item.hearted ? "Remove your heart" : "Heart this photo"}
							onClick={() => void toggleHeart(item)}
						>
							<Heart className={cn("size-5", item.hearted && "fill-[#f08a8a] text-[#f08a8a]")} />
							{item.heartCount ? <span className="text-sm font-semibold tabular-nums">{item.heartCount}</span> : null}
						</button>
						<button type="button" className={cn(lightboxButton, "max-sm:hidden")} aria-label="Copy link" title="Copy link" onClick={() => void copyLink(item)}>
							<Link2 className="size-5" />
						</button>
						<a href={galleryFileUrl(item.fileKey, { download: item.originalName })} className={lightboxButton} aria-label="Download original" title="Download original">
							<Download className="size-5" />
						</a>
						<button type="button" className={lightboxButton} aria-label="Move" title="Move" onClick={() => setSheet({ kind: "move", itemIds: [item.id] })}>
							<FolderInput className="size-5" />
						</button>
						<button
							type="button"
							className={lightboxButton}
							aria-label="Delete"
							title="Delete"
							disabled={busy}
							onClick={() => {
								stepAwayFrom([item.id]);
								void deleteItems([item.id]);
							}}
						>
							<Trash2 className="size-5" />
						</button>
					</>
				)}
				notice={notice}
				panel={(item) => (
					<ItemDetails
						key={item.id}
						item={item}
						inheritedEvent={inheritedEvent}
						folderLabel={item.folderId ? folderName.get(item.folderId) ?? "An album" : "Not in an album"}
						eventOptions={eventOptions}
						memberOptions={memberOptions}
						onSave={(patch) => act(() => updateItemAction({ itemId: item.id, ...patch }), { message: "Saved." })}
						onAddTag={(input) => act(() => addTagAction({ itemId: item.id, ...input }))}
						onRemoveTag={(tagId) => act(() => removeTagAction({ tagId }))}
					/>
				)}
			/>

			{canUpload ? <UploadPanel queue={queue} /> : null}

			{canUpload && toolbarHidden && !selecting && queue.uploads.length === 0 ? (
				<button
					type="button"
					onClick={() => fileInput.current?.click()}
					aria-label="Upload photos and videos"
					className="fixed bottom-24 right-4 z-30 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_20px_-6px_rgba(6,25,47,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:hidden"
				>
					<Upload className="size-6" />
				</button>
			) : null}

			{dragging ? (
				<div aria-hidden className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-xl border-2 border-dashed border-accent! bg-secondary/80 backdrop-blur-sm">
					<p className="font-heading text-2xl text-secondary-foreground">Drop to add to {folder?.name ?? "the gallery"}</p>
				</div>
			) : null}

			<Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
				<SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
					{sheet?.kind === "newFolder" ? (
						<NewFolderForm
							parentName={folder?.name ?? "the gallery"}
							onCreate={async (name) => {
								const result = await createFolderAction({ name, parentId: uploadFolderId ?? null });
								if (!result.ok) return toast({ message: result.error });
								setSheet(null);
								router.push(`/portal/gallery/${result.value}`);
							}}
						/>
					) : null}
					{sheet?.kind === "move" ? (
						<FolderPicker
							title={`Move ${countLabel(items.filter((item) => sheet.itemIds.includes(item.id)))}`}
							options={folderOptions}
							current={items.find((item) => item.id === sheet.itemIds[0])?.folderId ?? null}
							busy={busy}
							onPick={(target) => void moveItems(sheet.itemIds, target)}
						/>
					) : null}
					{sheet?.kind === "moveFolder" && folder ? (
						<FolderPicker
							title={`Move "${folder.name}"`}
							options={folderOptions}
							current={folder.parentId}
							exclude={folder.id}
							busy={busy}
							onPick={async (target) => {
								if (await act(() => moveFolderAction({ folderId: folder.id, parentId: target }), { message: `Moved "${folder.name}".` })) setSheet(null);
							}}
						/>
					) : null}
					{sheet?.kind === "folder" && folder ? (
						<FolderSettings
							folder={folder}
							eventOptions={eventOptions}
							canManage={canManage}
							busy={busy}
							onSave={async (patch) => {
								if (await act(() => updateFolderAction({ folderId: folder.id, ...patch }), { message: "Album saved." })) setSheet(null);
							}}
							onMove={() => setSheet({ kind: "moveFolder" })}
							onDelete={async () => {
								const parent = folder.parentId ? `/portal/gallery/${folder.parentId}` : "/portal/gallery";
								const done = await act(() => deleteFolderAction({ folderId: folder.id }), {
									message: `Deleted "${folder.name}" and everything in it. It stays in Recently deleted for 30 days.`,
									undo: () => restoreAction({ itemIds: [], folderIds: [folder.id] }),
								});
								if (done) {
									setSheet(null);
									router.push(parent);
								}
							}}
						/>
					) : null}
				</SheetContent>
			</Sheet>
		</div>
	);
}

export function NewFolderForm({ parentName, onCreate }: { parentName: string; onCreate(name: string): Promise<unknown> }) {
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);
	return (
		<form
			className="grid gap-4"
			onSubmit={async (event) => {
				event.preventDefault();
				setSaving(true);
				await onCreate(name);
				setSaving(false);
			}}
		>
			<SheetHeader>
				<SheetTitle className="font-heading text-xl">New album</SheetTitle>
				<SheetDescription>Inside {parentName}. Anyone can add to it, rename it or move it.</SheetDescription>
			</SheetHeader>
			<div className="grid gap-4 px-4">
				<label className="grid gap-1.5 text-sm font-medium">
					Name
					<Input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Leadership Summit, Day 1" />
				</label>
				<Button type="submit" disabled={saving || !name.trim()}>
					{saving ? "Creating..." : "Create album"}
				</Button>
			</div>
		</form>
	);
}

export function FolderPicker({ title, options, current, exclude, busy, onPick }: { title: string; options: GalleryFolderOption[]; current: string | null; exclude?: string; busy: boolean; onPick(target: string | null): void }) {
	// A folder cannot go into itself or anything under it.
	const blocked = useMemo(() => {
		const out = new Set<string>(exclude ? [exclude] : []);
		for (const option of options) if (option.parentId && out.has(option.parentId)) out.add(option.id);
		return out;
	}, [options, exclude]);
	const row = "flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
	return (
		<div className="grid gap-2">
			<SheetHeader>
				<SheetTitle className="font-heading text-xl">{title}</SheetTitle>
				<SheetDescription>Choose where it goes. Albums marked with a globe are on the CODE website.</SheetDescription>
			</SheetHeader>
			<ul className="grid gap-0.5 px-2 pb-6">
				<li>
					<button type="button" className={row} disabled={busy || current === null} onClick={() => onPick(null)}>
						<span className="flex-1 font-medium">Not in an album</span>
						{current === null ? <span className="text-xs text-muted-foreground">Here now</span> : null}
					</button>
				</li>
				{options
					.filter((option) => !blocked.has(option.id))
					.map((option) => (
						<li key={option.id}>
							<button type="button" className={row} style={{ paddingLeft: `${0.75 + option.depth * 1.25}rem` }} disabled={busy || option.id === current} onClick={() => onPick(option.id)}>
								<span className="min-w-0 flex-1 truncate">{option.name}</span>
								{option.isPublic ? <Globe className="size-3.5 shrink-0 text-accent" aria-label="Public" /> : null}
								{option.id === current ? <span className="shrink-0 text-xs text-muted-foreground">Here now</span> : null}
							</button>
						</li>
					))}
			</ul>
		</div>
	);
}

type FolderPatch = { name?: string; eventId?: string | null; isPublic?: boolean };

function FolderSettings({
	folder,
	eventOptions,
	canManage,
	busy,
	onSave,
	onMove,
	onDelete,
}: {
	folder: NonNullable<GalleryFolderView["folder"]>;
	eventOptions: GalleryEventOption[];
	canManage: boolean;
	busy: boolean;
	onSave(patch: FolderPatch): void;
	onMove(): void;
	onDelete(): void;
}) {
	const [name, setName] = useState(folder.name);
	const [eventId, setEventId] = useState(folder.eventId ?? "");
	const [isPublic, setIsPublic] = useState(folder.isPublic);
	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSave({ name, eventId: eventId || null, ...(canManage ? { isPublic } : {}) });
			}}
		>
			<SheetHeader>
				<SheetTitle className="font-heading text-xl">Album settings</SheetTitle>
				<SheetDescription>Changes are recorded with your name in the activity log.</SheetDescription>
			</SheetHeader>
			<div className="grid gap-5 px-4 pb-6">
				<label className="grid gap-1.5 text-sm font-medium">
					Name
					<Input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
				</label>
				<label className="grid gap-1.5 text-sm font-medium">
					Event
					<EventSelect value={eventId} onChange={setEventId} options={eventOptions} />
					<span className="text-xs font-normal text-muted-foreground">Its photos show on the event&apos;s page.</span>
				</label>
				<div className="grid gap-1.5">
					<div className="flex items-center justify-between gap-4">
						<span id="folder-public" className="text-sm font-medium">
							Public on the CODE website
						</span>
						<Switch checked={isPublic || folder.publicFromParent} disabled={!canManage || folder.publicFromParent} onChange={setIsPublic} labelledBy="folder-public" describedBy="folder-public-help" />
					</div>
					<p id="folder-public-help" className="text-xs text-muted-foreground">
						{folder.publicFromParent
							? "An album above this one is public, so this one is too."
							: canManage
								? "Anyone can see it at /gallery without signing in. Uploader names stay hidden."
								: "Only photo gallery admins can change this."}
					</p>
				</div>
				<Button type="submit" disabled={busy || !name.trim()}>
					Save
				</Button>
				<div className="grid gap-2 border-t border-border pt-5">
					<Button type="button" variant="outline" onClick={onMove} disabled={busy}>
						<FolderInput />
						Move album
					</Button>
					<Button type="button" variant="ghost" onClick={onDelete} disabled={busy}>
						<Trash2 />
						Delete album
					</Button>
					<p className="text-xs text-muted-foreground">It waits in Recently deleted for 30 days, with everything in it.</p>
				</div>
			</div>
		</form>
	);
}

function EventSelect({ value, onChange, options, dark = false }: { value: string; onChange(value: string): void; options: GalleryEventOption[]; dark?: boolean }) {
	return (
		<select
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className={cn("h-10 w-full min-w-0 rounded-md border px-3 text-sm font-normal", dark ? "border-white/25! bg-[#06192f] text-white" : "border-input! bg-background")}
		>
			<option value="">No event</option>
			{options.map((option) => (
				<option key={option.id} value={option.id}>
					{option.title} ({uploadedOn.format(option.startsAt)})
				</option>
			))}
		</select>
	);
}

function ItemDetails({
	item,
	inheritedEvent,
	folderLabel,
	eventOptions,
	memberOptions,
	onSave,
	onAddTag,
	onRemoveTag,
}: {
	item: GalleryItemView;
	inheritedEvent: { id: string; title: string } | null;
	folderLabel: string;
	eventOptions: GalleryEventOption[];
	memberOptions: GalleryMemberOption[];
	onSave(patch: { caption: string | null; takenAt: string | null; eventId: string | null }): Promise<boolean>;
	onAddTag(input: { memberId: string } | { label: string }): Promise<boolean>;
	onRemoveTag(tagId: string): Promise<boolean>;
}) {
	const [editing, setEditing] = useState(false);
	const [caption, setCaption] = useState(item.caption ?? "");
	const [takenAt, setTakenAt] = useState(toManilaInput(item.takenAt));
	const [eventId, setEventId] = useState(item.eventId ?? "");
	const [saving, setSaving] = useState(false);
	const field = "rounded-md border border-white/25! bg-[#06192f] text-white placeholder:text-white/45 focus-visible:ring-[#90b4cc]";

	if (editing) {
		return (
			<form
				className="grid gap-4 p-5"
				onSubmit={async (event) => {
					event.preventDefault();
					setSaving(true);
					const saved = await onSave({ caption: caption.trim() || null, takenAt: fromManilaInput(takenAt), eventId: eventId || null });
					setSaving(false);
					if (saved) setEditing(false);
				}}
			>
				<p className="font-heading text-lg">Edit details</p>
				<label className="grid gap-1.5 text-sm font-medium">
					Caption
					<Textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={3} maxLength={2000} className={field} placeholder="Who, what, where" />
				</label>
				<label className="grid gap-1.5 text-sm font-medium">
					Date taken
					<Input type="datetime-local" value={takenAt} onChange={(event) => setTakenAt(event.target.value)} className={cn(field, "[color-scheme:dark]")} />
				</label>
				<label className="grid gap-1.5 text-sm font-medium">
					Event
					<EventSelect value={eventId} onChange={setEventId} options={eventOptions} dark />
				</label>
				<div className="flex gap-2">
					<Button type="submit" disabled={saving} className="bg-white text-[#06192f] hover:bg-white/90">
						{saving ? "Saving..." : "Save"}
					</Button>
					<Button type="button" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setEditing(false)}>
						Cancel
					</Button>
				</div>
			</form>
		);
	}

	return (
		<div className="grid gap-5 p-5">
			<div className="flex items-start justify-between gap-3">
				<p className={cn("min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-relaxed", !item.caption && "text-white/60")}>{item.caption ?? "No caption"}</p>
				<button type="button" onClick={() => setEditing(true)} className={cn(lightboxButton, "size-9 shrink-0")} aria-label="Edit details" title="Edit details">
					<Pencil className="size-4" />
				</button>
			</div>
			<Tags item={item} memberOptions={memberOptions} onAdd={onAddTag} onRemove={onRemoveTag} />
			<dl className="grid gap-3.5 text-sm">
				<Detail label="Taken">{item.takenAt ? takenOn.format(item.takenAt) : "Unknown"}</Detail>
				<Detail label="Event">
					{item.eventId ? (
						<Link href={`/portal/calendar/${item.eventId}`} className="underline underline-offset-4 hover:text-white">
							{item.eventTitle ?? "An event"}
						</Link>
					) : inheritedEvent ? (
						<>
							<Link href={`/portal/calendar/${inheritedEvent.id}`} className="underline underline-offset-4 hover:text-white">
								{inheritedEvent.title}
							</Link>
							<span className="block text-white/60">From its album</span>
						</>
					) : (
						"None"
					)}
				</Detail>
				<Detail label="Album">{folderLabel}</Detail>
				<Detail label="Uploaded by">
					{item.uploaderName}, {uploadedOn.format(item.createdAt)}
				</Detail>
				<Detail label="File">
					<span className="[overflow-wrap:anywhere]">{item.originalName}</span>
					<span className="block text-white/60">{formatBytes(item.sizeBytes)}</span>
				</Detail>
				<Detail label="Seen">
					<span className="inline-flex items-center gap-1.5">
						<Eye className="size-3.5 text-[#90b4cc]" aria-hidden />
						{item.viewCount === 1 ? "1 view" : `${item.viewCount} views`}
					</span>
				</Detail>
			</dl>
		</div>
	);
}

/**
 * People and topics on a photo. One field does both: a name from the list tags that member, anything else
 * becomes a topic. Anyone can add or remove a tag; each change lands in the activity log.
 */
function Tags({
	item,
	memberOptions,
	onAdd,
	onRemove,
}: {
	item: GalleryItemView;
	memberOptions: GalleryMemberOption[];
	onAdd(input: { memberId: string } | { label: string }): Promise<boolean>;
	onRemove(tagId: string): Promise<boolean>;
}) {
	const [value, setValue] = useState("");
	const [adding, setAdding] = useState(false);
	const listId = `tag-people-${item.id}`;
	const ordered = [...item.tags.filter((tag) => tag.kind === "person"), ...item.tags.filter((tag) => tag.kind === "topic")];
	return (
		<div className="grid gap-2.5">
			{ordered.length ? (
				<ul className="flex flex-wrap gap-1.5" aria-label="Tags">
					{ordered.map((tag) => (
						<li key={tag.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/10 py-1 pl-2.5 pr-1 text-sm">
							<span className="min-w-0 truncate">{tag.kind === "topic" ? `#${tag.label}` : tag.label}</span>
							<button
								type="button"
								onClick={() => void onRemove(tag.id)}
								className="grid size-5 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#90b4cc]"
								aria-label={`Remove ${tag.label}`}
							>
								<X className="size-3" />
							</button>
						</li>
					))}
				</ul>
			) : null}
			<form
				className="flex gap-2"
				onSubmit={async (event) => {
					event.preventDefault();
					const text = value.trim();
					if (!text) return;
					const person = memberOptions.find((member) => member.name.toLowerCase() === text.toLowerCase());
					setAdding(true);
					const done = await onAdd(person ? { memberId: person.id } : { label: text });
					setAdding(false);
					if (done) setValue("");
				}}
			>
				<Input
					value={value}
					onChange={(event) => setValue(event.target.value)}
					list={listId}
					placeholder="Tag a person or topic"
					aria-label="Tag a person or topic"
					className="h-9 rounded-md border border-white/25! bg-[#06192f] text-sm text-white placeholder:text-white/45 focus-visible:ring-[#90b4cc]"
				/>
				<datalist id={listId}>
					{memberOptions.map((member) => (
						<option key={member.id} value={member.name} />
					))}
				</datalist>
				<button type="submit" disabled={adding || !value.trim()} className={cn(lightboxButton, "size-9 shrink-0 disabled:opacity-40")} aria-label="Add tag">
					<Plus className="size-4" />
				</button>
			</form>
		</div>
	);
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="grid gap-0.5">
			<dt className="text-xs font-semibold text-[#90b4cc]">{label}</dt>
			<dd className="min-w-0 text-white">{children}</dd>
		</div>
	);
}
