import { Check, Clock } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CtaBand } from "@/components/public/cta-band";
import { PageHero } from "@/components/public/public-page";
import { PlaceholderBlock } from "@/components/public/placeholder-block";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { SERVICES, SERVICES_INTRO } from "@/content/site";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Services — CODE" };
const PROCESS = [["01", "Listen", "We do careful research into each client's specific context."], ["02", "Tailor", "We design an engagement unique to that reality, not a template."], ["03", "Develop", "We train, restructure, or advise toward lasting change."], ["04", "Sustain", "We leave the organization healthier and more conducive to flourishing."]];

export default function ServicesPage() {
	if (!isFeatureEnabled("publicSite")) notFound();
	return <div className="min-h-screen bg-background text-foreground"><SiteHeader /><main><PageHero eyebrow="Our Services" description={SERVICES_INTRO}>Tailor-fit OD, <span className="font-normal italic text-[#90B4CC]">never generalized.</span></PageHero>
		<section className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 sm:py-20 lg:px-8">{SERVICES.map((service, index) => <article key={service.id} className="grid items-center gap-8 rounded-xl border border-border bg-card p-6 sm:p-9 lg:grid-cols-2 lg:gap-16 lg:p-12"><div className={index % 2 ? "lg:order-2" : ""}><span className="inline-flex rounded-md bg-[#D7DFE9] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary">{service.tag}</span><h2 className="mt-4 font-heading text-3xl sm:text-4xl">{service.title}</h2><p className="mt-4 text-lg leading-8 text-muted-foreground">{service.summary}</p><p className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#717D89]"><Clock className="size-4 text-accent" />{service.meta}</p><ul className="mt-6 grid gap-3">{service.points.map((point) => <li key={point} className="flex items-start gap-3 text-muted-foreground"><Check className="mt-1 size-4 shrink-0 text-accent" />{point}</li>)}</ul></div><PlaceholderBlock label={`Photo: ${service.title.toLowerCase()} in session`} className={`aspect-[5/4] ${index % 2 ? "lg:order-1" : ""}`} /></article>)}</section>
		<section className="bg-[#D7DFE9]/40"><div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">How an engagement works</p><h2 className="mt-3 font-heading text-4xl">Research-led, end to end</h2><div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">{PROCESS.map(([step, title, body]) => <div key={step}><p className="font-heading text-lg font-bold tracking-[0.12em] text-[#90B4CC]">{step}</p><div className="my-3 h-0.5 w-9 bg-accent" /><h3 className="font-heading text-2xl">{title}</h3><p className="mt-2 leading-7 text-muted-foreground">{body}</p></div>)}</div></div></section><CtaBand /></main><SiteFooter /></div>;
}
