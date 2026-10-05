import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { AdminTools } from "@/components/portal/admin-tools";
import { Button } from "@/components/ui/button";
import { getRepositories } from "@/db";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { getFeatureFlags } from "@/server/features";
import { visibleGroups } from "./nav";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
	const actor = await requireActor();
	const repositories = await getRepositories();
	// quick links has no shared-dev internal proxy yet; degrade to an empty list instead of crashing.
	const quickLinks = can(actor, "nav:configure") ? await repositories.quickLinks.list(actor).catch(() => []) : [];
	const groups = visibleGroups(actor, getFeatureFlags());

	return (
		<div className="grid gap-8">
			<header className="border-b border-border/60 pb-6">
				<h1 className="text-3xl font-semibold text-primary sm:text-4xl">Admin</h1>
				<p className="mt-2 max-w-2xl text-base leading-6 text-muted-foreground">Manage CODE members, communications and records. Find a tool below to get started.</p>
			</header>
			<AdminTools groups={groups} />

			{can(actor, "nav:configure") ? (
				<section className="grid gap-3 border-t border-border/60 pt-6" aria-labelledby="member-shortcuts">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 id="member-shortcuts" className="text-xl font-semibold text-primary">Member dashboard shortcuts</h2>
							<p className="mt-1 text-sm text-muted-foreground">Shared resources members see on their dashboard.</p>
						</div>
						<Button asChild variant="outline"><Link href="/portal/admin/system/quick-links">Manage shortcuts <ArrowRight /></Link></Button>
					</div>
					<div className="flex flex-wrap gap-x-6 gap-y-3">
						{quickLinks.length === 0 ? (
							<p className="text-sm text-muted-foreground">Add a shortcut to give members quick access to a shared resource.</p>
						) : (
							quickLinks.map((link) => (
								<a
									key={link.id}
									href={link.url}
									className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									target="_blank"
									rel="noreferrer"
								>
									{link.label}
									<ExternalLink className="size-3.5" aria-hidden />
									<span className="sr-only"> (opens in a new tab)</span>
								</a>
							))
						)}
					</div>
				</section>
			) : null}
		</div>
	);
}
