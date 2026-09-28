import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CtaBand } from "@/components/public/cta-band";
import { PageHero } from "@/components/public/public-page";
import { PlaceholderBlock } from "@/components/public/placeholder-block";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { PROJECTS } from "@/content/site";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Projects — CODE" };

export default function ProjectsPage() {
	if (!isFeatureEnabled("publicSite")) notFound();
	return <div className="min-h-screen bg-background text-foreground"><SiteHeader /><main><PageHero eyebrow="Our Projects" description="Two flagship programs carry CODE's advocacy beyond our clients to student leaders across the Philippines.">Where OD meets <span className="font-normal italic text-[#90B4CC]">the youth sector.</span></PageHero>
		<section className="mx-auto grid max-w-7xl gap-16 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">{PROJECTS.map((project, index) => <article key={project.id} id={project.id} className="grid scroll-mt-28 items-center gap-10 lg:grid-cols-2 lg:gap-16"><div className={index % 2 ? "lg:order-2" : ""}><div className="flex items-center gap-4"><span className="grid size-14 shrink-0 place-items-center rounded-xl bg-primary font-heading text-xl font-bold text-white">{project.short}</span><span className="rounded-md bg-[#D7DFE9] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary">{project.kicker}</span></div><h2 className="mt-6 font-heading text-4xl sm:text-5xl">{project.name}</h2><p className="mt-3 font-heading text-lg italic text-accent">{project.theme}</p><p className="mt-5 text-lg leading-8 text-muted-foreground">{project.summary}</p><ul className="mt-6 grid gap-3">{project.goals.map((goal) => <li key={goal} className="flex items-start gap-3 text-muted-foreground"><span className="mt-2.5 size-2 shrink-0 rounded-full bg-accent" />{goal}</li>)}</ul><dl className="mt-8 flex flex-wrap gap-10">{project.stat.map((stat) => <div key={stat.k}><dt className="font-heading text-3xl font-bold text-primary">{stat.k}</dt><dd className="mt-1 text-sm text-[#717D89]">{stat.v}</dd></div>)}</dl></div><PlaceholderBlock label={`Gallery: ${project.name} highlights`} className={`aspect-[4/5] ${index % 2 ? "lg:order-1" : ""}`} /></article>)}</section><CtaBand title="Want to partner on a program?" body="We collaborate with universities, non-profits, and youth organizations across the Philippines." cta="Reach out" /></main><SiteFooter /></div>;
}
