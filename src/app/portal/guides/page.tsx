import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BookOpen, Clock, LifeBuoy, Search, SearchX } from "lucide-react";
import { AUDIENCE_BADGE, GUIDE_ICONS } from "@/components/guides/guide-meta";
import { EmptyState } from "@/components/portal/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AUDIENCE_LABEL, GUIDE_AUDIENCES, GUIDES, type GuideAudience } from "@/lib/guides/content";
import { filterByAudience, parseAudience, searchGuides, visibleGuides } from "@/lib/guides/filter";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

export default async function GuidesPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; for?: string | string[] }> }) {
	const actor = await getActor();
	if (!actor) redirect("/signin");
	const params = await searchParams;

	const visible = visibleGuides(GUIDES, {
		canAdmin: can(actor, "survey:configure"),
		surveys: isFeatureEnabled("surveys"),
		retention: isFeatureEnabled("retention"),
	});
	// Only offer chips for audiences this member can see, so a CRS chip never leads to an empty list.
	const audiences = GUIDE_AUDIENCES.filter((audience) => visible.some((guide) => guide.audience === audience));
	const requested = parseAudience(params.for);
	const audience = requested && audiences.includes(requested) ? requested : undefined;
	const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
	const guides = searchGuides(filterByAudience(visible, audience), q);

	return (
		<div className="grid min-w-0 gap-8">
			<header className="grid min-w-0 justify-items-center gap-4 rounded-xl border border-border/60 bg-card px-5 py-10 text-center shadow-sm sm:px-8 sm:py-12">
				<span className="grid size-12 place-items-center rounded-full bg-secondary text-accent">
					<LifeBuoy className="size-6" aria-hidden="true" />
				</span>
				<div className="grid min-w-0 gap-2">
					<p className="text-xs font-semibold uppercase tracking-wide text-primary">Guides</p>
					<h1 className="font-heading text-3xl leading-tight [overflow-wrap:anywhere] sm:text-4xl">How can we help?</h1>
					<p className="mx-auto max-w-md text-sm text-muted-foreground sm:text-base">
						Short walkthroughs of the portal, with screenshots. Pick a topic or search.
					</p>
				</div>
				<form action="/portal/guides" role="search" className="flex w-full max-w-xl min-w-0 gap-2">
					{audience ? <input type="hidden" name="for" value={audience} /> : null}
					<label htmlFor="guide-search" className="sr-only">
						Search guides
					</label>
					<div className="relative min-w-0 flex-1">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
						<Input id="guide-search" type="search" name="q" defaultValue={q} placeholder="Try sign up or attendance" className="h-11 pl-9" />
					</div>
					<Button type="submit" className="h-11">
						Search
					</Button>
				</form>
			</header>

			<section aria-label="Guides" className="grid min-w-0 gap-4">
				<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
					<p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
						{q ? `${guides.length} ${guides.length === 1 ? "guide matches" : "guides match"} “${q}”` : `${guides.length} ${guides.length === 1 ? "guide" : "guides"}`}
					</p>
					{audiences.length > 1 ? (
						<nav aria-label="Filter by who it's for" className="flex flex-wrap gap-2">
							<Chip label="All" href={hrefFor(undefined, q)} active={!audience} />
							{audiences.map((item) => (
								<Chip key={item} label={AUDIENCE_LABEL[item]} href={hrefFor(item, q)} active={audience === item} />
							))}
						</nav>
					) : null}
				</div>

				{guides.length === 0 ? (
					<EmptyState
						icon={SearchX}
						title="No guides match that"
						description="Try a shorter word, like event or check in."
						action={
							<Button asChild variant="outline" size="sm">
								<Link href={hrefFor(audience, "")}>Clear search</Link>
							</Button>
						}
					/>
				) : (
					<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{guides.map((guide) => {
							const Icon = GUIDE_ICONS[guide.icon];
							return (
								<li key={guide.slug} className="min-w-0">
									<Link
										href={`/portal/guides/${guide.slug}`}
										className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<Card className="flex h-full flex-col gap-4 p-5 transition-colors group-hover:border-accent motion-reduce:transition-none">
											<div className="flex min-w-0 items-start justify-between gap-3">
												<span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-accent">
													<Icon className="size-5" aria-hidden="true" />
												</span>
												<Badge variant={AUDIENCE_BADGE[guide.audience]}>{AUDIENCE_LABEL[guide.audience]}</Badge>
											</div>
											<div className="grid min-w-0 gap-1.5">
												<h2 className="font-heading text-lg leading-snug [overflow-wrap:anywhere]">{guide.title}</h2>
												<p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{guide.summary}</p>
											</div>
											<div className="mt-auto flex items-center justify-between gap-3 text-xs text-muted-foreground">
												<span className="inline-flex items-center gap-1.5">
													<Clock className="size-3.5" aria-hidden="true" />~{guide.minutes} min · {guide.steps.length} steps
												</span>
												<ArrowRight
													className="size-4 text-accent transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
													aria-hidden="true"
												/>
											</div>
										</Card>
									</Link>
								</li>
							);
						})}
					</ul>
				)}
			</section>

			{isFeatureEnabled("library") ? (
				<p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 pt-6 text-sm text-muted-foreground">
					<BookOpen className="size-4 shrink-0 text-accent" aria-hidden="true" />
					<span className="min-w-0">Looking for something else?</span>
					<Link href="/portal/library?type=guide" className="font-medium text-accent underline-offset-4 hover:underline">
						More guides in the Library
					</Link>
				</p>
			) : null}
		</div>
	);
}

function hrefFor(audience: GuideAudience | undefined, q: string): string {
	const params = new URLSearchParams();
	if (q) params.set("q", q);
	if (audience) params.set("for", audience);
	const query = params.toString();
	return query ? `/portal/guides?${query}` : "/portal/guides";
}

function Chip({ label, href, active }: { label: string; href: string; active: boolean }) {
	return (
		<Link
			href={href}
			aria-current={active ? "true" : undefined}
			className={
				active
					? "rounded-full border border-accent bg-secondary px-3 py-1.5 text-xs font-medium text-foreground"
					: "rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
			}
		>
			{label}
		</Link>
	);
}
