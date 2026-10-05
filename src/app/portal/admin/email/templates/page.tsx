import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Plus, Search } from "lucide-react";
import { AdminIntro } from "@/components/portal/admin-intro";
import { Button } from "@/components/ui/button";
import { getRepositories } from "@/db";
import { Input } from "@/components/ui/input";
import { SAMPLE_MERGE_VALUES } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
import { emailStarters } from "@/lib/email/starters";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { emailConfigFromEnv } from "@/server/email/db";
import { formatManila } from "../campaign-row";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
	const actor = await requireActor();
	if (!can(actor, "email:configure")) redirect("/portal/admin/email");
	const { q = "" } = await searchParams;
	const { email } = await getRepositories();
	const templates = await email.templates.list(actor, { q });
	const { publicBaseUrl } = emailConfigFromEnv();
	const starters = emailStarters(publicBaseUrl).filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase()));
	const items = [
		...starters.map((t) => ({ ...t, categoryName: "CODE", meta: t.description, href: `/portal/admin/email/templates/new?starter=${t.id}`, useHref: `/portal/admin/email/new?starter=${t.id}`, builtIn: true })),
		...templates.map((t) => ({ ...t, meta: `Updated ${formatManila(t.updatedAt).split(",")[0]} · used ${t.usedCount} times`, href: `/portal/admin/email/templates/${t.id}`, useHref: `/portal/admin/email/new?template=${t.id}`, builtIn: false })),
	];

	return (
		<div className="grid gap-6">
			<AdminIntro title="Email templates" whoFor="Start with a CODE design or reuse one of your saved templates" effect="Every starter opens as editable content. Customize the details and audience before sending" />
			<div className="flex flex-wrap items-center justify-between gap-3">
				<form className="relative w-full sm:w-64">
					<Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
					<Input type="search" name="q" defaultValue={q} placeholder="Search templates" className="pl-8" aria-label="Search templates" />
				</form>
				<Button asChild variant="outline"><Link href="/portal/admin/email/templates/new"><Plus />New template</Link></Button>
			</div>
			<p role="status" className="text-sm text-muted-foreground">{starters.length} CODE starters · {templates.length} saved templates{q ? ` matching “${q}”` : ""}</p>
			<ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{items.map((t) => {
					const { bodyHtml } = renderEmail({
						subject: t.subject,
						preheader: t.preheader,
						blocks: t.blocks,
						resolve: valueResolver(SAMPLE_MERGE_VALUES),
						values: SAMPLE_MERGE_VALUES,
						baseUrl: publicBaseUrl,
						footer: { categoryName: t.categoryName ?? "CODE", required: true, archiveUrl: null, preferencesUrl: "#", unsubscribeUrl: null },
					});
					return (
						<li key={`${t.builtIn ? "starter" : "saved"}:${t.id}`} className="grid min-w-0 content-start overflow-hidden rounded-xl border border-border bg-card">
								<div className="pointer-events-none relative h-44 overflow-hidden bg-[#F5F5F6]" inert>
									<div className="absolute left-1/2 top-3 w-[600px] origin-top -translate-x-1/2 scale-[0.5]" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
								</div>
								<div className="grid gap-2 border-t border-border p-4">
									<h2 className="font-heading text-xl">{t.name}</h2>
									<p className="text-sm text-muted-foreground">{t.meta}</p>
									<div className="mt-1 flex flex-wrap items-center justify-between gap-2"><Button asChild size="sm"><Link href={t.useHref}>Use template<ArrowUpRight /></Link></Button><Link href={t.href} className="rounded-sm text-sm text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t.builtIn ? "Customize & save" : "Edit template"}</Link></div>
								</div>
						</li>
					);
				})}
			</ul>
			{items.length === 0 ? <p className="text-sm text-muted-foreground">No templates match &quot;{q}&quot;. <Link href="/portal/admin/email/templates" className="text-accent underline">Clear search</Link></p> : null}
		</div>
	);
}
