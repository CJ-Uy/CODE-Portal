"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArchiveRestore, ChevronDown, FolderPlus, Heart, ImageOff, Search, Upload } from "lucide-react";
import type { GalleryFolderOption, GalleryHomeView, GallerySort } from "@/db/repositories/gallery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { galleryThumbUrl } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";
import { createFolderAction } from "@/app/portal/gallery/actions";
import { FolderCards } from "./folder-cards";
import { NewFolderForm } from "./gallery-browser";
import { UploadPanel, useUploadQueue } from "./upload-panel";

const ACCEPT = "image/*,video/*,.heic,.heif,.mov,.m4v";
const ALBUMS_SHOWN = 8;
const eventDay = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", month: "short", day: "numeric" });

const HIGHLIGHT_TITLES: Record<GallerySort, string> = { loved: "Most loved", viewed: "Most viewed", tagged: "Most tagged", recent: "Latest photos" };

/**
 * The gallery's front page. Two jobs come first: add photos from an event, or find one. Add photos asks where they
 * go (recent events first) and opens the file picker in the same tap; search and the browse chips find the rest.
 * Below: recent events, a few loved prints, member albums, and the archive folded by school year.
 */
export function GalleryHome({ home, folderOptions }: { home: GalleryHomeView; folderOptions: GalleryFolderOption[] }) {
	const router = useRouter();
	const toast = useToast();
	const queue = useUploadQueue();
	const fileInput = useRef<HTMLInputElement>(null);
	const target = useRef<string | null>(null);
	const [sheet, setSheet] = useState<"pick" | "new" | null>(null);
	const [showAllAlbums, setShowAllAlbums] = useState(false);

	function pickAlbum(id: string) {
		target.current = id;
		// Still inside the tap, so the browser lets the file picker open.
		fileInput.current?.click();
		setSheet(null);
	}

	const albums = showAllAlbums ? home.albums : home.albums.slice(0, ALBUMS_SHOWN);
	const recentIds = new Set(home.recentEvents.map((card) => card.id));

	return (
		<div className="grid gap-10">
			<header className="grid gap-4">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<h1 className="font-heading text-4xl leading-tight">Gallery</h1>
					<div className="flex items-center gap-2">
						<Button onClick={() => setSheet("pick")}>
							<Upload />
							Add photos
						</Button>
						<Button variant="ghost" size="icon" asChild>
							<Link href="/portal/gallery/deleted" aria-label="Recently deleted" title="Recently deleted">
								<ArchiveRestore />
							</Link>
						</Button>
					</div>
				</div>
				<form action="/portal/gallery/photos" role="search" className="relative">
					<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
					<Input name="q" type="search" placeholder="Search people, events, captions or albums" aria-label="Search the gallery" className="h-11 pl-9 text-base sm:text-sm" />
				</form>
				<nav aria-label="Browse photos" className="flex flex-wrap gap-2">
					{home.photosOfMe ? <Chip href="/portal/gallery/photos?person=me">Photos of you · {home.photosOfMe}</Chip> : null}
					<Chip href="/portal/gallery/photos?sort=loved">Most loved</Chip>
					<Chip href="/portal/gallery/photos?sort=viewed">Most viewed</Chip>
					<Chip href="/portal/gallery/photos?sort=tagged">Most tagged</Chip>
					<Chip href="/portal/gallery/photos">All photos</Chip>
				</nav>
			</header>

			{home.recentEvents.length ? (
				<Section title="Recent events">
					<FolderCards folders={home.recentEvents} hrefFor={(id) => `/portal/gallery/${id}`} layout="strip" size="large" showDate />
				</Section>
			) : null}

			{home.highlights.items.length ? (
				<Section title={HIGHLIGHT_TITLES[home.highlights.sort]} action={<Link href={`/portal/gallery/photos?sort=${home.highlights.sort}`} className="text-sm font-medium text-accent underline-offset-4 hover:underline">See all</Link>}>
					<ul className="-mx-4 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-3 pt-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8 [scrollbar-width:thin]">
						{home.highlights.items.map((item, index) => (
							<li key={item.id} className="w-36 shrink-0 snap-start sm:w-44">
								<Link
									href={`/portal/gallery/photos?sort=${home.highlights.sort}&photo=${item.id}`}
									style={{ rotate: `${[-1.2, 0.8, -0.5, 1, -0.8, 0.4, -1][index % 7]}deg` }}
									className="group block rounded-[3px] bg-white p-1.5 pb-2 shadow-[0_1px_2px_rgba(6,25,47,0.14),0_8px_18px_-10px_rgba(6,25,47,0.35)] transition-[rotate,translate] duration-200 ease-out hover:-translate-y-0.5 hover:rotate-0 focus-visible:rotate-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
									aria-label={item.caption || item.originalName}
								>
									<Thumb item={item} />
									<span className="flex items-center gap-1 px-0.5 pt-1.5 text-xs text-[#3d5266]">
										<span className="min-w-0 flex-1 truncate font-heading italic">{item.caption ?? item.eventTitle ?? ""}</span>
										{item.heartCount ? (
											<span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-[#0c315c] tabular-nums">
												<Heart className="size-3 fill-current" aria-hidden />
												{item.heartCount}
											</span>
										) : null}
									</span>
								</Link>
							</li>
						))}
					</ul>
				</Section>
			) : null}

			<Section
				title="Albums"
				action={
					<Button variant="ghost" size="sm" onClick={() => setSheet("new")}>
						<FolderPlus />
						New album
					</Button>
				}
			>
				{albums.length ? (
					<div className="grid gap-4">
						<FolderCards folders={albums} hrefFor={(id) => `/portal/gallery/${id}`} layout="grid" />
						{home.albums.length > ALBUMS_SHOWN ? (
							<button type="button" onClick={() => setShowAllAlbums((value) => !value)} className="justify-self-start text-sm font-medium text-accent underline-offset-4 hover:underline">
								{showAllAlbums ? "Show fewer" : `Show all ${home.albums.length} albums`}
							</button>
						) : null}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">Make an album for anything that is not one event: org shirts, a trip, a project.</p>
				)}
			</Section>

			{home.archive.length ? <Archive archive={home.archive} /> : null}

			{home.looseCount ? (
				<Link href="/portal/gallery/unsorted" className="justify-self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
					{home.looseCount === 1 ? "1 photo is" : `${home.looseCount} photos are`} not in an album
				</Link>
			) : null}

			<input
				ref={fileInput}
				type="file"
				multiple
				accept={ACCEPT}
				className="sr-only"
				tabIndex={-1}
				aria-hidden
				onChange={(event) => {
					const files = [...(event.target.files ?? [])];
					event.target.value = "";
					if (files.length && target.current) queue.add(files, target.current);
				}}
			/>
			<UploadPanel queue={queue} />

			<Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
				<SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
					{sheet === "pick" ? (
						<div className="grid gap-2 pb-6">
							<SheetHeader>
								<SheetTitle className="font-heading text-xl">Where do these go?</SheetTitle>
								<SheetDescription>Pick an album, then choose your photos.</SheetDescription>
							</SheetHeader>
							{home.recentEvents.length ? (
								<PickGroup label="Recent events">
									{home.recentEvents.map((card) => (
										<PickRow key={card.id} onClick={() => pickAlbum(card.id)} cover={card.cover ? galleryThumbUrl(card.cover) : null} name={card.name} detail={card.eventDate ? eventDay.format(card.eventDate) : undefined} />
									))}
								</PickGroup>
							) : null}
							<PickGroup label="All albums">
								{folderOptions
									.filter((option) => !recentIds.has(option.id))
									.map((option) => (
										<PickRow key={option.id} onClick={() => pickAlbum(option.id)} name={option.name} depth={option.depth} />
									))}
								<li>
									<button type="button" onClick={() => setSheet("new")} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-accent hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
										<FolderPlus className="size-4" aria-hidden />
										New album
									</button>
								</li>
							</PickGroup>
						</div>
					) : null}
					{sheet === "new" ? (
						<NewFolderForm
							parentName="the gallery"
							onCreate={async (name) => {
								const result = await createFolderAction({ name, parentId: null });
								if (!result.ok) return toast({ message: result.error });
								setSheet(null);
								router.push(`/portal/gallery/${result.value}`);
							}}
						/>
					) : null}
				</SheetContent>
			</Sheet>
		</div>
	);
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
	return (
		<section className="grid gap-3" aria-label={title}>
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-heading text-2xl leading-tight">{title}</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

function Chip({ href, children }: { href: string; children: ReactNode }) {
	return (
		<Link href={href} className="inline-flex h-9 items-center rounded-full border border-border bg-card px-3.5 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
			{children}
		</Link>
	);
}

function Thumb({ item }: { item: GalleryHomeView["highlights"]["items"][number] }) {
	const [failed, setFailed] = useState(false);
	const src = galleryThumbUrl(item);
	return (
		<span className="block aspect-[4/5] overflow-hidden bg-[#d7dfe9]">
			{src && !failed ? (
				// eslint-disable-next-line @next/next/no-img-element -- access-checked storage proxy
				<img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
			) : (
				<span className="grid size-full place-items-center text-[#3d5266]">
					<ImageOff className="size-5" aria-hidden />
				</span>
			)}
		</span>
	);
}

/** Older event albums, one closed section per school year, with a row of years to jump straight to one. */
function Archive({ archive }: { archive: GalleryHomeView["archive"] }) {
	const count = (albums: unknown[]) => `${albums.length} ${albums.length === 1 ? "album" : "albums"}`;
	return (
		<Section title="Archive">
			{archive.length > 1 ? (
				<nav aria-label="Jump to a school year" className="flex flex-wrap gap-2">
					{archive.map((group) => (
						<button
							key={group.key}
							type="button"
							onClick={() => {
								const section = document.getElementById(`archive-${group.key}`) as HTMLDetailsElement | null;
								if (!section) return;
								section.open = true;
								section.scrollIntoView({ behavior: "smooth", block: "start" });
							}}
							className="inline-flex h-8 items-center rounded-full bg-secondary px-3 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							{group.name}
						</button>
					))}
				</nav>
			) : null}
			<div className="grid divide-y divide-border rounded-lg border border-border bg-card">
				{archive.map((group) => (
					<details key={group.key} id={`archive-${group.key}`} className="group scroll-mt-24">
						<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
							<span className="font-medium">{group.name}</span>
							<span className="flex items-center gap-2 text-sm text-muted-foreground">
								{count(group.albums)}
								<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
							</span>
						</summary>
						<div className="px-4 pb-5 pt-1">
							<FolderCards folders={group.albums} hrefFor={(id) => `/portal/gallery/${id}`} layout="grid" showDate />
						</div>
					</details>
				))}
			</div>
		</Section>
	);
}

function PickGroup({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="grid gap-1 px-2">
			<p className="px-3 pt-2 text-xs font-semibold text-muted-foreground">{label}</p>
			<ul className="grid gap-0.5">{children}</ul>
		</div>
	);
}

function PickRow({ name, detail, cover, depth = 0, onClick }: { name: string; detail?: string; cover?: string | null; depth?: number; onClick(): void }) {
	return (
		<li>
			<button
				type="button"
				onClick={onClick}
				style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
				className={cn("flex w-full min-w-0 items-center gap-3 rounded-md py-2 pr-3 text-left text-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
			>
				{cover !== undefined ? (
					<span className="size-10 shrink-0 overflow-hidden rounded bg-secondary">
						{/* eslint-disable-next-line @next/next/no-img-element -- access-checked storage proxy */}
						{cover ? <img src={cover} alt="" className="size-full object-cover" /> : null}
					</span>
				) : null}
				<span className="grid min-w-0 flex-1">
					<span className="truncate font-medium">{name}</span>
					{detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
				</span>
			</button>
		</li>
	);
}
