import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, FolderPlus, Plus, RotateCcw, Save } from "lucide-react";
import { AdminIntro } from "@/components/portal/admin-intro";
import { LinkKindTile } from "@/components/portal/link-kind-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getRepositories } from "@/db";
import type { ImportantLink, LinkCategory } from "@/db/repositories/important-links";
import { LINK_KIND_LABELS, LINK_KINDS, detectLinkKind, linkHost, linkKindOf } from "@/lib/link-kinds";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import {
	archiveCategoryAction,
	archiveLinkAction,
	createCategoryAction,
	createLinkAction,
	moveCategoryAction,
	moveLinkAction,
	renameCategoryAction,
	updateLinkAction,
} from "./actions";
import { CATEGORY_NAME_MAX, DESCRIPTION_MAX, TITLE_MAX } from "./input";
import { SubmitButton } from "./submit-button";

export const dynamic = "force-dynamic";

type CategoryOption = Pick<LinkCategory, "id" | "name">;
type FormAction = (formData: FormData) => Promise<void>;

const summaryClass =
	"flex cursor-pointer list-none items-start gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden";

export default async function ImportantLinksAdminPage() {
	const actor = await requireActor();
	if (!can(actor, "nav:configure")) redirect("/portal/admin");
	const repositories = await getRepositories();
	// Like quick links, important links have no shared-dev internal proxy; degrade to an empty editor instead of crashing.
	const directory = await repositories.importantLinks.listForEditing(actor).catch(() => ({ categories: [], uncategorized: [] }));

	const categories = directory.categories.filter((category) => !category.archivedAt);
	const archivedCategories = directory.categories.filter((category) => category.archivedAt);
	const options: CategoryOption[] = categories.map(({ id, name }) => ({ id, name }));
	const categoryNames = new Map(directory.categories.map((category) => [category.id, category.name]));
	const allLinks = [...directory.categories.flatMap((category) => category.links), ...directory.uncategorized];
	const archivedLinks = allLinks.filter((link) => link.archivedAt);
	const activeOther = directory.uncategorized.filter((link) => !link.archivedAt);
	const pinnedCount = [...categories.flatMap((category) => category.links), ...activeOther].filter((link) => !link.archivedAt && link.showInSidebar).length;
	const liveCount = categories.reduce((total, category) => total + category.links.filter((link) => !link.archivedAt).length, 0) + activeOther.length;

	return (
		<div className="grid min-w-0 gap-8">
			<AdminIntro title="Important links" whoFor="Choose the sheets, folders and forms members see on Important links" />

			<div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
				<section aria-labelledby="add-link" className="grid min-w-0 gap-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5">
					<h2 id="add-link" className="text-xl font-semibold text-primary">Add a link</h2>
					<form action={createLinkAction} className="grid min-w-0 gap-4">
						<LinkFields categories={options} />
						<div>
							<SubmitButton icon={<Plus aria-hidden />}>Add link</SubmitButton>
						</div>
					</form>
				</section>
				<section aria-labelledby="add-category" className="grid min-w-0 gap-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5">
					<div>
						<h2 id="add-category" className="text-xl font-semibold text-primary">Add a category</h2>
						<p className="mt-1 text-sm leading-5 text-muted-foreground">Members see these as headings.</p>
					</div>
					<form action={createCategoryAction} className="grid min-w-0 gap-3">
						<label className="grid min-w-0 gap-1.5 text-sm">
							<span className="font-medium">Category name</span>
							<Input name="name" required maxLength={CATEGORY_NAME_MAX} placeholder="e.g. Records and trackers" />
						</label>
						<div>
							<SubmitButton variant="outline" icon={<FolderPlus aria-hidden />}>Add category</SubmitButton>
						</div>
					</form>
				</section>
			</div>

			<section aria-labelledby="directory" className="grid min-w-0 gap-5">
				<div className="flex min-w-0 flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-3">
					<div className="min-w-0">
						<h2 id="directory" className="text-2xl font-semibold text-primary">What members see</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{liveCount} {liveCount === 1 ? "link" : "links"} in {categories.length} {categories.length === 1 ? "category" : "categories"}, {pinnedCount} in the sidebar
						</p>
					</div>
					<Button asChild variant="outline" className="min-h-10">
						<Link href="/portal/important-links">
							Open member view
							<ArrowUpRight aria-hidden />
						</Link>
					</Button>
				</div>

				{categories.length === 0 && activeOther.length === 0 ? (
					<div className="grid justify-items-start gap-2 rounded-xl border border-dashed border-border px-5 py-8">
						<h3 className="text-lg font-semibold">Nothing to show members yet</h3>
						<p className="max-w-xl text-sm leading-5 text-muted-foreground">
							Start with a category such as Forms, then add links to it. Links without a category list under Other links.
						</p>
					</div>
				) : null}

				{categories.map((category, index) => {
					const links = category.links.filter((link) => !link.archivedAt);
					return (
						<section key={category.id} aria-label={category.name} className="grid min-w-0 gap-2">
							<div className="flex min-w-0 items-start gap-2">
								<MoveButtons action={moveCategoryAction} id={category.id} label={category.name} first={index === 0} last={index === categories.length - 1} />
								<details className="group min-w-0 flex-1">
									<summary className={`${summaryClass} items-center py-1.5`}>
										<span className="min-w-0 flex-1">
											<h3 className="text-lg font-semibold text-primary [overflow-wrap:anywhere]">{category.name}</h3>
											<span className="text-sm text-muted-foreground">{links.length} {links.length === 1 ? "link" : "links"}</span>
										</span>
										<EditCue />
									</summary>
									<div className="mt-2 grid gap-3 rounded-xl border border-border/60 bg-card p-4">
										<form action={renameCategoryAction} className="flex min-w-0 flex-wrap items-end gap-2">
											<input type="hidden" name="id" value={category.id} />
											<label className="grid min-w-0 flex-1 basis-56 gap-1.5 text-sm">
												<span className="font-medium">Category name</span>
												<Input name="name" required maxLength={CATEGORY_NAME_MAX} defaultValue={category.name} />
											</label>
											<SubmitButton icon={<Save aria-hidden />}>Save name</SubmitButton>
										</form>
										<ArchiveForm action={archiveCategoryAction} id={category.id} label="Archive category" note="Hides it and its links from members. Restore it anytime." />
									</div>
								</details>
							</div>
							<LinkList links={links} options={options} empty={`No links here yet. Add one above and pick ${category.name}.`} />
						</section>
					);
				})}

				{activeOther.length > 0 ? (
					<section aria-labelledby="other-links" className="grid min-w-0 gap-2">
						<div className="py-1.5 pl-11">
							<h3 id="other-links" className="text-lg font-semibold text-primary">Other links</h3>
							<p className="text-sm text-muted-foreground">Links without a category, listed last.</p>
						</div>
						<LinkList links={activeOther} options={options} />
					</section>
				) : null}
			</section>

			{archivedCategories.length > 0 || archivedLinks.length > 0 ? (
				<section aria-labelledby="archived" className="grid min-w-0 gap-3">
					<div>
						<h2 id="archived" className="text-2xl font-semibold text-primary">Archived</h2>
						<p className="mt-1 text-sm text-muted-foreground">Hidden from members. Restore puts each back where it was.</p>
					</div>
					<ul className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card">
						{archivedCategories.map((category) => {
							const hidden = category.links.filter((link) => !link.archivedAt).length;
							return (
								<li key={category.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
									<div className="min-w-0 flex-1">
										<p className="font-semibold [overflow-wrap:anywhere]">{category.name}</p>
										<p className="text-sm text-muted-foreground">Category with {hidden} hidden {hidden === 1 ? "link" : "links"}</p>
									</div>
									<RestoreForm action={archiveCategoryAction} id={category.id} label={category.name} />
								</li>
							);
						})}
						{archivedLinks.map((link) => (
							<li key={link.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
								<LinkKindTile kind={linkKindOf(link)} className="opacity-70" />
								<div className="min-w-0 flex-1">
									<p className="font-semibold [overflow-wrap:anywhere]">{link.title}</p>
									<p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
										Link in {link.categoryId ? (categoryNames.get(link.categoryId) ?? "Other links") : "Other links"}
									</p>
								</div>
								<RestoreForm action={archiveLinkAction} id={link.id} label={link.title} />
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}

function LinkList({ links, options, empty }: { links: ImportantLink[]; options: CategoryOption[]; empty?: string }) {
	if (links.length === 0) {
		return empty ? <p className="ml-11 rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">{empty}</p> : null;
	}
	return (
		<ul className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card">
			{links.map((link, index) => (
				<li key={link.id} className="flex min-w-0 items-start gap-2 py-3 pl-2 pr-3 sm:pr-4">
					<MoveButtons action={moveLinkAction} id={link.id} label={link.title} first={index === 0} last={index === links.length - 1} />
					<details className="group min-w-0 flex-1">
						<summary className={summaryClass}>
							<LinkKindTile kind={linkKindOf(link)} />
							<span className="min-w-0 flex-1">
								<span className="block font-semibold leading-6 [overflow-wrap:anywhere]">{link.title}</span>
								{link.description ? <span className="block text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">{link.description}</span> : null}
								<span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
									<span className="min-w-0">
										{LINK_KIND_LABELS[linkKindOf(link)]} <span aria-hidden>·</span> <span className="[overflow-wrap:anywhere]">{linkHost(link.url)}</span>
									</span>
									{link.showInSidebar ? <span className="rounded-md bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">In sidebar</span> : null}
								</span>
							</span>
							<EditCue />
						</summary>
						<div className="mt-3 grid gap-4 border-t border-border/60 pt-4">
							<form action={updateLinkAction} className="grid min-w-0 gap-4">
								<input type="hidden" name="id" value={link.id} />
								<LinkFields categories={options} link={link} />
								<div>
									<SubmitButton icon={<Save aria-hidden />}>Save changes</SubmitButton>
								</div>
							</form>
							<ArchiveForm action={archiveLinkAction} id={link.id} label="Archive link" note="Hides it from members and the sidebar. Restore it anytime." />
						</div>
					</details>
				</li>
			))}
		</ul>
	);
}

function LinkFields({ categories, link }: { categories: CategoryOption[]; link?: ImportantLink }) {
	return (
		<div className="grid min-w-0 gap-4 sm:grid-cols-2">
			<label className="grid min-w-0 gap-1.5 text-sm">
				<span className="font-medium">Title</span>
				<Input name="title" required maxLength={TITLE_MAX} defaultValue={link?.title} placeholder="e.g. Masterfile" />
			</label>
			<label className="grid min-w-0 gap-1.5 text-sm">
				<span className="font-medium">Link</span>
				<Input
					name="url"
					type="url"
					inputMode="url"
					required
					pattern="https?://.+"
					title="Start the link with https://"
					defaultValue={link?.url}
					placeholder="https://docs.google.com/spreadsheets/..."
				/>
			</label>
			<label className="grid min-w-0 gap-1.5 text-sm">
				<span className="font-medium">Category</span>
				<Select name="categoryId" defaultValue={link?.categoryId ?? ""} className="min-w-0">
					<option value="">No category (Other links)</option>
					{categories.map((category) => (
						<option key={category.id} value={category.id}>
							{category.name}
						</option>
					))}
				</Select>
			</label>
			<label className="grid min-w-0 gap-1.5 text-sm">
				<span className="font-medium">Type</span>
				<Select name="kind" defaultValue={link?.kind ?? ""} className="min-w-0">
					<option value="">{link ? `Detect from the link (${LINK_KIND_LABELS[detectLinkKind(link.url)]})` : "Detect from the link"}</option>
					{LINK_KINDS.map((kind) => (
						<option key={kind} value={kind}>
							{LINK_KIND_LABELS[kind]}
						</option>
					))}
				</Select>
			</label>
			<label className="grid min-w-0 gap-1.5 text-sm sm:col-span-2">
				<span className="font-medium">
					Description <span className="font-normal text-muted-foreground">(optional)</span>
				</span>
				<Input name="description" maxLength={DESCRIPTION_MAX} defaultValue={link?.description ?? ""} placeholder="What members use it for, in one line" />
			</label>
			<label className="flex min-w-0 items-start gap-3 text-sm sm:col-span-2">
				<input type="checkbox" name="showInSidebar" defaultChecked={link?.showInSidebar} className="mt-0.5 size-4 shrink-0 accent-primary" />
				<span className="min-w-0">
					<span className="block font-medium">Show in sidebar</span>
					<span className="text-muted-foreground">Also pin it in every member&apos;s sidebar and menu.</span>
				</span>
			</label>
		</div>
	);
}

function MoveButtons({ action, id, label, first, last }: { action: FormAction; id: string; label: string; first: boolean; last: boolean }) {
	return (
		<div className="flex shrink-0 flex-col">
			{(["up", "down"] as const).map((direction) => (
				<form key={direction} action={action}>
					<input type="hidden" name="id" value={id} />
					<input type="hidden" name="direction" value={direction} />
					<SubmitButton
						variant="ghost"
						size="icon"
						className="size-9 text-muted-foreground hover:bg-secondary hover:text-accent"
						disabled={direction === "up" ? first : last}
						aria-label={`Move ${label} ${direction}`}
						title={direction === "up" ? "Move up" : "Move down"}
						icon={direction === "up" ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
					/>
				</form>
			))}
		</div>
	);
}

function EditCue() {
	return (
		<span className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-sm font-medium text-accent">
			Edit
			<ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
		</span>
	);
}

function ArchiveForm({ action, id, label, note }: { action: FormAction; id: string; label: string; note: string }) {
	return (
		<form action={action} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3">
			<input type="hidden" name="id" value={id} />
			<input type="hidden" name="intent" value="archive" />
			<SubmitButton variant="outline" size="sm" className="min-h-9" icon={<Archive aria-hidden />}>
				{label}
			</SubmitButton>
			<span className="min-w-0 text-xs text-muted-foreground">{note}</span>
		</form>
	);
}

function RestoreForm({ action, id, label }: { action: FormAction; id: string; label: string }) {
	return (
		<form action={action}>
			<input type="hidden" name="id" value={id} />
			<input type="hidden" name="intent" value="restore" />
			<SubmitButton variant="outline" size="sm" className="min-h-9" aria-label={`Restore ${label}`} icon={<RotateCcw aria-hidden />}>
				Restore
			</SubmitButton>
		</form>
	);
}
