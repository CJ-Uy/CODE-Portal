import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { RetentionVerdict } from "@/components/retention-parts";
import type { OverviewSummary } from "@/db/repositories/overview";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

export function MetricCard({
	label,
	value,
	description,
	icon: Icon,
}: {
	label: string;
	value: string;
	description: string;
	icon: LucideIcon;
}) {
	return (
		<Card>
			<CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
				<CardDescription>{label}</CardDescription>
				<Icon className="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-semibold">{value}</div>
				<p className="mt-1 text-xs text-muted-foreground">{description}</p>
			</CardContent>
		</Card>
	);
}

export function RetentionProgress({ retention }: { retention: OverviewSummary["retention"] }) {
	if (!retention || retention.progress.required === 0) {
		return <p className="text-xs text-muted-foreground">No school year is running, so there is nothing to track yet.</p>;
	}
	return (
		<div className="grid gap-3">
			<RetentionVerdict progress={retention.progress} compact />
			<Link href="/portal/retention" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
				See what you still need
				<ArrowRight className="size-4" aria-hidden />
			</Link>
		</div>
	);
}
