import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookOpen, Lock, Search } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/portal/empty-state";
import { KIND_LABELS, LIBRARY_KINDS } from "@/lib/library/taxonomy";
import { getActor } from "@/server/auth/actor";
import { isFeatureEnabled } from "@/server/features";
import type { LibraryConfidentiality } from "@/db/schema";

export const dynamic = "force-dynamic";

const CONFIDENTIALITY_LABEL: Record<LibraryConfidentiality, string> = {
	public: "Public",
	members: "Members",
	confidential: "Confidential",
};

export default async function LibraryPage({
	searchParams,
}: {
	searchParams: Promise<{ kind?: string; q?: string }>;
}) {
	// The portal layout already redirects signed-out visitors to /signin, so this guard is
	// what a signed-in member hits. Kept above the data loading so a disabled surface
	// never touches a repository.
	if (!isFeatureEnabled("library")) notFound();

	const actor = await getActor();
	if (!actor) redirect("/signin");
	const params = await searchParams;

	const repositories = await getRepositories();
	// ponytail: stopgap listing on the new search API; Task 13 replaces this page.
	const kind = LIBRARY_KINDS.find((value) => value === params.kind);
	const items = await repositories.library
		.search(actor, { q: params.q, kinds: kind ? [kind] : undefined, limit: 100 })
		.then((result) => result.cards)
		.catch(() => []);

	return (
		<div className="grid gap-5">
			<div>
				<p className="text-xs font-semibold uppercase text-primary">Member workspace</p>
				<h1 className="font-heading text-3xl">Library</h1>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
					Articles and case studies from CODE. Browse by topic or search.
				</p>
			</div>

			<form className="flex flex-wrap items-center gap-2" action="/portal/library">
				{kind ? <input type="hidden" name="kind" value={kind} /> : null}
				<div className="relative flex-1 sm:max-w-sm">
					<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input name="q" defaultValue={params.q ?? ""} placeholder="Search title or topic" className="pl-9" />
				</div>
				<Button type="submit" variant="secondary">
					Search
				</Button>
				<Button asChild variant="ghost" size="sm">
					<Link href="/portal/library/lists">My lists</Link>
				</Button>
			</form>

			<div className="flex flex-wrap gap-2">
				<CategoryChip label="All" href={buildHref(undefined, params.q)} active={!kind} />
				{LIBRARY_KINDS.map((value) => (
					<CategoryChip key={value} label={KIND_LABELS[value]} href={buildHref(value, params.q)} active={kind === value} />
				))}
			</div>

			{items.length === 0 ? (
				<EmptyState icon={BookOpen} title="Nothing here yet" description="No library items match. Try a different topic or search." />
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{items.map((item) => (
						<Link key={item.id} href={`/portal/library/${item.id}`} className="group">
							<Card className="h-full transition-colors group-hover:border-accent">
								<CardHeader>
									<div className="flex flex-wrap items-center gap-2">
										<Badge variant="secondary">{KIND_LABELS[item.kind]}</Badge>
										{item.confidentiality !== "members" ? (
											<Badge variant={item.confidentiality === "confidential" ? "warn" : "info"} className="gap-1">
												{item.confidentiality === "confidential" ? <Lock className="size-3" /> : null}
												{CONFIDENTIALITY_LABEL[item.confidentiality]}
											</Badge>
										) : null}
									</div>
									<CardTitle className="text-lg leading-snug">{item.title}</CardTitle>
								</CardHeader>
								<CardContent className="flex flex-col gap-3">
									<p className="line-clamp-3 text-sm text-muted-foreground">{item.dek}</p>
								</CardContent>
							</Card>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}

function buildHref(kind: string | undefined, q: string | undefined): string {
	const sp = new URLSearchParams();
	if (kind) sp.set("kind", kind);
	if (q) sp.set("q", q);
	const query = sp.toString();
	return query ? `/portal/library?${query}` : "/portal/library";
}

function CategoryChip({ label, href, active }: { label: string; href: string; active: boolean }) {
	return (
		<Link
			href={href}
			className={
				active
					? "rounded-full border border-accent bg-secondary px-3 py-1 text-xs font-medium text-foreground"
					: "rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
			}
		>
			{label}
		</Link>
	);
}
