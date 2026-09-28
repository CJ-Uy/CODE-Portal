import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import type { Article } from "@/content/site";
import { PlaceholderBlock } from "@/components/public/placeholder-block";

export function PageHero({ eyebrow, children, description }: { eyebrow: string; children: ReactNode; description?: string }) {
	return (
		<header className="relative isolate overflow-hidden bg-primary text-primary-foreground">
			<div className="absolute inset-0 -z-20 bg-[radial-gradient(110%_90%_at_10%_0%,rgba(144,180,204,0.28),transparent_58%)]" />
			<div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
				<p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#90B4CC]">{eyebrow}</p>
				<h1 className="mt-4 max-w-4xl text-balance font-heading text-4xl leading-[1.08] text-white sm:text-5xl lg:text-6xl">{children}</h1>
				{description ? <p className="mt-5 max-w-2xl text-lg leading-8 text-white/75">{description}</p> : null}
			</div>
		</header>
	);
}

export function ArticleCard({ article }: { article: Article }) {
	return (
		<Link href={`/product/${article.id}`} className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card transition hover:-translate-y-0.5 hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
			<PlaceholderBlock label={`Article cover: ${article.title}`} className="min-h-44 rounded-none border-0 border-b" />
			<div className="flex flex-1 flex-col p-6">
				<div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
					<span className="uppercase tracking-[0.12em] text-accent">{article.cat}</span>
					<span aria-hidden="true">·</span>
					<span className="inline-flex items-center gap-1"><Clock className="size-3" />{article.read}</span>
				</div>
				<h2 className="mt-3 text-balance font-heading text-2xl leading-tight transition-colors group-hover:text-accent">{article.title}</h2>
				<p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{article.dek}</p>
				<span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-accent">Read article <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></span>
			</div>
		</Link>
	);
}
