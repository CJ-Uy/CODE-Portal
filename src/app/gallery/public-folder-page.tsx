import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Images } from "lucide-react";
import { getRepositories } from "@/db";
import { FolderCards } from "@/components/gallery/folder-cards";
import { PublicGallery } from "@/components/gallery/public-gallery";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { countLabel } from "@/lib/gallery/view";
import { isFeatureEnabled } from "@/server/features";

/** `/gallery` lists the folders admins made public; `/gallery/<id>` shows one. Nothing private is ever loaded here. */
export async function PublicGalleryPage({ folderId }: { folderId: string | null }) {
	if (!isFeatureEnabled("publicSite") || !isFeatureEnabled("gallery")) notFound();
	const view = await (await getRepositories()).gallery.publicView(folderId);
	if (!view) notFound();
	const title = view.folder?.name ?? "Gallery";
	const counts = [view.items.length ? countLabel(view.items) : null, view.folders.length ? `${view.folders.length} ${view.folders.length === 1 ? "album" : "albums"}` : null]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className="min-h-screen bg-background text-foreground [--gallery-sticky-top:155px] md:[--gallery-sticky-top:99px]">
			<SiteHeader />
			<main>
				<header className="bg-primary text-primary-foreground">
					<div className="mx-auto grid max-w-7xl gap-3 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
						{view.folder ? (
							<nav aria-label="Breadcrumb" className="text-sm text-white/70">
								<ol className="flex flex-wrap items-center gap-1.5">
									<li>
										<Link href="/gallery" className="underline-offset-4 hover:text-white hover:underline">
											Gallery
										</Link>
									</li>
									{view.path.slice(0, -1).map((crumb) => (
										<li key={crumb.id} className="flex items-center gap-1.5">
											<ChevronRight className="size-3.5 opacity-60" aria-hidden />
											<Link href={`/gallery/${crumb.id}`} className="underline-offset-4 hover:text-white hover:underline">
												{crumb.name}
											</Link>
										</li>
									))}
								</ol>
							</nav>
						) : null}
						<h1 className="max-w-4xl text-balance [overflow-wrap:anywhere] font-heading text-4xl leading-[1.08] text-white sm:text-5xl">{title}</h1>
						<p className="text-white/75">{counts || (view.folder ? "Nothing here yet." : "Photos from CODE events and projects.")}</p>
					</div>
				</header>
				<div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:px-8">
					{view.folders.length ? <FolderCards folders={view.folders} hrefFor={(id) => `/gallery/${id}`} layout={view.items.length ? "strip" : "grid"} showPublic={false} /> : null}
					{view.items.length ? <PublicGallery items={view.items} /> : null}
					{!view.items.length && !view.folders.length ? (
						<p className="flex items-center gap-2 text-muted-foreground">
							<Images className="size-5" aria-hidden />
							No public photos yet.
						</p>
					) : null}
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
