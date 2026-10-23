import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Bookmark, Pencil, Plus } from "lucide-react";
import { EmptyState } from "@/components/portal/empty-state";
import { LinkKindTile } from "@/components/portal/link-kind-tile";
import { Button } from "@/components/ui/button";
import { getRepositories } from "@/db";
import type { ImportantLink } from "@/db/repositories/important-links";
import { LINK_KIND_LABELS, linkHost, linkKindOf } from "@/lib/link-kinds";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { signInPath } from "@/server/auth/sign-in";

export const dynamic = "force-dynamic";

const EDITOR_PATH = "/portal/admin/content/important-links";

export default async function ImportantLinksPage() {
	const actor = await getActor();
	if (!actor) redirect(await signInPath());
	const repositories = await getRepositories();
	// Like quick links, important links have no shared-dev internal proxy; show the empty state instead of crashing.
	const directory = await repositories.importantLinks.listDirectory(actor).catch(() => ({ categories: [], uncategorized: [] }));
	const canEdit = can(actor, "nav:configure");

	const sections = directory.categories
		.filter((category) => category.links.length > 0)
		.map((category) => ({ id: category.id, name: category.name, links: category.links }));
	if (directory.uncategorized.length > 0) {
		sections.push({ id: "other", name: sections.length > 0 ? "Other links" : "Links", links: directory.uncategorized });
	}

	return (
		<div className="grid min-w-0 gap-8">
			<header className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border/60 pb-5">
				<div className="min-w-0">
					<h1 className="text-3xl font-semibold text-primary sm:text-4xl">Important links</h1>
					<p className="mt-2 max-w-3xl text-pretty text-base leading-6 text-muted-foreground">
						The masterfile, shared folders and forms CODE runs on, kept current by the admins. Each opens in a new tab.
					</p>
				</div>
				{canEdit && sections.length > 0 ? (
					<Button asChild variant="outline" className="min-h-10">
						<Link href={EDITOR_PATH}>
							<Pencil aria-hidden />
							Edit links
						</Link>
					</Button>
				) : null}
			</header>

			{sections.length === 0 ? (
				<EmptyState
					icon={Bookmark}
					title="No important links yet"
					description={
						canEdit
							? "Add the masterfile, shared folders and forms members keep asking for. Group them into categories so they are easy to scan."
							: "The admins will post CODE's shared sheets, folders and forms here."
					}
					action={
						canEdit ? (
							<Button asChild>
								<Link href={EDITOR_PATH}>
									<Plus aria-hidden />
									Add the first link
								</Link>
							</Button>
						) : null
					}
				/>
			) : (
				<div className="grid items-start gap-x-8 gap-y-10 lg:grid-cols-2">
					{sections.map((section) => (
						<section key={section.id} aria-labelledby={`links-${section.id}`} className="grid min-w-0 gap-3">
							<h2 id={`links-${section.id}`} className="text-xl font-semibold text-primary [overflow-wrap:anywhere]">
								{section.name}
							</h2>
							<ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-card">
								{section.links.map((link) => (
									<li key={link.id}>
										<DirectoryLink link={link} />
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
			)}
		</div>
	);
}

function DirectoryLink({ link }: { link: ImportantLink }) {
	const kind = linkKindOf(link);
	return (
		<a
			href={link.url}
			target="_blank"
			rel="noreferrer"
			className="group flex min-w-0 items-start gap-3 px-4 py-3.5 transition-colors hover:bg-secondary/35 focus-visible:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
		>
			<LinkKindTile kind={kind} />
			<span className="min-w-0 flex-1">
				<span className="block font-semibold leading-6 text-foreground [overflow-wrap:anywhere] group-hover:text-accent">{link.title}</span>
				{link.description ? (
					<span className="mt-0.5 block text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">{link.description}</span>
				) : null}
				<span className="mt-1 block text-xs leading-5 text-muted-foreground">
					{LINK_KIND_LABELS[kind]} <span aria-hidden>·</span> <span className="[overflow-wrap:anywhere]">{linkHost(link.url)}</span>
				</span>
			</span>
			<ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent motion-reduce:transition-none" aria-hidden />
			<span className="sr-only">(opens in a new tab)</span>
		</a>
	);
}
