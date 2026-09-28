import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import type { Metadata } from "next";
import { ArticleFeedback } from "@/components/public/article-feedback";
import { PlaceholderBlock } from "@/components/public/placeholder-block";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { ARTICLES, getArticle } from "@/content/site";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
	if (!isFeatureEnabled("publicSite")) notFound();
	const { slug } = await params;
	const article = getArticle(slug);
	return { title: article ? `${article.title} — CODE` : "Article — CODE" };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
	if (!isFeatureEnabled("publicSite")) notFound();
	const { slug } = await params;
	const article = getArticle(slug);
	if (!article) notFound();
	const keepReading = ARTICLES.filter((other) => other.id !== article.id).slice(0, 2);

	return (
		<div className="min-h-screen bg-background text-foreground">
			<SiteHeader />

			<article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
				<Link href="/product" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
					<ArrowLeft className="size-4" />
					Product Center
				</Link>

				<div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					<span className="font-semibold uppercase tracking-wide text-accent">{article.cat}</span>
					<span className="inline-flex items-center gap-1">
						<Clock className="size-3" />
						{article.read}
					</span>
					<span>{article.author}</span>
					<span>{article.date}</span>
				</div>
				<h1 className="mt-3 font-heading text-4xl leading-tight">{article.title}</h1>
				<p className="mt-4 text-lg leading-8 text-muted-foreground">{article.dek}</p>

				<p className="mt-8 border-l-2 border-accent pl-4 leading-relaxed text-foreground/90">{article.abstract}</p>

				{article.sections.map((section) => (
					<section key={section.h} className="mt-10">
						<h2 className="font-heading text-2xl">{section.h}</h2>
						<p className="mt-3 leading-relaxed text-foreground/90">{section.body}</p>
						<PlaceholderBlock label={section.figure} className="mt-4 aspect-[16/7]" />
					</section>
				))}

				<section className="mt-12">
					<h2 className="font-heading text-2xl">{article.components.title}</h2>
					<div className="mt-4 grid gap-3 sm:grid-cols-2">
						{article.components.items.map((item) => (
							<div key={item.name} className="rounded-2xl border border-border p-4">
								<p className="font-medium">{item.name}</p>
								<p className="mt-1 text-sm text-muted-foreground">{item.def}</p>
								<p className="mt-2 text-sm italic text-foreground/80">{item.ex}</p>
							</div>
						))}
					</div>
				</section>

				<section className="mt-12">
					<h2 className="font-heading text-2xl">Questions to sit with</h2>
					<ul className="mt-3 list-disc space-y-2 pl-5 text-foreground/90">
						{article.questions.map((question) => (
							<li key={question}>{question}</li>
						))}
					</ul>
				</section>

				<section className="mt-12">
					<h2 className="font-heading text-xl">References</h2>
					<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
						{article.refs.map((ref) => (
							<li key={ref}>{ref}</li>
						))}
					</ul>
				</section>

				<div className="mt-12">
					<ArticleFeedback slug={article.id} />
				</div>

				{keepReading.length > 0 ? (
					<section className="mt-12">
						<h2 className="font-heading text-2xl">Keep reading</h2>
						<div className="mt-4 grid gap-4 sm:grid-cols-2">
							{keepReading.map((other) => (
								<Link
									key={other.id}
									href={`/product/${other.id}`}
									className="group rounded-2xl border border-border p-4 transition-colors hover:border-accent"
								>
									<span className="text-xs font-semibold uppercase tracking-wide text-accent">{other.cat}</span>
									<p className="mt-1 font-heading text-lg leading-snug group-hover:text-accent">{other.title}</p>
								</Link>
							))}
						</div>
					</section>
				) : null}
			</article>

			<SiteFooter />
		</div>
	);
}
