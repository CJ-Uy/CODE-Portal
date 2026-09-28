import type { LucideIcon } from "lucide-react";
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

export function RetentionProgress({ points, retainedAt }: { points: number; retainedAt: number | null }) {
	const target = retainedAt ?? 0;
	const pct = target > 0 ? Math.min(100, Math.round((points / target) * 100)) : 0;
	return (
		<div className="space-y-2">
			<div className="h-2 rounded-full bg-muted">
				<div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
			</div>
			<p className="text-xs text-muted-foreground">
				{target > 0 ? `${points} of ${target} points toward retained status.` : "No active term target set."}
			</p>
		</div>
	);
}
