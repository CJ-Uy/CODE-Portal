import Link from "next/link";
import { redirect } from "next/navigation";
import { Bookmark, Pencil, Plus } from "lucide-react";
import { EmptyState } from "@/components/portal/empty-state";
import { Button } from "@/components/ui/button";
import { getRepositories } from "@/db";
import type { ImportantLink } from "@/db/repositories/important-links";
import { linkHost, linkKindOf } from "@/lib/link-kinds";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { signInPath } from "@/server/auth/sign-in";
import { newLinkIds, type DirectorySection } from "./directory";
import { DirectoryView } from "./directory-view";

export const dynamic = "force-dynamic";

const EDITOR_PATH = "/portal/admin/content/important-links";

export default async function ImportantLinksPage() {
	const actor = await getActor();
	if (!actor) redirect(await signInPath());
	const repositories = await getRepositories();
	// Like quick links, important links have no shared-dev internal proxy; show the empty state instead of crashing.
	const directory = await repositories.importantLinks.listDirectory(actor).catch(() => ({ categories: [], uncategorized: [] }));
	const canEdit = can(actor, "nav:configure");

	const groups = directory.categories.filter((category) => category.links.length > 0).map(({ id, name, links }) => ({ id, name, links }));
	if (directory.uncategorized.length > 0) {
		groups.push({ id: "other", name: groups.length > 0 ? "Other links" : "Links", links: directory.uncategorized });
	}
	const fresh = newLinkIds(groups.flatMap((group) => group.links), new Date());
	const toView = (link: ImportantLink) => ({
		id: link.id,
		title: link.title,
		url: link.url,
		description: link.description,
		kind: linkKindOf(link),
		host: linkHost(link.url),
		isNew: fresh.has(link.id),
	});
	const sections: DirectorySection[] = groups.map((group) => ({ id: group.id, name: group.name, links: group.links.map(toView) }));

	return (
		<div className="grid min-w-0 gap-8">
			<header className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border/60 pb-5">
				<div className="min-w-0">
					<h1 className="text-3xl font-semibold text-primary sm:text-4xl">Important links</h1>
					<p className="mt-2 max-w-3xl text-pretty text-base leading-6 text-muted-foreground">CODE&apos;s shared sheets, folders and forms, kept current by the admins.</p>
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
					description={canEdit ? "Add the masterfile, shared folders and forms, grouped into categories." : "The admins will post shared sheets, folders and forms here."}
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
				<DirectoryView sections={sections} />
			)}
		</div>
	);
}
