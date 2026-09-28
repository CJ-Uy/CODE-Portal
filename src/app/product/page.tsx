import Link from "next/link";
import { Search } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Input } from "@/components/ui/input";
import { ArticleCard, PageHero } from "@/components/public/public-page";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { ARTICLE_CATS, ARTICLES } from "@/content/site";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Product Center — CODE" };

export default async function ProductCenterPage({ searchParams }: { searchParams: Promise<{ cat?: string; q?: string }> }) {
	if (!isFeatureEnabled("publicSite")) notFound();
	const { cat, q } = await searchParams;
	const category = cat && ARTICLE_CATS.includes(cat) ? cat : "All";
	const query = q?.trim().toLowerCase() ?? "";
	const articles = ARTICLES.filter((article) => (category === "All" || article.cat === category) && (!query || `${article.title} ${article.dek} ${article.cat}`.toLowerCase().includes(query)));
	return <div className="min-h-screen bg-background text-foreground"><SiteHeader /><main><PageHero eyebrow="Product Center" description="Digestible, contextualized OD content for public use, written by CODE consultants for youth who want to learn OD as a stepping point toward nation-building.">Organization Development, <span className="font-normal italic text-[#90B4CC]">made digestible.</span></PageHero>
		<section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8"><form className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-center sm:justify-between" action="/product">{category !== "All" ? <input type="hidden" name="cat" value={category} /> : null}<div className="flex flex-wrap gap-2">{ARTICLE_CATS.map((item) => <Link key={item} href={item === "All" ? "/product" : `/product?cat=${encodeURIComponent(item)}`} className={category === item ? "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white" : "rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground hover:border-accent hover:text-foreground"}>{item}</Link>)}</div><label className="relative block sm:w-72"><span className="sr-only">Search articles</span><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input name="q" defaultValue={q ?? ""} placeholder="Search articles" className="pl-9" /></label></form>
		{articles.length ? <div className="mt-9 grid gap-6 md:grid-cols-2 lg:grid-cols-3">{articles.map((article) => <ArticleCard key={article.id} article={article} />)}</div> : <div className="my-12 rounded-lg border border-dashed border-border bg-card p-12 text-center"><Search className="mx-auto size-8 text-[#90B4CC]" /><h2 className="mt-4 font-heading text-2xl">No articles match yet</h2><p className="mt-2 text-muted-foreground">Try a different category or search term.</p></div>}</section></main><SiteFooter /></div>;
}
