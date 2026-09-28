import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArticleCard } from "@/components/public/public-page";
import { CtaBand } from "@/components/public/cta-band";
import { PlaceholderBlock } from "@/components/public/placeholder-block";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { ARTICLES, COMPETENCIES, HERO_STATS, MISSION, ORG, VISION, WHAT_IS_OD } from "@/content/site";
import { isFeatureEnabled } from "@/server/features";

const LANDING_PAGE_URL = "https://sites.google.com/view/ateneo-code/landing";

// The flag lives in the Worker env, so this cannot be force-static any more. The page reads
// no database and renders from a content module, so dynamic rendering only costs CDN caching.
export const dynamic = "force-dynamic";

export default function Home() {
	if (!isFeatureEnabled("publicSite")) redirect(LANDING_PAGE_URL);

	return (
		<div className="min-h-screen bg-background text-foreground">
			<SiteHeader />
			<main>
				<header className="relative isolate overflow-hidden bg-primary text-white">
					<div className="absolute inset-0 -z-20 bg-[radial-gradient(120%_90%_at_12%_0%,rgba(144,180,204,0.28),transparent_55%)]" />
					<Image
						src="/code-falcon-white.png"
						alt=""
						aria-hidden="true"
						width={430}
						height={477}
						priority
						className="absolute -right-24 top-1/2 -z-10 h-[135%] w-auto max-w-none -translate-y-1/2 opacity-[0.07]"
					/>
					<div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-32">
						<div className="max-w-4xl">
							<p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#90B4CC]">Youth-led · Non-profit · Jesuit-formed</p>
							<h1 className="mt-5 text-balance font-heading text-4xl leading-[1.08] sm:text-6xl lg:text-7xl">Organization Development<br /><span className="font-normal italic text-[#90B4CC]">for the youth who will build the nation.</span></h1>
							<p className="mt-7 max-w-2xl text-lg leading-8 text-white/75 sm:text-xl">{ORG.blurb}</p>
							<div className="mt-9 flex flex-wrap gap-3"><Button asChild variant="secondary"><Link href="/services">Explore our services <ArrowRight /></Link></Button><Button asChild variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"><Link href="/product">Read the Product Center</Link></Button></div>
							<dl className="mt-14 flex flex-wrap gap-x-12 gap-y-6 sm:gap-x-16">{HERO_STATS.map((stat) => <div key={stat.label}><dt className="font-heading text-4xl leading-none">{stat.value}</dt><dd className="mt-2 max-w-36 text-sm text-white/55">{stat.label}</dd></div>)}</dl>
						</div>
					</div>
				</header>

				<section className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:px-8">
					<div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Who we are</p><h2 className="mt-4 text-balance font-heading text-3xl leading-tight sm:text-4xl">Consultants in action. Real people, real change.</h2></div>
					<div><p className="font-heading text-2xl leading-relaxed">We conduct <em>contextualized</em> OD services, tailor-fit to each client&apos;s reality, through short-term engagements, long-term partnerships, and consultancy teams.</p><p className="mt-5 text-lg leading-8 text-muted-foreground">Imbued with Ignatian values, we form the youth and youth-oriented organizations who will initiate positive change within the community.</p></div>
				</section>

				<section className="bg-[#D7DFE9]/40"><div className="mx-auto grid max-w-7xl gap-6 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:px-8">{[["Vision", VISION], ["Mission", MISSION]].map(([title, body]) => <article key={title} className="relative overflow-hidden rounded-xl border border-white bg-white p-8 shadow-sm sm:p-10"><Quote className="absolute right-7 top-7 size-10 text-[#D7DFE9]" /><p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{title}</p><p className="mt-6 font-heading text-xl leading-relaxed sm:text-2xl">{body}</p></article>)}</div></section>

				<section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">What grounds us</p><h2 className="mt-3 font-heading text-4xl">Three core competencies</h2><p className="mt-3 text-lg text-muted-foreground">Everything we do as consultants traces back to these.</p><div className="mt-10 grid gap-6 md:grid-cols-3">{COMPETENCIES.map((item) => <article key={item.n} className="rounded-lg border border-border p-7"><p className="font-heading text-lg font-bold tracking-[0.12em] text-[#90B4CC]">{item.n}</p><div className="my-4 h-0.5 w-10 bg-accent" /><h3 className="font-heading text-2xl">{item.title}</h3><p className="mt-3 leading-7 text-muted-foreground">{item.body}</p></article>)}</div></section>

				<section className="bg-primary text-white"><div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-8"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#90B4CC]">The discipline behind it all</p><h2 className="mt-4 text-balance font-heading text-4xl leading-tight sm:text-5xl">What is Organization Development?</h2><p className="mt-6 text-lg leading-8 text-white/70">{WHAT_IS_OD}</p><Button asChild variant="secondary" className="mt-8"><Link href="/services">See how we apply it <ArrowRight /></Link></Button></div><PlaceholderBlock label="The planned-change cycle: diagnose, intervene, reinforce" className="aspect-[4/3] border-white/20 bg-white/5 text-white/65 [&_svg]:text-[#90B4CC]" /></div></section>

				<section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Product Center</p><h2 className="mt-3 font-heading text-4xl">OD, made digestible</h2><p className="mt-3 max-w-2xl text-lg text-muted-foreground">Contextualized OD content written by CODE consultants, free for the youth.</p></div><Link href="/product" className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline">View all articles <ArrowRight className="size-4" /></Link></div><div className="mt-10 grid gap-6 md:grid-cols-3">{ARTICLES.slice(0, 3).map((article) => <ArticleCard key={article.id} article={article} />)}</div></section>

				<CtaBand />
			</main>
			<SiteFooter />
		</div>
	);
}
