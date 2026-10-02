import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { getRepositories } from "@/db";
import { Input } from "@/components/ui/input";
import { SAMPLE_MERGE_VALUES } from "@/lib/email/merge";
import { renderEmail, valueResolver } from "@/lib/email/render";
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

	return (
		<div className="grid gap-6">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h1 className="font-heading text-3xl">Templates</h1>
					<p className="text-sm text-muted-foreground">Reusable designs. Editing a template never changes emails already sent.</p>
				</div>
				<form className="relative w-full sm:w-64">
					<Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
					<Input name="q" defaultValue={q} placeholder="Search templates" className="pl-8" aria-label="Search templates" />
				</form>
			</header>
			<ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
				<li className="row-enter">
					<Link
						href="/portal/admin/email/templates/new"
						className="flex h-full min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted-foreground transition-[border-color,color,transform] hover:border-accent hover:text-foreground active:scale-[0.99]"
					>
						<Plus className="size-5" aria-hidden />
						New template
					</Link>
				</li>
				{templates.map((t, i) => {
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
						<li key={t.id} className="row-enter" style={{ animationDelay: `${Math.min(i + 1, 8) * 30}ms` }}>
							<Link
								href={`/portal/admin/email/templates/${t.id}`}
								className="group grid overflow-hidden rounded-xl border border-border bg-card transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-accent hover:shadow-md motion-reduce:hover:translate-y-0"
							>
								<div className="pointer-events-none relative h-44 overflow-hidden bg-[#F5F5F6]" aria-hidden>
									<div className="absolute left-1/2 top-3 w-[600px] origin-top -translate-x-1/2 scale-[0.5]" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
								</div>
								<div className="grid gap-0.5 border-t border-border p-3">
									<span className="min-w-0 truncate font-medium">{t.name}</span>
									<span className="text-sm text-muted-foreground">
										Updated {formatManila(t.updatedAt).split(",")[0]} · used {t.usedCount}×
									</span>
								</div>
							</Link>
						</li>
					);
				})}
			</ul>
			{templates.length === 0 && q ? <p className="text-sm text-muted-foreground">No templates match &quot;{q}&quot;.</p> : null}
		</div>
	);
}
