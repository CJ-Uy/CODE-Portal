import { redirect } from "next/navigation";
import { CalendarDays, Link2 } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberAvatar } from "@/components/portal/member-avatar";
import { MemberCodeCard } from "@/components/member-code-card";
import { getActor } from "@/server/auth/actor";
import type { OverviewSummary } from "@/db/repositories/overview";
import { EditProfileForm } from "./edit-profile-form";
import { buildPointBreakdown } from "./point-breakdown";

export const dynamic = "force-dynamic";

const EMPTY_SUMMARY: OverviewSummary = {
	retention: { points: 0, retainedAt: null, termName: null },
	pendingSurveys: 0,
	upcomingEvents: 0,
	linkClicks: 0,
};

const STATUS_LABEL = {
	retained: "Retained",
	on_track: "On track",
	probation: "Probation",
} as const;

function initialsFrom(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);
	return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "M";
}

export default async function ProfilePage() {
	const actor = await getActor();
	if (!actor) redirect("/signin");

	const repositories = await getRepositories();
	const member = await repositories.members.getById(actor, actor.memberId);
	if (!member) redirect("/signin");
	const [summary, loadedHistory, pointTypes] = await Promise.all([
		repositories.overview.getSummary(actor).catch(() => EMPTY_SUMMARY),
		repositories.retention.myHistory(actor, {}).catch(() => null),
		repositories.pointTypes.list().catch(() => null),
	]);
	const history = loadedHistory ?? { summary: null, records: [] };
	const pointRows = loadedHistory && pointTypes ? buildPointBreakdown(pointTypes, loadedHistory.records) : null;

	const displayName = member.nickname ?? member.fullName ?? member.name ?? member.email;
	const subtitle = [member.pronouns, member.batch].filter(Boolean).join(" · ");

	const stats = [
		{ label: "Upcoming events", value: summary.upcomingEvents, icon: CalendarDays },
		{ label: "Link clicks", value: summary.linkClicks, icon: Link2 },
	];

	return (
		<div className="grid gap-6">
			<Card className="overflow-hidden">
				<div className="h-20 bg-primary" aria-hidden />
				<CardContent className="pt-0">
					<MemberAvatar initials={initialsFrom(displayName)} className="-mt-10 size-20 text-2xl ring-4 ring-card" />
					<div className="mt-3 min-w-0">
						<h1 className="font-heading text-2xl text-foreground">{member.fullName ?? member.name ?? displayName}</h1>
						<p className="text-sm text-muted-foreground">{subtitle || member.email}</p>
					</div>
					<dl className="mt-6 grid grid-cols-2 gap-3">
						{stats.map((stat) => {
							const Icon = stat.icon;
							return (
								<div key={stat.label} className="rounded-xl border border-border bg-background p-3 text-center">
									<Icon className="mx-auto size-4 text-accent" />
									<dd className="mt-1 font-heading text-xl text-foreground">{stat.value}</dd>
									<dt className="text-xs text-muted-foreground">{stat.label}</dt>
								</div>
							);
						})}
					</dl>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between gap-3">
						<CardTitle>Points this term</CardTitle>
						{history.summary ? (
							<Badge variant={history.summary.status === "probation" ? "warn" : "secondary"}>
								{STATUS_LABEL[history.summary.status]}
							</Badge>
						) : null}
					</div>
					{history.summary ? (
						<CardDescription>
							{history.summary.totalPoints} retention points · retained at {history.summary.retainedAt}
						</CardDescription>
					) : null}
				</CardHeader>
				<CardContent>
					{pointRows ? (
						pointRows.map((row) => (
							<div key={row.pointTypeId} className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
								<div className="min-w-0">
									<p className="break-all text-sm font-medium">{row.label}</p>
									{row.retention ? (
										<p className="text-xs text-muted-foreground">Counts toward retention</p>
									) : null}
								</div>
								<span className="font-heading text-xl tabular-nums">{row.totalPoints}</span>
							</div>
						))
					) : (
						<p className="text-sm text-muted-foreground">Points are unavailable right now.</p>
					)}
				</CardContent>
			</Card>

			<div className="grid gap-6 lg:grid-cols-[1fr_320px]">
				<MemberCodeCard memberId={actor.memberId} className="lg:order-last" />
				<Card className="lg:order-first">
					<CardHeader>
						<CardTitle>Edit profile</CardTitle>
						<CardDescription>Keep the member details used across the portal current.</CardDescription>
					</CardHeader>
					<CardContent>
						<EditProfileForm
							values={{
								fullName: member.fullName ?? member.name ?? "",
								nickname: member.nickname ?? "",
								pronouns: member.pronouns ?? "",
								batch: member.batch ?? "",
								birthday: member.birthday ?? "",
								// birthday_private defaults to 1, so a member who never set a birthday has made no
								// choice yet — show them the default (public) rather than a stale opt-out.
								birthdayPublic: member.birthday ? !member.birthdayPrivate : true,
							}}
						/>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
