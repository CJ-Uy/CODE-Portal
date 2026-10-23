import { redirect } from "next/navigation";
import { signInPath } from "@/server/auth/sign-in";
import { ChevronDown, QrCode } from "lucide-react";
import { getRepositories } from "@/db";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberAvatar } from "@/components/portal/member-avatar";
import { MemberCodeCard } from "@/components/member-code-card";
import { getActor } from "@/server/auth/actor";
import { EditProfileForm } from "./edit-profile-form";
import { buildPointBreakdown } from "./point-breakdown";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
	retained: "Retained",
	on_track: "On track",
	probation: "Probation",
} as const;

function initialsFrom(name: string): string {
	const parts = name.trim().split(/\s+/).slice(0, 2);
	return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "M";
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
	const actor = await getActor();
	if (!actor) redirect(await signInPath());

	const repositories = await getRepositories();
	const member = await repositories.members.getById(actor, actor.memberId);
	if (!member) redirect(await signInPath());
	const [loadedHistory, pointTypes] = await Promise.all([
		repositories.retention.myHistory(actor, {}).catch(() => null),
		repositories.pointTypes.list().catch(() => null),
	]);
	const history = loadedHistory ?? { summary: null, records: [] };
	const pointRows = loadedHistory && pointTypes ? buildPointBreakdown(pointTypes, loadedHistory.records) : null;

	const displayName = member.nickname ?? member.fullName ?? member.name ?? member.email;
	const subtitle = [member.batch ? `Batch ${member.batch}` : null, member.pronouns].filter(Boolean).join(" · ");
	// Home's "Show my check-in code" link lands here with ?code=1, so the code is already open.
	const openCode = Boolean((await searchParams).code);

	return (
		<div className="grid min-w-0 max-w-3xl grid-cols-1 gap-6">
			<Card className="overflow-hidden">
				<div className="h-16 bg-primary" aria-hidden />
				<CardContent className="pt-0">
					<MemberAvatar initials={initialsFrom(displayName)} className="-mt-9 size-18 text-2xl ring-4 ring-card" />
					<div className="mt-3 min-w-0">
						<h1 className="font-heading text-2xl text-foreground [overflow-wrap:anywhere]">{member.fullName ?? member.name ?? displayName}</h1>
						{subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
						<p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{member.email}</p>
					</div>
				</CardContent>
			</Card>

			<details id="check-in" open={openCode} className="group min-w-0 scroll-mt-24">
				<summary className={buttonVariants({ variant: "outline", className: "min-h-11 w-fit cursor-pointer list-none bg-card [&::-webkit-details-marker]:hidden" })}>
					<QrCode aria-hidden />
					<span className="group-open:hidden">Show my check-in code</span>
					<span className="hidden group-open:inline">Hide check-in code</span>
					<ChevronDown className="group-open:rotate-180" aria-hidden />
				</summary>
				<div className="mt-3 max-w-sm"><MemberCodeCard memberId={actor.memberId} /></div>
			</details>

			<Card>
				<CardHeader className="pb-3">
					<h2 className="text-base font-semibold">Your details</h2>
					<CardDescription>Officers and the calendar use these.</CardDescription>
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
									<p className="text-sm font-medium [overflow-wrap:anywhere]">{row.label}</p>
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

		</div>
	);
}
