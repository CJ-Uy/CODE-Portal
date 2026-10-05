import Link from "next/link";
import { AdminIntro } from "@/components/portal/admin-intro";
import { notFound, redirect } from "next/navigation";
import { Inbox } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/portal/empty-state";
import { getActor } from "@/server/auth/actor";
import { hasAnyAdminScope } from "@/server/auth/admin";
import { isFeatureEnabled } from "@/server/features";

export const dynamic = "force-dynamic";

const SEGMENT_LABEL: Record<string, string> = {
	within_ls: "Within LS",
	outside_ls: "Outside LS",
	not_sure: "Not sure",
};

function formatWhen(value: Date): string {
	return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export default async function AdminSubmissionsPage({
	searchParams,
}: {
	searchParams: Promise<{ tab?: string }>;
}) {
	if (!isFeatureEnabled("publicSite")) notFound();
	const actor = await getActor();
	if (!actor) redirect("/signin");
	if (!hasAnyAdminScope(actor)) redirect("/portal");

	const tab = (await searchParams).tab === "feedback" ? "feedback" : "contact";
	const repositories = await getRepositories();
	const [contact, feedback] = await Promise.all([
		repositories.submissions.listContact(actor, { limit: 100 }).catch(() => []),
		repositories.submissions.listFeedback(actor, { limit: 100 }).catch(() => []),
	]);

	const tabs = [
		{ id: "contact", label: `Contact (${contact.length})`, href: "/portal/admin/content/submissions" },
		{ id: "feedback", label: `Article feedback (${feedback.length})`, href: "/portal/admin/content/submissions?tab=feedback" },
	];

	return (
		<div className="grid gap-5">
			<AdminIntro title="Submissions" whoFor="Read inquiries and article feedback from the public site" />

			<div className="flex gap-2 border-b border-border">
				{tabs.map((item) => (
					<Link
						key={item.id}
						href={item.href}
						aria-current={tab === item.id ? "page" : undefined}
						className={
							tab === item.id
								? "-mb-px border-b-2 border-accent px-3 py-2 text-sm font-semibold text-foreground"
								: "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
						}
					>
						{item.label}
					</Link>
				))}
			</div>

			{tab === "contact" ? (
				contact.length === 0 ? (
					<EmptyState icon={Inbox} title="No contact submissions yet" />
				) : (
					<div className="grid gap-3">
						{contact.map((row) => (
							<Card key={row.id}>
								<CardContent className="grid gap-1 py-4">
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-medium">{row.name}</span>
										<span className="text-sm text-muted-foreground">· {row.organization}</span>
										<Badge variant="secondary">{SEGMENT_LABEL[row.orgSegment] ?? row.orgSegment}</Badge>
										<span className="ml-auto text-xs text-muted-foreground">{formatWhen(row.createdAt)}</span>
									</div>
									<a href={`mailto:${row.email}`} className="text-sm text-accent hover:underline">
										{row.email}
									</a>
									<p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">{row.message}</p>
								</CardContent>
							</Card>
						))}
					</div>
				)
			) : feedback.length === 0 ? (
				<EmptyState icon={Inbox} title="No article feedback yet" />
			) : (
				<div className="grid gap-3">
					{feedback.map((row) => (
						<Card key={row.id}>
							<CardContent className="grid gap-1 py-4">
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="info">{row.rating}/5</Badge>
									<span className="text-sm font-medium">{row.articleSlug}</span>
									<span className="ml-auto text-xs text-muted-foreground">{formatWhen(row.createdAt)}</span>
								</div>
								{row.comment ? <p className="text-sm text-foreground/90">{row.comment}</p> : null}
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
