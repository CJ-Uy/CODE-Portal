"use client";

import { type FormEvent, type KeyboardEvent, type MouseEvent, type RefObject, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowDown, ArrowUp, CalendarDays, ChevronsUpDown, Copy, ExternalLink, ImageUp, Info, Plus, QrCode, RefreshCw, Save, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import type { LinkListItem, LinkStats, QrStyle } from "@/db/repositories/links";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ClicksOverTime, DonutChart, formatBucket } from "./charts";
import { LinkQrCustomizer } from "./link-qr-customizer";
import { formatStatsPoint, shiftIsoDay, todayInTimeZone } from "./stats-utils";
import { shortLinkUrl } from "./urls";

type LinkView = Omit<LinkListItem, "createdAt" | "updatedAt"> & { createdAt: Date | string; updatedAt: Date | string };
type StatsView = Omit<LinkStats, "link"> & { link: LinkView };
type ViewMode = "all" | "mine";
type SortKey = "title" | "slug" | "clicks" | "owner" | "created";
type SortState = { key: SortKey; dir: "asc" | "desc" };
type StatsQuery = LinkStats["query"];

type LinksWorkspaceProps = {
	initialLinks: LinkView[];
	actorMemberId: string;
	canModerate: boolean;
};

function subscribeOrigin() {
	return () => {};
}

function getClientOrigin() {
	return window.location.origin;
}

function getServerOrigin() {
	return "";
}

