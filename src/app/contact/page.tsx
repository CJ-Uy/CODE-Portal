import { ExternalLink, Mail, MapPin } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/public/contact-form";
import { PageHero } from "@/components/public/public-page";
import { PlaceholderBlock } from "@/components/public/placeholder-block";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { CONTACTS, ORG } from "@/content/site";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact — CODE" };

export default function ContactPage() {
	if (!isFeatureEnabled("publicSite")) notFound();
	return <div className="min-h-screen bg-background text-foreground"><SiteHeader /><main><PageHero eyebrow="Contact Us" description="Reach the right representative for your context, or send us a note. We read everything.">Let&apos;s talk about <span className="font-normal italic text-[#90B4CC]">your organization.</span></PageHero>
		<section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:px-8"><div><h2 className="font-heading text-3xl">Representatives</h2><p className="mt-2 text-muted-foreground">Choose by where your organization sits.</p><div className="mt-6 grid gap-3">{CONTACTS.map((rep) => <a key={rep.email} href={`mailto:${rep.email}`} className="group rounded-lg border border-border bg-card p-5 transition hover:border-accent"><div className="flex items-start justify-between gap-4"><h3 className="font-heading text-xl">{rep.role}</h3><Mail className="size-5 shrink-0 text-[#90B4CC] group-hover:text-accent" /></div><p className="mt-2 text-sm text-muted-foreground">{rep.scope}</p><p className="mt-2 break-all text-sm font-semibold text-accent">{rep.email}</p></a>)}</div><div className="mt-6 flex flex-wrap gap-3"><a href={`mailto:${ORG.email}`} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-primary"><Mail className="size-4" />{ORG.email}</a><a href={ORG.fbUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-primary"><ExternalLink className="size-4" />{ORG.fb}</a></div><div className="mt-10"><h2 className="font-heading text-3xl">Find us</h2><p className="mt-4 flex gap-3 leading-7 text-muted-foreground"><MapPin className="mt-1 size-5 shrink-0 text-[#90B4CC]" /><span><strong className="text-foreground">{ORG.room}</strong><br />{ORG.campus}</span></p><PlaceholderBlock label="Map: MVP Center for Student Leadership, ADMU" className="mt-5 aspect-video" /></div></div>
		<div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-10"><h2 className="font-heading text-3xl">Send us a note</h2><p className="mt-2 mb-7 text-muted-foreground">Tell us about your organization and what you are hoping to develop.</p><ContactForm /></div></section></main><SiteFooter /></div>;
}
