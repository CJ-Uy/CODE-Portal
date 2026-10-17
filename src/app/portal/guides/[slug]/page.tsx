import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock, Lightbulb } from "lucide-react";
import { AnnotatedShot } from "@/components/guides/annotated-shot";
import { AUDIENCE_BADGE, GUIDE_ICONS } from "@/components/guides/guide-meta";
import { Breadcrumb } from "@/components/portal/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { AUDIENCE_LABEL, GUIDES, type Guide } from "@/lib/guides/content";
import { neighbours, visibleGuides } from "@/lib/guides/filter";
import { getActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
	const actor = await getActor();
	if (!actor) redirect("/signin");
	const { slug } = await params;

	// A guide this member can't see (admin-only, or behind a flag that's off) 404s like an unknown slug.
	const visible = visibleGuides(GUIDES, {
		canAdmin: can(actor, "survey:configure"),
		surveys: isFeatureEnabled("surveys"),
		retention: isFeatureEnabled("retention"),
	});
	const guide = visible.find((item) => item.slug === slug);
	if (!guide) notFound();
	const { prev, next } = neighbours(guide.slug, visible);
	const Icon = GUIDE_ICONS[guide.icon];

	return (
		<article className="mx-auto grid w-full min-w-0 max-w-3xl gap-8">
			<div className="grid min-w-0 gap-5">
				<Breadcrumb items={[{ label: "Guides", href: "/portal/guides" }, { label: guide.title }]} />
				<header className="grid min-w-0 gap-3">
					<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
						<span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-accent">
							<Icon className="size-5" aria-hidden="true" />
						</span>
						<Badge variant={AUDIENCE_BADGE[guide.audience]}>{AUDIENCE_LABEL[guide.audience]}</Badge>
						<span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
							<Clock className="size-3.5" aria-hidden="true" />~{guide.minutes} min
						</span>
					</div>
					<h1 className="min-w-0 font-heading text-3xl leading-tight [overflow-wrap:anywhere] sm:text-4xl">{guide.title}</h1>
					<p className="min-w-0 max-w-2xl text-muted-foreground [overflow-wrap:anywhere]">{guide.summary}</p>
				</header>
			</div>

			<ol className="grid min-w-0 border-t border-border/60 pt-8">
				{guide.steps.map((step, index) => {
					const last = index === guide.steps.length - 1;
					return (
						<li key={step.title} className={`relative grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-x-3 sm:gap-x-5 ${last ? "" : "pb-12"}`}>
							{last ? null : <span aria-hidden="true" className="absolute bottom-0 left-4 top-10 w-px -translate-x-1/2 bg-border" />}
							<span
								aria-hidden="true"
								className="grid size-8 place-items-center rounded-full border border-border bg-card font-heading text-sm font-semibold text-primary"
							>
								{index + 1}
							</span>
							<div className="grid min-w-0 gap-5">
								<div className="grid min-w-0 gap-1.5 pt-0.5">
									<h2 className="font-heading text-xl leading-snug [overflow-wrap:anywhere] sm:text-2xl">
										<span className="sr-only">Step {index + 1}: </span>
										{step.title}
									</h2>
									<p className="text-muted-foreground [overflow-wrap:anywhere]">{step.body}</p>
								</div>
								{step.image ? <AnnotatedShot image={step.image} /> : null}
								{step.tip ? (
									<p className="flex min-w-0 items-start gap-2.5 rounded-lg border border-border/60 bg-secondary/50 p-3 text-sm text-secondary-foreground">
										<Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
										<span className="min-w-0 [overflow-wrap:anywhere]">
											<span className="font-semibold">Tip: </span>
											{step.tip}
										</span>
									</p>
								) : null}
							</div>
						</li>
					);
				})}
			</ol>

			{prev || next ? (
				<nav aria-label="More guides" className="grid min-w-0 gap-3 border-t border-border/60 pt-6 sm:grid-cols-2">
					{prev ? <Neighbour guide={prev} direction="prev" /> : null}
					{next ? <Neighbour guide={next} direction="next" /> : null}
				</nav>
			) : null}
		</article>
	);
}

function Neighbour({ guide, direction }: { guide: Guide; direction: "prev" | "next" }) {
	const isNext = direction === "next";
	return (
		<Link
			href={`/portal/guides/${guide.slug}`}
			className={`group flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
				isNext ? "flex-row-reverse text-right sm:col-start-2" : ""
			}`}
		>
			{isNext ? (
				<ArrowRight className="size-4 shrink-0 text-accent" aria-hidden="true" />
			) : (
				<ArrowLeft className="size-4 shrink-0 text-accent" aria-hidden="true" />
			)}
			<span className="grid min-w-0 gap-0.5">
				<span className="text-xs text-muted-foreground">{isNext ? "Next guide" : "Previous guide"}</span>
				<span className="font-medium [overflow-wrap:anywhere]">{guide.title}</span>
			</span>
		</Link>
	);
}