export function LinksWorkspace({ initialLinks, actorMemberId, canModerate }: LinksWorkspaceProps) {
	const [links, setLinks] = useState(initialLinks);
	const origin = useSyncExternalStore(subscribeOrigin, getClientOrigin, getServerOrigin);
	const [status, setStatus] = useState("");
	const [view, setView] = useState<ViewMode>("all");
	const [search, setSearch] = useState("");
	const [selectedTags, setSelectedTags] = useState<string[]>([]);
	const [sort, setSort] = useState<SortState>({ key: "created", dir: "desc" });
	const [createOpen, setCreateOpen] = useState(false);
	const [activeId, setActiveId] = useState("");
	const [confirmDeleteId, setConfirmDeleteId] = useState("");
	const [stats, setStats] = useState<StatsView | null>(null);
	const [statsLoading, setStatsLoading] = useState(false);
	const [statsError, setStatsError] = useState("");
	const statsRequestId = useRef(0);
	const createTriggerRef = useRef<HTMLButtonElement>(null);
	const dialogTriggerRef = useRef<HTMLElement | null>(null);
	const [hasMore, setHasMore] = useState(initialLinks.length === 50);
	const [linksLoading, setLinksLoading] = useState(false);
	const [form, setForm] = useState({ slug: "", destinationUrl: "", title: "", tags: [] as string[] });

	const baseLabel = origin ? origin.replace(/^https?:\/\//, "") : "your-code-site";
	const tagOptions = useMemo(() => Array.from(new Set(links.flatMap((link) => link.tags))).sort(), [links]);
	const active = useMemo(() => links.find((link) => link.id === activeId) ?? null, [activeId, links]);
	const activeUrl = active && origin ? shortLinkUrl(origin, active.slug) : "";

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		return links.filter((link) => {
			if (view === "mine" && link.ownerMemberId !== actorMemberId) return false;
			if (selectedTags.length && !selectedTags.some((tag) => link.tags.includes(tag))) return false;
			if (!term) return true;
			return [link.title, link.slug, link.destinationUrl].some((value) => value.toLowerCase().includes(term));
		});
	}, [actorMemberId, links, search, selectedTags, view]);

	const sorted = useMemo(() => {
		const dir = sort.dir === "asc" ? 1 : -1;
		return [...filtered].sort((a, b) => {
			switch (sort.key) {
				case "clicks":
					return (a.clickCount - b.clickCount) * dir;
				case "created":
					return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
				case "owner":
					return (a.owner?.name ?? "￿").localeCompare(b.owner?.name ?? "￿") * dir;
				case "slug":
					return a.slug.localeCompare(b.slug) * dir;
				default:
					return a.title.localeCompare(b.title) * dir;
			}
		});
	}, [filtered, sort]);
	const hasFilters = view === "mine" || Boolean(search.trim()) || selectedTags.length > 0;
	const emptyMessage = links.length ? "No links match these filters." : "No short links yet. Create your first one to get started.";

	function toggleSort(key: SortKey) {
		setSort((current) =>
			current.key === key
				? { key, dir: current.dir === "asc" ? "desc" : "asc" }
				: { key, dir: key === "created" || key === "clicks" ? "desc" : "asc" },
		);
	}

	async function refresh() {
		const response = await fetch("/api/links?limit=50", { credentials: "same-origin" });
		const body = await response.json() as { links?: LinkView[]; error?: string };
		if (!response.ok || !body.links) {
			setStatus(body.error ?? "Could not refresh links.");
			return;
		}
		setLinks(body.links);
		setHasMore(body.links.length === 50);
		setStatus("Links refreshed.");
	}

	async function loadMore() {
		setLinksLoading(true);
		let response: Response;
		let body: { links?: LinkView[]; error?: string };
		try {
			response = await fetch(`/api/links?limit=50&offset=${links.length}`, { credentials: "same-origin" });
			body = await response.json() as { links?: LinkView[]; error?: string };
		} catch {
			setLinksLoading(false);
			setStatus("Could not reach the links service.");
			return;
		}
		setLinksLoading(false);
		if (!response.ok || !body.links) {
			setStatus(body.error ?? "Could not load older links.");
			return;
		}
		setLinks((current) => {
			const known = new Set(current.map((link) => link.id));
			return [...current, ...body.links!.filter((link) => !known.has(link.id))];
		});
		setHasMore(body.links.length === 50);
		setStatus(body.links.length ? "Older links loaded." : "All links are shown.");
	}

	async function createLink(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const response = await fetch("/api/links", {
			method: "POST",
			credentials: "same-origin",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(form),
		});
		const body = await response.json() as { link?: LinkView; error?: string };
		if (!response.ok || !body.link) {
			setStatus(body.error ?? "Could not create link.");
			return;
		}
		setLinks((current) => [body.link!, ...current]);
		setForm({ slug: "", destinationUrl: "", title: "", tags: [] });
		setCreateOpen(false);
		setStatus("Link created.");
		openDialog(body.link.id);
	}

	async function updateLink(id: string, patch: Partial<LinkView>) {
		const response = await fetch(`/api/links/${encodeURIComponent(id)}`, {
			method: "PATCH",
			credentials: "same-origin",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(patch),
		});
		const body = await response.json() as { link?: LinkView; error?: string };
		if (!response.ok || !body.link) {
			setStatus(body.error ?? "Could not save link.");
			return;
		}
		setLinks((current) => current.map((link) => (link.id === body.link!.id ? body.link! : link)));
		setStatus("Link saved.");
	}

	async function removeLink(id: string) {
		const response = await fetch(`/api/links/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
		if (!response.ok) {
			setStatus("Could not delete link.");
			setConfirmDeleteId("");
			return;
		}
		setLinks((current) => current.filter((link) => link.id !== id));
		if (activeId === id) setActiveId("");
		setConfirmDeleteId("");
		setStatus("Link deleted.");
	}

	async function loadStats(id: string, query?: StatsQuery) {
		const requestId = ++statsRequestId.current;
		setStatsLoading(true);
		setStatsError("");
		const params = query ? new URLSearchParams(Object.entries(query)) : null;
		let response: Response;
		let body: StatsView | { error?: string } | null;
		try {
			response = await fetch(`/api/links/${encodeURIComponent(id)}/stats${params ? `?${params}` : ""}`, { credentials: "same-origin" });
			body = await response.json().catch(() => null) as StatsView | { error?: string } | null;
		} catch {
			if (requestId === statsRequestId.current) {
				setStatsLoading(false);
				setStatsError("Could not reach the statistics service.");
			}
			return;
		}
		if (requestId !== statsRequestId.current) return;
		setStatsLoading(false);
		if (!response.ok || !body || typeof body !== "object" || !("link" in body)) {
			const message = body && typeof body === "object" && "error" in body ? body.error : undefined;
			setStatsError(message ?? "Could not load statistics.");
			return;
		}
		setStats(body);
	}

	function openDialog(id: string) {
		const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		dialogTriggerRef.current = activeElement?.closest<HTMLElement>("button,a,[tabindex]") ?? createTriggerRef.current;
		setActiveId(id);
		setStats(null);
		void loadStats(id);
	}

	function closeDialog() {
		statsRequestId.current += 1;
		setActiveId("");
		setStatsLoading(false);
		setStatsError("");
	}

	function copy(event: MouseEvent, link: LinkView) {
		event.stopPropagation();
		if (!origin) return;
		void navigator.clipboard.writeText(shortLinkUrl(origin, link.slug))
			.then(() => setStatus("Link copied."))
			.catch(() => setStatus("Could not copy the link. Try again."));
	}

	function canEdit(link: LinkView): boolean {
		return canModerate || link.ownerMemberId === actorMemberId;
	}

	return (
		<div className="grid min-w-0 grid-cols-1 gap-5">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="min-w-0 basis-full sm:flex-1">
					<p className="text-xs font-semibold uppercase text-primary">Short links</p>
					<h1 className="font-heading text-3xl">Links</h1>
					<p className="mt-1 max-w-xl text-sm text-muted-foreground">Turn long web addresses into tidy <span className="font-medium text-foreground">{baseLabel}/name</span> links, share them, and see how many people click.</p>
				</div>
				<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
					{canModerate ? <Badge variant="info">Moderator</Badge> : null}
					<Button variant="outline" className="min-h-11" onClick={refresh}>
						<RefreshCw />
						Refresh
					</Button>
					<CreateLinkDialog
						triggerRef={createTriggerRef}
						open={createOpen}
						onOpenChange={setCreateOpen}
						form={form}
						setForm={setForm}
						onSubmit={createLink}
						tagOptions={tagOptions}
						baseLabel={baseLabel}
					/>
				</div>
			</div>

			<details className="group rounded-lg border bg-card p-4 text-sm">
				<summary className="flex cursor-pointer items-center gap-2 font-semibold text-foreground">
					<Info className="size-4 text-primary" />
					New here? What these words mean
				</summary>
				<div className="mt-3 grid max-w-3xl gap-2 text-muted-foreground">
					<p><strong className="text-foreground">Short link</strong> - a tidy CODE web address that forwards to a longer one. Share <UrlToken>{`${baseLabel}/welcome`}</UrlToken> instead of a giant URL.</p>
					<p><strong className="text-foreground">Slug</strong> - the custom ending you choose, the part after the slash. In <UrlToken>{`${baseLabel}/welcome`}</UrlToken> the slug is <strong className="text-foreground">welcome</strong>. Use letters, numbers, and dashes.</p>
					<p><strong className="text-foreground">Destination</strong> - where people actually land when they open the link.</p>
				</div>
			</details>

			<div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
				<div className="flex rounded-md border bg-background p-1">
					{(["all", "mine"] as ViewMode[]).map((mode) => (
						<button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)} className={cn("min-h-11 rounded px-3 text-xs font-semibold", view === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
							{mode === "mine" ? "My links" : "All links"}
						</button>
					))}
				</div>
				<label className="relative min-w-56 flex-1">
					<span className="sr-only">Search links</span>
					<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title, slug, or destination" className="min-h-11 pl-9" />
				</label>
				{tagOptions.length ? (
					<div className="flex flex-wrap items-center gap-1">
						<span className="mr-1 text-xs text-muted-foreground">Tags:</span>
						{tagOptions.map((tag) => (
							<button key={tag} type="button" aria-pressed={selectedTags.includes(tag)} onClick={() => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])} className={cn("min-h-11 rounded-md px-3 text-xs font-semibold", selectedTags.includes(tag) ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>
								{tag}
							</button>
						))}
						{selectedTags.length ? <button type="button" onClick={() => setSelectedTags([])} className="min-h-11 px-2 text-xs text-muted-foreground underline">Clear tags</button> : null}
					</div>
				) : null}
			</div>

			{status ? <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{status}</p> : null}

			<div className="hidden rounded-lg border bg-card 2xl:block">
				<Table>
					<TableHeader>
						<TableRow>
							<SortHeader label="Title" column="title" sort={sort} onSort={toggleSort} />
							<SortHeader label="Short link" column="slug" sort={sort} onSort={toggleSort} />
							<TableHead>Tags</TableHead>
							<SortHeader label="Clicks" column="clicks" sort={sort} onSort={toggleSort} align="right" />
							<SortHeader label="Owner" column="owner" sort={sort} onSort={toggleSort} />
							<SortHeader label="Created" column="created" sort={sort} onSort={toggleSort} />
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sorted.map((link) => (
							<TableRow
								key={link.id}
								className="cursor-pointer"
								onClick={(event) => {
									const target = event.target as HTMLElement;
									if (target.closest("a,button,input,select,textarea,label,summary,[role='button']")) return;
									openDialog(link.id);
								}}
							>
								{/* One bounded box around both lines. truncate needs a bounded box, and a
							    table cell in auto layout grows to fit its widest content, so without this
							    the destination URL set the column width and pushed the row into a
							    horizontal scroll. Kept deliberately narrow: titles are short in practice
							    and the URL is only there for recognition, not for reading in full, which
							    the hover title covers. */}
							<TableCell className="min-w-40">
								<div className="max-w-56">
									<button type="button" className="block min-h-11 max-w-full truncate rounded text-left font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={link.title} onClick={(event) => { event.stopPropagation(); openDialog(link.id); }}>{link.title}</button>
									<p className="truncate text-xs text-muted-foreground" title={link.destinationUrl}>
										to {link.destinationUrl}
									</p>
								</div>
							</TableCell>
								<TableCell><ShortLinkCell origin={origin} baseLabel={baseLabel} slug={link.slug} /></TableCell>
								<TableCell><TagList tags={link.tags} /></TableCell>
								<TableCell className="text-right tabular-nums">{link.clickCount}</TableCell>
								<TableCell><Owner owner={link.owner} /></TableCell>
								<TableCell className="whitespace-nowrap text-muted-foreground">{new Date(link.createdAt).toLocaleDateString()}</TableCell>
								<TableCell>
									<div className="flex justify-end gap-1">
										<Button variant="outline" size="icon" className="size-11" aria-label={`Copy ${link.title} short link`} onClick={(event) => copy(event, link)}><Copy /></Button>
										<Button variant="outline" size="icon" className="size-11" aria-label={`View ${link.title} details and QR code`} onClick={(event) => { event.stopPropagation(); openDialog(link.id); }}><QrCode /></Button>
										{canEdit(link) ? <Button variant="ghost" size="icon" className="size-11" aria-label={`Delete ${link.title}`} onClick={(event) => { event.stopPropagation(); setConfirmDeleteId(link.id); }}><Trash2 /></Button> : null}
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="grid gap-2 2xl:hidden">
				{sorted.map((link) => (
					<article key={link.id} className="min-w-0 rounded-lg border bg-card p-4">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<button type="button" className="block max-w-full text-left font-semibold hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openDialog(link.id)}>{link.title}</button>
								<p className="mt-0.5 break-all text-sm font-semibold text-primary">{baseLabel}/{link.slug}</p>
							</div>
							<span className="shrink-0 text-xs text-muted-foreground tabular-nums">{link.clickCount} clicks</span>
						</div>
						<p className="mt-2 truncate text-xs text-muted-foreground" title={link.destinationUrl}>To {link.destinationUrl}</p>
						<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
							<span className="text-xs text-muted-foreground">{link.owner?.name ?? "CODE"}</span>
							<div className="flex gap-2">
								<Button variant="outline" size="sm" className="min-h-11" aria-label={`Copy ${link.title} short link`} onClick={(event) => copy(event, link)}><Copy /> Copy</Button>
								<Button variant="outline" size="sm" className="min-h-11" aria-label={`View ${link.title} details and QR code`} onClick={() => openDialog(link.id)}><QrCode /> QR</Button>
								{canEdit(link) ? <Button variant="ghost" size="icon" className="size-11" aria-label={`Delete ${link.title}`} onClick={() => setConfirmDeleteId(link.id)}><Trash2 /></Button> : null}
							</div>
						</div>
					</article>
				))}
			</div>
			{!sorted.length ? <div className="grid justify-items-center gap-3 rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground"><p>{emptyMessage}</p>{hasFilters ? <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => { setView("all"); setSearch(""); setSelectedTags([]); }}>Clear filters</Button> : null}</div> : null}
			<div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
				<p>{hasFilters ? `Showing ${sorted.length} of ${links.length} loaded links${hasMore ? ". Load older links to search the full history." : "."}` : hasMore ? `Showing the newest ${links.length} links. Load older links to search the full history.` : `Showing all ${links.length} ${links.length === 1 ? "link" : "links"}.`}</p>
				{hasMore ? <Button type="button" variant="outline" className="min-h-11" onClick={() => void loadMore()} disabled={linksLoading}>{linksLoading ? <RefreshCw className="animate-spin motion-reduce:animate-none" /> : null}{linksLoading ? "Loading" : "Load older links"}</Button> : null}
			</div>

			<DialogPrimitive.Root open={Boolean(confirmDeleteId)} onOpenChange={(open) => !open && setConfirmDeleteId("")}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45" />
					<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(100%-1.5rem,420px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
						<DialogPrimitive.Title className="font-heading text-xl">Delete this link?</DialogPrimitive.Title>
						<DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
							{(() => {
								const target = links.find((link) => link.id === confirmDeleteId);
								if (!target) return "This link will stop working immediately.";
								return `“${target.title || target.slug}” (/${target.slug}) will stop working immediately. This can’t be undone.`;
							})()}
						</DialogPrimitive.Description>
						<div className="mt-5 flex justify-end gap-2">
							<DialogPrimitive.Close asChild>
								<Button variant="outline" className="min-h-11">Cancel</Button>
							</DialogPrimitive.Close>
							<Button
								className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
								onClick={() => void removeLink(confirmDeleteId)}
							>
								<Trash2 /> Delete link
							</Button>
						</div>
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>

			<DialogPrimitive.Root open={Boolean(active)} onOpenChange={(open) => !open && closeDialog()}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45" />
					<DialogPrimitive.Content
						className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(100%-1.5rem,1080px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg"
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							const target = dialogTriggerRef.current?.isConnected ? dialogTriggerRef.current : createTriggerRef.current;
							target?.focus();
						}}
					>
						{active ? <LinkDialog link={active} url={activeUrl} baseLabel={baseLabel} stats={stats} loading={statsLoading} statsError={statsError} editable={canEdit(active)} onLoadStats={(query) => void loadStats(active.id, query)} onSave={(patch) => updateLink(active.id, patch)} onUpload={(file) => uploadPreview(active.id, file, updateLink, setStatus)} /> : null}
						<DialogPrimitive.Close className="absolute right-3 top-3 grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="size-4" /><span className="sr-only">Close</span></DialogPrimitive.Close>
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		</div>
	);
}

function UrlToken({ children }: { children: string }) {
	return <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">{children}</span>;
}

function SortHeader({ label, column, sort, onSort, align = "left" }: { label: string; column: SortKey; sort: SortState; onSort(key: SortKey): void; align?: "left" | "right" }) {
	const activeSort = sort.key === column;
	const Icon = !activeSort ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
	return (
		<TableHead aria-sort={activeSort ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={align === "right" ? "text-right" : undefined}>
			<button type="button" onClick={() => onSort(column)} className={cn("inline-flex min-h-11 items-center gap-1 font-medium transition-colors hover:text-foreground", activeSort ? "text-foreground" : "text-muted-foreground", align === "right" && "flex-row-reverse")}>
				{label}
				<Icon className={cn("size-3.5", activeSort ? "opacity-100" : "opacity-40")} />
			</button>
		</TableHead>
	);
}

function ShortLinkCell({ origin, baseLabel, slug }: { origin: string; baseLabel: string; slug: string }) {
	const href = origin ? shortLinkUrl(origin, slug) : `/${slug}`;
	return (
		<a href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex min-h-11 max-w-[16rem] items-center gap-1 font-medium text-primary hover:underline">
			<span className="truncate">{baseLabel}/{slug}</span>
			<ExternalLink className="size-3.5 shrink-0 opacity-60" />
		</a>
	);
}

function Owner({ owner }: { owner: LinkView["owner"] }) {
	if (!owner) return <span className="text-muted-foreground">None</span>;
	return <span className="flex items-center gap-2"><Avatar image={owner.image} name={owner.name} size="sm" /><span className="max-w-32 truncate">{owner.name ?? "Member"}</span></span>;
}

function TagList({ tags }: { tags: string[] }) {
	if (!tags.length) return <span className="text-muted-foreground">None</span>;
	return <span className="flex flex-wrap gap-1">{tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</span>;
}

function CreateLinkDialog({ triggerRef, open, onOpenChange, form, setForm, onSubmit, tagOptions, baseLabel }: {
	triggerRef: RefObject<HTMLButtonElement | null>;
	open: boolean;
	onOpenChange(open: boolean): void;
	form: { slug: string; destinationUrl: string; title: string; tags: string[] };
	setForm(form: { slug: string; destinationUrl: string; title: string; tags: string[] }): void;
	onSubmit(event: FormEvent<HTMLFormElement>): void;
	tagOptions: string[];
	baseLabel: string;
}) {
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Trigger asChild>
				<Button ref={triggerRef} className="min-h-11"><Plus />New short link</Button>
			</DialogPrimitive.Trigger>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45" />
				<DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(100%-1.5rem,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg">
					<DialogPrimitive.Title className="font-heading text-2xl">New short link</DialogPrimitive.Title>
					<DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">Point a memorable CODE address at any web page.</DialogPrimitive.Description>
					<form className="mt-4 grid gap-4" onSubmit={onSubmit}>
						<label className="grid gap-1 text-sm font-medium">
							Destination
						<Input className="min-h-11" value={form.destinationUrl} placeholder="https://example.com" onChange={(event) => setForm({ ...form, destinationUrl: event.target.value })} required />
							<span className="text-xs font-normal text-muted-foreground">Where people go when they open the short link.</span>
						</label>
						<label className="grid gap-1 text-sm font-medium">
							Custom ending (slug)
							<div className="flex items-center rounded-md border border-input focus-within:ring-1 focus-within:ring-ring">
								<span className="whitespace-nowrap border-r border-input px-2 py-2 text-sm text-muted-foreground">{baseLabel}/</span>
								<Input value={form.slug} placeholder="welcome" onChange={(event) => setForm({ ...form, slug: event.target.value })} required className="min-h-11 border-0 shadow-none focus-visible:ring-0" />
							</div>
							<span className="text-xs font-normal text-muted-foreground">Your link will be <span className="font-medium text-foreground">{baseLabel}/{form.slug || "your-slug"}</span></span>
						</label>
						<label className="grid gap-1 text-sm font-medium">
							Title
							<Input className="min-h-11" value={form.title} placeholder="Welcome page" onChange={(event) => setForm({ ...form, title: event.target.value })} required />
							<span className="text-xs font-normal text-muted-foreground">A name so you can recognise this link in the list.</span>
						</label>
						<TagInput value={form.tags} suggestions={tagOptions} onChange={(tags) => setForm({ ...form, tags })} hint="Optional labels to group links, e.g. event, social." />
						<div className="flex justify-end gap-2 pt-2">
							<DialogPrimitive.Close asChild>
								<Button type="button" variant="outline" className="min-h-11">Cancel</Button>
							</DialogPrimitive.Close>
							<Button type="submit" className="min-h-11"><Save />Create link</Button>
						</div>
					</form>
					<DialogPrimitive.Close className="absolute right-3 top-3 grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="size-4" /><span className="sr-only">Close</span></DialogPrimitive.Close>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function TagInput({ value, suggestions, onChange, hint }: { value: string[]; suggestions: string[]; onChange(tags: string[]): void; hint?: string }) {
	const [draft, setDraft] = useState("");
	function add(tag = draft) {
		const next = tag.trim();
		if (!next) return;
		onChange(Array.from(new Set([...value, next])).slice(0, 10));
		setDraft("");
	}
	return (
		<label className="grid gap-1 text-sm font-medium">
			Tags
			<div className="flex min-h-11 flex-wrap items-center gap-1 rounded-md border border-input px-2 py-1">
				{value.map((tag) => <button key={tag} type="button" className="min-h-11 rounded bg-secondary px-2 text-xs" aria-label={`Remove ${tag} tag`} onClick={() => onChange(value.filter((item) => item !== tag))}>{tag} ×</button>)}
				<input list="link-tag-options" value={draft} placeholder={value.length ? "" : "Type a tag, press Enter"} onChange={(event) => setDraft(event.target.value)} onBlur={() => add()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); } }} className="min-w-20 flex-1 bg-transparent text-sm outline-none" />
				<datalist id="link-tag-options">{suggestions.map((tag) => <option key={tag} value={tag} />)}</datalist>
			</div>
			{hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
		</label>
	);
}

function LinkDialog({ link, url, baseLabel, stats, loading, statsError, editable, onLoadStats, onSave, onUpload }: { link: LinkView; url: string; baseLabel: string; stats: StatsView | null; loading: boolean; statsError: string; editable: boolean; onLoadStats(query?: StatsQuery): void; onSave(patch: Partial<LinkView>): void; onUpload(file: File): void }) {
	const [tab, setTab] = useState<"details" | "stats">("details");
	const [copyStatus, setCopyStatus] = useState("");
	const tabs = [["details", "Details"], ["stats", "Statistics"]] as const;

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(url || `${window.location.origin}/${link.slug}`);
			setCopyStatus("Link copied.");
		} catch {
			setCopyStatus("Could not copy the link. Try again.");
		}
	}

	function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
		setTab(tabs[next][0]);
		event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']")[next]?.focus();
	}

	return (
		<div className="grid gap-4">
			<div className="grid gap-1 pr-10">
				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Short link</p>
				<DialogPrimitive.Title className="break-all font-heading text-2xl text-primary"><a href={url || `/${link.slug}`} target="_blank" rel="noreferrer" className="hover:underline">{baseLabel}/{link.slug}</a></DialogPrimitive.Title>
				<DialogPrimitive.Description className="text-sm text-muted-foreground">{link.title}</DialogPrimitive.Description>
				<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
					<p className="min-w-0 break-all text-xs text-muted-foreground">To {link.destinationUrl}</p>
					<Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void copyLink()}><Copy /> Copy link</Button>
				</div>
				{copyStatus ? <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{copyStatus}</p> : null}
			</div>

			<div role="tablist" aria-label="Link sections" className="flex gap-1 border-b border-border">
				{tabs.map(([id, label], index) => (
					<button key={id} id={`${link.id}-${id}-tab`} type="button" role="tab" aria-selected={tab === id} aria-controls={`${link.id}-${id}-panel`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(event) => moveTab(event, index)} className={cn("-mb-px min-h-11 border-b-2 px-4 text-sm font-medium transition-colors", tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
						{label}
					</button>
				))}
			</div>

			{tab === "details" ? (
				<div id={`${link.id}-details-panel`} role="tabpanel" aria-labelledby={`${link.id}-details-tab`} tabIndex={0} className={cn("grid gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", editable && "lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]")}>
					<section className="grid content-start gap-3 rounded-lg border p-4">
						<h2 className="font-semibold">QR code</h2>
						<p className="text-sm text-muted-foreground">Print it, project it, or download it. Anyone who scans it lands on your short link.</p>
						{url ? <LinkQrCustomizer url={url} style={link.qrStyle} editable={editable} linkId={link.id} onSave={(qrStyle: QrStyle) => onSave({ qrStyle } as Partial<LinkView>)} /> : null}
					</section>
					{editable ? <EditPanel link={link} onSave={onSave} onUpload={onUpload} /> : null}
				</div>
			) : (
				<div id={`${link.id}-stats-panel`} role="tabpanel" aria-labelledby={`${link.id}-stats-tab`} tabIndex={0} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<StatsBlock stats={stats} loading={loading} error={statsError} onLoad={onLoadStats} />
				</div>
			)}
		</div>
	);
}

const GRANULARITY_TABS: Array<{ id: StatsQuery["granularity"]; label: string }> = [
	{ id: "hour", label: "Hour" },
	{ id: "day", label: "Day" },
	{ id: "week", label: "Week" },
	{ id: "month", label: "Month" },
];

function StatsBlock({ stats, loading, error, onLoad }: { stats: StatsView | null; loading: boolean; error: string; onLoad(query?: StatsQuery): void }) {
	if (loading && !stats) return <StatsSkeleton />;
	if (!stats) {
		return (
			<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
				<p>{error || "Could not load statistics."}</p>
				<Button type="button" variant="outline" className="min-h-11" onClick={() => onLoad()}><RefreshCw />Retry</Button>
			</div>
		);
	}
	return <StatsDetails key={stats.link.id} stats={stats} loading={loading} error={error} onLoad={(query) => onLoad(query)} />;
}

function StatsSkeleton() {
	return (
		<div role="status" aria-label="Loading link statistics" className="grid animate-pulse gap-4 motion-reduce:animate-none">
			<div className="grid gap-4 rounded-lg border p-4">
				<div className="h-5 w-40 rounded bg-muted" />
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-16 rounded-lg bg-muted" />)}</div>
				<div className="h-56 rounded-lg bg-muted" />
			</div>
			<div className="h-14 rounded-lg border bg-muted" />
			<div className="grid gap-4 sm:grid-cols-2"><div className="h-48 rounded-lg border bg-muted" /><div className="h-48 rounded-lg border bg-muted" /></div>
		</div>
	);
}

function StatsDetails({ stats, loading, error, onLoad }: { stats: StatsView; loading: boolean; error: string; onLoad(query: StatsQuery): void }) {
	const [defaults] = useState(stats.query);
	const [draft, setDraft] = useState(stats.query);
	const [showAverage, setShowAverage] = useState(true);
	const [cumulative, setCumulative] = useState(false);
	const browserTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
	const chartAverage = stats.filteredClicks / Math.max(1, stats.series.length);
	const chartActive = stats.series.filter((row) => row.count > 0).length;
	const chartPeak = stats.series.reduce((best, point) => (point.count > best.count ? point : best), { date: stats.query.from, count: 0 });
	const topDevice = [...stats.devices].sort((a, b) => b.count - a.count)[0]?.bucket;
	const sourceData = stats.referrers.map((row) => ({ ...row, bucket: formatBucket(row.bucket) }));
	const deviceData = stats.devices.map((row) => ({ ...row, bucket: formatBucket(row.bucket) }));
	const today = todayInTimeZone(draft.timezone);
	const change = stats.filteredClicks - stats.comparison.filteredClicks;
	const changePct = stats.comparison.filteredClicks ? (change / stats.comparison.filteredClicks) * 100 : null;

	function pickRecent(days: number) {
		setDraft((current) => ({ ...current, from: shiftIsoDay(today, -days + 1), to: today }));
	}

	function resetFilters() {
		setDraft(defaults);
		onLoad(defaults);
	}

	return (
		<section className="grid gap-4">
			{error ? (
				<div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
					<p>{error} The last successful view is still shown.</p>
					<Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => onLoad(stats.query)}><RefreshCw />Retry</Button>
				</div>
			) : null}

			<div className="rounded-lg border bg-card p-4">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<CalendarDays className="size-4 text-primary" />
							<h2 className="font-semibold">Click trends</h2>
						</div>
						<p className="mt-1 text-sm text-muted-foreground">
							{formatRange(stats.query.from, stats.query.to)} in {stats.query.timezone}, grouped by {stats.query.granularity}.
						</p>
					</div>
					<Badge variant="info">{formatWhole(stats.filteredClicks)} filtered</Badge>
				</div>
				<div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Applied filters">
					<span className="mr-1 text-xs font-semibold uppercase text-muted-foreground">Applied</span>
					<Badge variant="secondary">{formatRange(stats.query.from, stats.query.to)}</Badge>
					<Badge variant="secondary">{stats.query.timezone}</Badge>
					<Badge variant="secondary">Source: {sourceFilterLabel(stats.query.source)}</Badge>
					<Badge variant="secondary">Device: {deviceFilterLabel(stats.query.device)}</Badge>
					<Badge variant="secondary">By {stats.query.granularity}</Badge>
				</div>

				<div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
					<Stat label="Filtered clicks" value={formatWhole(stats.filteredClicks)} />
					<Stat label="Lifetime clicks" value={formatWhole(stats.lifetimeClicks)} />
					{stats.filteredClicks > 0 ? <>
						<Stat label="Previous period" value={formatChange(change, changePct)} />
						<Stat label={`Average per ${stats.query.granularity}`} value={formatAverage(chartAverage)} />
						<Stat label={`Active ${stats.query.granularity}s`} value={`${chartActive}/${Math.max(1, stats.series.length)}`} />
						<Stat label={`Best ${stats.query.granularity}`} value={chartPeak.count ? `${chartPeak.count} on ${formatStatsPoint(chartPeak.date)}` : "None"} />
					</> : null}
				</div>
				{stats.filteredClicks === 0 ? (
					<div role="status" className="mt-4 rounded-md bg-secondary/50 p-4 text-sm">
						<p className="font-semibold">No clicks in this range</p>
						<p className="mt-1 text-muted-foreground">This link has {formatWhole(stats.lifetimeClicks)} lifetime clicks. Try a longer date range or clear the source and device filters.</p>
					</div>
				) : (
					<div className="mt-4 grid gap-3">
						<div className="flex flex-wrap gap-2"><SettingToggle checked={showAverage} label="Average line" onChange={setShowAverage} /><SettingToggle checked={cumulative} label="Cumulative" onChange={setCumulative} /></div>
						<ClicksOverTime data={stats.series} average={showAverage && !cumulative ? chartAverage : undefined} cumulative={cumulative} verbose />
					</div>
				)}
				<p className="mt-3 text-xs text-muted-foreground">{historyLabel(stats)}</p>
			</div>

			<details className="rounded-lg border bg-card p-4">
				<summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 font-semibold">
					<span className="inline-flex items-center gap-2"><SlidersHorizontal className="size-4 text-primary" />Filter statistics</span>
					<span className="text-xs font-normal text-muted-foreground">Dates, source, device, timezone, grouping</span>
				</summary>
				<form className="mt-4 grid gap-4 border-t pt-4" onSubmit={(event) => { event.preventDefault(); onLoad(draft); }}>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<p className="text-sm text-muted-foreground">Changes take effect when you apply them.</p>
						<div role="group" aria-label="Date presets" className="grid w-full grid-cols-3 gap-1 rounded-lg bg-muted p-1 sm:w-auto">
							<Button type="button" variant={draft.from === today && draft.to === today ? "secondary" : "ghost"} className="min-h-11" aria-pressed={draft.from === today && draft.to === today} onClick={() => pickRecent(1)}>Today</Button>
							<Button type="button" variant={draft.from === shiftIsoDay(today, -6) && draft.to === today ? "secondary" : "ghost"} className="min-h-11" aria-pressed={draft.from === shiftIsoDay(today, -6) && draft.to === today} onClick={() => pickRecent(7)}>7 days</Button>
							<Button type="button" variant={draft.from === shiftIsoDay(today, -29) && draft.to === today ? "secondary" : "ghost"} className="min-h-11" aria-pressed={draft.from === shiftIsoDay(today, -29) && draft.to === today} onClick={() => pickRecent(30)}>30 days</Button>
						</div>
					</div>

					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
						<label className="grid gap-1 text-sm font-medium">Start date<Input className="min-h-11" type="date" required value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
						<label className="grid gap-1 text-sm font-medium">End date<Input className="min-h-11" type="date" required value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
						<label className="grid gap-1 text-sm font-medium">Source<Select className="min-h-11" value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value as StatsQuery["source"] })}><option value="all">All sources</option><option value="qr">QR scans</option><option value="link">Direct links</option><option value="unknown">Unknown history</option></Select></label>
						<label className="grid gap-1 text-sm font-medium">Device<Select className="min-h-11" value={draft.device} onChange={(event) => setDraft({ ...draft, device: event.target.value as StatsQuery["device"] })}><option value="all">All devices</option><option value="mobile">Mobile</option><option value="desktop">Desktop</option></Select></label>
						<label className="grid gap-1 text-sm font-medium">Timezone<Input className="min-h-11" list="link-stats-timezones" required value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} /><datalist id="link-stats-timezones"><option value="UTC" /><option value={browserTimezone} /></datalist></label>
					</div>

					<fieldset className="grid gap-1">
						<legend className="text-sm font-medium">Group by</legend>
						<div className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:flex sm:w-fit">
							{GRANULARITY_TABS.map((item) => <Button key={item.id} type="button" variant={draft.granularity === item.id ? "secondary" : "ghost"} className="min-h-11" aria-pressed={draft.granularity === item.id} onClick={() => setDraft({ ...draft, granularity: item.id })}>{item.label}</Button>)}
						</div>
					</fieldset>
					<p className="text-xs text-muted-foreground">Limits: 366 days overall, 14 days when grouped by hour, and 5,000 hourly aggregate rows including the comparison window.</p>

					<div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Button type="button" variant="ghost" className="min-h-11" onClick={resetFilters} disabled={loading}>Reset</Button><Button type="submit" className="min-h-11" disabled={loading}>{loading ? <RefreshCw className="animate-spin motion-reduce:animate-none" /> : null}{loading ? "Applying" : "Apply filters"}</Button></div>
				</form>
			</details>

			{stats.filteredClicks > 0 ? <div className="grid gap-4 sm:grid-cols-2">
				<div className="rounded-lg border bg-card p-4">
					<div className="mb-3 flex items-start justify-between gap-3">
						<div>
							<h2 className="font-semibold">Traffic source</h2>
							<p className="text-xs text-muted-foreground">Applied range and filters</p>
						</div>
						<Badge variant="secondary">{formatWhole(stats.filteredClicks)} clicks</Badge>
					</div>
					<DonutChart data={sourceData} label="Traffic source" />
				</div>
				<div className="rounded-lg border bg-card p-4">
					<div className="mb-3 flex items-start justify-between gap-3">
						<div>
							<h2 className="font-semibold">Devices</h2>
							<p className="text-xs text-muted-foreground">Applied range and filters</p>
						</div>
						<Badge variant="secondary">{topDevice ? formatBucket(topDevice) : "None"}</Badge>
					</div>
					<DonutChart data={deviceData} label="Devices" />
				</div>
			</div> : null}
		</section>
	);
}

function SettingToggle({ checked, label, onChange }: { checked: boolean; label: string; onChange(value: boolean): void }) {
	return (
		<label className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium">
			<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-[#06192F]" />
			{label}
		</label>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return <div className="rounded-lg bg-secondary/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 truncate font-semibold tabular-nums">{value}</p></div>;
}

function formatWhole(value: number): string {
	return new Intl.NumberFormat("en").format(value);
}

function formatAverage(value: number): string {
	return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function formatShortDate(value: string): string {
	const [year, month, day] = value.split("-").map(Number);
	return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatRange(start: string, end: string): string {
	return start === end ? formatShortDate(start) : `${formatShortDate(start)} to ${formatShortDate(end)}`;
}

function historyLabel(stats: StatsView): string {
	const { history } = stats;
	if (!history.earliestHour || !history.latestHour) return history.complete ? "No matching activity in this range." : "Activity may be missing from this range. Try a shorter range.";
	const range = `${formatStatsPoint(history.earliestHour)} to ${formatStatsPoint(history.latestHour)}`;
	return history.complete ? `Recorded activity: ${range}.` : `Activity shown from ${range}. Choose a shorter range for complete results.`;
}

function sourceFilterLabel(source: StatsQuery["source"]): string {
	return source === "qr" ? "QR scans" : source === "link" ? "Direct links" : source === "unknown" ? "Unknown history" : "All";
}

function deviceFilterLabel(device: StatsQuery["device"]): string {
	return device === "mobile" ? "Mobile" : device === "desktop" ? "Desktop" : "All";
}

function formatChange(change: number, pct: number | null): string {
	const signed = `${change >= 0 ? "+" : ""}${formatWhole(change)}`;
	return pct === null ? signed : `${signed} (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)`;
}

function EditPanel({ link, onSave, onUpload }: { link: LinkView; onSave(patch: Partial<LinkView>): void; onUpload(file: File): void }) {
	const [title, setTitle] = useState(link.title);
	const [destinationUrl, setDestinationUrl] = useState(link.destinationUrl);
	const [previewTitle, setPreviewTitle] = useState(link.previewTitle ?? "");
	const [previewDescription, setPreviewDescription] = useState(link.previewDescription ?? "");
	const [tags, setTags] = useState(link.tags);
	return (
		<section className="grid content-start gap-3 rounded-lg border p-4">
			<h2 className="font-semibold">Edit link</h2>
			<label className="grid gap-1 text-sm font-medium">Title<Input className="min-h-11" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
			<label className="grid gap-1 text-sm font-medium">Destination<Input className="min-h-11" value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} /></label>
			<TagInput value={tags} suggestions={link.tags} onChange={setTags} />

			<details className="rounded-md border p-3 text-sm">
				<summary className="cursor-pointer font-medium">Social preview <span className="font-normal text-muted-foreground">(optional)</span></summary>
				<p className="mt-1 text-xs text-muted-foreground">When someone shares this link on chat or social media, it can show a little preview card. These fields control what that card says. Leave them blank to use the destination page&rsquo;s own preview.</p>
				<div className="mt-3 grid gap-3">
					<label className="grid gap-1 font-medium">Preview title<Input className="min-h-11" value={previewTitle} onChange={(event) => setPreviewTitle(event.target.value)} /><span className="text-xs font-normal text-muted-foreground">The headline shown on the card.</span></label>
					<label className="grid gap-1 font-medium">Preview description<Textarea value={previewDescription} onChange={(event) => setPreviewDescription(event.target.value)} /><span className="text-xs font-normal text-muted-foreground">A line or two under the headline.</span></label>
					<div className="grid gap-1">
						<span className="font-medium">Preview image</span>
						<Button asChild variant="outline" size="sm" className="min-h-11 w-fit"><label className="cursor-pointer"><ImageUp />Upload image<input className="sr-only" type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && onUpload(event.target.files[0])} /></label></Button>
						<span className="text-xs font-normal text-muted-foreground">The thumbnail on the card. {link.previewImageKey ? "An image is set. Uploading replaces it." : "No image yet."} Saved as soon as it uploads.</span>
					</div>
				</div>
			</details>

			<Button className="min-h-11 w-fit" onClick={() => onSave({ title, destinationUrl, tags, previewTitle: previewTitle || null, previewDescription: previewDescription || null })}><Save />Save changes</Button>
		</section>
	);
}

async function uploadPreview(id: string, file: File, updateLink: (id: string, patch: Partial<LinkView>) => Promise<void>, setStatus: (status: string) => void) {
	const body = new FormData();
	body.set("purpose", "link_preview");
	body.set("linkId", id);
	body.set("file", file);
	const response = await fetch("/api/uploads", { method: "POST", credentials: "same-origin", body });
	const result = await response.json() as { key?: string; error?: string };
	if (!response.ok || !result.key) {
		setStatus(result.error ?? "Could not upload image.");
		return;
	}
	await updateLink(id, { previewImageKey: result.key });
}
