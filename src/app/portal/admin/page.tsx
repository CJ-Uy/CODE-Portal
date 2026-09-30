import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getRepositories } from "@/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
		<div className="grid gap-6">
			{groups.map((group) => (
				<div key={group.segment} className="grid gap-3">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{group.pages.map((page) => (
							<Link
								key={page.href}
								href={page.href}
								className="group flex flex-col gap-1 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent"
							>
								<span className="font-medium group-hover:text-accent">{page.label}</span>
								<span className="text-sm text-muted-foreground">{page.description}</span>
							</Link>
						))}
					</div>
				</div>
			))}

			{can(actor, "nav:configure") ? (
				<Card>
					<CardHeader>
						<CardTitle>Dashboard Shortcuts</CardTitle>
						<CardDescription>Shared resources surfaced on the member dashboard.</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-2">
						{quickLinks.length === 0 ? (
							<p className="text-sm text-muted-foreground">No shortcuts yet.</p>
						) : (
							quickLinks.map((link) => (
								<a
									key={link.id}
									href={link.url}
									className="flex items-center gap-2 text-sm hover:text-primary"
									target="_blank"
									rel="noreferrer"
								>
									<ExternalLink className="size-4" />
									{link.label}
								</a>
							))
						)}
						<Link href="/portal/admin/system/quick-links" className="mt-2 text-sm text-primary hover:underline">
							Manage shortcuts
						</Link>
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}
