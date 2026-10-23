import Link from "next/link";
import { Heart, ImageOff, Search, Tag } from "lucide-react";
import type { GallerySort } from "@/db/repositories/gallery";
import { FolderCards } from "@/components/gallery/folder-cards";
import { GalleryBrowser } from "@/components/gallery/gallery-browser";
import { EmptyState } from "@/components/portal/empty-state";
import { Input } from "@/components/ui/input";
import { countLabel } from "@/lib/gallery/view";
import { cn } from "@/lib/utils";
import { loadGalleryContext } from "../load";

export const dynamic = "force-dynamic";
export const metadata = { title: "Photos" };

const SORTS: { sort: GallerySort; label: string }[] = [
	{ sort: "recent", label: "Latest" },
	{ sort: "loved", label: "Most loved" },
	{ sort: "viewed", label: "Most viewed" },
	{ sort: "tagged", label: "Most tagged" },
];

const EMPTY: Record<GallerySort, { title: string; description: string }> = {
	recent: { title: "No photos yet", description: "Photos added to any album show up here." },
	loved: { title: "No hearts yet", description: "Tap the heart on a photo you love." },
	viewed: { title: "Nothing viewed yet", description: "Photos people open most rise to the top." },
	tagged: { title: "No tags yet", description: "Tag who is in a photo from its details." },
};

type Params = { sort?: string; q?: string; person?: string };

/** Every photo in the gallery: latest, or by hearts, views or tags; narrowed by a search or a tagged person. */
export default async function PhotosPage({ searchParams }: { searchParams: Promise<Params> }) {
	const [params, context] = await Promise.all([searchParams, loadGalleryContext()]);
	const sort = SORTS.some((option) => option.sort === params.sort) ? (params.sort as GallerySort) : "recent";
	const q = params.q?.trim().slice(0, 100) ?? "";
	const personId = params.person === "me" ? context.actor.memberId : params.person;
	const person = personId ? context.memberOptions.find((member) => member.id === personId) : undefined;
	const view = await context.gallery.browse(context.actor, { sort, q: q || undefined, personId });
	const title = personId ? (personId === context.actor.memberId ? "Photos of you" : `Photos of ${person?.name ?? "a member"}`) : q ? `Search: ${q}` : sort === "recent" ? "All photos" : SORTS.find((option) => option.sort === sort)!.label;
	const href = (next: GallerySort, keepPerson = true) => {
		const query = new URLSearchParams({ ...(next === "recent" ? {} : { sort: next }), ...(q ? { q } : {}), ...(keepPerson && params.person ? { person: params.person } : {}) });
		const text = query.toString();
		return `/portal/gallery/photos${text ? `?${text}` : ""}`;
	};
	const searching = Boolean(q || personId);

	return (
		<GalleryBrowser
			title={title}
			crumbs={[{ label: "Gallery", href: "/portal/gallery" }, { label: title }]}
			meta={view.items.length ? <span>{countLabel(view.items)}{view.items.length >= 120 ? ", the first 120" : ""}</span> : undefined}
			folder={null}
			subfolders={[]}
			items={view.items}
			folderOptions={context.folderOptions}
			eventOptions={context.eventOptions}
			memberOptions={context.memberOptions}
			canManage={context.canManage}
			grouping={sort === "recent" ? "day" : "none"}
			empty={
				view.albums.length ? null : (
					<EmptyState
						icon={searching ? Search : sort === "loved" ? Heart : sort === "tagged" ? Tag : ImageOff}
						title={searching ? "Nothing matches" : EMPTY[sort].title}
						description={searching ? "Try a name, an event or a word from a caption." : EMPTY[sort].description}
					/>
				)
			}
		>
			<div className="grid gap-4">
				<form action="/portal/gallery/photos" role="search" className="relative">
					{sort !== "recent" ? <input type="hidden" name="sort" value={sort} /> : null}
					<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
					<Input name="q" type="search" defaultValue={q} placeholder="Search people, events, captions or albums" aria-label="Search the gallery" className="h-11 pl-9 text-base sm:text-sm" />
				</form>
				<nav aria-label="Order" className="flex flex-wrap gap-2">
					{SORTS.map((option) => (
						<Link
							key={option.sort}
							href={href(option.sort)}
							aria-current={option.sort === sort ? "page" : undefined}
							className={cn(
								"inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								option.sort === sort ? "border-primary! bg-primary text-primary-foreground" : "border-border bg-card hover:bg-secondary",
							)}
						>
							{option.label}
						</Link>
					))}
					{params.person ? (
						<Link href={href(sort, false)} className="inline-flex h-9 items-center rounded-full px-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
							Everyone
						</Link>
					) : null}
				</nav>
				{view.albums.length ? (
					<section aria-label="Albums" className="grid gap-3">
						<h2 className="font-heading text-xl">Albums</h2>
						<FolderCards folders={view.albums} hrefFor={(id) => `/portal/gallery/${id}`} layout="strip" showDate />
					</section>
				) : null}
			</div>
		</GalleryBrowser>
	);
}
